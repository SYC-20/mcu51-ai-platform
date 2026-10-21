// 检测 MCU（IAP15F2K61S2）↔ 平台 串口帧协议（本项目自定义）
// 帧格式：0xA5 | type | len | payload[len] | xor(type,len,payload)
// 检测 MCU → 平台：
//   0x01 PINS  len=8 : P0 P1 P2 P3 t0 t1 t2 t3 （t 为检测 MCU 自上电起的毫秒，小端）——端口变化时立即上报 + 每 100ms 心跳
//   0x02 HELLO len=1 : 固件版本
//   0x03 ACK   len=1 : 被确认的命令类型
//   0x05 MON   len=7 : P0 P1 P2 P3 P4 t0 t1 —— 单 MCU 模式：学生单片机里的自检测代码上报（t 为 16 位毫秒，循环计数）
//   0x06 RESULT len=20: 实验 分数 项数 通过位 数据[16] —— 板上测评模式：单片机自己算出的测评结果（firmware/monitor/eval.h）
// 平台 → 检测 MCU：
//   0x10 KEY   len=3 : keyMask（bit0~3 = key1~key4 被按下）holdMs(小端 2 字节, 0=保持直到下一条)
//   0x11 RESETCLOCK len=0 : 时间戳清零（开始一次采集）
//   0x12 START len=5 : 'M' '5' '1' winMs(小端 2 字节) —— 检测 MCU 只在该时间窗内上报（与烧录共用串口时保持安静）
//   0x13 PING  len=0 : 检测 MCU 回复 HELLO
export const SOF = 0xa5
export const T = { MON: 0x05, RESULT: 0x06, PINS: 0x01, HELLO: 0x02, ACK: 0x03, KEY: 0x10, RESETCLOCK: 0x11, START: 0x12, PING: 0x13 }

export function encodeFrame(type, payload = []) {
  const body = [type, payload.length, ...payload]
  const x = body.reduce((a, b) => a ^ b, 0)
  return Buffer.from([SOF, ...body, x])
}

export class FrameParser {
  constructor(onFrame) {
    this.buf = Buffer.alloc(0)
    this.onFrame = onFrame
  }
  push(chunk) {
    this.buf = Buffer.concat([this.buf, chunk])
    for (;;) {
      const i = this.buf.indexOf(SOF)
      if (i < 0) {
        this.buf = Buffer.alloc(0)
        return
      }
      if (i > 0) this.buf = this.buf.subarray(i)
      if (this.buf.length < 4) return
      const len = this.buf[2]
      if (this.buf.length < len + 4) return
      const body = this.buf.subarray(1, 3 + len)
      const x = body.reduce((a, b) => a ^ b, 0)
      if (x !== this.buf[3 + len]) {
        this.buf = this.buf.subarray(1)
        continue
      }
      const type = body[0]
      const payload = Buffer.from(body.subarray(2))
      this.buf = this.buf.subarray(len + 4)
      this.onFrame(type, payload)
    }
  }
}

export function decodePins(payload) {
  return { p0: payload[0], p1: payload[1], p2: payload[2], p3: payload[3], t: payload.readUInt32LE(4) }
}

// 单 MCU 模式：解析自检测代码上报的 MON 帧，把 16 位毫秒时间展开成连续时间
export class MonitorDecoder {
  constructor(onSample, onResult = () => {}) {
    this.onSample = onSample
    this.onResult = onResult
    this.reset()
    this.parser = new FrameParser((type, p) => {
      if (type === T.RESULT && p.length >= 4) {
        this.results++
        return this.onResult({ code: p[0], score: p[1], n: p[2], bits: p[3], data: [...p.slice(4)] })
      }
      if (type !== T.MON || p.length < 7) return
      const t16 = p[5] | (p[6] << 8)
      if (this.last16 !== null && t16 < this.last16 && this.last16 - t16 > 0x8000) this.base += 0x10000
      this.last16 = t16
      this.frames++
      this.onSample({ p0: p[0], p1: p[1], p2: p[2], p3: p[3], p4: p[4], t: this.base + t16 })
    })
  }
  reset() {
    this.base = 0
    this.last16 = null
    this.frames = 0
    this.results = 0
  }
  push(bytes) {
    this.parser.push(Buffer.from(bytes))
  }
}

export const keyFrame = (mask, holdMs = 0) => encodeFrame(T.KEY, [mask & 0x0f, holdMs & 0xff, (holdMs >> 8) & 0xff])
