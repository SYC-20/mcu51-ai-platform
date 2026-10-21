import { test } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { parseIntelHex } from '../server/lib/hex.js'
import { keilToSdcc, compileC } from '../server/lib/compile.js'
import { encodeFrame, FrameParser, decodePins, T } from '../server/hardware/protocol.js'
import { buildPacket } from '../server/hardware/stcisp.js'
import { SimBoard } from '../server/hardware/board.js'
import { SEG_CODES, EXPERIMENTS, judge } from '../server/judge/experiments.js'
import { loadConfig } from '../server/config.js'

const cfg = loadConfig([])

test('Intel HEX：解析数据并校验 checksum', () => {
  const bin = parseIntelHex(':0300000002000CEF\n:00000001FF\n')
  assert.deepEqual([...bin], [0x02, 0x00, 0x0c])
  assert.throws(() => parseIntelHex(':0300000002000CEE\n:00000001FF\n'), /校验和/)
})

test('Keil 写法转换为 SDCC', () => {
  const s = keilToSdcc('#include <reg52.h>\nsbit LED = P1^3;\nvoid t(void) interrupt 1 {}\n')
  assert.match(s, /#include <8052.h>/)
  assert.match(s, /__sbit __at \(0x93\) LED;/)
  assert.match(s, /__interrupt\(1\)/)
})

test('检测帧协议：编码/解码与分包', () => {
  const frames = []
  const p = new FrameParser((type, payload) => frames.push({ type, payload }))
  const f = encodeFrame(T.PINS, [0xff, 0xfe, 0xff, 0xff, 0x10, 0x27, 0, 0])
  p.push(Buffer.concat([Buffer.from([0x00, 0x13]), f.subarray(0, 5)]))
  p.push(f.subarray(5))
  assert.equal(frames.length, 1)
  assert.deepEqual(decodePins(frames[0].payload), { p0: 0xff, p1: 0xfe, p2: 0xff, p3: 0xff, t: 10000 })
})

test('STC ISP 数据包格式', () => {
  assert.deepEqual([...buildPacket([0x82])], [0x46, 0xb9, 0x6a, 0x00, 0x06, 0x82, 0xf2, 0x16])
})

const cases = [
  ['blink', 'blink', true],
  ['water', 'water', true],
  ['keyled', 'keyled', true],
  ['buzzer', 'buzzer', true],
  ['water_student', 'water', false],
  ['blink', 'keyled', false],
  ['seg_static', 'segstatic', true],
  ['seg_dynamic', 'segdynamic', true],
  ['seg_static', 'segdynamic', false],
  ['seg_dynamic', 'segstatic', false],
  ['led35', 'led35', true],
  ['blink', 'led35', false],
  ['seg_key', 'segkey', true],
  ['keyled', 'segkey', false],
  ['step_fwd', 'stepfwd', true],
  ['step_dir', 'stepfwd', false],
  ['step_dir', 'stepdir', true],
  ['step_fwd', 'stepdir', false],
  ['step_speed', 'stepspeed', true],
  ['step_fwd', 'stepspeed', false],
]
for (const [file, exp, pass] of cases) {
  test(`端到端（模拟板）：${file}.c → ${exp} 判定${pass ? '通过' : '不通过'}`, async () => {
    const c = await compileC(fs.readFileSync(new URL(`../examples/student/${file}.c`, import.meta.url), 'utf8'), cfg)
    assert.ok(c.ok, c.log)
    const b = new SimBoard(cfg)
    await b.flash(parseIntelHex(c.hex))
    b.stopLive()
    const e = EXPERIMENTS[exp]
    const cap = await b.capture(e.captureMs, e.keyScript)
    const r = judge(exp, cap.samples, cap.durationMs)
    assert.equal(r.pass, pass, JSON.stringify(r.checks))
  })
}

// 模拟实物检测：P0.1 恒为 1、P2 位选不可见、光耦上升沿慢 1ms 产生过渡态
function asHardware(samples) {
  const out = []
  let last = null
  let n = 0
  for (const s of samples) {
    if ((s.p0 & 0x7f) === 0x06 && ++n % 30 === 0) continue // 偶尔漏帧
    const v = s.p0 | 0x02
    if (last !== null && v !== last && v & ~last) {
      // 各段光耦速度不同：高位段先到，低位段后到
      out.push({ ...s, p0: v & last, p2: s.p2 | 0x0f }, { ...s, t: s.t + 1, p0: (v & last) | (v & ~last & 0xf0), p2: s.p2 | 0x0f }, { ...s, t: s.t + 2, p0: v, p2: s.p2 | 0x0f })
    }
    else out.push({ ...s, p0: v, p2: s.p2 | 0x0f })
    last = v
  }
  return out
}
for (const [file, exp, pass] of [['seg_static', 'segstatic', true], ['seg_dynamic', 'segdynamic', true], ['seg_static', 'segdynamic', false], ['seg_dynamic', 'segstatic', false]]) {
  test(`实物检测条件下：${file}.c → ${exp} 判定${pass ? '通过' : '不通过'}`, async () => {
    const c = await compileC(fs.readFileSync(new URL(`../examples/student/${file}.c`, import.meta.url), 'utf8'), cfg)
    const b = new SimBoard(cfg)
    await b.flash(parseIntelHex(c.hex))
    b.stopLive()
    const cap = await b.capture(EXPERIMENTS[exp].captureMs, [])
    const r = judge(exp, asHardware(cap.samples), cap.durationMs)
    assert.equal(r.pass, pass, JSON.stringify(r.checks))
  })
}

test('网页数码管显示：模拟板与实物板都显示 1234', async () => {
  const { SegView } = await import('../server/judge/segview.js')
  const c = await compileC(fs.readFileSync(new URL('../examples/student/seg_dynamic.c', import.meta.url), 'utf8'), cfg)
  const b = new SimBoard(cfg)
  await b.flash(parseIntelHex(c.hex))
  b.stopLive()
  const cap = await b.capture(500, [])
  const want = [0x06, 0x5b, 0x4f, 0x66]
  for (const samples of [cap.samples, asHardware(cap.samples)]) {
    const v = new SegView()
    let seg
    for (const s of samples) seg = v.feed(s)
    assert.deepEqual(seg, want)
  }
})

test('多位数码管：个别残留的过渡段码可容忍，错误段码不行', () => {
  const S = [0x06, 0x5b, 0x4f, 0x66]
  const mk = (sub) => {
    const sm = []
    let t = 100
    for (let r = 0; r < 150; r++)
      for (let i = 0; i < 4; i++) {
        const v = i === 3 && r % 20 === 0 ? 0x62 : S[i] | 2
        sm.push({ t, p0: sub(v), p1: 0xff, p2: 0xff, p3: 0xff })
        t += 3
      }
    return [sm, t]
  }
  const [ok, t1] = mk((v) => v)
  assert.equal(judge('segdynamic', ok, t1).pass, true, JSON.stringify(judge('segdynamic', ok, t1).checks))
  const [bad, t2] = mk((v) => (v === 0x5b ? 0x5a : v))
  assert.equal(judge('segdynamic', bad, t2).pass, false)
  const slow = ok.map((x) => ({ ...x, t: (x.t - 100) * 3 + 100 }))
  assert.equal(judge('segdynamic', slow, (t1 - 100) * 3 + 100).checks.find((c) => c.name.includes('20ms')).pass, false)
})

test('网页数码管显示：实物板单位数码管 0~9 不被过渡段码带偏', async () => {
  const { SegView } = await import('../server/judge/segview.js')
  const c = await compileC(fs.readFileSync(new URL('../examples/student/seg_static.c', import.meta.url), 'utf8'), cfg)
  const b = new SimBoard(cfg)
  await b.flash(parseIntelHex(c.hex))
  b.stopLive()
  const cap = await b.capture(11000, [])
  const v = new SegView()
  const seen = []
  for (const s of asHardware(cap.samples)) {
    const d = SEG_CODES.indexOf(v.feed(s)[0])
    if (d >= 0 && seen.at(-1) !== d) seen.push(d)
  }
  assert.deepEqual(seen.slice(0, 11), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 0])
})

test('编译错误返回行号', async () => {
  const c = await compileC('void main(void) {\n  x = 1;\n}\n', cfg)
  assert.equal(c.ok, false)
  assert.ok(c.errors.some((e) => e.line === 2 && e.severity === 'error'), JSON.stringify(c.errors))
})

test('板子使用权：网页和 Agnes 不同时操作板子', async () => {
  const { BoardLease } = await import('../server/access.js')
  const l = new BoardLease(1000)
  l.acquire('A', 0)
  assert.throws(() => l.acquire('B', 500), /其他同学/)
  l.acquire('B', 1500)
  l.hold('B')
  assert.throws(() => l.acquire('A', 1e12), /其他同学/)
  l.release('B', 2000)
  l.acquire('A', 2600)
})

test('网页步进电机显示：逐帧累计半步，正反转方向正确，停转 300ms 后显示停止', async () => {
  const { MotorView } = await import('../server/judge/motorview.js')
  const v = new MotorView()
  const A = 1 << 5, B = 1 << 1, C = 1 << 6, D = 1 << 4
  const fwd = [A, B, C, D]
  let t = 0, r
  for (let i = 0; i < 40; i++) r = v.feed({ t: (t += 10), p4: fwd[i % 4] })
  assert.equal(r.pos, 78)
  assert.equal(r.dir, 1)
  for (let i = 39; i >= 20; i--) r = v.feed({ t: (t += 10), p4: fwd[i % 4] })
  assert.equal(r.pos, 40)
  assert.equal(r.dir, -1)
  r = v.feed({ t: t + 400, p4: fwd[0] })
  assert.equal(r.dir, 0)
  assert.equal(v.feed({ t: 5, p0: 0 }), undefined)
})
