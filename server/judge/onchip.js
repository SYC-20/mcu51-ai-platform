// 板上测评：把单片机发来的结果帧（0xA5 0x06，见 firmware/monitor/eval.h）整理成测评结果
import { EVAL_IDS } from '../lib/compile.js'
import { EXPERIMENTS, stepText } from './experiments.js'

const hex = (v) => `0x${v.toString(16).toUpperCase().padStart(2, '0')}`
const durs = (d) => d.slice(8, 16).filter((x) => x).map((x) => x * 8)

export function onchipText(expId, d) {
  switch (expId) {
    case 'blink':
    case 'water':
      return `前 8 段灯状态 ${d.slice(0, 8).map(hex).join(' ')}；各段时长约 ${durs(d).join('、') || '无'} ms`
    case 'keyled':
      return `按下 key1~key4 时灯状态 ${d.slice(0, 4).map(hex).join(' ')}`
    case 'buzzer':
      return `按键期间 P4.2 翻转 ${d[0] | (d[1] << 8)} 次`
    case 'segstatic':
      return `显示顺序 ${d.slice(0, 8).filter((x, i) => x || i === 0).map((x) => (x === 0x0f ? '?' : x)).join('→')}；各数字时长约 ${durs(d).join('、') || '无'} ms`
    case 'led35':
      return `200ms 后亮灯 P1 = ${hex(~d[0] & 0xff)}，变化 ${d[1]} 次`
    case 'segkey':
      return `按键前和各次按键时段码 ${d.slice(0, 5).map(hex).join(' ')}，位选 ${d.slice(8, 13).map(hex).join(' ')}`
    case 'stepfwd':
    case 'stepdir':
    case 'stepspeed':
      return stepWins(d, expId).map((w, i) => `第 ${i + 1} 段 ${stepText(w)}`).join('；')
    case 'segdynamic':
      return `扫描 ${d[0]} 轮，一轮约 ${d[1]}ms；无效段码 ${d[2]}%，显示位置不对 ${d[3]}%；切换 ${d[4]} 次，顺序不对 ${d[5]} 次`
    default:
      return d.map(hex).join(' ')
  }
}

const stepWins = (d, expId) => [...Array(EXPERIMENTS[expId].keyScript.length + 1)].map((_, k) => ({ fwd: d[k * 4], rev: d[k * 4 + 1], avg: d[k * 4 + 2], bad: d[k * 4 + 3] }))

const segName = (x) => (x === 0x0f ? '?' : x)

// 检查项名称和说明都按单片机里的测评代码（eval.h 第 3 段的通过位顺序）给出
function onchipChecks(expId, d, n) {
  const t = durs(d)
  const ms = t.length ? `各段时长约 ${t.join('、')} ms` : '没有完整的时长记录'
  const states = `前 8 段灯状态 ${d.slice(0, 8).map(hex).join(' ')}`
  switch (expId) {
    case 'blink':
      return [['所有灯同时亮灭', states], ['持续闪烁', ms], ['亮/灭各约 1 秒', ms]]
    case 'water':
      return [['每次只亮 1 个灯', states], ['从右到左依次移动（P1.0→P1.7）', states], ['每步约 1 秒', ms]]
    case 'keyled':
      return EXPERIMENTS.keyled.keyScript.slice(0, n).map((k, i) => [`按下 key${k.key + 1} → 仅 LED${k.key + 1} 亮`, `按下时 P1 = ${hex(~d[i] & 0xff)}`])
    case 'buzzer': {
      const tg = `按键期间 P4.2 翻转 ${d[0] | (d[1] << 8)} 次`
      return [['未按键时蜂鸣器不响', '按键前 LED1（P1.0）应保持熄灭'], ['按下 key1 蜂鸣器响', `按键期间 LED1（P1.0）应点亮；${tg}`], ['松开后蜂鸣器停止', '松开 100ms 后 LED1（P1.0）应熄灭']]
    }
    case 'segstatic': {
      const seq = `显示顺序 ${d.slice(0, 8).filter((x, i) => x || i === 0).map(segName).join('→')}`
      return [['段码正确（共阴极 0~9）', seq], ['0~9 依次循环', seq], ['每个数字显示约 1 秒', ms], ['只选通第 1 位（P2.0 = 0）', '检测 P2 低 4 位锁存值是否始终为 0x0E']]
    }
    case 'led35':
      return [['只点亮 LED3、LED5', `200ms 后 P1 = ${hex(~d[0] & 0xff)}`], ['一直保持不变（不闪烁）', `200ms 后指示灯变化 ${d[1]} 次`]]
    case 'segkey':
      return [...Array(n)].map((_, i) => {
        const k = i ? EXPERIMENTS.segkey.keyScript[i - 1].key + 1 : 0
        return [i ? `按下 key${k} → 第 1 位显示 ${k}` : '未按键时第 1 位显示 0', `段码 ${hex(d[i])}，P2 低 4 位 = ${hex(d[8 + i])}`]
      })
    case 'stepfwd': {
      const [w] = stepWins(d, expId)
      return [['电机在转', `500ms 后：${stepText(w)}`], ['正转（A→B→C→D，顺时针）', stepText(w)], ['每步间隔 2~20ms', w.avg ? `平均每步约 ${w.avg}ms` : '电机没有转']]
    }
    case 'stepdir': {
      const w = stepWins(d, expId)
      return [['上电不转', `按键前：${stepText(w[0])}`], ['按下 key1 后正转', `key1 松开后：${stepText(w[1])}`], ['按下 key2 后反转', `key2 松开后：${stepText(w[2])}`]]
    }
    case 'stepspeed': {
      const w = stepWins(d, expId)
      return [['上电正转', `按键前：${stepText(w[0])}`], ['按 key1 后加速', `每步 ${w[0].avg}ms → ${w[1].avg}ms`], ['按 key2 后减速', `每步 ${w[1].avg}ms → ${w[2].avg}ms`]]
    }
    case 'segdynamic':
      return [['只显示 1、2、3、4', `无效段码 ${d[2]}%`], ['按 1→2→3→4 顺序循环', `切换 ${d[4]} 次，顺序不对 ${d[5]} 次`], ['扫描一轮 ≤ 20ms（不闪烁）', `扫描 ${d[0]} 轮，一轮约 ${d[1]}ms`], ['1234 显示在对应的位上', `显示位置不对 ${d[3]}%`]]
    default:
      return []
  }
}

// replay：平台用串口端口数据复现后算出的结果，只用来对照
export function onchipResult(expId, r, replay) {
  const rep = { score: replay.score, pass: replay.pass }
  const fail = (name, detail) => ({ score: 0, pass: false, checks: [{ name, pass: false, detail }], onchip: null, replay: rep })
  if (!r) return fail('收到板上测评结果', '没有收到单片机发来的结果帧：检查程序是否关闭了总中断 EA，或是否用了串口、定时器 1/2')
  if (r.code !== EVAL_IDS[expId]) return fail('测评代码与实验一致', `单片机里的测评代码是第 ${r.code} 类实验，请重新编译烧录`)
  const own = onchipChecks(expId, r.data, r.n)
  const sameItems = replay.checks.length === r.n
  const checks = [...Array(r.n)].map((_, i) => ({
    name: own[i]?.[0] ?? `第 ${i + 1} 项`,
    pass: !!((r.bits >> i) & 1),
    detail: own[i]?.[1] ?? '',
    replayPass: sameItems ? replay.checks[i].pass : undefined,
  }))
  return { score: r.score, pass: checks.every((c) => c.pass), checks, onchip: { ...r, text: onchipText(expId, r.data) }, replay: rep }
}
