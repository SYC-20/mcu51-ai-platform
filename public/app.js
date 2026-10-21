const $ = (s) => document.querySelector(s)
const api = async (url, body) => {
  const res = await fetch(url, body === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])

const state = { experiment: 'blink', experiments: [], keyMask: 0, history: [] }

// ---------- 实验 ----------
async function loadExperiments() {
  state.experiments = await api('/api/experiments')
  const ws = await api('/api/workspace')
  state.experiment = ws.experiment
  setCode(ws.source)
  renderExperiments()
  const ex = await api('/api/examples')
  for (const e of ex) {
    const o = document.createElement('option')
    o.value = e.name
    o.textContent = e.name
    o.dataset.src = e.source
    $('#exampleSel').append(o)
  }
}
function renderExperiments() {
  $('#expList').innerHTML = ''
  for (const e of state.experiments) {
    const b = document.createElement('button')
    b.innerHTML = `<b>${esc(e.code)}</b><span>${esc(e.title)}</span><i class="ic" style="--ic:url(icons/chevron-right.svg)"></i>`
    b.className = e.id === state.experiment ? 'active' : ''
    b.setAttribute('role', 'option')
    b.setAttribute('aria-selected', e.id === state.experiment)
    b.onclick = () => {
      state.experiment = e.id
      saveWorkspace()
      renderExperiments()
    }
    $('#expList').append(b)
  }
  const cur = state.experiments.find((e) => e.id === state.experiment)
  $('#expTitle').textContent = cur ? `实验要求 · ${cur.code} ${cur.title}` : '实验要求'
  $('#expReq').innerHTML = cur ? `${esc(cur.requirement)}<br><b>引脚：</b>${esc(cur.pins)}` : ''
}
let saveTimer
function saveWorkspace() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => api('/api/workspace', { source: $('#code').value, experiment: state.experiment }).catch(() => {}), 300)
}
const gutter = () => {
  const n = $('#code').value.split('\n').length
  if ($('#gutter').childElementCount !== n) $('#gutter').innerHTML = Array.from({ length: n }, (_, i) => `<div>${i + 1}</div>`).join('')
  $('#gutter').scrollTop = $('#code').scrollTop
}
const setCode = (v) => (($('#code').value = v), gutter())
$('#code').addEventListener('input', () => (saveWorkspace(), gutter()))
$('#code').addEventListener('scroll', gutter)
$('#code').addEventListener('keydown', (e) => {
  if (e.key === 'Tab') {
    e.preventDefault()
    const t = e.target
    const s = t.selectionStart
    t.setRangeText('    ', s, t.selectionEnd, 'end')
    saveWorkspace()
  }
})
$('#exampleSel').onchange = (e) => {
  const o = e.target.selectedOptions[0]
  if (o?.value === '__upload') {
    e.target.value = ''
    $('#codeFile').value = ''
    return $('#codeFile').click()
  }
  if (o?.dataset.src) {
    setCode(o.dataset.src)
    saveWorkspace()
  }
  e.target.value = ''
}

$('#codeFile').onchange = async (e) => {
  const f = e.target.files[0]
  if (!f) return
  try {
    if (f.size > 512 * 1024) throw new Error('文件太大（超过 512KB），请选择 .c 源程序文件')
    const buf = await f.arrayBuffer()
    let text
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(buf)
    } catch {
      text = new TextDecoder('gbk').decode(buf) // Keil 默认用 GBK 保存中文注释
    }
    setCode(text.replace(/^\uFEFF/, ''))
    saveWorkspace()
  } catch (err) {
    showErr(err)
  }
}

// ---------- 实物状态 ----------
// 共阴极数码管：段 a~g、dp 对应 P0.0~P0.7，高电平点亮；位选 P2.0~P2.3 低电平选通
const SEG_SHAPES = [
  '9,3.5 25,3.5 27,5.5 25,7.5 9,7.5 7,5.5', '27.5,7 29.5,9 29.5,25 27.5,27 25.5,25 25.5,9', '27.5,29 29.5,31 29.5,47 27.5,49 25.5,47 25.5,31',
  '9,48.5 25,48.5 27,50.5 25,52.5 9,52.5 7,50.5', '6.5,29 8.5,31 8.5,47 6.5,49 4.5,47 4.5,31', '6.5,7 8.5,9 8.5,25 6.5,27 4.5,25 4.5,9',
  '9,26 25,26 27,28 25,30 9,30 7,28', null,
].map((pts) => (pts ? `<polygon points="${pts}"/>` : '<circle cx="32" cy="51" r="1.8"/>'))
const segDigits = []
for (let i = 0; i < 4; i++) {
  const d = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  d.setAttribute('viewBox', '0 0 35 56')
  d.innerHTML = SEG_SHAPES.map((x) => x.replace('/>', ' class="s"/>')).join('')
  $('#segs').append(d)
  segDigits.push([...d.querySelectorAll('.s')])
}
function renderSegs(p) {
  let seg = p.seg ?? [0, 0, 0, 0]
  const idle = seg.every((v) => !v)
  $('#segs').classList.toggle('idle', idle)
  if (idle) seg = [0x3f, 0x3f, 0x3f, 0x3f]
  segDigits.forEach((segs, i) => segs.forEach((el, b) => el.classList.toggle('on', ((seg[i] >> b) & 1) === 1)))
}
renderSegs({})

const leds = []
for (let i = 0; i < 8; i++) {
  const d = document.createElement('div')
  d.className = 'led'
  d.innerHTML = `<i></i>LED${i + 1}`
  d.title = `P1.${i}`
  $('#leds').append(d)
  leds.push(d)
}
for (let k = 0; k < 4; k++) {
  const b = document.createElement('button')
  b.innerHTML = `<b>${k + 5}</b><small>SW${k + 5}</small>`
  b.title = `P2.${k + 4}，按住为低电平`
  const set = (down) => {
    state.keyMask = down ? state.keyMask | (1 << k) : state.keyMask & ~(1 << k)
    b.classList.toggle('down', down)
    api('/api/keys', { mask: state.keyMask }).catch(showErr)
  }
  b.onpointerdown = () => set(true)
  b.onpointerup = b.onpointerleave = () => state.keyMask & (1 << k) && set(false)
  $('#keys').append(b)
}
// 步进电机：位置和转向由服务端逐帧累计（p.motor.pos 以半步计，4096 半步 = 输出轴一圈）
function renderMotor(p) {
  if (!p.motor) return
  $('#rotor').style.transform = `rotate(${(p.motor.pos * 360) / 4096}deg)`
  $('#motorState').textContent = p.motor.dir > 0 ? '正转' : p.motor.dir < 0 ? '反转' : '停止'
  $('#motorState').classList.toggle('on', !!p.motor.dir)
}
const h2 = (v) => v.toString(16).toUpperCase().padStart(2, '0')
function renderPins(p) {
  leds.forEach((d, i) => d.classList.toggle('on', !((p.p1 >> i) & 1)))
  $('#buzzer').classList.toggle('on', !(p.p1 & 1))
  $('#buzzState').textContent = p.p1 & 1 ? '停' : '响'
  $('#buzzState').classList.toggle('on', !(p.p1 & 1))

  renderSegs(p)
  renderMotor(p)
  $('#pinTime').textContent = `t=${(p.t / 1000).toFixed(1)}s`
}

// ---------- 日志 ----------
function addLog(e) {
  const d = document.createElement('div')
  d.className = `k-${e.kind}`
  const t = new Date(e.time).toLocaleTimeString('zh-CN', { hour12: false })
  d.textContent = `[${t}] ${e.msg}`
  const box = $('#log')
  const stick = box.scrollTop + box.clientHeight >= box.scrollHeight - 10
  box.append(d)
  $('#logLast').textContent = d.textContent
  if (e.kind === 'error') $('.log-box').open = true
  while (box.childElementCount > 400) box.firstChild.remove()
  if (stick) box.scrollTop = box.scrollHeight
}
const showErr = (e) => addLog({ kind: 'error', time: Date.now(), msg: e.message })

// ---------- 编译 / 烧录 / 测评 ----------
function renderErrors(errs = []) {
  $('#errors').textContent = errs.map((e) => `${e.severity === 'error' ? '错误' : '警告'} 第 ${e.line} 行：${e.message}`).join('\n')
}
async function withBusy(btn, fn) {
  const btns = document.querySelectorAll('.toolbar button, #btnEval')
  btns.forEach((b) => (b.disabled = true))
  try {
    await fn()
  } catch (e) {
    showErr(e)
  } finally {
    btns.forEach((b) => (b.disabled = false))
  }
}
async function compile() {
  const r = await api('/api/compile', { source: $('#code').value, experiment: state.experiment })
  renderErrors(r.errors)
  if (!r.ok) throw new Error('编译失败，请查看错误列表')
  return r
}
function renderResult(r) {
  const cls = r.pass ? 'ok' : 'bad'
  const passed = r.checks.filter((c) => c.pass).length
  $('#result').className = 'result'
  $('#result').innerHTML =
    `<div class="ring" style="--p:${r.score};--c:var(--${cls})"><b class="${cls}">${r.score}<small>分</small></b></div>` +
    `<div class="result-body"><strong class="result-title ${cls}"><i class="ic" style="--ic:url(icons/${r.pass ? 'circle-check' : 'circle-x'}.svg)"></i>${r.pass ? '通过' : '未通过'}<span class="muted" style="font-size:14px;font-weight:500">${esc(r.title)} · ${passed} / ${r.checks.length} 项</span></strong>` +
    (r.onchip !== undefined ? `<div class="muted onchip-line">${r.onchip ? `板上测评：单片机算出 <b>${r.onchip.score}</b> 分 · 平台复现 ${r.replay.score} 分<br>串口数据：${esc(r.onchip.text)}` : '没有收到单片机发来的测评结果'}</div>` : '') +
    `<ul class="checks">${r.checks.map((c) => `<li class="${c.pass ? 'ok' : 'bad'}" title="${esc(c.detail)}${c.replayPass !== undefined && c.replayPass !== c.pass ? '（平台复现结果与单片机不同）' : ''}"><i class="ic" style="--ic:url(icons/${c.pass ? 'circle-check' : 'circle-x'}.svg)"></i>${esc(c.name)}</li>`).join('')}</ul></div>`
  if (!r.pass) $('#result .result-body').insertAdjacentHTML('beforeend', '<span class="muted">没通过的项目把鼠标放上去可看原因，也可以切到“自动排错”让 Agnes 帮你查</span>')
}
const setStep = (name, st) => {
  const li = document.querySelector(`#steps [data-step="${name}"]`)
  li.className = st || ''
}
const resetSteps = () => ['compile', 'flash', 'test'].forEach((n) => setStep(n, ''))
async function step(name, fn) {
  setStep(name, 'run')
  try {
    const r = await fn()
    setStep(name, 'done')
    return r
  } catch (e) {
    setStep(name, 'fail')
    throw e
  }
}
const runTest = async () => renderResult(await api('/api/test', { experiment: state.experiment }))
$('#btnCompile').onclick = () => withBusy(null, () => (resetSteps(), step('compile', compile)))
$('#btnFlash').onclick = () => withBusy(null, () => step('flash', () => api('/api/flash', {})))
$('#btnTest').onclick = () => withBusy(null, () => step('test', runTest))
$('#btnEval').onclick = () =>
  withBusy(null, async () => {
    resetSteps()
    await step('compile', compile)
    await step('flash', () => api('/api/flash', {}))
    await step('test', runTest)
  })

// ---------- 记录 ----------
async function loadHistory() {
  state.history = await api('/api/history')
  $('#history').innerHTML = state.history.map((h, i) => `<div class="row"><b class="sc ${h.pass ? 'ok' : 'bad'}">${h.score}</b><span class="t">${esc(h.title)} · ${h.pass ? '通过' : '未通过'}<small>${new Date(h.time).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</small></span><button class="link" data-dl="${i}" title="只导出这一条">导出</button></div>`).join('') || '<span class="muted">还没有测评记录</span>'
}
function exportReport(items, withChat) {
  const lines = ['# 51 单片机实验测评报告', '', `导出时间：${new Date().toLocaleString()}`, '']
  for (const h of items) {
    lines.push(`## ${h.title} —— ${h.score} 分（${h.pass ? '通过' : '未通过'}）`, `时间：${h.time}　模式：${h.mode === 'sim' ? '模拟板' : '实物板'}`, '')
    if (h.onchip) lines.push(`板上测评：单片机算出 ${h.onchip.score} 分，平台复现 ${h.replay?.score ?? '-'} 分　串口数据：${h.onchip.text}`, '')
    for (const c of h.checks) lines.push(`- ${c.pass ? '✔' : '✘'} ${c.name}：${c.detail}${c.replayPass !== undefined && c.replayPass !== c.pass ? '（平台复现结果与单片机不同）' : ''}`)
    if (h.source) lines.push('', '```c', h.source, '```')
    lines.push('')
  }
  const chats = withChat ? [...document.querySelectorAll('#chat .msg')].map((m) => `**${m.classList.contains('user') ? '学生' : 'Agnes'}**：${m.textContent}`) : []
  if (chats.length) lines.push('## AI 助教对话', '', ...chats)
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/markdown' }))
  a.download = `测评报告-${items.length === 1 ? `${items[0].title}-` : ''}${Date.now()}.md`
  a.click()
}
$('#btnReport').onclick = () => exportReport(state.history, true)
$('#history').onclick = (e) => {
  const i = e.target.dataset?.dl
  if (i !== undefined) exportReport([state.history[+i]], false)
}

// ---------- AI ----------
function addMsg(cls, text) {
  const d = document.createElement('div')
  d.className = `msg ${cls}`
  d.innerHTML = esc(text).replace(/```(\w*)\n([\s\S]*?)```/g, (_, l, c) => `<pre>${c}</pre>`)
  $('#chat').append(d)
  $('#chat').scrollTop = $('#chat').scrollHeight
}
async function ask() {
  const msg = $('#ask').value.trim()
  const mode = document.querySelector('input[name=mode]:checked').value
  if (!msg && mode === 'ask') return
  await api('/api/workspace', { source: $('#code').value, experiment: state.experiment })
  addMsg('user', msg || { fix: '请帮我自动排错并在板子上验证', analyze: '请分析我的学习情况' }[mode])
  $('#ask').value = ''
  $('#btnAsk').disabled = true
  $('#aiProgress').textContent = 'Agnes 思考中…'
  try {
    const r = await api('/api/ai/chat', { message: msg, mode })
    addMsg('ai', r.reply)
    speak(r.reply)
  } catch (e) {
    addMsg('err', /config\.json|AGH|Harness/i.test(e.message) ? 'Agnes 还没接入：请关闭平台窗口，双击“5-接入AI.bat”按提示完成设置，再重新启动平台。' : e.message)
  } finally {
    $('#btnAsk').disabled = false
    $('#aiProgress').textContent = ''
  }
}
$('#btnAsk').onclick = ask
$('#ask').addEventListener('keydown', (e) => e.key === 'Enter' && (e.ctrlKey || e.metaKey) && ask())
$('#btnReset').onclick = () => api('/api/ai/reset', {}).then(() => ($('#chat').innerHTML = ''))

// ---------- 语音对话：电脑麦克风说话，电脑音箱朗读 ----------
function speak(text) {
  if (!$('#speakOn').checked || !window.speechSynthesis) return
  speechSynthesis.cancel()
  const plain = String(text)
    .replace(/```[\s\S]*?```/g, '（代码请看屏幕）')
    .replace(/[`*#>|_]/g, '')
    .slice(0, 600)
  const u = new SpeechSynthesisUtterance(plain)
  u.lang = 'zh-CN'
  const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('zh'))
  u.voice = voices.find((v) => /Xiaoxiao|晓晓/.test(v.name)) ?? voices[0] ?? null
  speechSynthesis.speak(u)
}
window.speechSynthesis?.getVoices()

const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition
let rec = null
function micStart(e) {
  e.preventDefault()
  if (!Recognition) return addMsg('err', '这个浏览器不支持语音输入，请用 Edge 浏览器打开平台。')
  if (rec) return
  window.speechSynthesis?.cancel()
  const base = $('#ask').value
  rec = new Recognition()
  rec.lang = 'zh-CN'
  rec.continuous = true
  rec.interimResults = true
  rec.onresult = (ev) => {
    $('#ask').value = base + [...ev.results].map((r) => r[0].transcript).join('')
  }
  rec.onerror = (ev) => {
    const why = {
      'not-allowed': '没有麦克风权限：点地址栏左边的锁形图标，把“麦克风”改成允许。',
      'no-speech': '没听到声音，请靠近麦克风再说一次。',
      'audio-capture': '找不到麦克风，请检查耳机或麦克风是否插好。',
      network: '语音识别要联网，现在连不上识别服务。请用 Edge 浏览器，并检查网络。',
    }[ev.error]
    addMsg('err', why ?? `语音识别出错：${ev.error}`)
  }
  rec.onend = () => {
    $('#btnMic').classList.remove('rec')
    $('#btnMic span').textContent = '按住说话'
    const send = rec?.sendOnEnd
    rec = null
    if (send && $('#ask').value.trim()) ask()
  }
  rec.start()
  $('#btnMic').classList.add('rec')
  $('#btnMic span').textContent = '松开发送'
}
function micStop() {
  if (!rec) return
  rec.sendOnEnd = true
  rec.stop()
}
$('#btnMic').addEventListener('pointerdown', micStart)
$('#btnMic').addEventListener('pointerup', micStop)
$('#btnMic').addEventListener('pointerleave', micStop)

// ---------- 状态 / WebSocket ----------
function renderStatus(s) {
  $('#modeBadge').textContent = s.board.connected ? `板卡已连接 · ${s.mode === 'sim' ? '模拟' : '实物'}` : '板卡未连接'
  $('#modeBadge').className = `badge ${s.board.connected ? 'ok' : 'bad'}`
  $('#boardInfo').textContent = `${s.board.name}${s.board.connected ? '' : '（未连接）'}`
  $('#busy').classList.toggle('hidden', !s.busy)
  $('#busy').textContent = s.busy ?? ''
  if (s.agh) {
    $('#aghBadge').className = `badge ${s.agh.configured ? 'ok' : 'bad'}`
    $('#aghBadge').textContent = s.agh.configured ? 'Agnes 已接入' : 'Agnes 未接入'
    $('#aghBadge').title = s.agh.configured ? '' : '双击“5-接入AI.bat”完成设置'
  }
}
function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`)
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data)
    if (m.type === 'pins') renderPins(m)
    else if (m.type === 'log') addLog(m)
    else if (m.type === 'status') renderStatus({ ...m, agh: undefined })
    else if (m.type === 'result') {
      renderResult(m.result)
      loadHistory()
    } else if (m.type === 'editor') {
      setCode(m.source)
      addLog({ kind: 'ai', time: Date.now(), msg: 'Agnes 修改了编辑器中的代码' })
    } else if (m.type === 'ai' && m.phase === 'progress') $('#aiProgress').textContent = m.text
  }
  ws.onclose = () => setTimeout(connect, 1500)
}

for (const t of document.querySelectorAll('.tab'))
  t.onclick = () => {
    for (const o of document.querySelectorAll('.tab')) {
      o.classList.toggle('active', o === t)
      o.setAttribute('aria-selected', o === t)
      $('#' + o.dataset.tab).classList.toggle('hidden', o !== t)
    }
  }

loadExperiments().catch(showErr)
loadHistory().catch(showErr)
api('/api/status').then(renderStatus).catch(showErr)
connect()
