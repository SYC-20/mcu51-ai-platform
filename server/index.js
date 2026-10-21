// 51 单片机 AI 智慧测评平台 —— HTTP + WebSocket 服务
import http from 'node:http'
import path from 'node:path'
import express from 'express'
import { WebSocketServer } from 'ws'
import { loadConfig, ROOT } from './config.js'
import { Platform } from './service.js'
import { AghBridge } from './agh.js'
import { clientId, BoardLease } from './access.js'

const cfg = loadConfig()
const platform = new Platform(cfg)
const agh = new AghBridge(cfg, platform)
const workspace = { experiment: 'blink', source: platform.examples().find((e) => e.name === 'blink.c')?.source ?? '' }

const lease = new BoardLease()
let aiOwner = null

const app = express()
app.use(express.json({ limit: '1mb' }))
app.use(clientId)
app.use(express.static(path.join(ROOT, 'public')))

const wrap = (fn) => async (req, res) => {
  try {
    res.json(await fn(req))
  } catch (e) {
    res.status(400).json({ error: e.message })
  }
}
const actor = (req) => (req.get('x-mcu51-actor') === 'agnes' ? 'agnes' : 'user')
const owner = (req) => (actor(req) === 'agnes' ? (aiOwner ?? 'agnes') : req.clientId)
const board = (fn) => (req) => {
  lease.acquire(owner(req))
  return fn(req)
}

app.get('/api/status', wrap((req) => ({ ...platform.status(), lease: lease.info(owner(req)), workspace: { experiment: workspace.experiment }, agh: agh.info() })))
app.get('/api/experiments', wrap(() => platform.experiments()))
app.get('/api/examples', wrap(() => platform.examples()))
app.get('/api/workspace', wrap(() => workspace))
app.post(
  '/api/workspace',
  wrap((req) => {
    if (typeof req.body.source === 'string') workspace.source = req.body.source
    if (req.body.experiment) workspace.experiment = req.body.experiment
    return { ok: true }
  }),
)
app.post(
  '/api/compile',
  wrap(async (req) => {
    const source = req.body.source ?? workspace.source
    if (actor(req) === 'agnes' && req.body.updateEditor !== false) {
      workspace.source = source
      broadcast({ type: 'editor', source, by: 'agnes' })
    }
    return platform.compile(source, 'main.c', req.body.experiment ?? workspace.experiment)
  }),
)
app.post('/api/flash', wrap(board((req) => platform.flash({ hex: req.body.hex }))))
app.post('/api/capture', wrap(board((req) => platform.capture(req.body.ms, req.body.keyScript ?? []))))
app.post('/api/keys', wrap(board((req) => (platform.pressKeys(Number(req.body.mask) || 0), { ok: true }))))
app.post('/api/test', wrap(board((req) => platform.runTest(req.body.experiment ?? workspace.experiment))))
app.post('/api/evaluate', wrap(board((req) => platform.evaluate(req.body.source ?? workspace.source, req.body.experiment ?? workspace.experiment))))
app.get('/api/history', wrap(() => platform.history()))
app.get('/api/docs', wrap((req) => platform.searchDocs(req.query.q)))
app.post(
  '/api/ai/chat',
  wrap(async (req) => {
    if (agh.running) throw new Error('Agnes 正在处理上一条消息，请稍候')
    lease.hold(req.clientId)
    aiOwner = req.clientId
    try {
      return await agh.chat(String(req.body.message ?? ''), { mode: req.body.mode, workspace })
    } finally {
      aiOwner = null
      lease.release(req.clientId)
    }
  }),
)
app.post('/api/ai/reset', wrap(() => agh.reset()))

const server = http.createServer(app)
const wss = new WebSocketServer({ server, path: '/ws' })
function broadcast(msg) {
  const s = JSON.stringify(msg)
  for (const c of wss.clients) if (c.readyState === 1) c.send(s)
}
let lastPinsSent = 0
let pendingPins = null
platform.on('pins', (p) => {
  const now = Date.now()
  pendingPins = p
  if (now - lastPinsSent < 40) return
  pendingPins = null
  lastPinsSent = now
  broadcast({ type: 'pins', ...p })
})
setInterval(() => {
  if (pendingPins && Date.now() - lastPinsSent >= 40) {
    lastPinsSent = Date.now()
    broadcast({ type: 'pins', ...pendingPins })
    pendingPins = null
  }
}, 50)
platform.on('log', (e) => broadcast({ type: 'log', ...e }))
platform.on('status', (s) => broadcast({ type: 'status', ...s }))
platform.on('result', (r) => broadcast({ type: 'result', result: r }))
agh.on('event', (e) => broadcast({ type: 'ai', ...e }))
wss.on('connection', (ws) => ws.send(JSON.stringify({ type: 'status', ...platform.status() })))

server.listen(cfg.port, cfg.host, () => {
  console.log(`51 单片机 AI 测评平台已启动：http://${cfg.host}:${cfg.port}  （模式：${cfg.mode === 'sim' ? '模拟板' : '实物板'}）`)
})
