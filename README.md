# AI Twin Lab Assistant

English | [简体中文](README.zh-CN.md)

<div align="center">

### An Agnes-based closed-loop intelligent system for remote hardware experiments

**Write C51 in the browser. The board compiles, programs itself, reports its own state, and scores the result — and Agnes does the same job through AGH and MCP.**

<img src="https://img.shields.io/badge/node-%E2%89%A5%2024-339933" alt="Node.js 24 or later" />
<img src="https://img.shields.io/badge/license-MIT-97ca00" alt="License: MIT" />
<img src="https://img.shields.io/badge/MCU-STC89C52RC-f59e0b" alt="MCU: STC89C52RC" />
<img src="https://img.shields.io/badge/compiler-SDCC-4B8BBE" alt="Compiler: SDCC" />
<img src="https://img.shields.io/badge/MCP-stdio-6e40c9" alt="MCP transport: stdio" />
<img src="https://img.shields.io/badge/platform-Windows-0078D6" alt="Platform: Windows" />

[Project Overview](#project-overview) · [Demo Video](#demo-video) · [Architecture](#architecture) · [Integration Standards](#integration-standards) · [Quickstart](#quickstart) · [Experiments](#experiments)

Built for the 2026 Jiangsu AI + Science & Engineering Innovation Practice Hackathon.

</div>

---

<details>
<summary><kbd>Contents</kbd></summary>

- [Project Overview](#project-overview)
  - [Background](#background)
  - [Core Features](#core-features)
  - [What Makes It Different](#what-makes-it-different)
- [Demo Video](#demo-video)
- [Architecture](#architecture)
  - [System Architecture](#system-architecture)
  - [Core Modules](#core-modules)
  - [How a Submission Is Judged](#how-a-submission-is-judged)
- [Integration Standards](#integration-standards)
  - [1. MCP Tool Interface](#1-mcp-tool-interface)
  - [2. HTTP API](#2-http-api)
  - [3. Serial Frame Protocol](#3-serial-frame-protocol)
  - [4. Student Programming Contract](#4-student-programming-contract)
  - [5. Scoring Rule Schema](#5-scoring-rule-schema)
  - [6. Configuration Contract](#6-configuration-contract)
  - [7. Ways to Integrate](#7-ways-to-integrate)
- [Quickstart](#quickstart)
- [Experiments](#experiments)
- [Development and Testing](#development-and-testing)
- [Third-party Components](#third-party-components)
- [License](#license)

</details>

## Project Overview

### Background

Teaching 8051 microcontrollers has a stubborn bottleneck: a student writes a C51 program, and someone has to stand next to the board, watch the LEDs, and decide whether it works. That does not scale — not in a lab of forty students, and certainly not when the experiment is remote.

Meanwhile, AI teaching assistants usually sit *outside* the loop. They can read a student's source file and guess, but they have never seen the pins actually change. Without runtime evidence, "your `while` loop never runs" is a guess, not a diagnosis.

This project closes that gap. It turns a physical STC89C52 board into a self-reporting device: a monitor program is added when the firmware is programmed, the MCU scores itself against the experiment's rules, and the result comes back over the serial link. Agnes then **reads pin and register states over that same serial link** and calls the very same tools a student uses through **Agnes Harness (AGH) + MCP** — so it can compile, program, read real state, and verify, instead of only commenting on text.

### Core Features

- **Browser IDE** — write C51 in the page, compile with SDCC (Keil-style syntax is converted automatically), and see errors with line numbers.
- **One-click pipeline** — compile → program the firmware over the STC serial ISP link → read run-time state → score. A single button, a few seconds.
- **Self-scoring board** — when the firmware is programmed, a monitor program is added to it. The MCU scores itself against the experiment's rules and reports the result back over the same serial link.
- **11 experiments with deterministic rules** — each returns a score, a per-item checklist, and an LED timeline, not a vague pass/fail.
- **Built-in 8051 emulator** — a full software twin of the board. The whole pipeline runs with no hardware attached.
- **Agnes in the loop** — the model calls the same tools through Agnes Harness (AGH) and MCP: planning → tool calls → feedback → verification → error handling, covering Q&A, automatic debugging, and learning analytics.
- **Traceable runs** — every evaluation is written to `data/runs/*.json` as a reproducible evidence record.

### What Makes It Different

| # | Point | Why it matters |
| --- | --- | --- |
| 1 | **Judging happens on the device, from real execution** | The monitor program is added when the firmware is programmed, and scoring runs inside the MCU. The verdict comes from what the pins actually did over time — not from static code analysis. |
| 2 | **The AI shares the student's exact toolchain** | Agnes does not get a special "inspection" API. It compiles, programs, reads state, and runs tests through the same MCP tools the web UI calls. If the AI can do it, a remote student can too. |
| 3 | **Hardware twin with an identical interface** | `SimBoard` and `HardwareBoard` implement the same contract, so simulation mode is a faithful rehearsal, not a mock-up with different behaviour. |
| 4 | **Timeline-based, timing-tolerant rules** | Judging reads a state timeline rather than a single sample, so a student's 1.02 s blink is accepted as a 1 s blink. |
| 5 | **End-to-end traceability** | Each run produces a complete record (source, HEX, state timeline, score, per-item results) usable as grading or diagnostic evidence. |

## Demo Video

<p align="center">
  <a href="https://github.com/SYC-20/mcu51-ai-platform/releases/tag/v0.1.0">
    <b>▶ Watch the demo video — v0.1.0 release assets</b>
  </a>
</p>

The walkthrough (33 MB MP4) is published as a release asset — download it from
[v0.1.0](https://github.com/SYC-20/mcu51-ai-platform/releases/tag/v0.1.0). It covers the full
pipeline on real hardware — write code → compile → program the firmware → read run-time state →
automatic scoring — and the Agnes closed loop, where the model answers a question and debugs a
buggy submission through MCP tools.

> No hardware at hand? Simulation mode reproduces the same pipeline end to end:
> `npm run sim` (or double-click `9-启动模拟板（板上测评）.bat`), pick an experiment, click the one-click button.

## Architecture

### System Architecture

```
        Browser (public/index.html + app.js)
                    │  HTTP · WebSocket
                    ▼
        Platform server — Node.js / Express / ws   (server/index.js)
                    │
   ┌────────────────┼─────────────────┬──────────────────┬─────────────────┐
   ▼                ▼                 ▼                  ▼                 ▼
Compile          Board             Judge              AI                Trace
server/lib/   server/hardware/   server/judge/     server/agh.js     data/
compile.js    board.js           experiments.js    server/mcp-        runs/*.json
(SDCC)        ├ HardwareBoard    onchip.js         stdio.js          events.log
              └ SimBoard         segview.js            │
              stcisp.js           motorview.js           │
              protocol.js                               │
              emu8051.js                                │
   │                │                                    ▼
   │                │                        AGH CLI (-p --mode json) ──> Agnes
   │                │                                    │
   └────────────────┴────────────────────────────────────┘
                     │  STC serial ISP / 115200 bps
                     ▼
        STC89C52RC board — firmware + monitor program (firmware/monitor/)
```

The AI does not bypass any layer: MCP calls arrive at `server/mcp-stdio.js`, which talks to the same `Platform` instance over the same HTTP API the browser uses.

### Core Modules

| Layer | Module | Responsibility |
| --- | --- | --- |
| Presentation | `public/index.html`, `public/app.js` | Code editor, experiment picker, step indicator, live LED view, AI panel |
| Service | `server/index.js`, `server/service.js` | REST endpoints, WebSocket broadcast, board lease, event log, run records |
| Compile | `server/lib/compile.js`, `server/lib/hex.js` | Keil→SDCC syntax conversion, SDCC invocation, HEX parse/pack, size check |
| Board abstraction | `server/hardware/board.js` | `SimBoard` / `HardwareBoard` behind one contract: program, read state, press keys |
| Programming | `server/hardware/stcisp.js` | STC89 serial ISP: handshake, baud switching, power-cycle, transfer |
| Protocol | `server/hardware/protocol.js` | Frame encode/decode, timestamp unrolling, key scripting |
| Emulator | `server/hardware/emu8051.js` | Instruction-level 8051 core with port and timer behaviour |
| Judge | `server/judge/experiments.js`, `onchip.js`, `segview.js`, `motorview.js` | 11 rule sets, on-device scoring, 7-segment and stepper views |
| AI integration | `server/agh.js`, `server/mcp-stdio.js` | AGH CLI orchestration, per-chat workspaces, 8 MCP tools |
| On-device firmware | `firmware/monitor/monitor.c`, `firmware/monitor/eval.h` | 1 ms tick port/register reads, serial reporting, per-experiment scoring |

### How a Submission Is Judged

1. **Compile** — SDCC builds the student source; Keil-style syntax is rewritten first. Errors come back with line numbers.
2. **Synthesise** — the student's `main` becomes `__student_main`; the monitor program and the experiment's rule set are added to the same firmware image.
3. **Program** — the image is written to the STC89C52 over the serial ISP link (power-cycle handled by the platform).
4. **Run and report** — the MCU runs the student program and, on every 1 ms tick, reports port and register states over the serial link; key presses are scripted by the platform when an experiment needs them.
5. **Score** — the monitor program checks each rule item and returns a score plus a per-item result mask and an LED timeline.
6. **Explain** — on failure, Agnes reads the same timeline and the source through MCP tools and points at the actual cause.

## Integration Standards

### 1. MCP Tool Interface

Transport: **stdio**. Server name `mcu51-platform`, implemented with `@modelcontextprotocol/sdk` and `zod`. Every tool declares annotations (`readOnlyHint` / `destructiveHint`) so AGH can auto-approve reads and hold writes for confirmation.

| Tool | Purpose | Parameters | Annotation |
| --- | --- | --- | --- |
| `board_status` | Connection state, mode (hardware/simulation), last compile result, current code, board lease | — | read-only |
| `list_experiments` | Available experiments: id, requirement, pin conventions | — | read-only |
| `get_code` | Current C source and selected experiment from the web editor | — | read-only |
| `compile` | Compile a C51 program with SDCC (Keil syntax auto-conversion) | `source: string`, `update_editor?: boolean` | write |
| `flash` | Program the last successful build onto the STC89C52 (or the emulator) | — | destructive |
| `capture` | Read port state over a time window, with optional scripted key presses | `duration_ms: int (200–20000)`, `keys?: [{key: 1–4, at_ms, hold_ms}]` | read-only |
| `run_test` | Run a named experiment's automatic scoring on the running program | `experiment: enum(11 ids)` | write |
| `search_docs` | Search board schematic notes, pin tables, requirements, C51 cheat sheet | `query: string` | read-only |

Register it with AGH:

```sh
node packages/cli/dist/stable/agnes.mjs mcp add mcu51 --command node --args <repo>/server/mcp-stdio.js
node packages/cli/dist/stable/agnes.mjs mcp trust mcu51
node packages/cli/dist/stable/agnes.mjs mcp enable mcu51
```

### 2. HTTP API

Base URL `http://127.0.0.1:8051` by default. All endpoints are `application/json`; errors return `{ error: string }`.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| GET | `/api/status` | Board mode, connection, lease, current experiment, AGH status |
| GET | `/api/experiments` | The 11 experiments with requirements and pin conventions |
| GET | `/api/examples` | Sample programs shipped in `examples/student/` |
| GET / POST | `/api/workspace` | Read or update the current source and selected experiment |
| POST | `/api/compile` | Compile source; returns success, code size, errors with line numbers |
| POST | `/api/flash` | Program the last successful build |
| POST | `/api/capture` | Read state over `ms`, with an optional key script |
| POST | `/api/keys` | Press a key mask (`key1..key4` → bits 0–3) |
| POST | `/api/test` | Score the running program against an experiment |
| POST | `/api/evaluate` | Compile → program → read → score in one call |
| GET | `/api/history` | Recent run history |
| GET | `/api/docs?q=` | Search the knowledge base |
| POST | `/api/ai/chat` | Send a message to Agnes through AGH |
| POST | `/api/ai/reset` | Start a new AGH conversation |

Live progress (compile output, step transitions, state frames) is pushed over WebSocket on the same port.

### 3. Serial Frame Protocol

Custom, single-byte-overhead framing on the 115200 bps link (see `server/hardware/protocol.js`):

```
0xA5 | type | len | payload[len] | xor(type, len, payload)
```

| Dir | Type | Value | Payload |
| --- | --- | --- | --- |
| → host | `PINS` | `0x01` | 8 B — P0 P1 P2 P3 + 32-bit ms timestamp (reported on change and every 100 ms heartbeat) |
| → host | `HELLO` | `0x02` | 1 B — firmware version |
| → host | `ACK` | `0x03` | 1 B — acknowledged command type |
| → host | `MON` | `0x05` | 7 B — P0 P1 P2 P3 P4 + 16-bit ms counter (monitor program reporting) |
| → host | `RESULT` | `0x06` | 20 B — experiment, score, item count, pass bitmask, 16 B data |
| → board | `KEY` | `0x10` | 3 B — key mask (bits 0–3) + hold ms (0 = until next command) |
| → board | `RESETCLOCK` | `0x11` | 0 B — zero the timestamp (start of a capture) |
| → board | `START` | `0x12` | 5 B — `'M' '5' '1'` + window ms; report only inside the window (keeps the link quiet while programming) |
| → board | `PING` | `0x13` | 0 B — board answers `HELLO` |

### 4. Student Programming Contract

> The platform has a fixed programming convention. A student program must provide the standard
> entry function `void main(void)` and include the standard check functions required by the
> platform. This is the programming contract that lets the monitor program obtain run-time state —
> **it is not a modification of the firmware.**

At build time the platform renames the student's `main` to `__student_main`, adds the monitor
program, and emits `__EV_EXP` (experiment type), `__EV_END` (evaluation duration) and the key
script table into the same image. The student writes only their own program.

### 5. Scoring Rule Schema

Each experiment in `server/judge/experiments.js` is a declarative object:

| Field | Meaning |
| --- | --- |
| `id`, `title` | Identifier and requirement shown in the UI and `list_experiments` |
| `pins` | Pin conventions the rule depends on |
| `durationMs` | Length of the state read window |
| `keyScript` | Scripted key presses injected during the window, if the experiment needs input |
| `check(timeline)` | Pure function over the state timeline → per-item results and score |

Because `check` is a pure function of the timeline, the same rule runs against hardware frames and emulator frames without change — which is what makes simulation mode a faithful twin.

### 6. Configuration Contract

Copy `config.example.json` to `config.json` (git-ignored) and set:

| Key | Meaning |
| --- | --- |
| `port`, `host` | HTTP server bind address (default `8051` / `127.0.0.1`) |
| `mode` | `sim` (built-in emulator) or `hardware` (serial board) |
| `sdcc.bin`, `sdcc.packihx` | SDCC tool paths |
| `flash.driver` | `builtin` (STC serial ISP) or `command` (external tool, e.g. stcgal) |
| `flash.port`, `flash.powerCycle` | Programming COM port; cold-start via `rts` / `dtr` / `none` |
| `detector.port`, `detector.baud` | Serial port and baud for reading state |
| `monitor.enabled`, `monitor.onchip` | Add the monitor program; `onchip` = on-device scoring |
| `board.*` | Clock, LED port and polarity, buzzer pin, key pins |
| `agh.cli` | Absolute path to AGH's `agnes.mjs` |

### 7. Ways to Integrate

1. **Web UI** — open the served page and use it directly; nothing else required.
2. **AI agent (MCP)** — register `server/mcp-stdio.js` with AGH; Agnes then drives the full pipeline.
3. **External program** — call the HTTP API above; `/api/evaluate` is the one-call entry point for automated grading.

## Quickstart

**Windows, no command line:** see [Windows安装使用说明.md](Windows安装使用说明.md) — double-click `1-安装.bat`, then `9-启动模拟板（板上测评）.bat`.

**From a shell:**

```sh
# 1. Node.js 24+ and SDCC (https://sdcc.sourceforge.net) must be installed
npm install
cp config.example.json config.json      # set flash.port / detector.port / agh.cli

# 2. Simulation mode — no hardware needed
npm run sim                             # open http://127.0.0.1:8051

# 3. Real board
node server/index.js                     # or: .\\scripts\\start-windows.ps1
```

**Connect Agnes (optional):** finish `agnes config` first and confirm `node agnes.mjs -p "hi"` answers, then run `5-接入AI.bat` (`scripts/setup-agh.ps1`), which locates `agnes.mjs`, writes it into `config.json`, and runs `mcp add / trust / enable`.

## Experiments

| id | Experiment | What is checked |
| --- | --- | --- |
| `led35` | LEDs 3 and 5 only | Only LED3/LED5 lit (P1=0xEB), unchanged after 200 ms |
| `blink` | Blinking LEDs | P1 all-on / all-off alternating, ~1 s each (±20%) |
| `water` | Running light | One LED at a time, P1.0→P1.7 in order, ~1 s per step |
| `keyled` | Keys control LEDs | Platform presses key1–4 (P2.4–P2.7); only the matching LED1–4 lights |
| `buzzer` | Buzzer | Driven by a square wave on P4.2, which is not directly readable over the serial link, so the synchronously lit LED1 (P1.0) is used: off with no key, on while key1 is held, off after release |
| `segstatic` | Single 7-segment digit | Digit 1 cycles 0–9; judged on P0 segment codes: correct segments, 0–9 in order, ~1 s each |
| `segdynamic` | Multi-digit scanning | Shows `1234`; only digits 1–4 appear, in order 1→2→3→4, one scan ≤20 ms |
| `segkey` | Keys control the display | Shows `0` on power-up; key1–4 → shows 1–4 |
| `stepfwd` | Stepper forward | 28BYJ-48 phases A–D on P4.5, P4.1, P4.6, P4.4 via ULN2003: clockwise A→B→C→D, 2–20 ms per step |
| `stepdir` | Keys control direction | Idle on power-up; key1 → forward, key2 → reverse |
| `stepspeed` | Keys control speed | Forward on power-up; key1 → step interval below 80%, key2 → above 125% |

`examples/student/` holds a correct sample for each experiment plus `water_student.c`, a buggy submission used to demonstrate AI debugging (the file contains no hints about its own bug).

## Development and Testing

```sh
npm test        # HEX/protocol/ISP packet formats + end-to-end scoring of all 11 experiments on the emulator
npm run sim     # start in simulation mode
npm run mcp     # run the MCP server over stdio
```

Logs: `data/events.log`. Full record of each evaluation: `data/runs/*.json` (also usable as submission evidence).

## Third-party Components

Express, ws, serialport, `@modelcontextprotocol/sdk`, zod — all MIT. SDCC (GPL) is invoked as an external compiler and is not distributed with this repository. The STC89 ISP frame format follows the public description in stcgal (MIT, Grigori Goronzy); the code here is an independent implementation. UI icons in `public/icons/*.svg` come from Tabler Icons (MIT License, Copyright (c) 2020-2026 Paweł Kuna); the licence text is in `public/icons/LICENSE`.

After `npm install`, each dependency's licence is available at `node_modules/<package>/LICENSE`.

## License

MIT — see [LICENSE](LICENSE). Third-party attributions are listed above.
