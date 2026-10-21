#!/usr/bin/env node
// MCP stdio 服务：供 Agnes Harness 调用。所有工具转发到正在运行的平台 HTTP 接口，
// 这样 AI 与网页操作的是同一块板子、同一份状态（网页能实时看到 AI 的每一步）。
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'

const BASE = process.env.MCU51_URL || `http://127.0.0.1:${process.env.MCU51_PORT || 8051}`

async function call(pathname, body) {
  let res
  try {
    res = await fetch(`${BASE}${pathname}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'content-type': 'application/json', 'x-mcu51-actor': 'agnes' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch (e) {
    throw new Error(`无法连接 51 平台 ${BASE}（请先运行 npm start）：${e.message}`)
  }
  const data = await res.json()
  if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)
  return data
}

const text = (obj) => ({ content: [{ type: 'text', text: typeof obj === 'string' ? obj : JSON.stringify(obj, null, 2) }] })
const guard = (fn) => async (args) => {
  try {
    return text(await fn(args))
  } catch (e) {
    return { ...text(`错误：${e.message}`), isError: true }
  }
}

const server = new McpServer({ name: 'mcu51-platform', version: '0.1.0' })

server.registerTool(
  'board_status',
  { title: '板卡状态', description: '查看 51 单片机板卡连接状态、运行模式（实物/模拟）、最近一次编译结果和当前代码。注意：实物模式下 connected=false 只表示检测串口暂未打开，flash / run_test 时会自动打开，不代表板子没接，不要因此停止；lease.mine=true 表示板子归你（Agnes）当前这次任务使用。', inputSchema: {}, annotations: { readOnlyHint: true } },
  guard(() => call('/api/status')),
)

server.registerTool(
  'list_experiments',
  { title: '实验列表', description: '列出平台支持的实验（id、题目要求、引脚约定）。run_test 需要使用这里的 id。', inputSchema: {}, annotations: { readOnlyHint: true } },
  guard(() => call('/api/experiments')),
)

server.registerTool(
  'get_code',
  { title: '读取学生代码', description: '读取网页编辑器中学生当前的 C 代码与所选实验。', inputSchema: {}, annotations: { readOnlyHint: true } },
  guard(() => call('/api/workspace')),
)

server.registerTool(
  'compile',
  {
    title: '编译 C51 程序',
    description: '用 SDCC 编译 STC89C52 的 C 程序（支持 Keil 写法自动转换）。返回是否成功、代码大小和带行号的错误列表。成功后可调用 flash。update_editor=true 会把代码同步到学生网页编辑器。',
    inputSchema: { source: z.string().describe('完整 C 源代码'), update_editor: z.boolean().optional().describe('是否把代码写回网页编辑器，默认 true') },
  },
  guard(({ source, update_editor = true }) => call('/api/compile', { source, updateEditor: update_editor })),
)

server.registerTool(
  'flash',
  { title: '烧录到单片机', description: '把最近一次编译成功的程序通过 STC 串口 ISP 烧录到 STC89C52（模拟模式下烧录到仿真板）。', inputSchema: {}, annotations: { destructiveHint: true } },
  guard(() => call('/api/flash', {})),
)

server.registerTool(
  'capture',
  {
    title: '采集引脚数据',
    description: '从检测 MCU 采集一段时间内 P0~P3 端口的电平变化时间线（低电平=LED 亮）。可选在采集期间模拟按下 key1~key4。',
    inputSchema: {
      duration_ms: z.number().int().min(200).max(20000).describe('采集时长（毫秒）'),
      keys: z.array(z.object({ key: z.number().int().min(1).max(4), at_ms: z.number().int().min(0), hold_ms: z.number().int().min(10) })).optional().describe('模拟按键脚本'),
    },
    annotations: { readOnlyHint: true },
  },
  guard(({ duration_ms, keys = [] }) => call('/api/capture', { ms: duration_ms, keyScript: keys.map((k) => ({ key: k.key - 1, atMs: k.at_ms, holdMs: k.hold_ms })) })),
)

server.registerTool(
  'run_test',
  { title: '实物测评', description: '对当前板子上运行的程序执行指定实验的自动测评（采集 + 判分），返回得分、每项检查结果和 LED 时间线。', inputSchema: { experiment: z.enum(['led35', 'blink', 'water', 'keyled', 'buzzer', 'segstatic', 'segdynamic', 'segkey', 'stepfwd', 'stepdir', 'stepspeed']).describe('实验 id') } },
  guard(({ experiment }) => call('/api/test', { experiment })),
)

server.registerTool(
  'search_docs',
  { title: '查询硬件与实验资料', description: '检索板卡原理图说明、引脚表、实验要求和 C51 编程速查。', inputSchema: { query: z.string().describe('关键词，如 “蜂鸣器 引脚”、“定时器 1ms”') }, annotations: { readOnlyHint: true } },
  guard(({ query }) => call(`/api/docs?q=${encodeURIComponent(query)}`)),
)

// AGH 用 Ajv2020 严格模式编译工具参数，zod 生成的 draft-07 "$schema" 会导致工具被判 invalid-schema 而丢弃
const transport = new StdioServerTransport()
const send = transport.send.bind(transport)
transport.send = (msg, ...rest) => {
  for (const t of msg?.result?.tools ?? []) {
    delete t.inputSchema?.$schema
    delete t.outputSchema?.$schema
  }
  return send(msg, ...rest)
}
await server.connect(transport)
