// 平台核心服务：网页 API、MCP 工具共用同一套确定性功能
import fs from 'node:fs'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { ROOT, DATA_DIR } from './config.js'
import { compileC } from './lib/compile.js'
import { onchipResult } from './judge/onchip.js'
import { parseIntelHex } from './lib/hex.js'
import { createBoard } from './hardware/board.js'
import { EXPERIMENTS, judge, listExperiments } from './judge/experiments.js'
import { SegView } from './judge/segview.js'
import { MotorView } from './judge/motorview.js'

const KNOWLEDGE_DIR = path.join(ROOT, 'docs', 'knowledge')
const EXAMPLES_DIR = path.join(ROOT, 'examples', 'student')

export class Platform extends EventEmitter {
  constructor(cfg) {
    super()
    this.cfg = cfg
    this.board = createBoard(cfg)
    this.segView = new SegView()
    this.motorView = new MotorView()
    this.board.on('pins', (s) => this.emit('pins', { ...s, seg: this.segView.feed(s), motor: this.motorView.feed(s) }))
    this.lastBuild = null
    this.busy = null
    fs.mkdirSync(path.join(DATA_DIR, 'runs'), { recursive: true })
  }

  log(kind, msg, extra = {}) {
    const entry = { time: new Date().toISOString(), kind, msg, ...extra }
    fs.appendFileSync(path.join(DATA_DIR, 'events.log'), `${JSON.stringify(entry)}\n`)
    this.emit('log', entry)
    return entry
  }

  async exclusive(name, fn) {
    if (this.busy) throw new Error(`设备正忙（${this.busy}），请稍后再试`)
    this.busy = name
    this.emit('status', this.status())
    try {
      return await fn()
    } finally {
      this.busy = null
      this.emit('status', this.status())
    }
  }

  status() {
    return {
      mode: this.cfg.mode,
      board: this.board.info(),
      busy: this.busy,
      lastBuild: this.lastBuild && { ok: this.lastBuild.ok, size: this.lastBuild.size, time: this.lastBuild.time, source: this.lastBuild.sourceName },
    }
  }

  experiments() {
    return listExperiments()
  }

  examples() {
    return fs.readdirSync(EXAMPLES_DIR).filter((f) => f.endsWith('.c')).map((f) => ({ name: f, source: fs.readFileSync(path.join(EXAMPLES_DIR, f), 'utf8') }))
  }

  async compile(source, sourceName = 'main.c', experiment = null) {
    if (typeof source !== 'string' || !source.trim()) throw new Error('源代码为空')
    this.log('compile', `开始编译 ${sourceName}（${source.length} 字符）`)
    const r = await compileC(source, this.cfg, { experiment })
    this.lastBuild = { ...r, time: new Date().toISOString(), sourceName, source, experiment: this.cfg.monitor?.onchip ? experiment : null }
    if (r.ok) this.log('compile', `编译成功，代码 ${r.size} 字节${r.errors.length ? `，${r.errors.length} 条警告` : ''}`)
    else this.log('error', `编译失败：${r.errors.map((e) => `第 ${e.line} 行 ${e.message}`).join('；').slice(0, 300)}`)
    return { ok: r.ok, size: r.size ?? 0, errors: r.errors, log: r.log }
  }

  imageFrom({ hex } = {}) {
    if (hex) return parseIntelHex(hex)
    if (!this.lastBuild?.ok) throw new Error('没有可烧录的程序：请先编译成功')
    return parseIntelHex(this.lastBuild.hex)
  }

  async flash(opts = {}) {
    const image = this.imageFrom(opts)
    if (image.length > this.cfg.sdcc.codeSize) throw new Error(`程序 ${image.length} 字节超过 STC89C52 Flash 容量 ${this.cfg.sdcc.codeSize}`)
    return this.exclusive('烧录中', async () => {
      this.log('flash', `开始烧录 ${image.length} 字节到${this.board.kind === 'sim' ? '模拟板' : '实物板'}`)
      try {
        const r = await this.board.flash(image, (msg, extra) => this.log('flash', msg, extra))
        return { ok: true, bytes: image.length, ...r }
      } catch (e) {
        this.log('error', `烧录失败：${e.message}`)
        throw e
      }
    })
  }

  async capture(ms = 3000, keyScript = []) {
    ms = Math.max(200, Math.min(20000, Number(ms) || 3000))
    return this.exclusive('采集中', async () => {
      this.log('capture', `采集 ${ms}ms 引脚数据${keyScript.length ? `，期间模拟按键 ${keyScript.length} 次` : ''}`)
      return this.board.capture(ms, keyScript)
    })
  }

  pressKeys(mask) {
    this.board.pressKeys(mask)
    this.log('key', `按键状态 key1~4 = ${[0, 1, 2, 3].map((k) => (mask >> k) & 1).join('')}`)
  }

  async runTest(experimentId) {
    const exp = EXPERIMENTS[experimentId]
    if (!exp) throw new Error(`未知实验 ${experimentId}，可选：${Object.keys(EXPERIMENTS).join(', ')}`)
    const onchip = !!this.cfg.monitor?.onchip
    if (onchip && this.lastBuild && this.lastBuild.experiment !== experimentId)
      throw new Error(`板上测评模式：现在烧进去的测评代码是“${EXPERIMENTS[this.lastBuild.experiment]?.title ?? '未指定实验'}”的，请先选“${exp.title}”再重新编译、烧录`)
    const cap = await this.capture(exp.captureMs, exp.keyScript)
    let result = judge(experimentId, cap.samples, cap.durationMs)
    // 板上测评：分数以单片机自己算出的为准，平台复现的结果用来对照
    if (onchip) result = { ...result, ...onchipResult(experimentId, cap.onchip, result) }
    if (!cap.samples.length && cap.diag) {
      const d = cap.diag
      result.checks[0].detail = d.rawBytes === 0
        ? `检测串口 ${d.port} 一个字节都没收到：检测芯片 IAP15 还没烧新检测固件（firmware/detector/detector.hex），或串口拨码开关不在工作单片机档`
        : d.hello
          ? `检测芯片已应答（收到 ${d.rawBytes} 字节）但没有引脚数据，请把 data\\events.log 发给开发者`
          : `检测串口 ${d.port} 收到 ${d.rawBytes} 字节但不是检测帧：IAP15 里可能还是旧固件，请烧录 firmware/detector/detector.hex`
    }
    const record = { id: `${Date.now()}`, time: new Date().toISOString(), mode: this.cfg.mode, ...result, source: this.lastBuild?.source ?? null, sampleCount: cap.samples.length }
    fs.writeFileSync(path.join(DATA_DIR, 'runs', `${record.id}-${experimentId}.json`), JSON.stringify({ ...record, samples: cap.samples }, null, 1))
    this.log('judge', `【${exp.title}】得分 ${result.score}：${result.checks.map((c) => `${c.pass ? '✔' : '✘'}${c.name}`).join(' ')}`, { score: result.score })
    this.emit('result', record)
    return record
  }

  // 编译 → 烧录 → 测评 一条龙（网页“一键测评”和 AI 工具都用它）
  async evaluate(source, experimentId) {
    const c = await this.compile(source, 'main.c', experimentId)
    if (!c.ok) return { stage: 'compile', ok: false, compile: c }
    const f = await this.flash()
    const t = await this.runTest(experimentId)
    return { stage: 'done', ok: t.pass, compile: { ok: true, size: c.size, warnings: c.errors }, flash: { bytes: f.bytes }, test: t }
  }

  history(limit = 500) {
    const dir = path.join(DATA_DIR, 'runs')
    this.histCache ??= new Map()
    return fs
      .readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .reverse()
      .slice(0, limit)
      .map((f) => {
        if (!this.histCache.has(f)) {
          const { samples, ...rest } = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))
          this.histCache.set(f, rest)
        }
        return this.histCache.get(f)
      })
  }

  searchDocs(query) {
    const words = String(query ?? '').toLowerCase().split(/[\s,，。？?]+/).filter(Boolean)
    const sections = []
    for (const f of fs.readdirSync(KNOWLEDGE_DIR)) {
      const text = fs.readFileSync(path.join(KNOWLEDGE_DIR, f), 'utf8')
      for (const part of text.split(/\n(?=#{1,3} )/)) sections.push({ file: f, text: part.trim() })
    }
    for (const e of listExperiments()) sections.push({ file: `experiment:${e.id}`, text: `# 实验 ${e.code} ${e.title}\n要求：${e.requirement}\n引脚：${e.pins}` })
    const scored = sections.map((s) => {
      const low = s.text.toLowerCase()
      return { ...s, score: words.reduce((a, w) => a + (low.includes(w) ? 1 : 0) + [...w].filter((ch) => /[\u4e00-\u9fff]/.test(ch) && low.includes(ch)).length * 0.1, 0) }
    })
    return scored.sort((a, b) => b.score - a.score).slice(0, 4).map(({ file, text }) => ({ file, text }))
  }
}
