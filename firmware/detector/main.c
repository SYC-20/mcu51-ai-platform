/*
 * 检测 MCU（IAP15F2K61S2）固件 —— 采集工作单片机 STC89C52 的 P0/P1 电平并按平台帧协议上报
 * 编译：sdcc -mmcs51 main.c && packihx main.ihx > detector.hex
 * 下载：STC-ISP 选 IAP15F2K61S2，"选择使用内部 IRC 时钟" 勾选，频率 22.1184MHz
 *       （P1.6/P1.7 用作检测输入，不能接外部晶振）
 *
 * 引脚（按原理图 SCH_2025AI教学实验平台 U3 核对）：
 *   BP00~BP07 → P0.0~P0.7      BP10~BP17 → P1.0~P1.7（光耦同相：工作 MCU 输出 0 → 读到 0）
 *   KEY1~KEY4 → P4.1~P4.4（与工作 MCU P2.4~P2.7 及实体按键并联，输出 0 = 按下）
 *   串口 UART_PINS=0：P3.0/P3.1 = ARXD/ATXD，与 STC89C52 的串口并在同一根 CH340 线上（默认，一个 COM 口）
 *        UART_PINS=1：P3.6/P3.7 = 2TXD/2RXD（SW13 拨到 "2" 档时使用）
 *
 * 共用串口时，烧录 STC89C52 期间本固件必须保持安静：上电后不主动发送，
 * 只在收到 START 命令后的时间窗内上报，避免干扰 STC ISP 握手。
 *
 * 帧格式（与 server/hardware/protocol.js 一致）：0xA5 | type | len | payload | xor(type..payload)
 *   上报 0x01 PINS : P0 P1 P2 P3 + 4 字节毫秒时间戳（小端），引脚变化即发 + 每 100ms 心跳
 *   上报 0x02 HELLO: 固件版本（收到 START / PING 时回复）
 *   接收 0x10 KEY  : keyMask(bit0~3=key1~4) holdLo holdHi（hold=0 表示一直保持到下一条 KEY）
 *   接收 0x11 RESETCLOCK : 时间戳清零
 *   接收 0x12 START: 'M' '5' '1' winLo winHi —— 上报 win 毫秒后自动停止
 *   接收 0x13 PING : 回复 HELLO
 */
#include <8052.h>

__sfr __at (0x8E) AUXR;
__sfr __at (0x93) P0M1;
__sfr __at (0x94) P0M0;
__sfr __at (0x91) P1M1;
__sfr __at (0x92) P1M0;
__sfr __at (0x95) P2M1;
__sfr __at (0x96) P2M0;
__sfr __at (0xB1) P3M1;
__sfr __at (0xB2) P3M0;
__sfr __at (0xD6) T2H;
__sfr __at (0xD7) T2L;
__sfr __at (0xC0) P4;
__sfr __at (0xB3) P4M1;
__sfr __at (0xB4) P4M0;
__sfr __at (0xA2) P_SW1;

#define FW_VERSION   2
#define UART_PINS    0
#define INVERT_OPTO  0
#define READ_WP0()   (P0)
#define READ_WP1()   (P1)
/* KEY1~KEY4 = P4.1~P4.4，bit=1 表示按下 → 输出 0 */
#define KEY_DRIVE(mask)  (P4 = (P4 & 0xE1) | (((~(mask)) & 0x0F) << 1))

volatile unsigned long ms_now = 0;
volatile unsigned char tick100 = 0;

/* 定时器 0：1ms 中断（22.1184MHz，1T 模式：22118 个时钟 → 初值 0xA99A） */
void timer0_isr(void) __interrupt(1)
{
    ms_now++;
    if (++tick100 >= 100) tick100 = 0;
}

void uart_init(void)
{
    /* 115200bps @22.1184MHz，定时器 2 作波特率发生器，1T */
    SCON = 0x50;
    AUXR |= 0x15;           /* T2R=1, T2x12=1, S1ST2=1 */
    T2L = 0xD0;
    T2H = 0xFF;
#if UART_PINS == 1
    P_SW1 = (P_SW1 & 0x3F) | 0x40;  /* UART1 → P3.6/P3.7 */
#else
    P_SW1 = (P_SW1 & 0x3F);         /* UART1 → P3.0/P3.1 */
#endif
}

void uart_put(unsigned char c)
{
    SBUF = c;
    while (!TI);
    TI = 0;
}

void send_frame(unsigned char type, unsigned char *p, unsigned char len)
{
    unsigned char x = type ^ len, i;
    uart_put(0xA5);
    uart_put(type);
    uart_put(len);
    for (i = 0; i < len; i++) { uart_put(p[i]); x ^= p[i]; }
    uart_put(x);
}

unsigned char key_mask = 0;
unsigned long key_release_at = 0;

unsigned char rx_buf[8];
volatile unsigned long report_until = 0;
unsigned char reporting = 0;
unsigned char rx_len = 0, rx_need = 0, rx_state = 0, rx_type = 0;

unsigned char force_report = 0;

void handle_cmd(void)
{
    unsigned int hold;
    unsigned char v;
    if (rx_type == 0x10) {
        key_mask = rx_buf[0] & 0x0F;
        hold = rx_buf[1] | ((unsigned int)rx_buf[2] << 8);
        EA = 0; key_release_at = hold ? ms_now + hold : 0; EA = 1;
        KEY_DRIVE(key_mask);
    } else if (rx_type == 0x11) {
        EA = 0; ms_now = 0; EA = 1;
    } else if (rx_type == 0x12 && rx_need == 5 && rx_buf[0] == 'M' && rx_buf[1] == '5' && rx_buf[2] == '1') {
        hold = rx_buf[3] | ((unsigned int)rx_buf[4] << 8);
        EA = 0; report_until = ms_now + hold; EA = 1;
        reporting = 1; force_report = 1;
        v = FW_VERSION; send_frame(0x02, &v, 1);
    } else if (rx_type == 0x13) {
        v = FW_VERSION; send_frame(0x02, &v, 1);
    }
}

void uart_poll(void)
{
    unsigned char c, x, i;
    if (!RI) return;
    c = SBUF; RI = 0;
    switch (rx_state) {
    case 0: if (c == 0xA5) rx_state = 1; break;
    case 1: rx_type = c; rx_state = 2; break;
    case 2: rx_need = c; rx_len = 0; rx_state = (c > sizeof(rx_buf)) ? 0 : (c ? 3 : 4); break;
    case 3: rx_buf[rx_len++] = c; if (rx_len >= rx_need) rx_state = 4; break;
    case 4:
        x = rx_type ^ rx_need;
        for (i = 0; i < rx_need; i++) x ^= rx_buf[i];
        if (x == c) handle_cmd();
        rx_state = 0;
        break;
    }
}

void main(void)
{
    unsigned char cur[8], last0 = 0, last1 = 0, last_tick = 0xFF;
    unsigned long t;

    P0M1 = 0; P0M0 = 0; P2M1 = 0; P2M0 = 0;   /* 准双向，读光耦输出 */
    P1M1 = 0; P1M0 = 0; P4M1 = 0; P4M0 = 0;
    P0 = 0xFF; P1 = 0xFF;
    KEY_DRIVE(0);

    AUXR |= 0x80;           /* T0 1T */
    TMOD = (TMOD & 0xF0) | 0x00; /* 模式 0：16 位自动重装（STC15） */
    TL0 = 0x9A; TH0 = 0xA9;
    ET0 = 1; TR0 = 1;
    uart_init();
    EA = 1;

    while (1) {
        uart_poll();
        if (key_release_at) {
            EA = 0; t = ms_now; EA = 1;
            if (t >= key_release_at) { key_release_at = 0; key_mask = 0; KEY_DRIVE(0); }
        }
        if (reporting) {
            EA = 0; t = ms_now; EA = 1;
            if (t >= report_until) reporting = 0;
        }
        if (!reporting) { last_tick = tick100; continue; }
        cur[0] = READ_WP0();
        cur[1] = READ_WP1();
#if INVERT_OPTO
        cur[0] = ~cur[0]; cur[1] = ~cur[1];
#endif
        if (force_report || cur[0] != last0 || cur[1] != last1 || (tick100 == 0 && last_tick != 0)) {
            force_report = 0;
            last0 = cur[0]; last1 = cur[1];
            cur[2] = 0x0F | (unsigned char)((~key_mask & 0x0F) << 4);
            cur[3] = 0xFF;
            EA = 0; t = ms_now; EA = 1;
            cur[4] = t; cur[5] = t >> 8; cur[6] = t >> 16; cur[7] = t >> 24;
            send_frame(0x01, cur, 8);
        }
        last_tick = tick100;
    }
}
