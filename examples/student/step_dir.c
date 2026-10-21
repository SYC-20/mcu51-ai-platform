// 按键控制步进电机正反转 —— 上电不转；按 key1 正转，按 key2 反转，松开后保持（每步 10ms）
#include <reg52.h>

sfr P4 = 0xE8;          // STC89C52 的扩展口 P4
sbit A_Phase = P4^5;    // 步进电机 A 相（经 ULN2003，高电平通电）
sbit B_Phase = P4^1;    // B 相
sbit C_Phase = P4^6;    // C 相
sbit D_Phase = P4^4;    // D 相

// 单相四拍：A → B → C → D（顺着走为顺时针正转，倒着走为反转）
unsigned char code PHASE[4] = {0x01, 0x02, 0x04, 0x08};

// 用定时器 0 精确延时 1ms（11.0592MHz，12T：1ms = 922 个机器周期）
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

void motor_out(unsigned char p)   // p 的第 0~3 位对应 A~D 相
{
    A_Phase = p & 0x01;
    B_Phase = (p >> 1) & 0x01;
    C_Phase = (p >> 2) & 0x01;
    D_Phase = (p >> 3) & 0x01;
}

sbit KEY1  = P2^4;
sbit KEY2  = P2^5;
sbit IKEY2 = P3^3;      // 置 0 后板上 SW5~SW8 就是 key1~key4
sbit IKEY1 = P3^2;

void main(void)
{
    unsigned char i = 0, dir = 0;    // dir：0 停，1 正转，2 反转
    IKEY1 = 0;
    IKEY2 = 0;
    motor_out(0);                    // 上电 4 相都不通电
    while (1) {
        if (KEY1 == 0) dir = 1;
        else if (KEY2 == 0) dir = 2;
        if (dir) {
            motor_out(PHASE[i]);
            i = dir == 1 ? (i + 1) & 3 : (i - 1) & 3;
            delay_ms(10);
        }
    }
}
