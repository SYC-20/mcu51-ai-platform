# AI孪生实验助手 —— 基于 Agnes 的远程硬件实验智能闭环系统

[English](README.md) | 简体中文

<div align="center">

### 面向远程硬件实验的智能闭环

**在网页上写 C51，平台自动完成编译 → 串口烧写固件 → 读取运行状态 → 自动判分；
Agnes 通过 AGH + MCP 调用同一套工具，走通同一条链路。**

<img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933" alt="Node.js 24 及以上" />
<img src="https://img.shields.io/badge/license-MIT-97ca00" alt="许可证：MIT" />
<img src="https://img.shields.io/badge/MCU-STC89C52RC-f59e0b" alt="主控：STC89C52RC" />
<img src="https://img.shields.io/badge/compiler-SDCC-4B8BBE" alt="编译器：SDCC" />
<img src="https://img.shields.io/badge/MCP-stdio-6e40c9" alt="MCP 通道：stdio" />
<img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="平台：Windows" />

[项目介绍](#项目介绍) · [视频介绍](#视频介绍) · [架构介绍](#架构介绍) · [集成标准](#集成标准) · [快速开始](#快速开始) · [实验列表](#实验列表)

面向 2026 江苏省 AI+科学与工程创新实践黑客松的作品。

</div>

---

<details>
<summary><kbd>目录</kbd></summary>

- [项目介绍](#项目介绍)
  - [项目背景](#项目背景)
  - [核心功能](#核心功能)
  - [创新亮点](#创新亮点)
- [视频介绍](#视频介绍)
- [架构介绍](#架构介绍)
  - [总体架构](#总体架构)
  - [核心模块](#核心模块)
  - [一次测评的完整链路](#一次测评的完整链路)
- [集成标准](#集成标准)
  - [一、MCP 工具接口](#一mcp-工具接口)
  - [二、HTTP 接口](#二http-接口)
  - [三、串口帧协议](#三串口帧协议)
  - [四、学生编程约定](#四学生编程约定)
  - [五、判分规则结构](#五判分规则结构)
  - [六、配置约定](#六配置约定)
  - [七、三种集成方式](#七三种集成方式)
- [快速开始](#快速开始)
- [实验列表](#实验列表)
- [开发与测试](#开发与测试)
- [第三方组件](#第三方组件)
- [开源许可证](#开源许可证)

</details>

## 项目介绍

### 项目背景

单片机实验教学有一个绕不开的瓶颈：学生写完 C51 程序，必须有人站在板子旁边，看着指示灯的闪烁节奏，才能判断这段代码对不对。一个班四十个人就很难转得开，实验一旦搬到线上，这件事干脆做不了。

与此同时，常见的 AI 助学工具始终站在链路之外。它能读学生的源文件、能猜，却从没见过引脚真正变化的那一刻。没有运行时证据，"你这个 while 循环压根没进去"只是猜测，不是诊断。

本项目要补的就是这一段。它把一块真实的 STC89C52 教学板改造成会自我上报运行状态的设备：烧写固件时一并加入检测程序，单片机运行后按实验规则自行打分并回传结果；Agnes 模型通过串口读取引脚和寄存器状态，借助 **Agnes Harness（AGH）+ MCP** 调用与学生完全相同的工具——能编译、能烧写、能读到真实状态、能验证，而不只是对着代码文本做点评。

### 核心功能

- **网页 IDE**：在页面里编写 C51，由 SDCC 编译（Keil 写法自动转换），错误带行号返回。
- **一键闭环**：编译 → 串口烧写固件 → 读取运行状态 → 自动判分，一个按钮、几秒钟完成。
- **板上自评**：烧写固件时会一并加入检测程序，单片机运行后按实验规则自行打分，并经串口回传结果。
- **11 个实验的确定性判分**：返回得分、逐项检查结果与指示灯时间线，而不是笼统的通过/不通过。
- **内置 8051 仿真板**：板卡的完整软件孪生，不接任何硬件也能跑通全流程。
- **Agnes 在环**：模型通过 **Agnes Harness（AGH）+ MCP** 调用同一套工具，完成"任务规划 → 工具调用 → 执行反馈 → 结果验证 → 异常处理"的闭环，支撑答疑、自动排错与学情分析。
- **过程可追溯**：每次测评都落盘为 `data/runs/*.json`，可作为复现与评分依据。

### 创新亮点

| # | 亮点 | 为什么重要 |
| --- | --- | --- |
| 1 | **判分发生在设备内部，基于真实运行行为** | 检测程序在烧写固件时加入，评分在单片机里完成。结论来自引脚在一段时间里实际做了什么，而不是对源代码做静态分析。 |
| 2 | **AI 与学生共用同一套工具** | Agnes 没有额外的" inspection"通道，它调用的是网页界面调用的同一批 MCP 工具。AI 能做到的事，远程学生同样能做到。 |
| 3 | **接口一致的硬件孪生** | 仿真板与实物板实现同一套契约，模拟模式是忠实预演，不是行为不同的演示壳子。 |
| 4 | **基于时间线、容忍时序差异** | 判分读的是状态时间线而非单点快照，学生写的 1.02 秒闪烁同样被认作 1 秒。 |
| 5 | **端到端可追溯** | 每次运行留下完整记录（源码、HEX、状态时间线、得分、逐项结果），可直接作为评分与诊断证据。 |

## 视频介绍

<p align="center">
  <a href="https://github.com/SYC-20/mcu51-ai-platform/releases/tag/v0.1.0">
    <b>▶ 观看演示视频 —— v0.1.0 Release 附件</b>
  </a>
</p>

演示视频作为 Release 附件发布：请在
[v0.1.0](https://github.com/SYC-20/mcu51-ai-platform/releases/tag/v0.1.0) 页面下载 `演示视频.mp4`。
内容覆盖实物板上的完整链路 —— 编写代码 → 编译 → 串口烧写固件 → 读取运行状态 → 自动判分，
以及 Agnes 闭环：模型经 AGH + MCP 完成答疑，并定位、修复一份有错误的学生程序。

> 手边没有硬件也能立刻看到效果：执行 `npm run sim`（或双击 `9-启动模拟板（板上测评）.bat`），
> 选一个实验，点"一键测评"即可。

## 架构介绍

### 总体架构

```
        浏览器（public/index.html + app.js）
                    │  HTTP · WebSocket
                    ▼
        平台服务端 —— Node.js / Express / ws   (server/index.js)
                    │
   ┌────────────────┼─────────────────┬──────────────────┬─────────────────┐
   ▼                ▼                 ▼                  ▼                 ▼
 编译层           板卡层             判分层             AI 层             记录层
server/lib/   server/hardware/   server/judge/      server/agh.js      data/
compile.js    board.js           experiments.js    server/mcp-        runs/*.json
(SDCC)        ├ 实物板            onchip.js         stdio.js          events.log
              └ 仿真板            segview.js             │
              stcisp.js           motorview.js            │
              protocol.js                                │
              emu8051.js                                  ▼
   │                │                          AGH CLI（-p --mode json）──> Agnes 模型
   │                │
   └────────────────┴──────────  STC 串口 ISP / 115200bps
                     ▼
        STC89C52RC 板卡 —— 固件 + 检测程序（firmware/monitor/）
```

AI 不绕过任何一层：MCP 调用进入 `server/mcp-stdio.js`，再走与浏览器完全相同的 HTTP 接口访问同一个 `Platform` 实例。

### 核心模块

| 层次 | 模块 | 职责 |
| --- | --- | --- |
| 表现层 | `public/index.html`、`public/app.js` | 代码编辑器、实验选择、步骤指示、指示灯实时视图、AI 面板 |
| 服务层 | `server/index.js`、`server/service.js` | REST 端点、WebSocket 广播、板卡租借、事件日志、运行记录 |
| 编译层 | `server/lib/compile.js`、`server/lib/hex.js` | Keil→SDCC 写法转换、调用 SDCC、HEX 解析与打包、容量校验 |
| 板卡抽象 | `server/hardware/board.js` | 实物板与仿真板统一契约：烧写、读取状态、模拟按键 |
| 烧写层 | `server/hardware/stcisp.js` | STC89 串口 ISP：握手、波特率切换、断电上电、数据传输 |
| 协议层 | `server/hardware/protocol.js` | 帧编解码、时间展开、按键脚本 |
| 仿真层 | `server/hardware/emu8051.js` | 指令级 8051 内核，含端口与定时器行为 |
| 判分层 | `server/judge/experiments.js`、`onchip.js`、`segview.js`、`motorview.js` | 11 套规则、板上自评、数码管与步进电机视图 |
| AI 集成层 | `server/agh.js`、`server/mcp-stdio.js` | AGH CLI 编排、按对话隔离工作区、8 个 MCP 工具 |
| 板卡固件 | `firmware/monitor/monitor.c`、`firmware/monitor/eval.h` | 1ms 节拍读取端口与寄存器状态、串口上报、按实验判分 |

### 一次测评的完整链路

1. **编译**：SDCC 编译学生源码（先做 Keil 写法转换），错误带行号返回。
2. **合成**：学生的 `main` 被重命名为 `__student_main`，检测程序与该实验的判分规则被加入同一份固件。
3. **烧写**：固件经串口 ISP 写入 STC89C52，断电上电由平台自动完成。
4. **运行与上报**：单片机运行学生程序，按 1ms 节拍经串口上报引脚状态与寄存器状态；实验需要输入时，由平台下发按键脚本。
5. **判分**：检测程序逐项核对规则，回传得分、逐项通过与指示灯时间线。
6. **归因**：若未通过，Agnes 通过 MCP 工具读取同一份时间线与源码，指出真实原因。

## 集成标准

### 一、MCP 工具接口

通道：**stdio**；服务名 `mcu51-platform`，基于 `@modelcontextprotocol/sdk` 与 `zod` 实现。
每个工具都声明 `annotations`（`readOnlyHint` / `destructiveHint`），AGH 据此自动放行只读工具、对写入类工具保留确认。

| 工具 | 作用 | 参数 | 标注 |
| --- | --- | --- | --- |
| `board_status` | 板卡连接状态、运行模式（实物/模拟）、最近一次编译结果、当前代码、板卡租借情况 | — | 只读 |
| `list_experiments` | 平台支持的实验（id、题目要求、引脚约定） | — | 只读 |
| `get_code` | 读取网页编辑器中当前的 C 代码与所选实验 | — | 只读 |
| `compile` | 用 SDCC 编译 C51 程序（Keil 写法自动转换） | `source: string`、`update_editor?: boolean` | 写入 |
| `flash` | 把最近一次编译成功的程序烧写到 STC89C52（模拟模式下烧写到仿真板） | — | 破坏性 |
| `capture` | 读取一段时间内的端口状态，可附带按键脚本 | `duration_ms: int(200–20000)`、`keys?: [{key:1–4, at_ms, hold_ms}]` | 只读 |
| `run_test` | 对板上运行的程序执行指定实验的自动判分 | `experiment: enum(11 个 id)` | 写入 |
| `search_docs` | 检索板卡原理图说明、引脚表、实验要求与 C51 速查 | `query: string` | 只读 |

接入 AGH：

```sh
node packages/cli/dist/stable/agnes.mjs mcp add mcu51 --command node --args <仓库路径>/server/mcp-stdio.js
node packages/cli/dist/stable/agnes.mjs mcp trust mcu51
node packages/cli/dist/stable/agnes.mjs mcp enable mcu51
```

### 二、HTTP 接口

默认基址 `http://127.0.0.1:8051`，全部为 `application/json`，出错返回 `{ error: string }`。

| 方法 | 端点 | 作用 |
| --- | --- | --- |
| GET | `/api/status` | 板卡模式、连接状态、租借、当前实验、AGH 状态 |
| GET | `/api/experiments` | 11 个实验及题目要求、引脚约定 |
| GET | `/api/examples` | `examples/student/` 下的示例程序 |
| GET / POST | `/api/workspace` | 读取或更新当前源码与所选实验 |
| POST | `/api/compile` | 编译源码，返回是否成功、代码大小、带行号的错误 |
| POST | `/api/flash` | 烧写最近一次编译成功的程序 |
| POST | `/api/capture` | 读取 `ms` 时长内的运行状态，可附带按键脚本 |
| POST | `/api/keys` | 按下按键掩码（key1~key4 对应 bit0~3） |
| POST | `/api/test` | 对板上运行中的程序按指定实验判分 |
| POST | `/api/evaluate` | 编译 → 烧写 → 读取 → 判分，一次调用完成 |
| GET | `/api/history` | 最近的测评历史 |
| GET | `/api/docs?q=` | 检索知识库 |
| POST | `/api/ai/chat` | 经 AGH 向 Agnes 发送一条消息 |
| POST | `/api/ai/reset` | 开启一个新的 AGH 对话 |

编译输出、步骤流转、状态帧等实时进度通过同一端口的 WebSocket 推送。

### 三、串口帧协议

115200bps 上的自定义帧格式，开销仅一个字节（见 `server/hardware/protocol.js`）：

```
0xA5 | type | len | payload[len] | xor(type, len, payload)
```

| 方向 | 类型 | 取值 | 载荷 |
| --- | --- | --- | --- |
| 板卡 → 平台 | `PINS` | `0x01` | 8 字节 — P0 P1 P2 P3 + 32 位毫秒时间戳（端口变化时立即上报，另有 100ms 心跳） |
| 板卡 → 平台 | `HELLO` | `0x02` | 1 字节 — 固件版本 |
| 板卡 → 平台 | `ACK` | `0x03` | 1 字节 — 被确认的命令类型 |
| 板卡 → 平台 | `MON` | `0x05` | 7 字节 — P0 P1 P2 P3 P4 + 16 位毫秒计数（检测程序上报） |
| 板卡 → 平台 | `RESULT` | `0x06` | 20 字节 — 实验、分数、项数、通过位图、16 字节数据 |
| 平台 → 板卡 | `KEY` | `0x10` | 3 字节 — 按键掩码（bit0~3）+ 保持毫秒（0 表示保持到下一条） |
| 平台 → 板卡 | `RESETCLOCK` | `0x11` | 0 字节 — 时间戳清零（开始一次读取） |
| 平台 → 板卡 | `START` | `0x12` | 5 字节 — `'M' '5' '1'` + 时间窗毫秒，只在该窗口内上报（与烧写共用串口时保持安静） |
| 平台 → 板卡 | `PING` | `0x13` | 0 字节 — 板卡回复 `HELLO` |

### 四、学生编程约定

> **编程约定**：使用本平台时，学生程序必须按规范编写标准入口函数 `void main(void)`，
> 并包含平台规定的标准检测函数。这是本平台要求的编程规范，用于让检测程序取得运行状态，
> **不属于对固件的修改**。

编译时，平台把学生的 `main` 重命名为 `__student_main`，加入检测程序，并自动生成
`__EV_EXP`（实验类型）、`__EV_END`（测评时长）与按键脚本表，随检测程序一起进入同一份固件。
学生只需按规范编写自己的程序。

### 五、判分规则结构

`server/judge/experiments.js` 中每个实验是一条声明式规则：

| 字段 | 含义 |
| --- | --- |
| `id`、`title` | 标识符与题目要求，同时用于界面与 `list_experiments` |
| `pins` | 该规则依赖的引脚约定 |
| `durationMs` | 读取运行状态的时间窗长度 |
| `keyScript` | 时间窗内注入的按键脚本（实验需要输入时） |
| `check(timeline)` | 对状态时间线的纯函数 → 逐项结果与得分 |

由于 `check` 是时间线的纯函数，同一套规则可以不加改动地跑在实物板帧与仿真板帧上——这正是模拟模式能成为忠实孪生的原因。

### 六、配置约定

把 `config.example.json` 复制为 `config.json`（已被 git 忽略）并填写：

| 键 | 含义 |
| --- | --- |
| `port`、`host` | HTTP 服务监听地址（默认 `8051` / `127.0.0.1`） |
| `mode` | `sim`（内置仿真板）或 `hardware`（串口实物板） |
| `sdcc.bin`、`sdcc.packihx` | SDCC 工具路径 |
| `flash.driver` | `builtin`（内置 STC 串口 ISP）或 `command`（外部工具，如 stcgal） |
| `flash.port`、`flash.powerCycle` | 烧写串口；冷启动方式 `rts` / `dtr` / `none` |
| `detector.port`、`detector.baud` | 读取运行状态的串口与波特率 |
| `monitor.enabled`、`monitor.onchip` | 是否加入检测程序；`onchip` 为板上自评 |
| `board.*` | 时钟、指示灯端口与极性、蜂鸣器引脚、按键引脚 |
| `agh.cli` | AGH 的 `agnes.mjs` 绝对路径 |

### 七、三种集成方式

1. **网页直接使用**：打开平台页面即可，无需额外接入。
2. **AI 智能体（MCP）**：把 `server/mcp-stdio.js` 注册进 AGH，Agnes 即可驱动整条链路。
3. **外部程序**：直接调用上面的 HTTP 接口；`/api/evaluate` 是自动化评分的单次入口。

## 快速开始

**Windows、不用命令行**：见 [Windows安装使用说明.md](Windows安装使用说明.md)，双击 `1-安装.bat`，再双击 `9-启动模拟板（板上测评）.bat`。
板上测评模式见 [板上测评说明.md](板上测评说明.md)。

**命令行：**

```sh
# 1. 需先安装 Node.js 24+ 与 SDCC（https://sdcc.sourceforge.net）
npm install
cp config.example.json config.json      # 填写 flash.port / detector.port / agh.cli

# 2. 模拟板模式（不需要硬件）
npm run sim                             # 浏览器打开 http://127.0.0.1:8051

# 3. 实物板
node server/index.js                     # 或 .\scripts\start-windows.ps1
```

**接入 Agnes（可选）**：先按 AGH 文档完成 `agnes config`，确认 `node agnes.mjs -p "你好"` 能回复；
再双击 `5-接入AI.bat`（`scripts/setup-agh.ps1`），它会自动查找 `agnes.mjs` 写入 `config.json`，
并执行 `mcp add / trust / enable`。

**config.json 关键项**：

- `flash.port`：CH340 的 COM 口（设备管理器 → 端口）。
- `flash.powerCycle`：`rts`（默认，本板 CH340 RTS# 经 Q1/Q2 只断开 STC89C52 的 MCUGND，板上其余芯片保持供电；极性相反时设 `powerCycleInvert: true`）/ `dtr` / `none`（手动断电；注意整板断电会让板上其余芯片的 ISP 引导程序也应答，导致握手冲突）。
- `detector.port`：读取运行状态所用串口；与烧写口相同时，平台在烧写期间自动释放该串口。
- `agh.cli`：AGH 的 `packages\cli\dist\stable\agnes.mjs` 绝对路径。
- 若内置烧写与板子不兼容，可设 `flash.driver: "command"`，`flash.command` 填外部命令（如 `stcgal -P stc89 -p {port} {bin}`）。

平台在 `data/agh-workspace` 下为每个新对话建一个 `chat-*` 子目录作为 AGH 工作目录，并写入 `AGENTS.md`（助教规则）。
工具调用如需审批，CLI 一次性模式会返回 `parked`；演示时可在 AGH 配置中设 `approvals.mode: smart`（MCP 只读工具已声明 `readOnlyHint`）。

## 实验列表

| id | 实验 | 判分依据 |
| --- | --- | --- |
| `led35` | 仅 3、5 号灯点亮 | 只亮 LED3、LED5（P1=0xEB），200ms 后一直保持不变 |
| `blink` | 闪烁灯 | P1 全亮/全灭交替，各约 1s（±20%） |
| `water` | 流水灯 | 每次只亮一个，P1.0→P1.7 顺序移动，每步约 1s |
| `keyled` | 按键控制指示灯 | 平台依次按 key1~4（P2.4~P2.7），检查只亮对应 LED1~4 |
| `buzzer` | 蜂鸣器 | 蜂鸣器在 P4.2（方波驱动），该位状态不经串口上报，因此用同步点亮的 LED1（P1.0）判定：未按键灭、按 key1 期间亮、松开后灭 |
| `segstatic` | 单位数码管 | 第 1 位循环显示 0~9；按 P0 段码判定段码正确、0~9 依次循环、每个数字约 1 秒（仿真板上额外检查只选通第 1 位） |
| `segdynamic` | 多位数码管 | 动态扫描显示 1234；按 P0 段码判定只出现 1~4、顺序 1→2→3→4 循环、扫一轮 ≤20ms（仿真板上额外检查数字 k 只在 DIGk 选通时出现） |
| `segkey` | 独立按键控制数码管 | 第 1 位上电显示 0；平台依次按 key1~4，检查分别显示 1~4（仿真板上额外检查只选通第 1 位） |
| `stepfwd` | 步进电机正转 | 28BYJ-48 的 A~D 相接 P4.5、P4.1、P4.6、P4.4（经 ULN2003）：按 A→B→C→D 顺序一直顺时针转（单四拍/双四拍/八拍均可），每步 2~20ms |
| `stepdir` | 按键控制步进电机正反转 | 上电不转；平台按 key1 后应正转，按 key2 后应反转 |
| `stepspeed` | 按键控制步进电机加减速 | 上电正转；按 key1 后每步间隔缩短到 80% 以下，按 key2 后变长到 1.25 倍以上 |

`examples/student/` 下有 11 个实验各自的正确示例和一个有错误的学生作业 `water_student.c`（用于演示 AI 自动排错，文件里不含错误提示）。

## 开发与测试

```sh
npm test        # HEX/协议/ISP 包格式 + 11 个实验在内置 8051 仿真器上的端到端判分（含板上测评）
npm run sim     # 模拟板启动
npm run mcp     # 以 stdio 方式运行 MCP 服务
```

运行日志：`data/events.log`；每次测评的完整记录：`data/runs/*.json`（可直接作为比赛"运行与验证证据"）。

## 第三方组件

Express、ws、serialport、@modelcontextprotocol/sdk、zod（均 MIT）；SDCC（GPL，作为外部编译器调用，未随本仓库分发）；STC89 ISP 帧格式参考 stcgal（MIT，Grigori Goronzy）的公开描述，代码为独立实现；界面图标 `public/icons/*.svg` 来自 Tabler Icons（MIT License, Copyright (c) 2020-2026 Paweł Kuna），许可原文见 `public/icons/LICENSE`。

上述依赖的许可证均可通过 `npm install` 后在 `node_modules/<包名>/LICENSE` 中查看。

## 开源许可证

本项目源码采用 MIT License，详见 [LICENSE](LICENSE)。第三方组件的授权说明见上一节。
