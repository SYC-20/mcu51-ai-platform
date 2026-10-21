// Intel HEX → 二进制镜像（校验每行 checksum，支持 00/01/02/04 记录）
export function parseIntelHex(text) {
  const mem = new Map()
  let base = 0
  let maxAddr = -1
  const lines = text.split(/\r?\n/)
  for (let n = 0; n < lines.length; n++) {
    const line = lines[n].trim()
    if (!line) continue
    if (line[0] !== ':') throw new Error(`HEX 第 ${n + 1} 行不是以 ':' 开头`)
    const bytes = Buffer.from(line.slice(1), 'hex')
    if (bytes.length < 5 || bytes.length !== bytes[0] + 5) throw new Error(`HEX 第 ${n + 1} 行长度不匹配`)
    const sum = bytes.reduce((a, b) => (a + b) & 0xff, 0)
    if (sum !== 0) throw new Error(`HEX 第 ${n + 1} 行校验和错误`)
    const len = bytes[0]
    const addr = (bytes[1] << 8) | bytes[2]
    const type = bytes[3]
    const data = bytes.subarray(4, 4 + len)
    if (type === 0x00) {
      for (let i = 0; i < len; i++) {
        const a = base + addr + i
        mem.set(a, data[i])
        if (a > maxAddr) maxAddr = a
      }
    } else if (type === 0x01) break
    else if (type === 0x02) base = ((data[0] << 8) | data[1]) << 4
    else if (type === 0x04) base = ((data[0] << 8) | data[1]) << 16
  }
  if (maxAddr < 0) throw new Error('HEX 文件中没有数据')
  const bin = Buffer.alloc(maxAddr + 1, 0xff)
  for (const [a, v] of mem) bin[a] = v
  return bin
}
