// 网页上的步进电机显示：逐帧累计相位变化，算出 28BYJ-48 输出轴的位置和转向
import { motorPhase } from './experiments.js'

const STEP_POS = { 1: 0, 3: 1, 2: 2, 6: 3, 4: 4, 12: 5, 8: 6, 9: 7 }
const RUN_MS = 300

export class MotorView {
  constructor() {
    this.reset()
  }

  reset() {
    this.prev = null
    this.pos = 0
    this.dir = 0
    this.at = -Infinity
    this.t = 0
  }

  // pos 以半步计，4096 个半步 = 输出轴一圈（电机 64 半步/圈 × 1:64 减速）
  feed(s) {
    if (s.p4 === undefined) return undefined
    if (s.t < this.t) this.reset()
    this.t = s.t
    const m = STEP_POS[motorPhase(s.p4)]
    if (m !== undefined) {
      if (this.prev !== null && m !== this.prev) {
        const d = (m - this.prev) & 7
        const k = d <= 2 ? d : d >= 6 ? d - 8 : 0
        if (k) {
          this.pos += k
          this.dir = Math.sign(k)
          this.at = s.t
        }
      }
      this.prev = m
    }
    return { pos: this.pos, dir: s.t - this.at < RUN_MS ? this.dir : 0 }
  }
}
