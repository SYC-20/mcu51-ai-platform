// 多位数码管：显示 1234
#include <reg52.h>

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
    unsigned char i;
    while (1) {
        for (i = 0; i < 4; i++) {
            P0 = 0x00;                               // 消隐，防止串位重影
            P2 = (P2 | 0x0F) & ~(1 << i);            // 选通第 i+1 位（P2.0=DIG1，低电平有效）
            P0 = SEG[i + 1];
            delay_ms(3);
        }
    }
}
