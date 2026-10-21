// 独立按键控制数码管 —— 第 1 位上电显示 0，按下 key1~key4 分别显示 1~4，松开后保持
#include <reg52.h>

// 共阴极段码 0~9（P0.0=a … P0.6=g，P0.7=dp，高电平点亮）
unsigned char code SEG[10] = {0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F};

sbit KEY1 = P2^4;
sbit KEY2 = P2^5;
sbit KEY3 = P2^6;
sbit KEY4 = P2^7;
sbit IKEY2 = P3^3;      // 置 0 后板上 SW5~SW8 就是 key1~key4
sbit IKEY1 = P3^2;

void main(void)
{
    IKEY1 = 0;
    IKEY2 = 0;
    P2 = (P2 | 0x0F) & 0xFE;   // 只选通第 1 位（P2.0 = 0），P2.4~P2.7 保持高电平作按键输入
    P0 = SEG[0];
    while (1) {
        if (KEY1 == 0)      P0 = SEG[1];
        else if (KEY2 == 0) P0 = SEG[2];
        else if (KEY3 == 0) P0 = SEG[3];
        else if (KEY4 == 0) P0 = SEG[4];
    }
}
