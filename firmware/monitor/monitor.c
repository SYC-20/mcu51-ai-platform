/* ===== 平台自动附加：单片机自检测代码（单 MCU 远程检测） =====
 * 不需要 IAP15 检测芯片。编译时平台把学生程序的 main 改名为 __student_main，
 * 再附加本段代码；上电后先启动检测，再进入学生程序。
 *   定时器 1：1ms 中断，读取 P0/P1/P2/P3/P4，变化即上报，否则每 100ms 心跳
 *   定时器 2：串口波特率发生器 115200bps（11.0592MHz）
 *   串口中断（高优先级，防止接收丢字节）：发送缓冲区 + 接收平台命令（模拟按键 / 时间清零）
 * 上报帧：0xA5 0x05 7 | P0 P1 P2 P3 P4 tLo tHi | xor   （t 为毫秒，16 位循环）
 * 接收帧：0xA5 0x10 3 | keyMask holdLo holdHi | xor     0xA5 0x11 0 | xor
 * 板上测评模式（--onchip）：编译时按实验类型再嵌入 eval.h，定时器 1 中断里同时打分，
 *   测完发结果帧 0xA5 0x06 …（约每 2 秒重发），不改端口，学生程序继续运行，详见 eval.h。
 * 限制：学生程序不能使用串口、定时器 1、定时器 2，不能长时间关闭总中断 EA。
 */
__sfr __at (0xE8) __MON_P4;
#define __MON_RB 44
#define __MON_ADJ 7
static __idata unsigned char __mon_rb[__MON_RB];
static volatile unsigned char __mon_h, __mon_t, __mon_busy;
static volatile unsigned int __mon_ms, __mon_beat, __mon_key_off;
static volatile unsigned char __mon_key, __mon_keyon, __mon_last[5];
static unsigned char __mon_p2l, __mon_p4l;
static unsigned char __mon_rxs, __mon_rxty, __mon_rxn, __mon_rxi, __mon_rxb[3];

/* 宏而不是函数：中断用寄存器组 3，调用普通函数会改写学生程序寄存器组 0 */
#define __mon_put(c) do { __mon_rb[__mon_h] = (c); if (__mon_h == __MON_RB - 1) __mon_h = 0; else __mon_h++; } while (0)

#ifdef __EV_EXP
#define __EV_PART 1
#include "eval.h"
#undef __EV_PART
#endif

void __mon_t1_isr(void) __interrupt(3) __using(3)
{
    unsigned char p0, p1, p2, p3, p4, x, fr;
    /* 在当前计数上累加重装值（补偿中断响应延迟），用汇编固定停表周期，1ms 不漂移 */
    __asm
        push acc
        push psw
        clr  _TR1
        mov  a, _TL1
        add  a, #(0x66 + __MON_ADJ)
        mov  _TL1, a
        mov  a, _TH1
        addc a, #0xFC
        mov  _TH1, a
        setb _TR1
        pop  psw
        pop  acc
    __endasm;
    TMOD = (TMOD & 0x0F) | 0x10;
    __mon_ms++;
#ifdef __EV_EXP
    /* 板上测评：按键由单片机自己按脚本模拟 */
#if __EV_NK
    if (__ev_ki < __EV_NK && __mon_ms == __ev_kat[__ev_ki]) { __mon_key = 1 << __ev_kkey[__ev_ki]; __mon_key_off = __mon_ms + __ev_khold[__ev_ki]; __ev_ki++; }
#endif
#endif
    if (__mon_key && __mon_key_off && __mon_ms == __mon_key_off) __mon_key = 0;
    if (__mon_key) P2 &= ~(__mon_key << 4);
    if (__mon_keyon & ~__mon_key) P2 |= (__mon_keyon & ~__mon_key) << 4;
    __mon_keyon = __mon_key;
    /* 位选 P2.0~P2.3 直接接数码管公共阴极，亮着时灌入电流把引脚电压抬高，读引脚会误读成 1。
     * 这 4 位改读锁存器（程序写进去的值）：JBC 是读-改-写指令，读的是锁存器；
     * 位为 1 时 JBC 会把它清 0 约 2 个机器周期，随即 SETB 恢复。按键 P2.4~P2.7 仍读引脚。 */
    __asm
        mov  ___mon_p2l, #0x0F
        jbc  0xA0, 00001$
        anl  ___mon_p2l, #0xFE
        sjmp 00002$
00001$: setb 0xA0
00002$: jbc  0xA1, 00003$
        anl  ___mon_p2l, #0xFD
        sjmp 00004$
00003$: setb 0xA1
00004$: jbc  0xA2, 00005$
        anl  ___mon_p2l, #0xFB
        sjmp 00006$
00005$: setb 0xA2
00006$: jbc  0xA3, 00007$
        anl  ___mon_p2l, #0xF7
        sjmp 00008$
00007$: setb 0xA3
00008$:
    __endasm;
    /* 步进电机 A~D 相（P4.5、P4.1、P4.6、P4.4）接 ULN2003 输入，会把引脚拉低，同样改读锁存器 */
    __asm
        mov  ___mon_p4l, #0x72
        jbc  0xE9, 00011$
        anl  ___mon_p4l, #0xFD
        sjmp 00012$
00011$: setb 0xE9
00012$: jbc  0xEC, 00013$
        anl  ___mon_p4l, #0xEF
        sjmp 00014$
00013$: setb 0xEC
00014$: jbc  0xED, 00015$
        anl  ___mon_p4l, #0xDF
        sjmp 00016$
00015$: setb 0xED
00016$: jbc  0xEE, 00017$
        anl  ___mon_p4l, #0xBF
        sjmp 00018$
00017$: setb 0xEE
00018$:
    __endasm;
    p0 = P0; p1 = P1; p2 = (P2 & 0xF0) | __mon_p2l; p3 = P3; p4 = (__MON_P4 & 0x8D) | __mon_p4l;
#ifdef __EV_EXP
    if (!__ev_done) {
#define __EV_PART 2
#include "eval.h"
#undef __EV_PART
        if (__mon_ms >= __EV_END) {
#define __EV_PART 3
#include "eval.h"
#undef __EV_PART
        }
    }
    if (__ev_done) {
#define __EV_PART 4
#include "eval.h"
#undef __EV_PART
    }
#endif
    if (p0 == __mon_last[0] && p1 == __mon_last[1] && p2 == __mon_last[2] && p4 == __mon_last[4] && ++__mon_beat < 100) return;
    fr = __mon_h >= __mon_t ? __MON_RB - 1 - (__mon_h - __mon_t) : __mon_t - __mon_h - 1;
    if (fr < 11) return;
    __mon_beat = 0;
    __mon_last[0] = p0; __mon_last[1] = p1; __mon_last[2] = p2; __mon_last[3] = p3; __mon_last[4] = p4;
    x = 0x05 ^ 7 ^ p0 ^ p1 ^ p2 ^ p3 ^ p4 ^ (unsigned char)__mon_ms ^ (unsigned char)(__mon_ms >> 8);
    __mon_put(0xA5); __mon_put(0x05); __mon_put(7);
    __mon_put(p0); __mon_put(p1); __mon_put(p2); __mon_put(p3); __mon_put(p4);
    __mon_put((unsigned char)__mon_ms); __mon_put((unsigned char)(__mon_ms >> 8)); __mon_put(x);
    if (!__mon_busy) { __mon_busy = 1; TI = 1; }
}

void __mon_uart_isr(void) __interrupt(4) __using(2)
{
    unsigned char c, x;
    if (TI) {
        TI = 0;
        if (__mon_t != __mon_h) {
            SBUF = __mon_rb[__mon_t];
            if (++__mon_t == __MON_RB) __mon_t = 0;
        } else __mon_busy = 0;
    }
    if (RI) {
        RI = 0;
        c = SBUF;
        switch (__mon_rxs) {
        case 0: if (c == 0xA5) __mon_rxs = 1; break;
        case 1: __mon_rxty = c; __mon_rxs = 2; break;
        case 2: __mon_rxn = c; __mon_rxi = 0; __mon_rxs = c > 3 ? 0 : (c ? 3 : 4); break;
        case 3: __mon_rxb[__mon_rxi++] = c; if (__mon_rxi >= __mon_rxn) __mon_rxs = 4; break;
        default:
            x = __mon_rxty ^ __mon_rxn;
            for (__mon_rxi = 0; __mon_rxi < __mon_rxn; __mon_rxi++) x ^= __mon_rxb[__mon_rxi];
            if (x == c) {
                if (__mon_rxty == 0x10 && __mon_rxn == 3) {
                    __mon_key = __mon_rxb[0] & 0x0F;
                    x = __mon_rxb[1] | __mon_rxb[2];
                    __mon_key_off = x ? __mon_ms + (__mon_rxb[1] | ((unsigned int)__mon_rxb[2] << 8)) : 0;
                } else if (__mon_rxty == 0x11) __mon_ms = 0;
            }
            __mon_rxs = 0;
        }
    }
}

void __student_main(void);

void main(void)
{
    __mon_last[0] = 0x5A;
    SCON = 0x50;
    RCAP2H = 0xFF; RCAP2L = 0xFD; TH2 = 0xFF; TL2 = 0xFD;
    T2CON = 0x34;
    TMOD = (TMOD & 0x0F) | 0x10;
    TH1 = 0xFC; TL1 = 0x67;
    PS = 1;
    ET1 = 1; ES = 1; TR1 = 1; EA = 1;
    __student_main();
    while (1);
}
