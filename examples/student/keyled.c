// 实验三：按键控制指示灯 —— key1~key4（P2.4~P2.7）按下时对应 LED1~LED4 点亮，其余熄灭
#include <reg52.h>

sbit KEY1 = P2^4;
sbit KEY2 = P2^5;
sbit KEY3 = P2^6;
sbit KEY4 = P2^7;
sbit IKEY2 = P3^3;      // 置 0 后板上 SW5~SW8 就是 key1~key4（SW1~SW4 本板未接到单片机）
sbit IKEY1 = P3^2;

void main(void)
{
    P1 = 0xFF;
    IKEY1 = 0;
    IKEY2 = 0;
    while (1) {
        if (KEY1 == 0)      P1 = 0xFE;
        else if (KEY2 == 0) P1 = 0xFD;
        else if (KEY3 == 0) P1 = 0xFB;
        else if (KEY4 == 0) P1 = 0xF7;
    }
}
