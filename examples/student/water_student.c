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
    unsigned char i;
    while (1) {
        for (i = 0; i < 8; i++) {
            P1 = ~(0x80 >> i);
            delay_ms(300);
        }
    }
}
