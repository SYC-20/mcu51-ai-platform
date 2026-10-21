// 仅 3、5 号灯点亮 —— LED3（P1.2）和 LED5（P1.4）亮，其余熄灭（低电平点亮）
#include <reg52.h>

void main(void)
{
    P1 = 0xEB;          // 1110 1011：P1.2、P1.4 为 0
    while (1);
}
