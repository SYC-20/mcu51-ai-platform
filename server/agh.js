// 与 Agnes Harness 的桥接：通过 AGH CLI 一次性模式（-p --mode json）发送任务，
// 由 AGH 调度 Agnes 模型，并通过 MCP（server/mcp-stdio.js）回调本平台的编译/烧录/采集/测评工具。
import { spawn } from 'node:child_process'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

const MODES = {
  ask: '答疑',
  fix: '自动排错',
  analyze: '学情分析',
}

const AGENT_RULES = `# 51 单片机 AI 助教（Agnes）工作规则

你是“51 单片机 AI 智慧测评平台”的助教，面向初学 STC89C52 的学生。
你可以使用 MCP 服务 mcu51-platform 提供的工具：board_status、list_experiments、get_code、compile、flash、capture、run_test、search_docs。

硬件事实（不要臆测，不确定时先调用 search_docs）：
- STC89C52，11.0592MHz，12T；8 个 LED 接 P1，低电平点亮，P1.0=LED1（最右）。
- 蜂鸣器接 P4.2（sfr P4 = 0xE8，PNP 驱动，需约 2kHz 方波才响）；蜂鸣器实验要求按键期间同时点亮 LED1（P1.0）作指示，判分看 LED1。
- key1~key4 接 P2.4~P2.7，按下为低电平；板上是矩阵键盘，实体按键用 SW5~SW8（= key1~key4），程序需先把 P3.3 置 0；SW1~SW4 实测未接到 STC89C52，不可用。
- 4 位共阴极数码管 FJ5461AH：段码接 P0（P0.0=a … P0.6=g，P0.7=dp，经 74HC245 驱动，高电平点亮；0~9 段码 0x3F,0x06,0x5B,0x4F,0x66,0x6D,0x7D,0x07,0x7F,0x6F）；位选 P2.0~P2.3 = DIG1~DIG4（DIG1 最左），低电平选通。
- 步进电机 28BYJ-48 经 ULN2003 驱动，高电平通电：A、B、C、D 相 = P4.5、P4.1、P4.6、P4.4（sfr P4 = 0xE8）；按 A→B→C→D 顺序通电为正转（顺时针），反过来为反转；每步间隔 2~20ms。
- 平台用 SDCC 编译，Keil 写法会自动转换；软件 for 循环延时与编译器相关，需要精确时序时推荐定时器 0。测评代码占用定时器 1、定时器 2 和串口，学生程序不要使用它们。

两种测评方式（board_status 返回的板卡名称里带“板上测评”的就是第 1 种）：
1. 板上测评（主要方式）：测评代码在编译时嵌进学生固件，定时器 1 每 1ms 读一次 P0~P4，按规则算分，测完把结果通过串口发回；平台再用同样的规则复现一遍。测评代码不改端口，学生程序照常运行。能看到 P0 段码、P2 位选、P4 步进电机相位，蜂鸣器实验还会给出按键期间 P4.2 的翻转次数。
2. IAP15 检测模式：另一块 IAP15 检测芯片通过光耦只采集 P0、P1。看不到 P2 位选、P4.2 蜂鸣器和 P4 步进电机，P0.1（b 段）检测端恒为 1，数码管实验按段码内容、顺序和时间判分；步进电机实验在这种方式下无法测评。
- 测评只看端口电平：步进电机得满分只说明 P4 的通电顺序和时间对，不能证明电机真的在转；蜂鸣器是否发声也要学生用耳朵确认。遇到“平台满分但实物不对”，结合学生描述检查接线、电源和驱动板。

工作方式：
1. 板卡状态里 connected=false 只说明串口还没打开（flash / run_test 时会自动打开），不影响编译和烧录；不要因为它或 lease 字段就放弃调用工具，直接调用工具，以工具返回的错误为准。工具调用被“拒绝/未批准”时，告诉用户：在 AGH 网页里给当前对话打开 YOLO（或批准该工具）。
2. 答疑：用中文、分步骤讲清原理，引用具体引脚和寄存器；只有在需要验证时才调用工具。
3. 自动排错（闭环）：get_code → 分析 → compile（修正后的完整代码）→ 若编译失败读取错误再改 → flash → run_test → 根据每一项检查结果和端口时间线定位原因 → 再修改，最多 3 轮。
   每一轮用一句话说明“计划 / 调用结果 / 结论”。最后给出：最终得分、改了什么、为什么。
4. 不要编造测评结果，所有“已通过”的结论必须来自 run_test 的返回值。
5. 工具报错（串口打不开、设备忙、超时）时说明可能原因和学生可以做的检查，不要无限重试。
`

export class AghBridge extends EventEmitter {
  constructor(cfg, platform) {
    super()
    this.cfg = cfg
    this.platform = platform
    this.sessionId = null
    this.running = null
    this.chars = 0
    if (!this.loadState()) this.newWorkdir()
  }

  // AGH 按工作目录确定对话（YOLO 等审批开关也跟着对话走），所以平台一直用同一个目录，
  // 平台重启后也接着用；只有点“新对话”或对话内容快到上限时才换新目录。
  get stateFile() {
    return path.join(this.cfg.agh.cwd, 'current.json')
  }

  loadState() {
    try {
      const st = JSON.parse(fs.readFileSync(this.stateFile, 'utf8'))
      if (!fs.existsSync(st.workdir)) return false
      Object.assign(this, { workdir: st.workdir, sessionId: st.sessionId ?? null, chars: st.chars ?? 0 })
      return true
    } catch {
      return false
    }
  }

  saveState() {
    fs.writeFileSync(this.stateFile, JSON.stringify({ workdir: this.workdir, sessionId: this.sessionId, chars: this.chars }))
  }

  newWorkdir() {
    const base = this.cfg.agh.cwd
    fs.mkdirSync(base, { recursive: true })
    const old = fs.readdirSync(base).filter((n) => n.startsWith('chat-')).sort()
    for (const n of old.slice(0, Math.max(0, old.length - 4))) fs.rmSync(path.join(base, n), { recursive: true, force: true })
    this.workdir = path.join(base, `chat-${Date.now()}`)
    fs.mkdirSync(this.workdir, { recursive: true })
    fs.writeFileSync(path.join(this.workdir, 'AGENTS.md'), AGENT_RULES)
    this.sessionId = null
    this.chars = 0
    this.saveState()
  }

  info() {
    return { configured: !!this.cfg.agh.cli && fs.existsSync(this.cfg.agh.cli), cli: this.cfg.agh.cli, sessionId: this.sessionId, running: !!this.running }
  }

  reset() {
    this.newWorkdir()
    if (this.child) {
      this.cancelled = true
      this.child.kill()
    }
    return { ok: true }
  }

  buildPrompt(message, mode, workspace) {
    const exp = this.platform.experiments().find((e) => e.id === workspace.experiment)
    const ctx = [
      `【模式】${MODES[mode] ?? MODES.ask}`,
      exp ? `【当前实验】${exp.title}（id=${exp.id}）要求：${exp.requirement}` : '',
      `【平台模式】${this.cfg.mode === 'sim' ? '模拟板（内置 8051 仿真）' : '实物板'}`,
    ]
    if (mode === 'fix') {
      ctx.push('请按“自动排错（闭环）”流程执行：先 get_code 读取学生代码，再编译、烧录、run_test 验证，直到通过或达到 3 轮。')
    } else if (mode === 'analyze') {
      const hist = this.platform.history(10).map((h) => `${h.time} ${h.title} ${h.score}分 ${h.checks.filter((c) => !c.pass).map((c) => c.name).join('/')}`)
      ctx.push(`最近测评记录：\n${hist.join('\n') || '（暂无）'}\n请据此给出学情分析：掌握情况、薄弱点、下一步练习建议。`)
    } else {
      ctx.push(`学生当前代码：\n\`\`\`c\n${workspace.source.slice(0, 6000)}\n\`\`\``)
    }
    return `${ctx.filter(Boolean).join('\n')}\n\n【学生的问题/指令】${message || '（无）'}`
  }

  runOnce(prompt, sessionId) {
    const args = [this.cfg.agh.cli, '-p', '--mode', 'json', '--cwd', this.workdir]
    if (sessionId) args.push('--resume', sessionId)
    return new Promise((resolve, reject) => {
      const child = spawn(this.cfg.agh.node, args, { cwd: this.workdir, windowsHide: true, env: { ...process.env, MCU51_PORT: String(this.cfg.port) } })
      this.child = child
      let out = ''
      let err = ''
      const timer = setTimeout(() => child.kill(), this.cfg.agh.timeoutMs)
      child.stdout.on('data', (d) => (out += d))
      child.stderr.on('data', (d) => {
        err += d
        for (const line of String(d).split(/\r?\n/)) if (line.trim()) this.emit('event', { phase: 'progress', text: line.trim() })
      })
      child.on('error', (e) => {
        clearTimeout(timer)
        reject(new Error(`无法启动 AGH：${e.message}`))
      })
      child.stdin.end(prompt)
      child.on('close', (code) => {
        clearTimeout(timer)
        if (this.child === child) this.child = null
        if (this.cancelled) return reject(new Error('已结束上一次请求，开始新对话'))
        const line = out.trim().split(/\r?\n/).filter((l) => l.startsWith('{')).pop()
        let result = null
        try {
          result = line ? JSON.parse(line) : null
        } catch {}
        if (!result) return reject(new Error(`AGH 没有返回结果（退出码 ${code}）：${err.trim().slice(-500)}`))
        resolve(result)
      })
    })
  }

  async chat(message, { mode = 'ask', workspace }) {
    if (!this.info().configured) throw new Error('尚未配置 Agnes Harness：请在 config.json 的 agh.cli 填写 agnes.mjs 的绝对路径（见 README“接入 AGH”）')
    if (this.running) throw new Error('Agnes 正在处理上一条消息，请稍候')
    const prompt = this.buildPrompt(message, mode, workspace)
    this.emit('event', { phase: 'start', mode, message })
    this.platform.log('ai', `Agnes（${MODES[mode] ?? mode}）开始处理：${message.slice(0, 80)}`)
    const OK = ['completed', 'parked', 'max_steps']
    const limit = this.cfg.agh.maxChatChars ?? 150000
    let switched = false
    if (this.chars + prompt.length > limit) {
      this.platform.log('ai', '当前 Agnes 对话内容快到上限，自动开启新对话')
      this.newWorkdir()
      switched = true
    }
    this.cancelled = false
    this.running = (async () => {
      try {
        const r = await this.runOnce(prompt, this.sessionId)
        if (OK.includes(r.reason) || this.cancelled) return r
        this.platform.log('ai', `Agnes 本轮未正常结束（${r.reason}），在同一对话里重试一次`)
      } catch (e) {
        if (this.cancelled) throw e
        this.platform.log('ai', `Agnes 调用出错，在同一对话里重试一次：${e.message.slice(0, 120)}`)
      }
      return this.runOnce(prompt, this.sessionId)
    })()
    try {
      const r = await this.running
      if (r.sessionId) this.sessionId = r.sessionId
      this.chars += prompt.length + (r.text?.length ?? 0)
      this.saveState()
      let reply = r.reason === 'parked' ? `⚠ Agnes 正在等待工具调用审批（ticket ${r.ticket ?? '?'}），请在 AGH Web 工作台中批准后重试。` : r.text || `（本轮结束：${r.reason}）Agnes 模型这次没有返回内容，可能是网络或模型服务暂时出错，请稍后再问一次。`
      if (switched) reply = `（上一个对话内容太多，已自动换成新对话。如需 Agnes 自动编译烧录，请在 AGH 网页里给新对话打开 YOLO。）\n\n${reply}`
      this.platform.log('ai', `Agnes 回复完成（${r.reason}）`)
      this.emit('event', { phase: 'end', reason: r.reason, text: reply })
      return { reply, reason: r.reason, sessionId: r.sessionId }
    } catch (e) {
      this.platform.log('error', `Agnes 调用失败：${e.message}`)
      this.emit('event', { phase: 'error', text: e.message })
      throw e
    } finally {
      this.running = null
    }
  }
}

