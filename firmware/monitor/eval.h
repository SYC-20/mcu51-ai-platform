/* ===== 板上测评代码（参考 scorc.c 的 led_lab / beep_lab / smgo_lab / smgm_lab / keyo_lab） =====
 * 编译时平台按当前实验自动定义：
 *   __EV_EXP  实验类型 1闪烁灯 2流水灯 3按键控制灯 4蜂鸣器 5单位数码管 6多位数码管 7仅3、5号灯亮 8独立按键控制数码管
 *             9步进电机正转 10按键控制正反转 11按键控制加减速
 *   __EV_END  测评时长（ms）；__EV_NK 按键脚本条数；__ev_kat/__ev_khold/__ev_kkey 按键脚本
 * 本文件分 3 段被 monitor.c 包含（__EV_PART）：1 变量；2 每 1ms 在定时器 1 中断里检测端口；
 * 3 时间到：计算分数（只做一次）；4 测完后串口发结果帧，约每 2 秒重发。
 * 测评代码不改端口，测完学生程序照常运行，只是不再打分。
 * 结果帧：0xA5 0x06 20 | 实验 分数 项数 通过位 数据[16] | xor
 * 中断里不调用乘除法库函数（不会打乱学生程序的运算库），需要时用移位/减法展开。
 */
#if __EV_PART == 1
static __code unsigned char __ev_seg[10] = { 0x3F, 0x06, 0x5B, 0x4F, 0x66, 0x6D, 0x7D, 0x07, 0x7F, 0x6F };
/* 大的放 idata（0x80 以上），直接寻址区留给学生程序 */
static __idata unsigned char __ev_d[16];
static unsigned char __ev_cur, __ev_cand, __ev_n, __ev_ki, __ev_ci, __ev_prev = 0xFF, __ev_bits;
static unsigned char __ev_b1, __ev_b2, __ev_b3, __ev_b4, __ev_f1, __ev_cnt, __ev_mid;
static __idata unsigned int __ev_candT, __ev_segT, __ev_u1, __ev_u2, __ev_u3, __ev_u4, __ev_u5, __ev_u6, __ev_u7, __ev_rs;
static __idata unsigned char __ev_sc, __ev_nn;
static __bit __ev_done;
#if __EV_EXP >= 9
/* 步进电机：4 位相位（A 相 P4.5 为最低位，B=P4.1，C=P4.6，D=P4.4）→ 八拍位置，0xFF 为无效状态 */
static __code unsigned char __ev_pos[16] = { 0xFF, 0, 2, 1, 4, 0xFF, 3, 0xFF, 6, 7, 0xFF, 0xFF, 5, 0xFF, 0xFF, 0xFF };
static __idata unsigned int __ev_wn[3], __ev_wa[3], __ev_wz[3];
static __idata unsigned char __ev_wf[3], __ev_wr[3], __ev_wb[3];
#if __EV_EXP == 10
#define __EV_W0 200
#else
#define __EV_W0 500
#endif
#endif
/* 中断里用的无库乘除：q = a / b（16 位移位减法，a 会被改写），x * 10 */
#define __EV_UDIV(q, a, b) do { unsigned int __r = 0; unsigned char __i; q = 0; for (__i = 16; __i; __i--) { __r = (__r << 1) | (a >> 15); a <<= 1; q <<= 1; if (__r >= (b)) { __r -= (b); q |= 1; } } } while (0)
#define __EV_X10(x) (((x) << 3) + ((x) << 1))
#endif

#if __EV_PART == 2
{
    unsigned char v, m, d;
#if __EV_EXP == 1 || __EV_EXP == 2 || __EV_EXP == 5
    unsigned int dur;
#endif
#if __EV_EXP == 1 || __EV_EXP == 2 || __EV_EXP == 5
    /* 状态时间线（去毛刺）：指示灯稳定 30ms、数码管稳定 5ms 才算切换 */
#if __EV_EXP == 5
#define __EV_STABLE 5
    v = p0 & 0x7F;
#else
#define __EV_STABLE 30
    v = ~p1;
#endif
    d = 0;
    if (!__ev_n) { __ev_cur = __ev_cand = v; __ev_segT = __mon_ms; __ev_n = 1; d = 1; }
    else if (v != __ev_cand) { __ev_cand = v; __ev_candT = __mon_ms; }
    else if (v != __ev_cur && (unsigned int)(__mon_ms - __ev_candT) >= __EV_STABLE) {
        dur = __ev_candT - __ev_segT;
        /* ---- 一段状态结束：__ev_cur 持续了 dur 毫秒，是第 __ev_n 段 ---- */
#if __EV_EXP == 1
        if (__ev_n > 1) {
            if (__ev_mid < 255) __ev_mid++;
            if (dur < 800 || dur > 1200) __ev_b2 = 1;
            if (__ev_mid <= 8) __ev_d[7 + __ev_mid] = dur > 2040 ? 255 : (unsigned char)(dur >> 3);
        }
#elif __EV_EXP == 2
        if (__ev_cur && !(__ev_cur & (__ev_cur - 1))) {
            if (!__ev_f1) __ev_f1 = 1;
            else {
                if (__ev_mid < 255) __ev_mid++;
                if (dur < 800 || dur > 1200) __ev_b2 = 1;
                if (__ev_mid <= 8) __ev_d[7 + __ev_mid] = dur > 2040 ? 255 : (unsigned char)(dur >> 3);
            }
        }
#endif
        __ev_cur = v; __ev_segT = __ev_candT;
        if (__ev_n < 255) __ev_n++;
        d = 1;
    }
    if (d) {
        /* ---- 新状态 v 开始（第 __ev_n 段） ---- */
#if __EV_EXP == 1
        if (v != 0 && v != 0xFF) __ev_b1 = 1;
        if (__ev_n <= 8) __ev_d[__ev_n - 1] = v;
#elif __EV_EXP == 2
        if (__ev_n <= 8) __ev_d[__ev_n - 1] = v;
        if (__ev_n > 1 && v && (v & (v - 1))) __ev_b1 = 1;
        if (v && !(v & (v - 1))) {
            if (__ev_prev != 0xFF && !(v == (unsigned char)(__ev_prev << 1) || (__ev_prev == 0x80 && v == 1))) __ev_b3 = 1;
            __ev_prev = v;
            if (__ev_cnt < 255) __ev_cnt++;
        }
#else
        if (v && !(__ev_n == 1 && v == 0x7F)) {
            __ev_f1 = 1;
            for (m = 0; m < 10 && __ev_seg[m] != v; m++);
            if (m == 10) { __ev_b1 = 1; m = 0x0F; }
            else {
                if (__ev_cnt) {
                    if (m != (__ev_prev == 9 ? 0 : __ev_prev + 1)) __ev_b2 = 1;
                    if (__ev_cnt >= 2) {
                        dur = __ev_segT - __ev_u1;
                        if (__ev_mid < 255) __ev_mid++;
                        if (dur < 800 || dur > 1200) __ev_b3 = 1;
                        if (__ev_mid <= 8) __ev_d[7 + __ev_mid] = dur > 2040 ? 255 : (unsigned char)(dur >> 3);
                    }
                }
                __ev_u1 = __ev_segT; __ev_prev = m;
                if (__ev_cnt < 255) __ev_cnt++;
            }
            if (__ev_cnt <= 8 && __ev_cnt) __ev_d[__ev_cnt - 1] = m;
        }
#endif
    }
#if __EV_EXP == 5
    if (__mon_ms > 50 && (p2 & 0x0F) != 0x0E) __ev_b4 = 1;
#endif
#elif __EV_EXP == 3
    /* 按键控制灯：每次按键松开前 50ms 检查 P1 是否只亮对应的那颗灯 */
    if (__ev_ci < __EV_NK && __mon_ms == __ev_kat[__ev_ci] + __ev_khold[__ev_ci] - 50) {
        v = ~p1;
        __ev_d[__ev_ci] = v;
        if (v == (unsigned char)(1 << __ev_kkey[__ev_ci])) __ev_bits |= 1 << __ev_ci;
        __ev_ci++;
    }
#elif __EV_EXP == 4
    /* 蜂鸣器：按键前不响（P1.0 高）、按住时响、松开后停；顺带统计 P4.2 翻转次数 */
    v = !(p1 & 1);
    if (__mon_ms >= 200 && __mon_ms < __ev_kat[0] && v) __ev_b1 = 1;
    if (__mon_ms > __ev_kat[0] + 20 && __mon_ms < __ev_kat[0] + __ev_khold[0] && v) __ev_b2 = 1;
    if (__mon_ms > __ev_kat[0] + __ev_khold[0] + 100 && v) __ev_b3 = 1;
    if (__mon_ms > __ev_kat[0] && __mon_ms < __ev_kat[0] + __ev_khold[0] && ((p4 ^ __ev_cur) & 0x04)) __ev_u1++;
    __ev_cur = p4;
#elif __EV_EXP == 6
    /* 多位数码管：P2 低 4 位选位，P0 段码；检查内容、位置、扫描顺序和刷新周期 */
    if (__mon_ms >= 100) {
        v = p0 & 0x7F;
        m = p2 & 0x0F;
        m = m == 0x0E ? 0 : m == 0x0D ? 1 : m == 0x0B ? 2 : m == 0x07 ? 3 : 0xFF;
        if (v) {
            __ev_u1++;
            for (d = 1; d < 5 && __ev_seg[d] != v; d++);
            if (d == 5) __ev_u2++;
            else if (m != d - 1) __ev_u3++;
            if (m != 0xFF && m != __ev_prev) {
                if (__ev_prev != 0xFF) { __ev_u4++; if (m != ((__ev_prev + 1) & 3)) __ev_u5++; }
                __ev_prev = m;
                if (m == 0) { if (!__ev_cnt) __ev_u6 = __mon_ms; __ev_u7 = __mon_ms; if (__ev_cnt < 255) __ev_cnt++; }
            }
        }
    }
#elif __EV_EXP == 7
    /* 仅 3、5 号灯亮：200ms 后记录亮灯状态和变化次数 */
    if (__mon_ms >= 200) {
        v = ~p1;
        if (!__ev_f1) { __ev_f1 = 1; __ev_cur = v; }
        else if (v != __ev_cur) { __ev_cur = v; if (__ev_cnt < 255) __ev_cnt++; }
    }
#elif __EV_EXP == 8
    /* 独立按键控制数码管：第 1 次按键前 50ms 应显示 0，每次松开前 50ms 应显示对应数字，且只选通第 1 位 */
    if (__ev_ci <= __EV_NK && __mon_ms == (__ev_ci ? __ev_kat[__ev_ci - 1] + __ev_khold[__ev_ci - 1] - 50 : __ev_kat[0] - 50)) {
        v = p0 & 0x7F;
        m = p2 & 0x0F;
        __ev_d[__ev_ci] = v;
        __ev_d[8 + __ev_ci] = m;
        if (v == __ev_seg[__ev_ci ? __ev_kkey[__ev_ci - 1] + 1 : 0] && m == 0x0E) __ev_bits |= 1 << __ev_ci;
        __ev_ci++;
    }
#elif __EV_EXP >= 9
    /* 步进电机（参考 scorc.c stepz_test14~16）：相位每变一次算一步，八拍位置 +1/+2 为正转，-1/-2 为反转。
     * 按键把时间分成几段（第 w 次按键前），松开 200ms 后才开始统计，每段记步数和首末步时间 */
    v = ((p4 >> 5) & 1) | (p4 & 2) | ((p4 >> 4) & 4) | ((p4 >> 1) & 8);
    m = __ev_pos[v];
    if (m != 0xFF && v != __ev_cur) {
        unsigned char w = __ev_ki;
        __ev_cur = v;
        if (__ev_prev != 0xFF && __mon_ms >= (w ? __ev_kat[w - 1] + __ev_khold[w - 1] + 200 : __EV_W0) && (w == __EV_NK || __mon_ms < __ev_kat[w])) {
            d = (m - __ev_prev) & 7;
            if (d == 1 || d == 2) { if (__ev_wf[w] < 255) __ev_wf[w]++; }
            else if (d == 6 || d == 7) { if (__ev_wr[w] < 255) __ev_wr[w]++; }
            else if (__ev_wb[w] < 255) __ev_wb[w]++;
            if (!__ev_wn[w]) __ev_wa[w] = __mon_ms;
            __ev_wn[w]++;
            __ev_wz[w] = __mon_ms;
        }
        __ev_prev = m;
    }
#endif
}
#endif

#if __EV_PART == 3
/* 只算一次：算分 → 结果帧交给第 4 段发送。不动端口，学生程序继续运行。
 * 这里在中断里，学生程序还在跑：不能调用乘除法库函数，乘除都用移位/减法展开 */
{
    unsigned char k, s;
    unsigned int a, b, q, r;
    __ev_nn = 3;
#if __EV_EXP == 1
    __ev_bits = (!__ev_b1) | ((__ev_mid >= 3) << 1) | ((__ev_mid >= 3 && !__ev_b2) << 2);
#elif __EV_EXP == 2
    __ev_bits = (__ev_n > 1 && !__ev_b1) | ((__ev_cnt >= 4 && !__ev_b3) << 1) | ((__ev_mid >= 3 && !__ev_b2) << 2);
#elif __EV_EXP == 3
    __ev_nn = __EV_NK;
#elif __EV_EXP == 4
    __ev_bits = (!__ev_b1) | (__ev_b2 << 1) | ((!__ev_b3) << 2);
    __ev_d[0] = __ev_u1; __ev_d[1] = __ev_u1 >> 8;
#elif __EV_EXP == 5
    __ev_nn = 4;
    __ev_bits = (__ev_f1 && !__ev_b1) | ((__ev_cnt >= 4 && !__ev_b2) << 1) | ((__ev_mid >= 3 && !__ev_b3) << 2) | ((!__ev_b4) << 3);
#elif __EV_EXP == 7
    __ev_nn = 2;
    __ev_bits = (__ev_f1 && __ev_cur == 0x14) | ((__ev_f1 && !__ev_cnt) << 1);
    __ev_d[0] = __ev_cur; __ev_d[1] = __ev_cnt;
#elif __EV_EXP == 8
    __ev_nn = __EV_NK + 1;
#elif __EV_EXP >= 9
    /* 每段：数据[4k] 正转步数 [4k+1] 反转步数 [4k+2] 平均每步 ms（四舍五入）[4k+3] 乱序步数 */
    for (k = 0; k <= __EV_NK; k++) {
        q = 0;
        if (__ev_wn[k] > 1) { b = __ev_wn[k] - 1; a = __ev_wz[k] - __ev_wa[k] + (b >> 1); __EV_UDIV(q, a, b); }
        __ev_d[k << 2] = __ev_wf[k]; __ev_d[(k << 2) + 1] = __ev_wr[k];
        __ev_d[(k << 2) + 2] = q > 255 ? 255 : q; __ev_d[(k << 2) + 3] = __ev_wb[k];
    }
#define __EV_FWD(k) (__ev_wf[k] >= 10 && (((unsigned int)__ev_wr[k] + __ev_wb[k]) << 3) <= __ev_wf[k])
#define __EV_REV(k) (__ev_wr[k] >= 10 && (((unsigned int)__ev_wf[k] + __ev_wb[k]) << 3) <= __ev_wr[k])
#define __EV_AVG(k) ((unsigned int)__ev_d[((k) << 2) + 2])
#if __EV_EXP == 9
    __ev_bits = ((unsigned int)__ev_wf[0] + __ev_wr[0] >= 20) | (__EV_FWD(0) << 1) | ((__ev_wn[0] > 1 && __EV_AVG(0) >= 2 && __EV_AVG(0) <= 20) << 2);
#elif __EV_EXP == 10
    __ev_bits = ((unsigned int)__ev_wf[0] + __ev_wr[0] + __ev_wb[0] <= 2) | (__EV_FWD(1) << 1) | (__EV_REV(2) << 2);
#else
    __ev_bits = __EV_FWD(0) | ((__EV_FWD(1) && __EV_AVG(1) && (__EV_AVG(1) << 2) + __EV_AVG(1) <= (__EV_AVG(0) << 2)) << 1)
              | ((__EV_FWD(2) && __EV_AVG(2) && (__EV_AVG(2) << 2) >= (__EV_AVG(1) << 2) + __EV_AVG(1)) << 2);
#endif
#elif __EV_EXP == 6
    __ev_nn = 4;
    q = 0;
    if (__ev_cnt > 1) { a = __ev_u7 - __ev_u6; b = __ev_cnt - 1; __EV_UDIV(q, a, b); }
    __ev_bits = (__ev_u1 && __EV_X10(__ev_u2) <= __ev_u1) | ((__ev_u4 >= 8 && __EV_X10(__ev_u5) <= __ev_u4) << 1)
              | ((__ev_cnt >= 11 && q <= 20) << 2) | ((__ev_u1 && __EV_X10(__ev_u3) <= __ev_u1) << 3);
    __ev_d[0] = __ev_cnt; __ev_d[1] = q > 255 ? 255 : q;
    /* 百分比：先把分母缩到 655 以内，乘 100 不溢出 16 位 */
    for (k = 2; k < 4; k++) {
        b = __ev_u1; r = k == 2 ? __ev_u2 : __ev_u3; q = 0;
        if (b) {
            while (b > 655) { b >>= 1; r >>= 1; }
            a = (r << 6) + (r << 5) + (r << 2);
            __EV_UDIV(q, a, b);
        }
        __ev_d[k] = q;
    }
    __ev_d[4] = __ev_u4 > 255 ? 255 : __ev_u4; __ev_d[5] = __ev_u5 > 255 ? 255 : __ev_u5;
#endif
    for (k = s = 0; k < __ev_nn; k++) if (__ev_bits & (1 << k)) s++;
    /* 分数 = (s * 100 + n / 2) / n */
    a = __ev_nn >> 1;
    for (k = 0; k < s; k++) a += 100;
    for (__ev_sc = 0; a >= __ev_nn; __ev_sc++) a -= __ev_nn;
    __ev_done = 1;
    __ev_rs = __mon_ms - 2000;
}
#endif

#if __EV_PART == 4
/* 测完后：结果帧马上发一次，之后约每 2 秒重发一次（缓冲区不够就下一毫秒再试） */
if ((unsigned int)(__mon_ms - __ev_rs) >= 2000
    && (__mon_h >= __mon_t ? __MON_RB - 1 - (__mon_h - __mon_t) : __mon_t - __mon_h - 1) >= 24) {
    unsigned char k, s;
    __ev_rs = __mon_ms;
    k = 0x06 ^ 20 ^ __EV_EXP ^ __ev_sc ^ __ev_nn ^ __ev_bits;
    __mon_put(0xA5); __mon_put(0x06); __mon_put(20);
    __mon_put(__EV_EXP); __mon_put(__ev_sc); __mon_put(__ev_nn); __mon_put(__ev_bits);
    for (s = 0; s < 16; s++) { __mon_put(__ev_d[s]); k ^= __ev_d[s]; }
    __mon_put(k);
    if (!__mon_busy) { __mon_busy = 1; TI = 1; }
}
#endif
