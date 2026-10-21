// 实验四：蜂鸣器 —— 按住 key1（P2.4）蜂鸣器（P4.2）响，同时 LED1（P1.0）亮作指示；松开停止
#include <reg52.h>

sfr P4 = 0xE8;          // STC89C52 的扩展口 P4（本板为 LQFP44 封装）
sbit BEEP  = P4^2;      // 蜂鸣器：经 PNP 三极管 Q3 驱动，低电平导通，需要方波才响
sbit LED1  = P1^0;      // 指示灯：检测芯片采集不到 P4.2，平台通过 LED1 判定
sbit KEY1  = P2^4;
sbit IKEY2 = P3^3;      // 置 0 后板上 SW5~SW8 就是 key1~key4（SW1~SW4 本板未接到单片机）
sbit IKEY1 = P3^2;

void delay_half(void)   // 方波半周期，约 2~3kHz
{
    unsigned char i = 115;
    while (--i);
}

void main(void)
{
    BEEP = 1;
    LED1 = 1;
    IKEY1 = 0;
    IKEY2 = 0;
    while (1) {
        if (KEY1 == 0) {
            LED1 = 0;
            BEEP = !BEEP;
            delay_half();
        } else {
            LED1 = 1;
            BEEP = 1;
        }
    }
}
