import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const DATA_DIR = path.join(ROOT, 'data')

const DEFAULTS = {
  port: 8051,
  host: '127.0.0.1',
  // sim: 使用内置 8051 仿真器代替实物板；hardware: 使用串口连接实物板
  mode: 'sim',
  sdcc: { bin: 'sdcc', packihx: 'packihx', codeSize: 8192, iramSize: 256 },
  flash: {
    // builtin: 内置 STC89 串口 ISP；command: 调用外部烧录命令（如 stcgal）
    driver: 'builtin',
    port: 'COM3',
    handshakeBaud: 2400,
    transferBaud: 19200,
    // 冷启动方式：rts / dtr / none（none 需要手动给板子断电再上电）
    powerCycle: 'rts',
    powerCycleInvert: false,
    timeoutMs: 15000,
    command: 'stcgal -P stc89 -p {port} {hex}',
  },
  detector: {
    // 检测 MCU（IAP15F2K61S2）串口；可与烧录口相同（烧录完成后自动切换波特率）
    port: 'COM3',
    baud: 115200,
  },
  // 单 MCU 模式：不用 IAP15 检测芯片，编译时给学生程序附加自检测代码（firmware/monitor/monitor.c）
  // onchip：板上测评，再按实验嵌入 firmware/monitor/eval.h，单片机自己打分并串口回传（不改端口）
  monitor: { enabled: false, onchip: false, baud: 115200 },
  board: {
    clockHz: 11059200,
    // 4 个实验共用的引脚约定（来自原平台实验说明）
    ledPort: 'P1',
    ledActiveLow: true,
    buzzerPin: 'P4.2',
    buzzerActiveLow: true,
    keyPins: ['P2.4', 'P2.5', 'P2.6', 'P2.7'],
  },
  agh: {
    // Agnes Harness CLI 入口（Windows 示例：D:\\agnes-harness-main\\packages\\cli\\dist\\stable\\agnes.mjs）
    cli: '',
    node: process.execPath,
    cwd: '',
    timeoutMs: 600000,
    // 同一个对话累计超过这么多字就自动换新对话（AGH 自己也会压缩旧上下文）
    maxChatChars: 150000,
  },
}

function merge(base, over) {
  const out = { ...base }
  for (const [k, v] of Object.entries(over ?? {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' ? merge(base[k], v) : v
  }
  return out
}

export function loadConfig(argv = process.argv.slice(2)) {
  const file = path.join(ROOT, 'config.json')
  let user = {}
  if (fs.existsSync(file)) user = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''))
  const cfg = merge(DEFAULTS, user)
  if (argv.includes('--sim')) cfg.mode = 'sim'
  if (argv.includes('--hardware')) cfg.mode = 'hardware'
  if (argv.includes('--single')) cfg.monitor = { ...cfg.monitor, enabled: true }
  if (argv.includes('--onchip')) cfg.monitor = { ...cfg.monitor, enabled: true, onchip: true }
  const portArg = argv.indexOf('--port')
  if (portArg >= 0) cfg.port = Number(argv[portArg + 1])
  if (!cfg.agh.cwd) cfg.agh.cwd = path.join(DATA_DIR, 'agh-workspace')
  return cfg
}
