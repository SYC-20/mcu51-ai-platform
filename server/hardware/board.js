// 板卡抽象：SimBoard（内置 8051 仿真）与 HardwareBoard（STC ISP 烧录 + 检测 MCU 串口采集）
// 两者对上层提供相同接口：flash(image) / capture(ms, keyScript) / pressKeys(mask) / on('pins')
import { EventEmitter } from 'node:events'
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Cpu8051 } from './emu8051.js'
import { flashStc89 } from './stcisp.js'
import { FrameParser, MonitorDecoder, T, decodePins, encodeFrame, keyFrame } from './protocol.js'

const KEY_BITS = [4, 5, 6, 7] // key1~key4 → P2.4~P2.7

export class SimBoard extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.kind = 'sim'
    this.cpu = null
    this.keyMask = 0
    this.liveTimer = null
    // 单 MCU 模式：引脚数据只来自程序里的自检测代码经串口发出的帧，和实物板一样
    this.monitor = !!cfg.monitor?.enabled
    this.liveBuf = []
    this.liveDec = new MonitorDecoder((s) => {
      this.liveLast = s
      this.liveBuf.push(s)
    })
  }
  info() {
    return { kind: 'sim', name: `内置 8051 仿真板（STC89C52 @ 11.0592MHz${this.cfg.monitor?.onchip ? '，板上测评' : this.monitor ? '，单 MCU 自检测' : ''}）`, connected: true, programmed: !!this.cpu }
  }
  async flash(image, log = () => {}) {
    log('模拟板：加载程序镜像')
    this.cpu = new Cpu8051(image, { clockHz: this.cfg.board.clockHz })
    log(`下载完成 ${image.length} 字节，仿真单片机开始运行`, { progress: 1 })
    this.startLive()
    return { ok: true, bytes: image.length }
  }
  applyKeys() {
    if (this.monitor) return this.cpu?.sendSerial(keyFrame(this.keyMask))
    let low = 0
    for (let k = 0; k < 4; k++) if (this.keyMask & (1 << k)) low |= 1 << KEY_BITS[k]
    this.cpu?.setExternalLow(2, low)
  }
  pressKeys(mask) {
    this.keyMask = mask & 0x0f
    this.applyKeys()
  }
  // 实时运行（给界面显示用）：每 50ms 推进 50ms 仿真时间
  startLive() {
    this.stopLive()
    this.liveTimer = setInterval(() => {
      if (!this.cpu || this.capturing) return
      if (this.monitor) {
        this.cpu.run(50)
        this.liveDec.push(this.cpu.serialOut.splice(0).map((x) => x.byte))
        // 每一帧都要往上送，网页的步进电机按相位逐步累计，丢帧会算错步数和方向
        const buf = this.liveBuf.splice(0)
        if (buf.length) for (const x of buf) this.emit('pins', x)
        else if (this.liveLast) this.emit('pins', this.liveLast)
        return
      }
      this.cpu.run(50, () => this.emitPins())
      this.emitPins()
    }, 50)
  }
  stopLive() {
    if (this.liveTimer) clearInterval(this.liveTimer)
    this.liveTimer = null
  }
  emitPins() {
    const c = this.cpu
    this.emit('pins', { t: Math.round(c.timeMs), p0: c.portPins(0), p1: c.portPins(1), p2: c.portPins(2), p3: c.portPins(3), p4: c.sfr[0xe8] })
  }
  async capture(ms, keyScript = []) {
    if (!this.cpu) throw new Error('目标板还没有程序，请先烧录')
    if (this.monitor) return this.captureMonitor(ms, keyScript)
    this.capturing = true
    try {
      // 测评从复位开始，保证结果可复现
      this.cpu.reset()
      this.keyMask = 0
      this.applyKeys()
      const events = []
      for (const k of keyScript) {
        events.push({ t: k.atMs, mask: 1 << k.key })
        events.push({ t: k.atMs + k.holdMs, mask: 0 })
      }
      events.sort((a, b) => a.t - b.t)
      const samples = []
      const rec = (t, [p0, p1, p2, p3, p4]) => samples.push({ t, p0, p1, p2, p3, p4 })
      const snap = () => rec(this.cpu.timeMs, [...[0, 1, 2, 3].map((i) => this.cpu.portPins(i)), this.cpu.sfr[0xe8]])
      snap()
      let now = 0
      for (const ev of [...events, { t: ms, mask: null }]) {
        if (ev.t > now) this.cpu.run(ev.t - now, () => snap())
        now = Math.max(now, ev.t)
        if (ev.mask !== null) {
          this.keyMask = ev.mask
          this.applyKeys()
          snap()
        }
      }
      return { samples, durationMs: ms, serial: this.cpu.serialOut.splice(0) }
    } finally {
      this.capturing = false
    }
  }
  captureMonitor(ms, keyScript) {
    this.capturing = true
    try {
      this.cpu.reset()
      this.cpu.serialOut.length = 0
      this.keyMask = 0
      // 板上测评：按键由单片机里的测评代码自己模拟，测完还要等它发结果帧
      const onchip = !!this.cfg.monitor?.onchip
      if (!onchip) for (const k of keyScript) this.cpu.sendSerial(keyFrame(1 << k.key, k.holdMs), k.atMs)
      this.cpu.run(ms + (onchip ? 150 : 20))
      const samples = []
      const results = []
      const dec = new MonitorDecoder((s) => samples.push(s), (r) => results.push(r))
      dec.push(this.cpu.serialOut.splice(0).map((x) => x.byte))
      this.liveDec.reset()
      this.liveBuf = []
      return { samples: samples.filter((s) => s.t <= ms), durationMs: ms, serial: [], onchip: onchip ? results[0] ?? null : undefined, diag: { port: '仿真串口', rawBytes: dec.frames * 11, hello: false } }
    } finally {
      this.capturing = false
    }
  }
  async close() {
    this.stopLive()
  }
}

function runCommand(template, vars, log) {
  return new Promise((resolve, reject) => {
    const parts = template.match(/"[^"]*"|\S+/g).map((p) => p.replace(/^"|"$/g, '').replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? ''))
    log(`执行：${parts.join(' ')}`)
    const child = spawn(parts[0], parts.slice(1), { windowsHide: true })
    child.stdout.on('data', (d) => log(String(d).trim()))
    child.stderr.on('data', (d) => log(String(d).trim()))
    child.on('error', reject)
    child.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`烧录命令退出码 ${code}`))))
  })
}

export class HardwareBoard extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.kind = 'hardware'
    this.port = null
    this.lastHello = null
    this.lastPins = null
    this.listeners = new Set()
  }
  info() {
    return {
      kind: 'hardware',
      name: `实物板（烧录 ${this.cfg.flash.port} / 检测 ${this.cfg.detector.port}）`,
      connected: !!this.port?.isOpen,
      detectorVersion: this.lastHello,
      lastPins: this.lastPins,
    }
  }
  async openDetector() {
    if (this.port?.isOpen) return
    const { SerialPort } = await import('serialport')
    const { port, baud } = this.cfg.detector
    this.port = new SerialPort({ path: port, baudRate: baud, autoOpen: false })
    await new Promise((res, rej) => this.port.open((e) => (e ? rej(new Error(`无法打开检测串口 ${port}: ${e.message}`)) : res())))
    const parser = new FrameParser((type, payload) => {
      if (type === T.PINS && payload.length >= 8) {
        const s = decodePins(payload)
        this.lastPins = s
        this.emit('pins', s)
        for (const l of this.listeners) l(s)
      } else if (type === T.HELLO) {
        this.lastHello = payload[0]
        this.helloCount = (this.helloCount || 0) + 1
      }
    })
    // RTS 经 Q1/Q2 控制 STC89C52 的地（MCUGND），保持 RTS 不有效 = 工作单片机供电
    await new Promise((r) => this.port.set({ rts: false }, () => r()))
    this.rawBytes = 0
    this.port.on('data', (d) => ((this.rawBytes += d.length), parser.push(d)))
    this.port.on('close', () => this.emit('status', this.info()))
  }
  async closeDetector() {
    if (this.port?.isOpen) await new Promise((r) => this.port.close(() => r()))
    this.port = null
  }
  send(type, payload) {
    if (!this.port?.isOpen) throw new Error('检测 MCU 串口未连接')
    this.port.write(encodeFrame(type, payload))
  }
  pressKeys(mask) {
    this.send(T.KEY, [mask & 0x0f, 0, 0])
  }
  async flash(image, log = () => {}) {
    const shared = this.cfg.flash.port === this.cfg.detector.port
    if (shared) await this.closeDetector()
    try {
      if (this.cfg.flash.driver === 'command') {
        const tmp = path.join(os.tmpdir(), `mcu51-${Date.now()}.bin`)
        fs.writeFileSync(tmp, image)
        await runCommand(this.cfg.flash.command, { port: this.cfg.flash.port, hex: tmp, bin: tmp }, log)
        fs.rmSync(tmp, { force: true })
        return { ok: true, bytes: image.length }
      }
      return await flashStc89(image, this.cfg.flash, log)
    } finally {
      await this.openDetector().catch((e) => log(`检测串口未打开：${e.message}`))
    }
  }
  async capture(ms, keyScript = []) {
    await this.openDetector()
    const samples = []
    let t0 = null
    const onPins = (s) => {
      if (t0 === null) t0 = s.t
      samples.push({ ...s, t: s.t - t0 })
    }
    this.listeners.add(onPins)
    const timers = []
    try {
      const raw0 = this.rawBytes
      const hello0 = this.helloCount || 0
      this.send(T.RESETCLOCK, [])
      const win = Math.min(65000, ms + 1000)
      this.send(T.START, [0x4d, 0x35, 0x31, win & 0xff, win >> 8])
      this.diag = () => ({ port: this.cfg.detector.port, rawBytes: this.rawBytes - raw0, hello: (this.helloCount || 0) > hello0 })
      for (const k of keyScript) {
        timers.push(setTimeout(() => this.send(T.KEY, [1 << k.key, k.holdMs & 0xff, k.holdMs >> 8]), k.atMs))
      }
      await new Promise((r) => setTimeout(r, ms + 150))
    } finally {
      timers.forEach(clearTimeout)
      this.listeners.delete(onPins)
    }
    const diag = this.diag?.()
    return { samples, durationMs: ms, serial: [], diag }
  }
  async close() {
    await this.closeDetector()
  }
}

// 单 MCU 实物板：没有 IAP15 检测芯片。烧录口和检测口是同一根 CH340 线：
// 烧录时由 STC ISP 占用，平时以 115200bps 接收学生单片机里自检测代码发来的 MON 帧
export class SingleBoard extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.kind = 'hardware'
    this.port = null
    this.lastPins = null
    this.listeners = new Set()
    this.dec = new MonitorDecoder(
      (s) => {
        this.lastPins = s
        this.emit('pins', s)
        for (const l of this.listeners) l(s)
      },
      (r) => (this.lastResult ??= r),
    )
  }
  info() {
    return { kind: 'hardware', name: `${this.cfg.monitor?.onchip ? '板上测评' : '单 MCU'} 实物板（烧录+检测 ${this.cfg.flash.port}）`, connected: !!this.port?.isOpen, lastPins: this.lastPins }
  }
  async open() {
    if (this.port?.isOpen) return
    const { SerialPort } = await import('serialport')
    const path = this.cfg.flash.port
    this.port = new SerialPort({ path, baudRate: this.cfg.monitor.baud, autoOpen: false })
    await new Promise((res, rej) => this.port.open((e) => (e ? rej(new Error(`无法打开串口 ${path}: ${e.message}`)) : res())))
    await this.power(true)
    this.rawBytes = 0
    this.port.on('data', (d) => ((this.rawBytes += d.length), this.dec.push(d)))
    this.port.on('close', () => this.emit('status', this.info()))
  }
  // 与 STC ISP 冷启动相同：RTS（或 DTR）控制单片机供电
  power(on) {
    const { powerCycle, powerCycleInvert } = this.cfg.flash
    if (powerCycle === 'none') return
    const off = !powerCycleInvert
    const v = on ? !off : off
    return new Promise((r) => this.port.set(powerCycle === 'dtr' ? { dtr: v } : { rts: v }, () => r()))
  }
  async closePort() {
    if (this.port?.isOpen) await new Promise((r) => this.port.close(() => r()))
    this.port = null
  }
  pressKeys(mask) {
    if (!this.port?.isOpen) throw new Error('串口未连接')
    this.port.write(keyFrame(mask))
  }
  async flash(image, log = () => {}) {
    await this.closePort()
    try {
      return await flashStc89(image, this.cfg.flash, log)
    } finally {
      await this.open().catch((e) => log(`串口未打开：${e.message}`))
    }
  }
  async capture(ms, keyScript = []) {
    await this.open()
    const samples = []
    const timers = []
    const raw0 = this.rawBytes
    const onchip = !!this.cfg.monitor?.onchip
    this.lastResult = null
    try {
      // 从复位开始采集，结果可复现；不能控制供电时只把时间清零
      if (this.cfg.flash.powerCycle !== 'none') {
        await this.power(false)
        await new Promise((r) => setTimeout(r, 400))
        this.dec.reset()
        await this.power(true)
      } else {
        this.dec.reset()
        this.port.write(encodeFrame(T.RESETCLOCK, []))
      }
      const first = await new Promise((resolve) => {
        const to = setTimeout(() => (this.listeners.delete(on), resolve(null)), 3000)
        const on = (s) => (clearTimeout(to), this.listeners.delete(on), resolve(s))
        this.listeners.add(on)
      })
      if (first) {
        const t0 = first.t
        samples.push({ ...first, t: 0 })
        const onPins = (s) => samples.push({ ...s, t: s.t - t0 })
        this.listeners.add(onPins)
        if (!onchip) for (const k of keyScript) timers.push(setTimeout(() => this.port.write(keyFrame(1 << k.key, k.holdMs)), k.atMs))
        await new Promise((r) => setTimeout(r, ms + 150))
        this.listeners.delete(onPins)
        for (let i = 0; onchip && !this.lastResult && i < 30; i++) await new Promise((r) => setTimeout(r, 100))
      }
    } finally {
      timers.forEach(clearTimeout)
    }
    return { samples: samples.filter((s) => s.t <= ms), durationMs: ms, serial: [], onchip: onchip ? this.lastResult : undefined, diag: { port: this.cfg.flash.port, rawBytes: this.rawBytes - raw0, hello: false, single: true } }
  }
  async close() {
    await this.closePort()
  }
}

export function createBoard(cfg) {
  if (cfg.mode === 'hardware') return cfg.monitor?.enabled ? new SingleBoard(cfg) : new HardwareBoard(cfg)
  return new SimBoard(cfg)
}
