# AI孪生实验助手 —— 基于 Agnes 的远程硬件实验智能闭环系统

面向 2026 江苏省 AI+科学与工程创新实践黑客松的作品。

学生在网页上编写 C51 程序，平台自动完成 **编译 → 串口烧写固件到实物 STC89C52 → 读取运行状态 → 自动判分**：
烧写固件时会一并加入检测程序，单片机运行后按实验规则自行打分，并经串口回传引脚状态与寄存器状态；
Agnes 模型通过串口读取引脚和寄存器状态，借助 **Agnes Harness（AGH）+ MCP** 调用同一套工具，
完成“任务规划 → 工具调用 → 执行反馈 → 结果验证 → 异常处理”的智能闭环（答疑、自动排错、学情分析）。

> **编程约定**：使用本平台时，学生程序必须按规范编写标准入口函数 `void main(void)`，
> 并包含平台规定的标准检测函数。这是本平台要求的编程规范，用于让检测程序取得运行状态，**不属于对固件的修改**。

```
浏览器 ──HTTP/WS──> 平台 server/index.js（Node）
                       ├─ SDCC 编译（Keil 写法自动转换）
                       ├─ STC89 串口 ISP 烧写固件（CH340），烧写时加入检测程序  ┐
                       ├─ 经串口读取引脚状态与寄存器状态                        ├─ 实物板 / 内置 8051 仿真板（--sim）
                       ├─ 11 个实验的确定性判分规则                            ┘
                       └─ AI 面板 ──> AGH CLI（-p --mode json）──> Agnes 模型
                                                └─MCP stdio─> server/mcp-stdio.js ──HTTP──> 平台
```

## 实验（11 个，按网页列表顺序）

| id | 实验 | 判分依据 |
| --- | --- | --- |
| led35 | 仅 3、5 号灯点亮 | 只亮 LED3、LED5（P1=0xEB），200ms 后一直保持不变 |
| blink | 闪烁灯 | P1 全亮/全灭交替，各约 1s（±20%） |
| water | 流水灯 | 每次只亮一个，P1.0→P1.7 顺序移动，每步约 1s |
| keyled | 按键控制指示灯 | 平台依次按 key1~4（P2.4~P2.7），检查只亮对应 LED1~4 |
| buzzer | 蜂鸣器 | 蜂鸣器在 P4.2（方波驱动），该位状态无法经串口读到，因此用同步点亮的 LED1（P1.0）判定：未按键灭、按 key1 期间亮、松开后灭 |
| segstatic | 单位数码管 | 第 1 位循环显示 0~9；按 P0 段码判定段码正确、0~9 依次循环、每个数字约 1 秒（模拟板上额外检查只选通第 1 位） |
| segdynamic | 多位数码管 | 动态扫描显示 1234；按 P0 段码判定只出现 1~4、顺序 1→2→3→4 循环、扫一轮 ≤20ms（模拟板上额外检查数字 k 只在 DIGk 选通时出现） |
| segkey | 独立按键控制数码管 | 第 1 位上电显示 0；平台依次按 key1~4，检查分别显示 1~4（模拟板上额外检查只选通第 1 位） |
| stepfwd | 步进电机正转 | 28BYJ-48 的 A~D 相接 P4.5、P4.1、P4.6、P4.4（经 ULN2003）：按 A→B→C→D 顺序一直顺时针转（单四拍/双四拍/八拍均可），每步 2~20ms |
| stepdir | 按键控制步进电机正反转 | 上电不转；平台按 key1 后应正转，按 key2 后应反转 |
| stepspeed | 按键控制步进电机加减速 | 上电正转；按 key1 后每步间隔缩短到 80% 以下，按 key2 后变长到 1.25 倍以上 |

`examples/student/` 下有 11 个实验各自的正确示例和一个有错误的学生作业 `water_student.c`（用于演示 AI 自动排错，文件里不含错误提示）。

> 不熟悉命令行？直接看 [Windows安装使用说明.md](Windows安装使用说明.md)，全程双击即可。
> 板上测评模式（`8-启动实物板（板上测评）.bat` / `9-启动模拟板（板上测评）.bat`）见 [板上测评说明.md](板上测评说明.md)。

## Windows 安装

1. 安装 **Node.js 24**（与 AGH 要求一致）。
2. 安装 **SDCC**（https://sdcc.sourceforge.net ，默认路径 `C:\Program Files\SDCC\bin`）。
3. 在本目录执行 `npm install`。
4. 复制 `config.example.json` 为 `config.json`，填写：
   - `flash.port`：CH340 的 COM 口（设备管理器 → 端口）。
   - `flash.powerCycle`：`rts`（默认，本板 CH340 RTS# 经 Q1/Q2 只断开 STC89C52 的 MCUGND，板上其余芯片保持供电；若极性相反设 `powerCycleInvert: true`）/ `dtr` / `none`（手动断电；注意整板断电会让板上其余芯片的 ISP 引导程序也应答，导致握手冲突）。
   - `detector.port`：读取运行状态所用串口；与烧写口相同时，平台在烧写期间自动释放该串口。
   - `agh.cli`：AGH 的 `packages\cli\dist\stable\agnes.mjs` 绝对路径。
   - 若内置烧写与板子不兼容，可设 `flash.driver: "command"`，`flash.command` 填外部命令（如 `stcgal -P stc89 -p {port} {bin}`）。
5. 启动：`.\scripts\start-windows.ps1`（实物）或 `.\scripts\start-windows.ps1 -Sim`（模拟板），浏览器打开 http://127.0.0.1:8051 。

## 接入 AGH（Agnes 模型）

1. 先按 AGH 文档完成 `agnes config`（Agnes 模型账号/路由），确认 `node agnes.mjs -p "你好"` 能回复。
2. 双击 `5-接入AI.bat`（`scripts/setup-agh.ps1`）：自动查找 agnes.mjs 写入 `config.json`，执行 `mcp add / trust / enable`（需在窗口中输入 y 确认），并用 `-p --mode json` 试一次对话。
3. 平台在 `data/agh-workspace` 下为每个新对话建一个 `chat-*` 子目录作为 AGH 工作目录（AGH 按目录区分对话），并写入 `AGENTS.md`（助教规则）。
4. 工具调用如需审批，CLI 一次性模式会返回 `parked`；比赛演示可在 AGH 配置中设 `approvals.mode: smart`（MCP 只读工具已声明 `readOnlyHint`）。

MCP 工具：`board_status`、`list_experiments`、`get_code`、`compile`、`flash`、`capture`、`run_test`、`search_docs`。

## 检测程序与标准检测函数

| 文件 | 作用 |
| --- | --- |
| `firmware/monitor/monitor.c` | 平台固定的运行框架：按 1ms 节拍读取 P0~P4 端口状态与寄存器状态，并以 115200bps 经串口上报 |
| `firmware/monitor/eval.h` | 检测程序：按当前实验的判分规则逐项核对，并给出分数 |

学生程序需要包含的标准函数是 `void main(void)`。平台在编译阶段把它作为 `__student_main`
与检测程序合成同一份固件，再烧写进 STC89C52——**这是平台规定的编程规范，检测程序由平台加入，学生只需按规范编写自己的程序**。

编译后平台自动生成 `__EV_EXP`（实验类型）、`__EV_END`（测评时长）与按键脚本表，随检测程序一起加入。
串口帧格式见 `server/hardware/protocol.js`。

## 开发与测试

```sh
npm test          # HEX/协议/ISP 包格式 + 11 个实验在内置 8051 仿真器上的端到端判分（含板上测评）
npm run sim       # 模拟板启动
```

运行日志：`data/events.log`；每次测评的完整记录：`data/runs/*.json`（可直接作为比赛“运行与验证证据”）。

## 尚待实物验证

- 步进电机相位、数码管位选等部分外设的状态读取结果仍需与原理图进一步核对。

## 第三方组件

Express、ws、serialport、@modelcontextprotocol/sdk、zod（均 MIT）；SDCC（GPL，作为外部编译器调用，未随本仓库分发）；STC89 ISP 帧格式参考 stcgal（MIT，Grigori Goronzy）的公开描述，代码为独立实现；界面图标 `public/icons/*.svg` 来自 Tabler Icons（MIT License, Copyright (c) 2020-2026 Paweł Kuna），许可原文见 `public/icons/LICENSE`。

上述依赖的许可证均可通过 `npm install` 后在 `node_modules/<包名>/LICENSE` 中查看。

## 开源许可证

本项目源码采用 MIT License，详见 [LICENSE](LICENSE)。第三方组件的授权说明见上一节。
