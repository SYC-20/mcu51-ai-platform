// STC89C5x 串口 ISP 下载协议（与自研烧写软件流程一致：0x7F 握手 → 设波特率 → 擦除 → 分块下载）
// 帧格式参考开源项目 stcgal（MIT License, Grigori Goronzy）中 STC89 协议的公开描述，本文件为独立实现。
import { SerialPort } from 'serialport'

const START = [0x46, 0xb9]
const HOST = 0x6a
const MCU = 0x68
const END = 0x16
const BLOCK = 128

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export function buildPacket(payload) {
  const len = payload.length + 5
  const body = [HOST, len >> 8, len & 0xff, ...payload]
  const sum = body.reduce((a, b) => a + b, 0) & 0xff
  return Buffer.from([...START, ...body, sum, END])
}

class Link {
  constructor(port) {
    this.port = port
    this.buf = Buffer.alloc(0)
    this.waiters = []
    port.on('data', (d) => {
      this.buf = Buffer.concat([this.buf, d])
      this.waiters.splice(0).forEach((w) => w())
    })
  }
  async setBaud(baud) {
    await new Promise((res, rej) => this.port.update({ baudRate: baud }, (e) => (e ? rej(e) : res())))
  }
  write(buf) {
    return new Promise((res, rej) => this.port.write(buf, (e) => (e ? rej(e) : this.port.drain(() => res()))))
  }
  setSignals(sig) {
    return new Promise((res) => this.port.set(sig, () => res()))
  }
  clear() {
    this.buf = Buffer.alloc(0)
  }
  // 解析一帧 MCU → 主机 的数据包，返回 payload
  tryParse() {
    const i = this.buf.indexOf(Buffer.from(START))
    if (i < 0) return null
    const b = this.buf.subarray(i)
    if (b.length < 5) return null
    if (b[2] !== MCU) {
      this.buf = b.subarray(1)
      return this.tryParse()
    }
    const len = (b[3] << 8) | b[4]
    const total = len + 2
    if (b.length < total) return null
    const pkt = b.subarray(0, total)
    this.buf = b.subarray(total)
    if (pkt[total - 1] !== END) throw new Error('ISP 数据包结束符错误')
    const sum = pkt.subarray(2, total - 2).reduce((a, v) => a + v, 0) & 0xff
    if (sum !== pkt[total - 2]) throw new Error('ISP 数据包校验和错误')
    return Buffer.from(pkt.subarray(5, total - 2))
  }
  async readPacket(timeoutMs = 2000) {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      const p = this.tryParse()
      if (p) return p
      const left = deadline - Date.now()
      if (left <= 0) throw new Error('等待单片机应答超时')
      await new Promise((r) => {
        const t = setTimeout(r, Math.min(left, 50))
        this.waiters.push(() => {
          clearTimeout(t)
          r()
        })
      })
    }
  }
}

export async function flashStc89(image, opts, log = () => {}) {
  const { port: path, handshakeBaud = 2400, transferBaud = 19200, powerCycle = 'rts', powerCycleInvert = false, timeoutMs = 15000 } = opts
  const port = new SerialPort({ path, baudRate: handshakeBaud, dataBits: 8, parity: 'none', stopBits: 1, autoOpen: false })
  await new Promise((res, rej) => port.open((e) => (e ? rej(new Error(`无法打开串口 ${path}: ${e.message}`)) : res())))
  const link = new Link(port)
  try {
    log(`串口 ${path} 已打开，握手波特率 ${handshakeBaud}`)
    if (powerCycle !== 'none') {
      const off = !powerCycleInvert
      const sig = (v) => (powerCycle === 'dtr' ? { dtr: v } : { rts: v })
      log('通过 CH340 RTS 断开 STC89C52 电源再接通（冷启动，检测芯片保持供电）...')
      await link.setSignals(sig(off))
      await sleep(1000)
      await link.setSignals(sig(!off))
    } else log('请给目标板断电后重新上电...')

    // 1. 持续发送 0x7F，直到收到状态包
    log('发送 0x7F 同步...')
    link.clear()
    const deadline = Date.now() + timeoutMs
    let status = null
    let badPkt = 0
    while (!status) {
      if (Date.now() > deadline) throw new Error('未检测到单片机：请确认串口、接线并重新上电')
      await link.write(Buffer.from([0x7f]))
      try {
        status = await link.readPacket(30)
      } catch (e) {
        if (!/超时/.test(e.message)) {
          if (!badPkt++) log(`收到无法识别的应答（${e.message}），可能检测芯片 IAP15 也在应答，继续同步...`)
          link.clear()
        }
      }
    }
    if (status[0] !== 0x00) throw new Error(`收到非预期状态包 0x${status[0].toString(16)}`)
    let counts = 0
    for (let i = 0; i < 8; i++) counts += status.readUInt16BE(1 + i * 2)
    const freqCount = counts / 8
    const clockHz = (handshakeBaud * freqCount * 12) / 7
    const magic = status.length >= 22 ? status.readUInt16BE(20) : 0xf002
    log(`检测到单片机：型号码 0x${magic.toString(16).toUpperCase()}，BSL 版本 ${status[17] >> 4}.${status[17] & 0xf}，时钟约 ${(clockHz / 1e6).toFixed(3)} MHz`)

    // 2. 切换波特率
    const brt = 65536 - Math.round(clockHz / (transferBaud * 32))
    const brtCsum = (2 * (256 - (brt >> 8))) & 0xff
    const delay = 0x80
    const iapWait = clockHz < 5e6 ? 0x83 : clockHz < 10e6 ? 0x82 : clockHz < 20e6 ? 0x81 : 0x80
    await sleep(50)
    await link.write(buildPacket([0x8f, brt >> 8, brt & 0xff, 0xff - (brt >> 8), brtCsum, delay, iapWait]))
    await sleep(200)
    await link.setBaud(transferBaud)
    let r = await link.readPacket()
    await link.setBaud(handshakeBaud)
    if (r[0] !== 0x8f) throw new Error('波特率测试失败')
    await link.write(buildPacket([0x8e, brt >> 8, brt & 0xff, 0xff - (brt >> 8), brtCsum, delay]))
    await sleep(200)
    await link.setBaud(transferBaud)
    r = await link.readPacket()
    if (r[0] !== 0x8e) throw new Error('波特率切换失败')
    for (let i = 0; i < 4; i++) {
      await link.write(buildPacket([0x80, 0x00, 0x00, 0x36, 0x01, magic >> 8, magic & 0xff]))
      r = await link.readPacket()
      if (r[0] !== 0x80) throw new Error('通信测试失败')
    }
    log(`已切换到 ${transferBaud} 波特率`)

    // 3. 擦除
    const blks = Math.min(0xff, Math.ceil(image.length / 512) * 2)
    log('擦除 Flash...')
    await link.write(buildPacket([0x84, blks, 0x33, 0x33, 0x33, 0x33, 0x33, 0x33]))
    r = await link.readPacket(10000)
    if (r[0] !== 0x80) throw new Error('擦除失败')

    // 4. 分块下载
    for (let addr = 0; addr < image.length; addr += BLOCK) {
      const chunk = Buffer.alloc(BLOCK, 0x00)
      image.copy(chunk, 0, addr, Math.min(addr + BLOCK, image.length))
      const pkt = [0x00, 0x00, 0x00, addr >> 8, addr & 0xff, BLOCK >> 8, BLOCK & 0xff, ...chunk]
      const csum = chunk.reduce((a, b) => a + b, 0) & 0xff
      await link.write(buildPacket(pkt))
      r = await link.readPacket()
      if (r[0] !== 0x80) throw new Error(`写入地址 0x${addr.toString(16)} 失败`)
      if (r[1] !== csum) throw new Error(`地址 0x${addr.toString(16)} 校验失败`)
      log(`下载 ${Math.min(addr + BLOCK, image.length)}/${image.length} 字节`, { progress: Math.min(1, (addr + BLOCK) / image.length) })
    }
    // 5. 结束，单片机开始运行新程序
    await link.write(buildPacket([0x82]))
    log('下载完成，单片机已复位运行')
    return { ok: true, bytes: image.length, clockHz, magic }
  } finally {
    await new Promise((r) => port.close(() => r()))
  }
}
