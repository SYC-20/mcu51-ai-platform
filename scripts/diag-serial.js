// 串口诊断：打开检测串口，向检测芯片发 PING/START，打印 3 秒内收到的原始字节和解析出的帧
import { loadConfig } from '../server/config.js'
import { encodeFrame, FrameParser, T, decodePins } from '../server/hardware/protocol.js'

const cfg = loadConfig(process.argv.slice(2))
const portName = process.argv.find((a) => /^COM\d+$/i.test(a)) || cfg.detector.port
const { SerialPort } = await import('serialport')
console.log(`可用串口：${(await SerialPort.list()).map((p) => `${p.path}(${p.manufacturer || '?'})`).join(', ')}`)
console.log(`打开 ${portName} @ ${cfg.detector.baud} ...`)
const port = new SerialPort({ path: portName, baudRate: cfg.detector.baud, autoOpen: false })
await new Promise((res, rej) => port.open((e) => (e ? rej(e) : res()))).catch((e) => {
  console.log(`打不开 ${portName}：${e.message}（平台窗口开着的话先关掉）`)
  process.exit(1)
})
await new Promise((r) => port.set({ rts: false }, () => r()))
let raw = 0, hello = 0, pins = 0, last = null
const parser = new FrameParser((type, payload) => {
  if (type === T.HELLO) hello++, console.log(`收到 HELLO，检测固件版本 ${payload[0]}`)
  else if (type === T.PINS) pins++, (last = decodePins(payload))
})
port.on('data', (d) => {
  raw += d.length
  if (raw <= 64) console.log('原始字节:', d.toString('hex').match(/../g).join(' '))
  parser.push(d)
})
port.write(encodeFrame(T.PING))
port.write(encodeFrame(T.START, [0x4d, 0x35, 0x31, 0xb8, 0x0b]))
await new Promise((r) => setTimeout(r, 3000))
port.close()
console.log(`\n3 秒内共收到 ${raw} 字节，HELLO ${hello} 次，引脚帧 ${pins} 个`)
if (last) console.log(`最后一帧：P0=${last.p0?.toString(2).padStart(8, '0') ?? JSON.stringify(last)} P1=${last.p1?.toString(2).padStart(8, '0') ?? ''}`)
console.log(
  raw === 0
    ? '结论：一个字节都没收到 → IAP15 没烧新检测固件，或者串口拨码开关档位不对。'
    : pins
      ? '结论：检测芯片工作正常。'
      : '结论：收到了数据但不是新协议 → IAP15 里还是旧固件，请烧录 firmware\\detector\\detector.hex。'
)
