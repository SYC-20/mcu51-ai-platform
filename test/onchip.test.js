// 单 MCU 自检测模式：引脚数据只来自程序里附加的检测代码经串口发出的帧
import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { compileC } from '../server/lib/compile.js'
import { MonitorDecoder, encodeFrame, T } from '../server/hardware/protocol.js'
import { SimBoard } from '../server/hardware/board.js'
import { parseIntelHex } from '../server/lib/hex.js'
import { EXPERIMENTS, judge } from '../server/judge/experiments.js'
import { loadConfig } from '../server/config.js'

const cfg = loadConfig(['--sim', '--single'])
const src = (f) => fs.readFileSync(new URL(`../examples/student/${f}.c`, import.meta.url), 'utf8')

test('单 MCU：MON 帧解析，16 位毫秒时间自动展开', () => {
  const got = []
  const d = new MonitorDecoder((s) => got.push(s.t))
  for (const t of [65530, 65535, 3, 100]) d.push(encodeFrame(T.MON, [0, 0xff, 0xff, 0xff, 0x04, t & 0xff, t >> 8]))
  assert.deepEqual(got, [65530, 65535, 65539, 65636])
})

test('单 MCU：学生程序用了串口或定时器 1/2 时给出明确提示', async () => {
  const r = await compileC('#include <reg52.h>\nvoid main(void){ SCON = 0x50; while(1); }', cfg)
  assert.equal(r.ok, false)
  assert.match(r.errors[0].message, /串口/)
  const ok = await compileC('#include <reg52.h>\n// 注释里写 SBUF 不算\nvoid main(void){ while(1); }', cfg)
  assert.equal(ok.ok, true, JSON.stringify(ok.errors))
})

for (const [file, exp, pass] of [['blink', 'blink', true], ['water', 'water', true], ['keyled', 'keyled', true], ['buzzer', 'buzzer', true], ['seg_static', 'segstatic', true], ['seg_dynamic', 'segdynamic', true], ['led35', 'led35', true], ['seg_key', 'segkey', true], ['blink', 'led35', false], ['seg_static', 'segkey', false], ['step_fwd', 'stepfwd', true], ['step_dir', 'stepdir', true], ['step_speed', 'stepspeed', true], ['step_fwd', 'stepdir', false], ['step_fwd', 'stepspeed', false], ['water_student', 'water', false]]) {
  test(`单 MCU 仿真：${file} 只靠串口检测帧判分 → ${pass ? '通过' : '不通过'}`, async () => {
    const c = await compileC(src(file), cfg)
    assert.equal(c.ok, true, JSON.stringify(c.errors))
    const b = new SimBoard(cfg)
    await b.flash(parseIntelHex(c.hex))
    b.stopLive()
    const e = EXPERIMENTS[exp]
    const cap = await b.capture(e.captureMs, e.keyScript)
    assert.ok(cap.samples.length > 10)
    const j = judge(exp, cap.samples, cap.durationMs)
    assert.equal(j.pass, pass, JSON.stringify(j.checks))
  })
}

// ===== 板上测评：单片机自己打分，经串口回传结果帧，不改端口 =====
const ocfg = loadConfig(['--sim', '--onchip'])
const { onchipResult } = await import('../server/judge/onchip.js')
const { segDigits } = await import('../server/judge/experiments.js')

for (const [file, exp, pass] of [['blink', 'blink', true], ['water', 'water', true], ['keyled', 'keyled', true], ['buzzer', 'buzzer', true], ['seg_static', 'segstatic', true], ['seg_dynamic', 'segdynamic', true], ['led35', 'led35', true], ['seg_key', 'segkey', true], ['blink', 'led35', false], ['seg_static', 'segkey', false], ['step_fwd', 'stepfwd', true], ['step_dir', 'stepdir', true], ['step_speed', 'stepspeed', true], ['step_fwd', 'stepdir', false], ['step_fwd', 'stepspeed', false], ['water_student', 'water', false]]) {
  test(`板上测评仿真：${file} 单片机打分 → ${pass ? '100 分' : '不通过'}，与平台复现一致，测完学生程序继续运行`, async () => {
    const c = await compileC(src(file), ocfg, { experiment: exp })
    assert.equal(c.ok, true, JSON.stringify(c.errors))
    const b = new SimBoard(ocfg)
    await b.flash(parseIntelHex(c.hex))
    b.stopLive()
    const e = EXPERIMENTS[exp]
    const cap = await b.capture(e.captureMs, e.keyScript)
    assert.ok(cap.onchip, '没有收到结果帧')
    const j = judge(exp, cap.samples, cap.durationMs)
    const r = onchipResult(exp, cap.onchip, j)
    assert.equal(r.pass, pass, JSON.stringify({ r, j: j.checks }))
    if (pass) assert.equal(r.score, 100)
    assert.equal(r.score, j.score, `单片机 ${r.score} 分，平台复现 ${j.score} 分：${r.onchip.text} ${JSON.stringify(j.checks)}`)
    // 测完后测评代码不动端口，学生程序继续运行；结果帧约每 2 秒重发
    const after = []
    const resent = []
    b.cpu.serialOut.length = 0
    b.cpu.run(2500)
    new MonitorDecoder((s) => after.push(s), (res) => resent.push(res)).push(b.cpu.serialOut.map((x) => x.byte))
    assert.ok(resent.length >= 1 && resent.every((x) => x.score === r.score), '测完后没有按原分数重发结果帧')
    assert.ok(after.length > 5, '测完后没有端口实况帧')
    assert.ok(!after.some((s) => (s.p2 & 0x0f) === 0x0e && (s.p0 === 0x73 || s.p0 === 0x71)), '测完后数码管不应显示 P/F')
    if (!e.keyScript.length && exp !== 'led35' && file !== 'led35') assert.ok(new Set(after.map((s) => `${s.p0},${s.p1},${s.p2},${s.p4}`)).size >= 2, '测完后学生程序应继续运行（端口仍在变化）')
  })
}

test('板上测评：烧进去的测评代码与所选实验不一致时给出明确提示', () => {
  const r = onchipResult('water', { code: 1, score: 100, n: 3, bits: 7, data: Array(16).fill(0) }, { checks: [], score: 0, pass: false })
  assert.equal(r.pass, false)
  assert.match(r.checks[0].detail, /重新编译/)
})

// 实物板：位选直接接共阴极，数码管亮着时读 P2 引脚得 1；测评代码改读锁存器后仍应判对
for (const [file, exp] of [['seg_static', 'segstatic'], ['seg_dynamic', 'segdynamic']]) {
  test(`板上测评仿真：${file} 位选引脚被数码管电流抬高时仍按锁存值判分 → 100 分`, async () => {
    const c = await compileC(src(file), ocfg, { experiment: exp })
    assert.equal(c.ok, true, JSON.stringify(c.errors))
    const b = new SimBoard(ocfg)
    await b.flash(parseIntelHex(c.hex))
    b.stopLive()
    b.cpu.digitSinkOverload = true
    const e = EXPERIMENTS[exp]
    const cap = await b.capture(e.captureMs, e.keyScript)
    assert.ok(cap.onchip, '没有收到结果帧')
    assert.ok(cap.samples.some((s) => (s.p2 & 0x0f) !== 0x0f), '端口帧里的位选也应是锁存值')
    const j = judge(exp, cap.samples, cap.durationMs)
    const r = onchipResult(exp, cap.onchip, j)
    assert.equal(r.score, 100, JSON.stringify(r.checks))
    assert.equal(j.score, 100, JSON.stringify(j.checks))
    assert.ok(r.checks.every((x) => !/^第 \d+ 项$/.test(x.name)), '检查项应有名称')
  })
}

// 实物板：电机 4 相接 ULN2003 输入，引脚被拉低；测评代码读锁存值仍应判对
for (const [file, exp] of [['step_fwd', 'stepfwd'], ['step_dir', 'stepdir'], ['step_speed', 'stepspeed']]) {
  test(`板上测评仿真：${file} 电机引脚被 ULN2003 拉低时仍按锁存值判分 → 100 分`, async () => {
    const c = await compileC(src(file), ocfg, { experiment: exp })
    assert.equal(c.ok, true, JSON.stringify(c.errors))
    const b = new SimBoard(ocfg)
    await b.flash(parseIntelHex(c.hex))
    b.stopLive()
    b.cpu.motorSink = true
    const e = EXPERIMENTS[exp]
    const cap = await b.capture(e.captureMs, e.keyScript)
    assert.ok(cap.onchip, '没有收到结果帧')
    const j = judge(exp, cap.samples, cap.durationMs)
    const r = onchipResult(exp, cap.onchip, j)
    assert.equal(r.score, 100, JSON.stringify(r.checks))
    assert.equal(j.score, 100, JSON.stringify(j.checks))
  })
}
