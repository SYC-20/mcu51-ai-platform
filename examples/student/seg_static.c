// 单位数码管：第 1 位循环显示 0~9
#include <reg52.h>

// 共阴极段码 0~9（P0.0=a … P0.6=g，P0.7=dp，高电平点亮）
unsigned char code SEG[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};

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
    unsigned char n = 0;
    P2 = (P2 | 0x0F) & 0xFE;   // 只选通第 1 位（P2.0 = 0）
    while (1) {
        P0 = SEG[n];
        delay_ms(1000);
        n = (n + 1) % 10;
    }
}
