// 板子使用权：一块板子同一时间只给一个人用（网页和 Agnes 不会同时烧录/测评）
import crypto from 'node:crypto'

const CID = 'mcu51_cid'

export function parseCookies(header = '') {
  const out = {}
  for (const part of header.split(';')) {
    const i = part.indexOf('=')
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim())
  }
  return out
}

// 给每个浏览器发一个标识，用来区分板子归谁用
export function clientId(req, res, next) {
  req.clientId = parseCookies(req.headers.cookie)[CID]
  if (!req.clientId) {
    req.clientId = crypto.randomBytes(8).toString('hex')
    res.append('Set-Cookie', `${CID}=${req.clientId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000`)
  }
  next()
}

// 板子使用权：某人操作板子后保留一段时间（默认 60 秒），期间其他人不能烧录/测评。
// Agnes 处理消息期间，使用权归发起这条消息的人。
export class BoardLease {
  constructor(holdMs = 60000) {
    this.holdMs = holdMs
    this.owner = null
    this.until = 0
  }
  acquire(owner, now = Date.now()) {
    if (this.owner && this.owner !== owner && now < this.until) {
      const s = this.until === Infinity ? '' : `，约 ${Math.ceil((this.until - now) / 1000)} 秒后可用`
      throw new Error(`板子正在被其他同学使用${s}，请稍后再试`)
    }
    this.owner = owner
    this.until = now + this.holdMs
  }
  hold(owner) {
    this.acquire(owner)
    this.until = Infinity
  }
  release(owner, now = Date.now()) {
    if (this.owner === owner) this.until = now + this.holdMs / 2
  }
  info(viewer, now = Date.now()) {
    const busy = !!this.owner && now < this.until
    return { inUse: busy, mine: busy && this.owner === viewer }
  }
}
