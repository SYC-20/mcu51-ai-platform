// 实验一：闪烁灯 —— P1 口 8 个 LED 亮 1 秒、灭 1 秒（Keil 写法，平台自动转换为 SDCC）
#include <reg52.h>

// 用定时器 0 精确延时 1ms（11.0592MHz，12T：1ms = 922 个机器周期），Keil 与 SDCC 下时序一致
void delay_ms(unsigned int ms)
{
    TMOD = (TMOD & 0xF0) | 0x01;
    while (ms--) {
        TH0 = 0xFC;
        TL0 = 0x66;
        TF0 = 0;
        TR0 = 1;
        while (!TF0);
        TR0 = 0;
    }
}

void main(void)
{
    while (1) {
        P1 = 0x00;      // 全亮（低电平点亮）
        delay_ms(1000);
        P1 = 0xFF;      // 全灭
        delay_ms(1000);
    }
}
