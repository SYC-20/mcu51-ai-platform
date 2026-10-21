import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { parseIntelHex } from './hex.js'
import { ROOT } from '../config.js'
import { EXPERIMENTS } from '../judge/experiments.js'

export const MONITOR_SRC = path.join(ROOT, 'firmware', 'monitor', 'monitor.c')

// 单 MCU 模式：把学生的 main 改名，再附加自检测代码（它的 main 先启动检测再调用学生程序）
export const EVAL_SRC = path.join(ROOT, 'firmware', 'monitor', 'eval.h')
// 板上测评：实验 → eval.h 里的实验类型编号（结果帧第 1 个字节）
export const EVAL_IDS = { blink: 1, water: 2, keyled: 3, buzzer: 4, segstatic: 5, segdynamic: 6, led35: 7, segkey: 8, stepfwd: 9, stepdir: 10, stepspeed: 11 }

// 板上测评：按实验生成 eval.h 需要的宏和按键脚本表
export function evalHeader(expId) {
  const e = EXPERIMENTS[expId]
  if (!e || !EVAL_IDS[expId]) throw new Error(`板上测评不支持实验：${expId}`)
  const ks = e.keyScript
  const tab = (name, f) => `static __code unsigned ${name === 'kkey' ? 'char' : 'int'} __ev_${name}[] = { ${ks.length ? ks.map(f).join(', ') : '0'} };`
  return [`#define __EV_EXP ${EVAL_IDS[expId]}`, `#define __EV_END ${e.captureMs}`, `#define __EV_NK ${ks.length}`, tab('kat', (k) => k.atMs), tab('khold', (k) => k.holdMs), tab('kkey', (k) => k.key), ''].join('\n')
}

export function attachMonitor(converted, expId) {
  const re = /\b(?:void|int)\s+main\s*\(\s*(?:void)?\s*\)\s*\{/
  if (!re.test(converted)) throw new Error('没有找到 void main(void) 函数')
  const mon = fs.readFileSync(MONITOR_SRC, 'utf8')
  const pre = expId ? `/* 板上测评：${EXPERIMENTS[expId].title} */\n${evalHeader(expId)}` : ''
  return `${converted.replace(re, 'void __student_main(void) {')}\n#line 1 "monitor.c"\n${pre}${mon}`
}

function run(cmd, args, cwd) {
  return new Promise((resolve) => {
    let out = ''
    let stdout = ''
    let child
    try {
      child = spawn(cmd, args, { cwd, windowsHide: true })
    } catch (err) {
      resolve({ code: -1, out: String(err) })
      return
    }
    child.stdout.on('data', (d) => ((out += d), (stdout += d)))
    child.stderr.on('data', (d) => (out += d))
    child.on('error', (err) => resolve({ code: -1, out: `${out}\n无法启动 ${cmd}: ${err.message}` }))
    child.on('close', (code) => resolve({ code, out, stdout }))
  })
}

// 把 Keil C51 常见写法转换成 SDCC 写法，学生可以直接粘贴 Keil 代码
export function keilToSdcc(src) {
  let s = src
  s = s.replace(/#include\s*[<"]reg(52|51|x52)\.h[>"]/gi, '#include <8052.h>')
  s = s.replace(/#include\s*[<"]stc89c5xrc\.h[>"]/gi, '#include <8052.h>\n__sfr __at (0xE8) P4;')
  s = s.replace(/#include\s*[<"]intrins\.h[>"]/gi, '')
  s = s.replace(/\bsbit\s+(\w+)\s*=\s*(P[0-4])\s*\^\s*([0-7])\s*;/g, (_, n, p, b) => `__sbit __at (0x${((p[1] === '4' ? 0xe8 : 0x80 + Number(p[1]) * 0x10) + Number(b)).toString(16)}) ${n};`)
  s = s.replace(/\bsfr\s+(\w+)\s*=\s*(0x[0-9a-f]+)\s*;/gi, '__sfr __at ($2) $1;')
  s = s.replace(/\binterrupt\s+(\d+)/g, '__interrupt($1)')
  s = s.replace(/\busing\s+(\d+)/g, '__using($1)')
  s = s.replace(/\b_nop_\s*\(\s*\)/g, '__asm nop __endasm')
  s = s.replace(/\b(code)\b(?=\s+(unsigned|signed|char|int|uchar|uint|u8|u16))/g, '__code')
  s = s.replace(/(?<=\b(?:char|int|short|long|uchar|uint|u8|u16)\s+)code\b(?=\s+[A-Za-z_])/g, '__code')
  s = s.replace(/\bxdata\b/g, '__xdata').replace(/\bidata\b/g, '__idata').replace(/\bbit\b(?=\s+\w+\s*[;=])/g, '__bit')
  if (!/#include\s*<(8052|8051|at89x52|reg51)\.h>/.test(s)) s = `#include <8052.h>\n#line 1\n${s}`
  return s
}

export function parseSdccErrors(log) {
  const errors = []
  for (const line of log.split(/\r?\n/)) {
    const m = line.match(/^(?:.*[\\/])?main\.c:(\d+):\s*(error|warning)\s*(\d+)?:?\s*(.*)$/i)
    if (m) errors.push({ line: Number(m[1]), severity: m[2].toLowerCase(), message: m[4].trim() })
    else if (/^\?ASlink-Error|error/i.test(line) && !/^\s*$/.test(line) && !m && /ASlink|Insufficient|exceed/i.test(line))
      errors.push({ line: 0, severity: 'error', message: line.trim() })
  }
  return errors
}

export async function compileC(source, cfg, { experiment } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcu51-'))
  try {
    const converted = keilToSdcc(source)
    let full = converted
    if (cfg.monitor?.enabled) {
      if (/\b(SBUF|SCON|TI|RI|ES|TR1|TH1|TL1|ET1|T2CON|RCAP2[HL]|TR2)\b|__interrupt\s*\(\s*[345]\s*\)/.test(converted.replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '')))
        return { ok: false, errors: [{ line: 0, severity: 'error', message: (cfg.monitor.onchip ? '板上测评模式下' : '单 MCU 检测模式下') + '，学生程序不能使用串口、定时器 1、定时器 2（它们留给检测代码）' }], log: '', converted }
      try {
        full = attachMonitor(converted, cfg.monitor.onchip ? experiment : null)
      } catch (e) {
        return { ok: false, errors: [{ line: 0, severity: 'error', message: e.message }], log: '', converted }
      }
    }
    fs.writeFileSync(path.join(dir, 'main.c'), full)
    fs.copyFileSync(EVAL_SRC, path.join(dir, 'eval.h'))
    const { bin, packihx, codeSize, iramSize } = cfg.sdcc
    const res = await run(bin, ['-mmcs51', `--code-size`, String(codeSize), `--iram-size`, String(iramSize), 'main.c'], dir)
    const errors = parseSdccErrors(res.out)
    const ihx = path.join(dir, 'main.ihx')
    if (res.code !== 0 || !fs.existsSync(ihx)) {
      if (!errors.some((e) => e.severity === 'error')) errors.push({ line: 0, severity: 'error', message: res.out.trim() || '编译失败' })
      return { ok: false, errors, log: res.out, converted }
    }
    const pk = await run(packihx, [ihx], dir)
    const hex = pk.code === 0 && pk.stdout.includes(':00000001FF') ? pk.stdout.slice(pk.stdout.indexOf(':')) : fs.readFileSync(ihx, 'utf8')
    const image = parseIntelHex(hex)
    return { ok: true, errors, log: res.out, hex, size: image.length, converted }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}
