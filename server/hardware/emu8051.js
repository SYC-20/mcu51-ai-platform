// 精简但完整指令集的 8051/8052 仿真器：12T 时序、T0/T1/T2、中断、端口与串口输出。
// 用于“模拟板模式”：编译出的 HEX 在这里真实运行，端口变化与实物板一致地送入判分引擎。

const P0 = 0x80, SP = 0x81, DPL = 0x82, DPH = 0x83, TCON = 0x88, TMOD = 0x89, TL0 = 0x8a, TL1 = 0x8b, TH0 = 0x8c, TH1 = 0x8d
const P1 = 0x90, SCON = 0x98, SBUF = 0x99, P2 = 0xa0, IE = 0xa8, P3 = 0xb0, IP = 0xb8, T2CON = 0xc8, RCAP2L = 0xca, RCAP2H = 0xcb
const TL2 = 0xcc, TH2 = 0xcd, PSW = 0xd0, ACC = 0xe0, B = 0xf0
const PORTS = [P0, P1, P2, P3]
const P4 = 0xe8

const TWO_CYCLE = new Set([
  0x02, 0x12, 0x22, 0x32, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x73, 0x75, 0x76, 0x77, 0x82, 0x83, 0x85, 0x86, 0x87,
  0x90, 0x92, 0x93, 0x43, 0x53, 0x63, 0x72, 0xa0, 0xa3, 0xa6, 0xa7, 0xb0, 0xb4, 0xb5, 0xb6, 0xb7, 0xc0, 0xd0, 0xd5, 0xe0,
  0xe2, 0xe3, 0xf0, 0xf2, 0xf3,
])
function cyclesOf(op) {
  if (op === 0x84 || op === 0xa4) return 4
  if ((op & 0x1f) === 0x01 || (op & 0x1f) === 0x11) return 2
  if (TWO_CYCLE.has(op)) return 2
  if (op >= 0x88 && op <= 0x8f) return 2
  if (op >= 0xa8 && op <= 0xaf) return 2
  if (op >= 0xb8 && op <= 0xbf) return 2
  if (op >= 0xd8 && op <= 0xdf) return 2
  return 1
}
const CYCLES = Uint8Array.from({ length: 256 }, (_, i) => cyclesOf(i))

const parity = (v) => {
  v ^= v >> 4
  v ^= v >> 2
  v ^= v >> 1
  return v & 1
}

export class Cpu8051 {
  constructor(image, { clockHz = 11059200 } = {}) {
    this.rom = new Uint8Array(65536).fill(0xff)
    this.rom.set(image.subarray(0, 65536))
    this.machineHz = clockHz / 12
    this.iram = new Uint8Array(256)
    this.sfr = new Uint8Array(256)
    this.xram = new Uint8Array(65536)
    this.extLow = new Uint8Array(4) // 外部拉低的引脚位（按键按下）
    this.serialOut = []
    this.rxQueue = [] // { cycle, byte } 平台发给单片机的串口字节
    this.reset()
  }

  reset() {
    this.pc = 0
    this.cycles = 0
    this.sfr.fill(0)
    for (const p of PORTS) this.sfr[p] = 0xff
    this.sfr[SP] = 0x07
    this.inIsr = [] // 正在服务的中断优先级栈
    this.txDoneAt = -1
    this.rxBuf = 0
    this.rxQueue = []
    this.prevInt = [1, 1]
  }

  get timeMs() {
    return (this.cycles / this.machineHz) * 1000
  }
  portLatch(i) {
    return this.sfr[PORTS[i]]
  }
  portPins(i) {
    const v = this.sfr[PORTS[i]] & ~this.extLow[i] & 0xff
    // 实物板：位选 P2.0~P2.3 直接接共阴极，段亮着时灌入电流把引脚抬高，读引脚得 1
    if (i === 2 && this.digitSinkOverload && this.sfr[P0] & ~this.extLow[0] & 0xff) return v | 0x0f
    return v
  }
  setExternalLow(portIndex, mask) {
    this.extLow[portIndex] = mask & 0xff
  }

  // ---------- 存储访问 ----------
  get A() {
    return this.sfr[ACC]
  }
  set A(v) {
    this.sfr[ACC] = v & 0xff
  }
  get CY() {
    return this.sfr[PSW] >> 7
  }
  set CY(v) {
    this.sfr[PSW] = v ? this.sfr[PSW] | 0x80 : this.sfr[PSW] & 0x7f
  }
  get dptr() {
    return (this.sfr[DPH] << 8) | this.sfr[DPL]
  }
  set dptr(v) {
    this.sfr[DPH] = (v >> 8) & 0xff
    this.sfr[DPL] = v & 0xff
  }
  regAddr(n) {
    return (this.sfr[PSW] & 0x18) + n
  }
  R(n) {
    return this.iram[this.regAddr(n)]
  }
  setR(n, v) {
    this.iram[this.regAddr(n)] = v & 0xff
  }
  readDirect(a, rmw = false) {
    if (a < 0x80) return this.iram[a]
    if (a === PSW) return (this.sfr[PSW] & 0xfe) | parity(this.sfr[ACC])
    if (a === SBUF) return this.rxBuf
    if (!rmw) {
      const pi = PORTS.indexOf(a)
      if (pi >= 0) return this.portPins(pi)
      // 实物板：P4.1/P4.4/P4.5/P4.6 接 ULN2003 输入，引脚被拉低
      if (a === P4 && this.motorSink) return this.sfr[a] & ~0x72
    }
    return this.sfr[a]
  }
  writeDirect(a, v) {
    v &= 0xff
    if (a < 0x80) this.iram[a] = v
    else {
      this.sfr[a] = v
      if (a === SBUF) {
        const n = this.byteCycles()
        if (n) this.txDoneAt = this.cycles + n
        else this.sfr[SCON] |= 0x02
        this.serialOut.push({ t: this.timeMs, byte: v })
      }
    }
  }
  readIndirect(a) {
    return this.iram[a]
  }
  writeIndirect(a, v) {
    this.iram[a] = v & 0xff
  }
  bitLoc(bit) {
    return bit < 0x80 ? [0x20 + (bit >> 3), bit & 7] : [bit & 0xf8, bit & 7]
  }
  readBit(bit, rmw = false) {
    const [a, b] = this.bitLoc(bit)
    return (this.readDirect(a, rmw) >> b) & 1
  }
  writeBit(bit, v) {
    const [a, b] = this.bitLoc(bit)
    const cur = this.readDirect(a, true)
    this.writeDirect(a, v ? cur | (1 << b) : cur & ~(1 << b))
  }
  fetch() {
    const v = this.rom[this.pc]
    this.pc = (this.pc + 1) & 0xffff
    return v
  }
  rel(off) {
    return (this.pc + ((off << 24) >> 24)) & 0xffff
  }
  push(v) {
    this.sfr[SP] = (this.sfr[SP] + 1) & 0xff
    this.iram[this.sfr[SP]] = v & 0xff
  }
  pop() {
    const v = this.iram[this.sfr[SP]]
    this.sfr[SP] = (this.sfr[SP] - 1) & 0xff
    return v
  }
  call(addr) {
    this.push(this.pc & 0xff)
    this.push(this.pc >> 8)
    this.pc = addr
  }

  // ---------- 算术 ----------
  add(v, c) {
    const a = this.A
    const r = a + v + c
    let psw = this.sfr[PSW] & ~0xc4
    if (r > 0xff) psw |= 0x80
    if ((a & 0xf) + (v & 0xf) + c > 0xf) psw |= 0x40
    if (((a ^ r) & (v ^ r) & 0x80) !== 0) psw |= 0x04
    this.sfr[PSW] = psw
    this.A = r
  }
  subb(v) {
    const a = this.A
    const c = this.CY
    const r = a - v - c
    let psw = this.sfr[PSW] & ~0xc4
    if (r < 0) psw |= 0x80
    if ((a & 0xf) - (v & 0xf) - c < 0) psw |= 0x40
    if (((a ^ v) & (a ^ r) & 0x80) !== 0) psw |= 0x04
    this.sfr[PSW] = psw
    this.A = r
  }
  cjne(x, y, off) {
    this.CY = x < y ? 1 : 0
    if (x !== y) this.pc = this.rel(off)
  }

  // 寻址模式取操作数：低 3/4 位 4..F 的通用模式
  srcOperand(op) {
    const lo = op & 0x0f
    if (lo === 4) return this.fetch()
    if (lo === 5) return this.readDirect(this.fetch())
    if (lo === 6 || lo === 7) return this.readIndirect(this.R(lo & 1))
    return this.R(lo - 8)
  }

  step() {
    const op = this.fetch()
    const lo = op & 0x0f
    const hi = op >> 4
    switch (true) {
      case (op & 0x1f) === 0x01: {
        const a = this.fetch()
        this.pc = (this.pc & 0xf800) | ((op & 0xe0) << 3) | a
        break
      }
      case (op & 0x1f) === 0x11: {
        const a = this.fetch()
        this.call((this.pc & 0xf800) | ((op & 0xe0) << 3) | a)
        break
      }
      case hi === 0x2 && lo >= 4:
        this.add(this.srcOperand(op), 0)
        break
      case hi === 0x3 && lo >= 4:
        this.add(this.srcOperand(op), this.CY)
        break
      case hi === 0x9 && lo >= 4:
        this.subb(this.srcOperand(op))
        break
      case (hi === 0x4 || hi === 0x5 || hi === 0x6) && lo >= 2: {
        const f = hi === 0x4 ? (x, y) => x | y : hi === 0x5 ? (x, y) => x & y : (x, y) => x ^ y
        if (lo === 2) {
          const d = this.fetch()
          this.writeDirect(d, f(this.readDirect(d, true), this.A))
        } else if (lo === 3) {
          const d = this.fetch()
          const imm = this.fetch()
          this.writeDirect(d, f(this.readDirect(d, true), imm))
        } else this.A = f(this.A, this.srcOperand(op))
        break
      }
      case hi === 0x0 && lo >= 4: {
        if (lo === 4) this.A = this.A + 1
        else if (lo === 5) {
          const d = this.fetch()
          this.writeDirect(d, this.readDirect(d, true) + 1)
        } else if (lo < 8) {
          const a = this.R(lo & 1)
          this.writeIndirect(a, this.readIndirect(a) + 1)
        } else this.setR(lo - 8, this.R(lo - 8) + 1)
        break
      }
      case hi === 0x1 && lo >= 4: {
        if (lo === 4) this.A = this.A - 1
        else if (lo === 5) {
          const d = this.fetch()
          this.writeDirect(d, this.readDirect(d, true) - 1)
        } else if (lo < 8) {
          const a = this.R(lo & 1)
          this.writeIndirect(a, this.readIndirect(a) - 1)
        } else this.setR(lo - 8, this.R(lo - 8) - 1)
        break
      }
      case hi === 0x7 && lo >= 4: {
        if (lo === 4) this.A = this.fetch()
        else if (lo === 5) {
          const d = this.fetch()
          this.writeDirect(d, this.fetch())
        } else if (lo < 8) this.writeIndirect(this.R(lo & 1), this.fetch())
        else this.setR(lo - 8, this.fetch())
        break
      }
      case hi === 0x8 && lo >= 5: {
        if (lo === 5) {
          const s = this.fetch()
          const d = this.fetch()
          this.writeDirect(d, this.readDirect(s))
        } else if (lo < 8) {
          const d = this.fetch()
          this.writeDirect(d, this.readIndirect(this.R(lo & 1)))
        } else {
          const d = this.fetch()
          this.writeDirect(d, this.R(lo - 8))
        }
        break
      }
      case hi === 0xa && lo >= 6: {
        const d = this.fetch()
        if (lo < 8) this.writeIndirect(this.R(lo & 1), this.readDirect(d))
        else this.setR(lo - 8, this.readDirect(d))
        break
      }
      case hi === 0xb && lo >= 4: {
        if (lo === 4) {
          const imm = this.fetch()
          this.cjne(this.A, imm, this.fetch())
        } else if (lo === 5) {
          const d = this.readDirect(this.fetch())
          this.cjne(this.A, d, this.fetch())
        } else if (lo < 8) {
          const imm = this.fetch()
          this.cjne(this.readIndirect(this.R(lo & 1)), imm, this.fetch())
        } else {
          const imm = this.fetch()
          this.cjne(this.R(lo - 8), imm, this.fetch())
        }
        break
      }
      case hi === 0xc && lo >= 5: {
        const a = this.A
        if (lo === 5) {
          const d = this.fetch()
          this.A = this.readDirect(d, true)
          this.writeDirect(d, a)
        } else if (lo < 8) {
          const r = this.R(lo & 1)
          this.A = this.readIndirect(r)
          this.writeIndirect(r, a)
        } else {
          this.A = this.R(lo - 8)
          this.setR(lo - 8, a)
        }
        break
      }
      case hi === 0xd && lo >= 8: {
        const v = (this.R(lo - 8) - 1) & 0xff
        this.setR(lo - 8, v)
        const off = this.fetch()
        if (v !== 0) this.pc = this.rel(off)
        break
      }
      case hi === 0xe && lo >= 5: {
        if (lo === 5) this.A = this.readDirect(this.fetch())
        else if (lo < 8) this.A = this.readIndirect(this.R(lo & 1))
        else this.A = this.R(lo - 8)
        break
      }
      case hi === 0xf && lo >= 5: {
        if (lo === 5) this.writeDirect(this.fetch(), this.A)
        else if (lo < 8) this.writeIndirect(this.R(lo & 1), this.A)
        else this.setR(lo - 8, this.A)
        break
      }
      default:
        this.misc(op)
    }
    return CYCLES[op]
  }

  misc(op) {
    switch (op) {
      case 0x00:
        break
      case 0x02: {
        const h = this.fetch()
        this.pc = (h << 8) | this.fetch()
        break
      }
      case 0x12: {
        const h = this.fetch()
        const l = this.fetch()
        this.call((h << 8) | l)
        break
      }
      case 0x22:
      case 0x32: {
        const h = this.pop()
        this.pc = (h << 8) | this.pop()
        if (op === 0x32) this.inIsr.pop()
        break
      }
      case 0x03:
        this.A = (this.A >> 1) | ((this.A & 1) << 7)
        break
      case 0x13: {
        const c = this.A & 1
        this.A = (this.A >> 1) | (this.CY << 7)
        this.CY = c
        break
      }
      case 0x23:
        this.A = (this.A << 1) | (this.A >> 7)
        break
      case 0x33: {
        const c = this.A >> 7
        this.A = (this.A << 1) | this.CY
        this.CY = c
        break
      }
      case 0x10: {
        const bit = this.fetch()
        const off = this.fetch()
        if (this.readBit(bit, true)) {
          this.writeBit(bit, 0)
          this.pc = this.rel(off)
        }
        break
      }
      case 0x20:
      case 0x30: {
        const bit = this.fetch()
        const off = this.fetch()
        if (this.readBit(bit) === (op === 0x20 ? 1 : 0)) this.pc = this.rel(off)
        break
      }
      case 0x40:
      case 0x50: {
        const off = this.fetch()
        if (this.CY === (op === 0x40 ? 1 : 0)) this.pc = this.rel(off)
        break
      }
      case 0x60:
      case 0x70: {
        const off = this.fetch()
        if ((this.A === 0) === (op === 0x60)) this.pc = this.rel(off)
        break
      }
      case 0x80:
        this.pc = this.rel(this.fetch())
        break
      case 0x72:
        this.CY = this.CY | this.readBit(this.fetch())
        break
      case 0xa0:
        this.CY = this.CY | (this.readBit(this.fetch()) ^ 1)
        break
      case 0x82:
        this.CY = this.CY & this.readBit(this.fetch())
        break
      case 0xb0:
        this.CY = this.CY & (this.readBit(this.fetch()) ^ 1)
        break
      case 0x73:
        this.pc = (this.A + this.dptr) & 0xffff
        break
      case 0x83:
        this.A = this.rom[(this.A + this.pc) & 0xffff]
        break
      case 0x93:
        this.A = this.rom[(this.A + this.dptr) & 0xffff]
        break
      case 0x84: {
        const b = this.sfr[B]
        let psw = this.sfr[PSW] & ~0x84
        if (b === 0) psw |= 0x04
        else {
          const a = this.A
          this.A = Math.floor(a / b)
          this.sfr[B] = a % b
        }
        this.sfr[PSW] = psw
        break
      }
      case 0xa4: {
        const r = this.A * this.sfr[B]
        let psw = this.sfr[PSW] & ~0x84
        if (r > 0xff) psw |= 0x04
        this.sfr[PSW] = psw
        this.A = r & 0xff
        this.sfr[B] = r >> 8
        break
      }
      case 0x90: {
        const h = this.fetch()
        this.dptr = (h << 8) | this.fetch()
        break
      }
      case 0xa3:
        this.dptr = (this.dptr + 1) & 0xffff
        break
      case 0x92:
        this.writeBit(this.fetch(), this.CY)
        break
      case 0xa2:
        this.CY = this.readBit(this.fetch())
        break
      case 0xb2: {
        const bit = this.fetch()
        this.writeBit(bit, this.readBit(bit, true) ^ 1)
        break
      }
      case 0xb3:
        this.CY = this.CY ^ 1
        break
      case 0xc2:
        this.writeBit(this.fetch(), 0)
        break
      case 0xc3:
        this.CY = 0
        break
      case 0xd2:
        this.writeBit(this.fetch(), 1)
        break
      case 0xd3:
        this.CY = 1
        break
      case 0xc0:
        this.push(this.readDirect(this.fetch()))
        break
      case 0xd0: {
        const d = this.fetch()
        this.writeDirect(d, this.pop())
        break
      }
      case 0xc4:
        this.A = ((this.A << 4) | (this.A >> 4)) & 0xff
        break
      case 0xd4: {
        let a = this.A
        const psw = this.sfr[PSW]
        let cy = psw >> 7
        if ((a & 0xf) > 9 || psw & 0x40) a += 6
        if (a > 0xff) cy = 1
        if (((a >> 4) & 0x1f) > 9 || cy) a += 0x60
        if (a > 0xff) cy = 1
        this.A = a
        this.CY = cy
        break
      }
      case 0xd5: {
        const d = this.fetch()
        const off = this.fetch()
        const v = (this.readDirect(d, true) - 1) & 0xff
        this.writeDirect(d, v)
        if (v !== 0) this.pc = this.rel(off)
        break
      }
      case 0xd6:
      case 0xd7: {
        const r = this.R(op & 1)
        const m = this.readIndirect(r)
        const a = this.A
        this.A = (a & 0xf0) | (m & 0x0f)
        this.writeIndirect(r, (m & 0xf0) | (a & 0x0f))
        break
      }
      case 0xe0:
        this.A = this.xram[this.dptr]
        break
      case 0xe2:
      case 0xe3:
        this.A = this.xram[(this.sfr[P2] << 8) | this.R(op & 1)]
        break
      case 0xf0:
        this.xram[this.dptr] = this.A
        break
      case 0xf2:
      case 0xf3:
        this.xram[(this.sfr[P2] << 8) | this.R(op & 1)] = this.A
        break
      case 0xe4:
        this.A = 0
        break
      case 0xf4:
        this.A = ~this.A
        break
      default:
        break // 0xA5 保留指令，按 NOP 处理
    }
  }

  // 一个串口字节（10 位）占用的机器周期；没有配置波特率时返回 0（立即发送完）
  byteCycles() {
    const t2con = this.sfr[T2CON]
    if (t2con & 0x10) return Math.round((10 * 32 * (0x10000 - ((this.sfr[RCAP2H] << 8) | this.sfr[RCAP2L]))) / 12)
    if (((this.sfr[TMOD] >> 4) & 3) === 2 && this.sfr[TCON] & 0x40) return Math.round((10 * 32 * (256 - this.sfr[TH1])) / (this.sfr[0x87] & 0x80 ? 2 : 1))
    return 0
  }
  // 平台通过串口发给单片机的字节，按波特率在 atMs 之后依次到达
  sendSerial(bytes, atMs = this.timeMs) {
    let c = Math.max(Math.round((atMs / 1000) * this.machineHz), this.rxQueue.at(-1)?.cycle ?? 0, this.cycles)
    for (const b of bytes) this.rxQueue.push({ cycle: (c += this.byteCycles() || 80), byte: b })
  }
  tickSerial() {
    if (this.txDoneAt >= 0 && this.cycles >= this.txDoneAt) {
      this.txDoneAt = -1
      this.sfr[SCON] |= 0x02
    }
    if (this.rxQueue.length && this.cycles >= this.rxQueue[0].cycle && this.sfr[SCON] & 0x10) {
      this.rxBuf = this.rxQueue.shift().byte
      this.sfr[SCON] |= 0x01
    }
  }

  tickTimers(n) {
    const tcon = this.sfr[TCON]
    const tmod = this.sfr[TMOD]
    const t0mode = tmod & 3
    const t1mode = (tmod >> 4) & 3
    if (tcon & 0x10) this.tickTimer(0, t0mode, n)
    if (t0mode === 3) {
      if (tcon & 0x40) {
        const v = this.sfr[TH0] + n
        if (v > 0xff) this.sfr[TCON] |= 0x80
        this.sfr[TH0] = v & 0xff
      }
    } else if (tcon & 0x40 && t1mode !== 3) this.tickTimer(1, t1mode, n)
    const t2con = this.sfr[T2CON]
    if (t2con & 0x04 && !(t2con & 0x30)) {
      let v = ((this.sfr[TH2] << 8) | this.sfr[TL2]) + n
      if (v > 0xffff) {
        this.sfr[T2CON] |= 0x80
        v = ((this.sfr[RCAP2H] << 8) | this.sfr[RCAP2L]) + (v - 0x10000)
      }
      this.sfr[TH2] = (v >> 8) & 0xff
      this.sfr[TL2] = v & 0xff
    }
  }
  tickTimer(i, mode, n) {
    const TL = i ? TL1 : TL0
    const TH = i ? TH1 : TH0
    const TF = i ? 0x80 : 0x20
    if (mode === 1) {
      let v = ((this.sfr[TH] << 8) | this.sfr[TL]) + n
      if (v > 0xffff) {
        this.sfr[TCON] |= TF
        v &= 0xffff
      }
      this.sfr[TH] = v >> 8
      this.sfr[TL] = v & 0xff
    } else if (mode === 2) {
      let v = this.sfr[TL] + n
      while (v > 0xff) {
        this.sfr[TCON] |= TF
        v = this.sfr[TH] + (v - 0x100)
      }
      this.sfr[TL] = v
    } else if (mode === 0) {
      let v = ((this.sfr[TH] << 5) | (this.sfr[TL] & 0x1f)) + n
      if (v > 0x1fff) {
        this.sfr[TCON] |= TF
        v &= 0x1fff
      }
      this.sfr[TH] = v >> 5
      this.sfr[TL] = (this.sfr[TL] & 0xe0) | (v & 0x1f)
    } else if (mode === 3 && i === 0) {
      const v = this.sfr[TL0] + n
      if (v > 0xff) this.sfr[TCON] |= 0x20
      this.sfr[TL0] = v & 0xff
    }
  }

  sampleExternalInterrupts() {
    const p3 = this.portPins(3)
    for (let i = 0; i < 2; i++) {
      const pin = (p3 >> (2 + i)) & 1
      const itBit = i ? 0x04 : 0x01
      const ieBit = i ? 0x08 : 0x02
      if (this.sfr[TCON] & itBit) {
        if (this.prevInt[i] === 1 && pin === 0) this.sfr[TCON] |= ieBit
      } else if (pin === 0) this.sfr[TCON] |= ieBit
      else this.sfr[TCON] &= ~ieBit
      this.prevInt[i] = pin
    }
  }

  checkInterrupts() {
    const ie = this.sfr[IE]
    if (!(ie & 0x80)) return 0
    const tcon = this.sfr[TCON]
    const sources = [
      [ie & 0x01 && tcon & 0x02, 0, 0x03, () => this.sfr[TCON] & 0x01 && (this.sfr[TCON] &= ~0x02)],
      [ie & 0x02 && tcon & 0x20, 1, 0x0b, () => (this.sfr[TCON] &= ~0x20)],
      [ie & 0x04 && tcon & 0x08, 2, 0x13, () => this.sfr[TCON] & 0x04 && (this.sfr[TCON] &= ~0x08)],
      [ie & 0x08 && tcon & 0x80, 3, 0x1b, () => (this.sfr[TCON] &= ~0x80)],
      [ie & 0x10 && this.sfr[SCON] & 0x03, 4, 0x23, () => {}],
      [ie & 0x20 && this.sfr[T2CON] & 0xc0, 5, 0x2b, () => {}],
    ]
    const cur = this.inIsr.length ? this.inIsr[this.inIsr.length - 1] : -1
    for (const level of [1, 0]) {
      if (level <= cur) continue
      for (const [pending, bit, vector, clear] of sources) {
        if (!pending) continue
        const prio = (this.sfr[IP] >> bit) & 1
        if (prio !== level) continue
        clear()
        this.inIsr.push(level)
        this.call(vector)
        return 2
      }
    }
    return 0
  }

  // 运行 ms 毫秒的仿真时间；端口锁存变化时回调 onPorts(timeMs, [p0,p1,p2,p3,p4])
  run(ms, onPorts) {
    const end = this.cycles + Math.round((ms / 1000) * this.machineHz)
    let last = [...PORTS, P4].map((a) => this.sfr[a])
    while (this.cycles < end) {
      let n = this.step()
      this.tickTimers(n)
      this.tickSerial()
      this.sampleExternalInterrupts()
      const irq = this.checkInterrupts()
      if (irq) this.tickTimers(irq) // 响应中断的 LCALL 也占机器周期，定时器照常计数
      n += irq
      this.cycles += n
      const s0 = this.sfr[P0], s1 = this.sfr[P1], s2 = this.sfr[P2], s3 = this.sfr[P3], s4 = this.sfr[P4]
      if (s0 !== last[0] || s1 !== last[1] || s2 !== last[2] || s3 !== last[3] || s4 !== last[4]) {
        last = [s0, s1, s2, s3, s4]
        onPorts?.(this.timeMs, last)
      }
    }
  }
}
