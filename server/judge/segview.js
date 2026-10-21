// 网页上的数码管显示：把逐帧的 P0/P2 合成为 4 位数码管“人眼看到的”画面
import { SEG_CODES, segDigits } from './experiments.js'

const HOLD_MS = 100

export class SegView {
  constructor() {
    this.digits = [null, null, null, null]
    this.hist = []
    this.lastStatic = null
  }

  feed(s) {
    if ((s.p2 & 0x0f) !== 0x0f) return this.fromSelect(s)
    return this.fromSegments(s)
  }

  // 模拟板：能看到位选，记下每一位最近一次选通时的段码（消隐的 0x00 不覆盖）
  fromSelect(s) {
    for (let i = 0; i < 4; i++) if (!((s.p2 >> i) & 1) && s.p0 !== 0) this.digits[i] = { code: s.p0, t: s.t }
    return this.digits.map((d) => (d && s.t - d.t < HOLD_MS ? d.code : 0))
  }

  // 实物板：看不到位选和 b 段，只按段码出现的顺序推断
  fromSegments(s) {
    const v = s.p0 | 0x02
    // 0xFF 是复位后的 P0（位选也全关），不当作数字
    const cands = s.p0 === 0xff ? [] : segDigits(v, 0x02)
    if (cands.length && this.hist.at(-1)?.v !== v) this.hist.push({ t: s.t, v, cands })
    this.hist = this.hist.filter((h, i) => i === this.hist.length - 1 || s.t - h.t < HOLD_MS)
    // 只出现一次的段码是切换瞬间的过渡态；动态扫描时每个数字在窗口内会反复出现
    const count = (v) => this.hist.filter((h) => h.v === v).length
    const order = []
    for (const h of this.hist) if (count(h.v) >= 2 && !order.some((o) => o.v === h.v)) order.push(h)
    if (!order.length && this.hist.length) order.push(this.hist.at(-1))
    if (!order.length) return [0, 0, 0, 0]
    if (order.length === 1) {
      const c = order[0].cands
      const p = this.lastStatic
      const d = p !== null && c.includes((p + 1) % 10) ? (p + 1) % 10 : p !== null && c.includes(p) ? p : c[0]
      this.lastStatic = d
      return [SEG_CODES[d], 0, 0, 0]
    }
    const ds = order.slice(0, 4).map((o) => o.cands[0])
    const k = ds.indexOf(Math.min(...ds))
    const rot = [...ds.slice(k), ...ds.slice(0, k)]
    return [0, 1, 2, 3].map((i) => (i < rot.length ? SEG_CODES[rot[i]] : 0))
  }
}
