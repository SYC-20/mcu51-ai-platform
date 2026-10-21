// 实验的题目、引脚约定与判分规则。
// 引脚约定来自原平台：P1 接 8 个指示灯（低电平点亮），蜂鸣器 P4.2（检测芯片采集不到，用 LED1 指示），按键 P2.4~P2.7（低电平有效，实体按键需 P3.2=0）。

export const EXPERIMENTS = {
  led35: {
    id: 'led35',
    code: 'E1',
    title: '仅 3、5 号灯点亮',
    requirement: '只点亮 LED3 和 LED5（P1.2、P1.4），其余指示灯熄灭，并一直保持不变。',
    pins: '八个指示灯接在 P1，低电平点亮，P1.0 为 LED1。',
    captureMs: 2000,
    keyScript: [],
  },
  blink: {
    id: 'blink',
    code: 'E2',
    title: '闪烁灯',
    requirement: 'P1 口 8 个指示灯全部同时亮、灭交替闪烁，亮 1 秒、灭 1 秒（允许误差 ±20%）。',
    pins: '八个指示灯接在 P1，低电平点亮。',
    captureMs: 6500,
    keyScript: [],
  },
  water: {
    id: 'water',
    code: 'E3',
    title: '流水灯',
    requirement: '从右到左（P1.0 → P1.7）每次只点亮 1 个指示灯，每 1 秒移动一位，循环往复（允许误差 ±20%）。',
    pins: '八个指示灯接在 P1，低电平点亮，P1.0 为最右侧 LED1。',
    captureMs: 10500,
    keyScript: [],
  },
  keyled: {
    id: 'keyled',
    code: 'E4',
    title: '按键控制指示灯',
    requirement: '按下 key1~key4（P2.4~P2.7，低电平有效）时，对应位置（LED1~LED4，即 P1.0~P1.3）的指示灯点亮，其余熄灭。',
    pins: '四个按键接在 P2.4~P2.7（按下为低电平）；板上是 2×4 矩阵键盘，实体按键用 SW5~SW8（= key1~key4），程序里先把 P3.3（IKEY2）置 0；SW1~SW4 在本板上不可用；八个指示灯接在 P1，低电平点亮。',
    captureMs: 4400,
    // 平台通过检测 MCU 依次“按下”每个按键 500ms，间隔 500ms
    keyScript: [0, 1, 2, 3].map((k) => ({ atMs: 400 + k * 1000, key: k, holdMs: 500 })),
  },
  buzzer: {
    id: 'buzzer',
    code: 'E5',
    title: '蜂鸣器',
    requirement: '按住 key1（P2.4，低电平有效）时蜂鸣器（P4.2）响、同时 LED1（P1.0）点亮作为指示，松开后两者都停止。',
    pins: '蜂鸣器接在 P4.2（sfr P4 = 0xE8），经 PNP 三极管驱动，需输出方波（约 2kHz）才响；检测芯片看不到 P4.2，平台通过 LED1（P1.0）判定；key1 接在 P2.4，实体按键用 SW5（需先把 P3.3 置 0）。',
    captureMs: 3000,
    keyScript: [{ atMs: 1000, key: 0, holdMs: 1000 }],
  },
  segstatic: {
    id: 'segstatic',
    code: 'E6',
    title: '单位数码管',
    requirement: '第 1 位数码管循环显示 0~9，每个数字 1 秒。',
    pins: '段码 P0（高电平亮），位选 P2.0~P2.3（低电平选通）。',
    captureMs: 6500,
    keyScript: [],
  },
  segdynamic: {
    id: 'segdynamic',
    code: 'E7',
    title: '多位数码管',
    requirement: '4 位数码管稳定显示 1234。',
    pins: '段码 P0（高电平亮），位选 P2.0~P2.3（低电平选通）。',
    captureMs: 2000,
    keyScript: [],
  },
  segkey: {
    id: 'segkey',
    code: 'E8',
    title: '独立按键控制数码管',
    requirement: '第 1 位数码管上电显示 0；按下 key1~key4（P2.4~P2.7，低电平有效）时分别显示 1~4，松开后保持最后显示的数字。',
    pins: '段码 P0（高电平亮），位选 P2.0~P2.3（低电平选通，只用第 1 位 P2.0）；四个按键接在 P2.4~P2.7，实体按键用 SW5~SW8（程序里先把 P3.3（IKEY2）置 0）。',
    captureMs: 4400,
    keyScript: [0, 1, 2, 3].map((k) => ({ atMs: 400 + k * 1000, key: k, holdMs: 500 })),
  },
  stepfwd: {
    id: 'stepfwd',
    code: 'E9',
    title: '步进电机正转',
    requirement: '步进电机一直正转：按 A→B→C→D 相的顺序通电（顺时针）（单四拍、双四拍、八拍都可以），每步间隔 2~20ms。',
    pins: 'A、B、C、D 相 = P4.5、P4.1、P4.6、P4.4（sfr P4 = 0xE8），经 ULN2003 驱动 28BYJ-48，高电平通电。',
    captureMs: 3000,
    stepW0: 500,
    keyScript: [],
  },
  stepdir: {
    id: 'stepdir',
    code: 'E10',
    title: '按键控制步进电机正反转',
    requirement: '上电电机不转（4 相都不通电）；按下 key1 后一直正转，按下 key2 后一直反转，松开按键后保持当前方向。每步间隔 2~20ms。',
    pins: 'A、B、C、D 相 = P4.5、P4.1、P4.6、P4.4（sfr P4 = 0xE8），经 ULN2003 驱动 28BYJ-48，高电平通电。key1、key2 接 P2.4、P2.5，实体按键 SW5、SW6，需先把 P3.3 置 0。',
    captureMs: 4500,
    stepW0: 200,
    keyScript: [{ atMs: 500, key: 0, holdMs: 300 }, { atMs: 2500, key: 1, holdMs: 300 }],
  },
  stepspeed: {
    id: 'stepspeed',
    code: 'E11',
    title: '按键控制步进电机加减速',
    requirement: '上电一直正转；每按一次 key1 加速（每步间隔缩短到原来的 80% 以下），每按一次 key2 减速（间隔变长到原来的 1.25 倍以上），每步间隔保持在 2~20ms。',
    pins: 'A、B、C、D 相 = P4.5、P4.1、P4.6、P4.4（sfr P4 = 0xE8），经 ULN2003 驱动 28BYJ-48，高电平通电。key1、key2 接 P2.4、P2.5，实体按键 SW5、SW6，需先把 P3.3 置 0。',
    captureMs: 5500,
    stepW0: 500,
    keyScript: [{ atMs: 1500, key: 0, holdMs: 300 }, { atMs: 3500, key: 1, holdMs: 300 }],
  },
}

export const SEG_CODES = [0x3f, 0x06, 0x5b, 0x4f, 0x66, 0x6d, 0x7d, 0x07, 0x7f, 0x6f]
// mask：检测芯片看不到的段（实物板 P0.1 按原理图未经光耦，检测端恒为 1），比较时忽略
export const segDigits = (v, mask = 0) => SEG_CODES.map((c, d) => ((c | mask) === ((v & 0x7f) | mask) ? d : -1)).filter((d) => d >= 0)
const segBlank = (v, mask = 0) => ((v & 0x7f) | mask) === mask
const segText = (v, mask = 0) => {
  const ds = segDigits(v, mask)
  return segBlank(v, mask) ? '熄灭' : ds.length ? `显示 ${ds.join('/')}` : `无效段码 ${hex(v)}`
}

export const listExperiments = () =>
  Object.values(EXPERIMENTS).map(({ id, code, title, requirement, pins }) => ({ id, code, title, requirement, pins }))

// samples: [{t, p0, p1, p2, p3}] —— 端口状态变化时间线（t 单位 ms，第一条为 t=0 的初始状态）
function ledTimeline(samples, endMs) {
  const tl = []
  for (const s of samples) {
    const leds = ~s.p1 & 0xff
    if (!tl.length || tl[tl.length - 1].leds !== leds) tl.push({ t: s.t, leds })
  }
  return tl.map((seg, i) => ({ ...seg, dur: (i + 1 < tl.length ? tl[i + 1].t : endMs) - seg.t }))
}

// 合并持续时间极短（< minMs）的毛刺段，避免扫描/上电瞬态干扰
function deglitch(tl, minMs = 30) {
  const out = []
  for (const seg of tl) {
    if (seg.dur < minMs && out.length) {
      out[out.length - 1].dur += seg.dur
      continue
    }
    if (out.length && out[out.length - 1].leds === seg.leds) out[out.length - 1].dur += seg.dur
    else out.push({ ...seg })
  }
  return out
}

const hex = (v) => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`
const ledsText = (v) => (v === 0 ? '全灭' : v === 0xff ? '全亮' : [...Array(8)].map((_, i) => (v >> i) & 1 ? `LED${i + 1}` : null).filter(Boolean).join('+'))
const list = (arr) => (arr.length > 12 ? `${arr.slice(0, 12).join(', ')} …（共 ${arr.length} 段）` : arr.join(', '))
const within = (v, target, tol = 0.2) => Math.abs(v - target) <= target * tol

function stateAt(samples, t) {
  let cur = samples[0]
  for (const s of samples) {
    if (s.t <= t) cur = s
    else break
  }
  return cur
}

function judgeBlink(samples, endMs) {
  const tl = deglitch(ledTimeline(samples, endMs))
  const checks = []
  const bad = tl.filter((s) => s.leds !== 0 && s.leds !== 0xff)
  checks.push({ name: '所有灯同时亮灭', pass: bad.length === 0, detail: bad.length ? `出现非全亮/全灭状态：${bad.slice(0, 3).map((s) => `${hex(s.leds)}(${ledsText(s.leds)})`).join('、')}` : '只出现全亮/全灭' })
  const full = tl.slice(1, -1)
  checks.push({ name: '持续闪烁', pass: full.length >= 3, detail: `观察到 ${tl.length - 1} 次状态切换` })
  const off = full.filter((s) => !within(s.dur, 1000))
  checks.push({ name: '亮/灭各约 1 秒', pass: full.length >= 3 && off.length === 0, detail: full.length ? `各段时长(ms)：${list(full.map((s) => Math.round(s.dur)))}` : '没有完整周期' })
  return { checks, timeline: tl }
}

function judgeWater(samples, endMs) {
  const tl = deglitch(ledTimeline(samples, endMs))
  const checks = []
  const steady = tl.slice(1)
  const notSingle = steady.filter((s) => s.leds !== 0 && (s.leds & (s.leds - 1)) !== 0)
  checks.push({ name: '每次只亮 1 个灯', pass: steady.length > 0 && notSingle.length === 0, detail: notSingle.length ? `出现多灯同时亮：${notSingle.slice(0, 3).map((s) => ledsText(s.leds)).join('、')}` : '满足' })
  const singles = tl.filter((s) => s.leds && (s.leds & (s.leds - 1)) === 0)
  let dirOk = singles.length >= 4
  for (let i = 1; i < singles.length; i++) {
    const prev = Math.log2(singles[i - 1].leds)
    const cur = Math.log2(singles[i].leds)
    if (!(cur === prev + 1 || (prev === 7 && cur === 0))) dirOk = false
  }
  checks.push({ name: '从右到左依次移动（P1.0→P1.7）', pass: dirOk, detail: `顺序：${singles.slice(0, 10).map((s) => `LED${Math.log2(s.leds) + 1}`).join(' → ')}` })
  const mid = singles.slice(1, -1)
  const off = mid.filter((s) => !within(s.dur, 1000))
  checks.push({ name: '每步约 1 秒', pass: mid.length >= 3 && off.length === 0, detail: mid.length ? `各步时长(ms)：${list(mid.map((s) => Math.round(s.dur)))}` : '步数不足' })
  return { checks, timeline: tl }
}

function judgeKeyLed(samples, endMs, exp) {
  const checks = []
  for (const k of exp.keyScript) {
    const s = stateAt(samples, k.atMs + k.holdMs - 50)
    const leds = ~s.p1 & 0xff
    const want = 1 << k.key
    checks.push({ name: `按下 key${k.key + 1} → 仅 LED${k.key + 1} 亮`, pass: leds === want, detail: `实际：${ledsText(leds)}（P1=${hex(s.p1)}）` })
  }
  return { checks, timeline: deglitch(ledTimeline(samples, endMs)) }
}

function judgeBuzzer(samples, endMs, exp) {
  const k = exp.keyScript[0]
  const low = (from, to) => {
    let any = false
    let prev = stateAt(samples, from)
    if (!(prev.p1 & 1)) any = true
    for (const s of samples) if (s.t > from && s.t < to && !(s.p1 & 1)) any = true
    return any
  }
  const checks = [
    { name: '未按键时蜂鸣器不响', pass: !low(200, k.atMs), detail: '检测 LED1（P1.0，蜂鸣器指示）在按键前是否点亮' },
    { name: '按下 key1 蜂鸣器响', pass: low(k.atMs + 20, k.atMs + k.holdMs), detail: '检测 LED1（P1.0，蜂鸣器指示）在按键期间是否点亮；蜂鸣器本身在 P4.2，请用耳朵确认' },
    { name: '松开后蜂鸣器停止', pass: !low(k.atMs + k.holdMs + 100, endMs), detail: '检测 LED1（P1.0）在松开后是否熄灭' },
  ]
  return { checks, timeline: deglitch(ledTimeline(samples, endMs), 0) }
}

// 实物板检测芯片看不到 P2.0~P2.3（帧里固定为 1），也看不到 P0.1；模拟板都能看到
const digitSelectVisible = (samples) => samples.some((s) => (s.p2 & 0x0f) !== 0x0f)

// 段码（P0）时间线：不做时间去毛刺（动态扫描每位只有几毫秒），只去掉光耦上升慢造成的过渡态
function segTimeline(samples, endMs, mask) {
  let tl = []
  const push = (seg) => { if (!tl.length || tl[tl.length - 1].leds !== seg.leds) tl.push(seg) }
  for (const s of samples) push({ t: s.t, leds: s.p0 | mask, p2: s.p2 })
  for (let pass = 0; pass < 2; pass++) {
    const out = []
    for (let i = 0; i < tl.length; i++) {
      const prev = out[out.length - 1], cur = tl[i], next = tl[i + 1]
      const between = prev && next && (cur.leds & ~(prev.leds | next.leds)) === 0
      const transient = between && ((next.t - cur.t <= 2 && ((prev.leds & next.leds) & ~cur.leds) === 0) || (next.t - cur.t <= 3 && !segBlank(cur.leds, mask) && !segDigits(cur.leds, mask).length))
      if (!transient && (!prev || prev.leds !== cur.leds)) out.push(cur)
    }
    tl = out
  }
  return tl.map((seg, i) => ({ ...seg, dur: (i + 1 < tl.length ? tl[i + 1].t : endMs) - seg.t, text: segText(seg.leds, mask) }))
}

function judgeSegStatic(samples, endMs) {
  const sel = digitSelectVisible(samples)
  const mask = sel ? 0 : 0x02
  const tl = segTimeline(samples, endMs, mask).filter((s, i) => i > 0 || (s.leds | 0x80) !== 0xff)
  const checks = []
  const shown = tl.filter((s) => !segBlank(s.leds, mask))
  const bad = shown.filter((s) => !segDigits(s.leds, mask).length && !(s.dur <= 5 && SEG_CODES.some((c) => (s.leds & ~(c | mask)) === 0)))
  checks.push({ name: '段码正确（共阴极 0~9）', pass: shown.length > 0 && bad.length === 0, detail: bad.length ? `出现无效段码：${bad.slice(0, 3).map((s) => hex(s.leds)).join('、')}` : shown.length ? '满足' : 'P0 没有输出段码' })
  const seq = shown.filter((s) => segDigits(s.leds, mask).length)
  const start = seq.length ? segDigits(seq[0].leds, mask).find((d0) => seq.every((s, i) => segDigits(s.leds, mask).includes((d0 + i) % 10))) : undefined
  const digits = seq.map((s, i) => (start !== undefined ? (start + i) % 10 : segDigits(s.leds, mask).join('/')))
  checks.push({ name: '0~9 依次循环', pass: seq.length >= 4 && start !== undefined, detail: `顺序：${digits.slice(0, 10).join(' → ') || '无'}` })
  const mid = seq.slice(1, -1)
  const off = mid.filter((s) => !within(s.dur, 1000))
  checks.push({ name: '每个数字显示约 1 秒', pass: mid.length >= 3 && off.length === 0, detail: mid.length ? `各段时长(ms)：${list(mid.map((s) => Math.round(s.dur)))}` : '数字切换次数不足' })
  if (sel) {
    const wrong = samples.filter((s) => s.t > 50 && (s.p2 & 0x0f) !== 0x0e)
    checks.push({ name: '只选通第 1 位（P2.0 = 0）', pass: wrong.length === 0, detail: wrong.length ? `P2 低 4 位出现 ${hex(wrong[0].p2 & 0x0f)}` : '满足' })
  }
  return { checks, timeline: tl }
}

function judgeSegDynamic(samples, endMs) {
  const sel = digitSelectVisible(samples)
  const mask = sel ? 0 : 0x02
  const tl = segTimeline(samples, endMs, mask).filter((s) => s.t >= 100)
  const checks = []
  const shown = tl.filter((s) => !segBlank(s.leds, mask))
  const dig = (s) => segDigits(s.leds, mask).find((d) => d >= 1 && d <= 4) ?? -1
  // 漏帧时个别过渡段码（某个目标段码的“半亮”状态）会留下来，允许 ≤10%
  const want = [1, 2, 3, 4].map((d) => SEG_CODES[d])
  const partial = (s) => s.dur <= 5 && want.some((c) => (s.leds & ~(c | mask)) === 0)
  const bad = shown.filter((s) => dig(s) < 0)
  const realBad = bad.filter((s) => !partial(s))
  checks.push({ name: '只显示 1、2、3、4', pass: shown.length > 0 && realBad.length === 0 && bad.length <= shown.length * 0.1, detail: realBad.length || bad.length > shown.length * 0.1 ? `出现其他段码：${[...new Set(bad.map((s) => hex(s.leds)))].slice(0, 4).join('、')}` : shown.length ? `满足${bad.length ? '（个别切换瞬间的过渡段码已忽略）' : ''}` : 'P0 没有输出段码' })
  const seq = shown.filter((s, i) => i === 0 || s.leds !== shown[i - 1].leds).map((s) => ({ t: s.t, d: dig(s) }))
  // 检测串口偶尔会漏掉一帧，允许 ≤10% 的跳变不符合顺序
  let wrongStep = 0
  for (let i = 1; i < seq.length; i++) if (seq[i].d !== (seq[i - 1].d % 4) + 1) wrongStep++
  const orderOk = seq.length >= 8 && wrongStep <= (seq.length - 1) * 0.1
  checks.push({ name: '按 1→2→3→4 顺序循环', pass: orderOk, detail: `顺序：${seq.slice(0, 12).map((s) => (s.d > 0 ? s.d : '?')).join(' → ') || '无'}${wrongStep ? `（共 ${seq.length - 1} 次切换，${wrongStep} 次不符合顺序）` : ''}` })
  const starts = seq.filter((s) => s.d === 1).map((s) => s.t)
  const periods = starts.slice(1).map((t, i) => t - starts[i])
  // 漏帧会让个别轮次看起来变长，用中位数判断真实扫描周期
  const median = periods.length ? [...periods].sort((a, b) => a - b)[Math.floor(periods.length / 2)] : Infinity
  checks.push({ name: '扫描一轮 ≤ 20ms（不闪烁）', pass: periods.length >= 10 && median <= 20, detail: periods.length ? `共 ${periods.length} 轮，一轮约 ${Math.round(median)}ms` : '没有观察到完整的扫描周期' })
  if (sel) {
    const wrong = shown.filter((s) => dig(s) > 0 && (s.p2 & 0x0f) !== (0x0f & ~(1 << (dig(s) - 1))))
    checks.push({ name: '1234 显示在对应的位上', pass: wrong.length === 0, detail: wrong.length ? `显示 ${dig(wrong[0])} 时 P2 低 4 位 = ${hex(wrong[0].p2 & 0x0f)}` : '满足' })
  }
  return { checks, timeline: tl }
}

function judgeLed35(samples, endMs) {
  const tl = deglitch(ledTimeline(samples, endMs))
  const last = ~stateAt(samples, endMs).p1 & 0xff
  let prev = stateAt(samples, 200).p1
  let changes = 0
  for (const s of samples) if (s.t > 200 && s.p1 !== prev) (changes++, (prev = s.p1))
  const checks = [
    { name: '只点亮 LED3、LED5', pass: last === 0x14, detail: `实际：${ledsText(last)}（P1=${hex(~last & 0xff)}）` },
    { name: '一直保持不变（不闪烁）', pass: changes === 0, detail: changes ? `200ms 后指示灯变化了 ${changes} 次` : '满足' },
  ]
  return { checks, timeline: tl }
}

function judgeSegKey(samples, endMs, exp) {
  const sel = digitSelectVisible(samples)
  const mask = sel ? 0 : 0x02
  const at = [exp.keyScript[0].atMs - 50, ...exp.keyScript.map((k) => k.atMs + k.holdMs - 50)]
  const checks = at.map((t, i) => {
    const s = stateAt(samples, t)
    const want = i === 0 ? 0 : exp.keyScript[i - 1].key + 1
    const okSeg = segDigits(s.p0, mask).includes(want) && (s.p0 & 0x7f | mask) === (SEG_CODES[want] | mask)
    const okSel = !sel || (s.p2 & 0x0f) === 0x0e
    return {
      name: i === 0 ? '未按键时第 1 位显示 0' : `按下 key${want} → 第 1 位显示 ${want}`,
      pass: okSeg && okSel,
      detail: `实际：${segText(s.p0, mask)}${sel ? `，P2 低 4 位 = ${hex(s.p2 & 0x0f)}` : ''}`,
    }
  })
  return { checks, timeline: segTimeline(samples, endMs, mask) }
}

// 步进电机：A~D 相 = P4.5、P4.1、P4.6、P4.4，组成 4 位相位（A 相为最低位）；八拍顺序 1→3→2→6→4→C→8→9 为正转
export const motorPhase = (p4) => ((p4 >> 5) & 1) | (p4 & 2) | ((p4 >> 4) & 4) | ((p4 >> 1) & 8)
const STEP_POS = { 1: 0, 3: 1, 2: 2, 6: 3, 4: 4, 12: 5, 8: 6, 9: 7 }
// 和 eval.h 的统计方法一致：按键脚本把时间分成若干段（按键松开 200ms 后才开始统计），每段统计正转/反转/乱序步数和平均每步间隔
function stepWindows(samples, exp) {
  const ks = exp.keyScript
  const win = [...Array(ks.length + 1)].map((_, i) => ({ from: i ? ks[i - 1].atMs + ks[i - 1].holdMs + 200 : exp.stepW0, to: i < ks.length ? ks[i].atMs : exp.captureMs + 1, fwd: 0, rev: 0, bad: 0, n: 0, a: 0, z: 0 }))
  let cur = 0
  let prev = null
  for (const s of samples) {
    if (s.p4 === undefined) continue
    const v = motorPhase(s.p4)
    const m = STEP_POS[v]
    if (m === undefined || v === cur) continue
    cur = v
    const w = prev === null ? null : win.find((x) => s.t >= x.from && s.t < x.to)
    if (w) {
      const d = (m - prev) & 7
      if (d === 1 || d === 2) w.fwd++
      else if (d === 6 || d === 7) w.rev++
      else w.bad++
      if (!w.n++) w.a = s.t
      w.z = s.t
    }
    prev = m
  }
  return win.map((w) => ({ fwd: Math.min(w.fwd, 255), rev: Math.min(w.rev, 255), bad: Math.min(w.bad, 255), n: w.n, avg: w.n > 1 ? Math.min(255, Math.floor((w.z - w.a + ((w.n - 1) >> 1)) / (w.n - 1))) : 0 }))
}
export const stepIsFwd = (w) => w.fwd >= 10 && (w.rev + w.bad) * 8 <= w.fwd
export const stepIsRev = (w) => w.rev >= 10 && (w.fwd + w.bad) * 8 <= w.rev
export const stepText = (w) => `正转 ${w.fwd} 步、反转 ${w.rev} 步、乱序 ${w.bad} 步${w.avg ? `，每步约 ${w.avg}ms` : ''}`
const noP4 = (samples) => !samples.some((s) => s.p4 !== undefined)
const NO_P4 = '这种检测方式采集不到 P4（电机），请用板上测评或单 MCU 自检测模式'

function judgeStepFwd(samples, endMs, exp) {
  const [w] = stepWindows(samples, exp)
  const na = noP4(samples)
  const checks = [
    { name: '电机在转', pass: w.fwd + w.rev >= 20, detail: na ? NO_P4 : `500ms 后：${stepText(w)}` },
    { name: '正转（A→B→C→D，顺时针）', pass: stepIsFwd(w), detail: na ? NO_P4 : stepText(w) },
    { name: '每步间隔 2~20ms', pass: w.n > 1 && w.avg >= 2 && w.avg <= 20, detail: na ? NO_P4 : w.n > 1 ? `平均每步约 ${w.avg}ms` : '电机没有转' },
  ]
  return { checks, timeline: [] }
}

function judgeStepDir(samples, endMs, exp) {
  const w = stepWindows(samples, exp)
  const na = noP4(samples)
  const checks = [
    { name: '上电不转', pass: w[0].fwd + w[0].rev + w[0].bad <= 2, detail: na ? NO_P4 : `按键前：${stepText(w[0])}` },
    { name: '按下 key1 后正转', pass: stepIsFwd(w[1]), detail: na ? NO_P4 : `key1 松开后：${stepText(w[1])}` },
    { name: '按下 key2 后反转', pass: stepIsRev(w[2]), detail: na ? NO_P4 : `key2 松开后：${stepText(w[2])}` },
  ]
  return { checks, timeline: [] }
}

function judgeStepSpeed(samples, endMs, exp) {
  const w = stepWindows(samples, exp)
  const na = noP4(samples)
  const checks = [
    { name: '上电正转', pass: stepIsFwd(w[0]), detail: na ? NO_P4 : `按键前：${stepText(w[0])}` },
    { name: '按 key1 后加速', pass: stepIsFwd(w[1]) && w[1].avg > 0 && w[1].avg * 5 <= w[0].avg * 4, detail: na ? NO_P4 : `每步 ${w[0].avg}ms → ${w[1].avg}ms（${stepText(w[1])}）` },
    { name: '按 key2 后减速', pass: stepIsFwd(w[2]) && w[2].avg > 0 && w[2].avg * 4 >= w[1].avg * 5, detail: na ? NO_P4 : `每步 ${w[1].avg}ms → ${w[2].avg}ms（${stepText(w[2])}）` },
  ]
  return { checks, timeline: [] }
}

const JUDGES = { led35: judgeLed35, blink: judgeBlink, water: judgeWater, keyled: judgeKeyLed, buzzer: judgeBuzzer, segstatic: judgeSegStatic, segdynamic: judgeSegDynamic, segkey: judgeSegKey, stepfwd: judgeStepFwd, stepdir: judgeStepDir, stepspeed: judgeStepSpeed }

export function judge(expId, samples, endMs) {
  const exp = EXPERIMENTS[expId]
  if (!exp) throw new Error(`未知实验：${expId}`)
  if (!samples.length) return { experiment: expId, title: exp.title, score: 0, pass: false, checks: [{ name: '采集到数据', pass: false, detail: '没有收到检测数据' }], timeline: [] }
  const { checks, timeline } = JUDGES[expId](samples, endMs, exp)
  const passed = checks.filter((c) => c.pass).length
  const score = Math.round((passed / checks.length) * 100)
  return {
    experiment: expId,
    title: exp.title,
    score,
    pass: passed === checks.length,
    checks,
    timeline: timeline.slice(0, 40).map((s) => ({ t: Math.round(s.t), durMs: Math.round(s.dur), leds: hex(s.leds), text: s.text ?? ledsText(s.leds) })),
  }
}
