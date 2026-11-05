#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""运营数据分析 · 复算器（OptraCall 自研，纯标准库）

定位：给分析一把可核验的尺子——不只出数字，还回显算式与口径，让结论可复算。
分工：calc.py 验数字；quality_check.py 验格式与数据体检。

纪律：
  1. 金额与比率用 Decimal（str 中转），不用 float 运算；
  2. 中间过程不舍入，只在输出时舍入一次，ROUND_HALF_UP；
  3. 拆解效应之和必须精确闭合，容差 0.01，超差退出码 3，不输出带残差的结论；
  4. 每个结果回显算式，可抄到纸上人工核对；
  5. 口径缺失（单位/期间/天数）即报错，不用默认值硬算；
  6. 提供 --selftest，案例全部手算可得。

退出码：0 正常；2 输入错误；3 闭合/校验失败。
"""

import argparse
import json
import sys
from datetime import date
from decimal import Decimal, ROUND_HALF_UP, InvalidOperation

VERSION = "optracall-data-calc-1"
TOL = Decimal("0.01")
Z_THRESHOLD = Decimal("3")


class InputError(Exception):
    """输入不合法 → 退出码 2"""


class ReconcileError(Exception):
    """闭合失败 → 退出码 3"""


def d(value, label="数值"):
    """转 Decimal；走 str 中转避免 float 二进制误差。"""
    if isinstance(value, Decimal):
        return value
    if isinstance(value, bool):
        raise InputError("%s 不能是布尔值" % label)
    try:
        return Decimal(str(value)).copy_abs() * (Decimal(-1) if str(value).strip().startswith("-") else Decimal(1))
    except (InvalidOperation, ValueError):
        raise InputError("%s 不是合法数字：%r" % (label, value))


def q(value, places=2):
    """输出时唯一一次舍入。"""
    return str(Decimal(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_UP))


def pct(value, places=2):
    return q(value * Decimal(100), places) + "%"


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


def parse_pairs(text, label):
    """解析 name:value[,name:value...]，保序。"""
    pairs = []
    for chunk in text.split(","):
        chunk = chunk.strip()
        if not chunk:
            continue
        if ":" not in chunk:
            raise InputError("%s 格式应为 名称:数值（逗号分隔），收到 %r" % (label, chunk))
        name, _, raw = chunk.partition(":")
        name, raw = name.strip(), raw.strip()
        if not name:
            raise InputError("%s 中出现空名称" % label)
        pairs.append((name, d(raw, "%s[%s]" % (label, name))))
    if not pairs:
        raise InputError("%s 不能为空" % label)
    names = [n for n, _ in pairs]
    if len(set(names)) != len(names):
        raise InputError("%s 中有重名因子：%s" % (label, names))
    return pairs


def product(values):
    result = Decimal(1)
    for v in values:
        result *= v
    return result


# ---------------------------------------------------------------- decompose

def cmd_decompose(args):
    base = parse_pairs(args.base, "--base")
    cur = parse_pairs(args.current, "--current")
    if [n for n, _ in base] != [n for n, _ in cur]:
        raise InputError("两期因子名不一致：base=%s current=%s" % ([n for n, _ in base], [n for n, _ in cur]))
    names = [n for n, _ in base]
    b = [v for _, v in base]
    c = [v for _, v in cur]
    n = len(names)

    if args.mode == "mul":
        total_b, total_c = product(b), product(c)
        left = Decimal(1)
        effects = []
        for i in range(n):
            right = product(b[i + 1:])
            effect = (c[i] - b[i]) * left * right
            formula = "(%s − %s)" % (q(c[i]), q(b[i]))
            if left != Decimal(1):
                formula += " × %s" % q(left)
            if right != Decimal(1):
                formula += " × %s" % q(right)
            effects.append({
                "factor": names[i], "base": q(b[i]), "current": q(c[i]),
                "effect": q(effect), "formula": "%s = %s" % (formula, q(effect)),
            })
            left *= c[i]
    else:
        total_b, total_c = sum(b, Decimal(0)), sum(c, Decimal(0))
        effects = [{
            "factor": names[i], "base": q(b[i]), "current": q(c[i]),
            "effect": q(c[i] - b[i]), "formula": "(%s − %s) = %s" % (q(c[i]), q(b[i]), q(c[i] - b[i])),
        } for i in range(n)]

    total_change = total_c - total_b
    effect_sum = sum(Decimal(e["effect"]) for e in effects)
    diff = abs(effect_sum - total_change)
    if diff > TOL:
        raise ReconcileError("拆解不闭合：|Σ效应 %s − 总变动 %s| = %s > %s" % (q(effect_sum), q(total_change), q(diff), q(TOL)))
    for e in effects:
        e["share_of_change"] = pct(Decimal(e["effect"]) / total_change) if total_change != 0 else "总变动为0，不计算占比"
    emit({
        "engine": VERSION, "metric": args.metric, "mode": args.mode,
        "order": "效应按因子给出顺序依次剥离：先变动者先剥离（顺序不同结果不同，报告须写明剥离顺序）",
        "base_total": q(total_b), "current_total": q(total_c), "total_change": q(total_change),
        "effects": effects,
        "closure": {"sum_effects": q(effect_sum), "total_change": q(total_change), "diff": q(diff), "tolerance": q(TOL), "ok": True},
    })


# ---------------------------------------------------------------- compare

def cmd_compare(args):
    base, cur = d(args.base), d(args.current)
    if base == 0:
        raise InputError("基期为 0，百分比变化不可定义；请改用绝对差或核对口径")
    delta = cur - base
    change = delta / base
    payload = {
        "engine": VERSION, "label": args.label, "base": q(base), "current": q(cur),
        "delta": q(delta), "pct_change": pct(change),
        "formula": "(%s − %s) ÷ %s = %s" % (q(cur), q(base), q(base), pct(change)),
    }
    if args.base_days or args.cur_days:
        if not (args.base_days and args.cur_days):
            raise InputError("按天对齐须同时给出 --base-days 与 --cur-days（口径缺失不硬算）")
        bd, cd = int(d(args.base_days, "--base-days")), int(d(args.cur_days, "--cur-days"))
        if bd <= 0 or cd <= 0:
            raise InputError("期间天数必须为正")
        payload["days"] = {"base_days": str(bd), "cur_days": str(cd), "equal_length": bd == cd,
                           "day_ratio": pct(Decimal(cd) / Decimal(bd))}
        if bd != cd:
            daily_b, daily_c = base / Decimal(bd), cur / Decimal(cd)
            payload["daily_aligned"] = {
                "base_daily": q(daily_b), "current_daily": q(daily_c),
                "daily_delta": q(daily_c - daily_b), "daily_pct_change": pct((daily_c - daily_b) / daily_b),
                "formula": "(%s ÷ %d) 与 (%s ÷ %d) 相比 = %s" % (q(base), bd, q(cur), cd, pct((daily_c - daily_b) / daily_b)),
                "note": "期间不等长（基期 %d 天、本期 %d 天），总量不可直比；日历效应本身即解释 %s 的量级，先按天对齐再谈经营原因" % (bd, cd, pct(abs(Decimal(cd) / Decimal(bd) - 1))),
            }
    emit(payload)


# ---------------------------------------------------------------- outlier

def tukey_quartiles(values):
    """Tukey 法：奇数样本时整体中位数不进入两半。values 须已升序。"""
    n = len(values)
    mid = n // 2
    lower = values[:mid]
    upper = values[mid + 1:] if n % 2 else values[mid:]

    def median(seq):
        m = len(seq)
        return seq[m // 2] if m % 2 else (seq[m // 2 - 1] + seq[m // 2]) / Decimal(2)

    return median(lower), median(upper)


def cmd_outlier(args):
    values = [d(v, "--values") for v in args.values.split(",") if v.strip()]
    n = len(values)
    if n < 3:
        raise InputError("样本量 %d < 3，无法做异常检测" % n)
    ordered = sorted(values)
    if args.method == "3sigma":
        if n < args.min_n:
            raise InputError("3σ 法要求样本量 ≥ %d（正态近似），当前 %d；小样本或偏态分布请用 --method iqr" % (args.min_n, n))
        mean = sum(values, Decimal(0)) / Decimal(n)
        var = sum((v - mean) ** 2 for v in values) / Decimal(n - 1)
        std = var.sqrt()
        outliers = [{"value": q(v), "z": q((v - mean) / std), "deviation": pct(abs(v - mean) / abs(mean)) if mean != 0 else "均值为0，偏离度不可定义"}
                    for v in values if abs((v - mean) / std) > Z_THRESHOLD]
        emit({
            "engine": VERSION, "method": "3sigma", "n": str(n),
            "mean": q(mean), "sample_std": q(std), "rule": "|z| > 3",
            "mean_formula": "Σx ÷ %d = %s" % (n, q(mean)), "outliers": outliers, "outlier_count": str(len(outliers)),
        })
    else:
        q1, q3 = tukey_quartiles(ordered)
        iqr = q3 - q1
        lo, hi = q1 - Decimal("1.5") * iqr, q3 + Decimal("1.5") * iqr
        outliers = [{"value": q(v), "below_lower": v < lo, "above_upper": v > hi}
                    for v in values if v < lo or v > hi]
        emit({
            "engine": VERSION, "method": "iqr", "n": str(n),
            "q1": q(q1), "q3": q(q3), "iqr": q(iqr),
            "lower": q(lo), "upper": q(hi),
            "bounds_formula": "[%s − 1.5×%s, %s + 1.5×%s]" % (q(q1), q(iqr), q(q3), q(iqr)),
            "quartile_note": "Tukey 法：奇数样本时整体中位数不进入两半",
            "outliers": outliers, "outlier_count": str(len(outliers)),
        })


# ---------------------------------------------------------------- weighted

def cmd_weighted(args):
    groups = []
    for chunk in args.groups.split(","):
        chunk = chunk.strip()
        parts = chunk.split(":")
        if len(parts) != 3:
            raise InputError("--groups 格式应为 名称:均值:样本数（逗号分隔），收到 %r" % chunk)
        name, mean, count = parts[0].strip(), d(parts[1], "均值"), int(d(parts[2], "样本数"))
        if not name:
            raise InputError("分组名不能为空")
        if count <= 0:
            raise InputError("分组 %s 样本数必须为正" % name)
        groups.append((name, mean, Decimal(count)))
    if len(groups) < 2:
        raise InputError("加权对比至少需要 2 个分组")
    arithmetic = sum(m for _, m, _ in groups) / Decimal(len(groups))
    total_n = sum(c for _, _, c in groups)
    weighted = sum(m * c for _, m, c in groups) / total_n
    emit({
        "engine": VERSION,
        "groups": [{"name": n_, "mean": q(m), "count": str(int(c))} for n_, m, c in groups],
        "arithmetic_mean_of_means": q(arithmetic), "weighted_mean": q(weighted),
        "gap": q(arithmetic - weighted),
        "weighted_formula": "(%s) ÷ %d = %s" % (" + ".join("%s×%s" % (q(m), str(int(c))) for _, m, c in groups), int(total_n), q(weighted)),
        "note": "各组样本数不等时，算术平均≠加权平均；报告分组均值汇总必须用加权值并说明分母",
    })


# ---------------------------------------------------------------- period

def cmd_period(args):
    def parse_date(text, label):
        try:
            y, m, dd = text.split("-")
            return date(int(y), int(m), int(dd))
        except (ValueError, TypeError):
            raise InputError("%s 应为 YYYY-MM-DD，收到 %r" % (label, text))

    b0, b1 = parse_date(args.base_start, "--base-start"), parse_date(args.base_end, "--base-end")
    c0, c1 = parse_date(args.cur_start, "--cur-start"), parse_date(args.cur_end, "--cur-end")
    if b1 < b0 or c1 < c0:
        raise InputError("起止日期反了：基期 %s~%s，本期 %s~%s" % (b0, b1, c0, c1))
    bd = (b1 - b0).days + 1
    cd = (c1 - c0).days + 1
    equal = bd == cd
    payload = {
        "engine": VERSION, "base": "%s~%s" % (b0, b1), "current": "%s~%s" % (c0, c1),
        "base_days": str(bd), "cur_days": str(cd), "equal_length": equal,
        "day_ratio": pct(Decimal(cd) / Decimal(bd)),
    }
    if not equal:
        payload["verdict"] = "期间不等长（本期为基期的 %s），两期总量不可直接比较；须按天对齐（compare --base-days/--cur-days）或按同天数截取后再比" % pct(Decimal(cd) / Decimal(bd))
    else:
        payload["verdict"] = "期间等长（各 %d 天），可直接比较" % bd
    emit(payload)


# ---------------------------------------------------------------- trend

def cmd_trend(args):
    values = [d(v, "--values") for v in args.values.split(",") if v.strip()]
    n = len(values)
    if n < 3:
        raise InputError("趋势窗口 %d < 3，无法拟合" % n)
    xs = [Decimal(i) for i in range(n)]
    mx = sum(xs, Decimal(0)) / Decimal(n)
    my = sum(values, Decimal(0)) / Decimal(n)
    sxx = sum((x - mx) ** 2 for x in xs)
    syy = sum((y - my) ** 2 for y in values)
    sxy = sum((x - mx) * (y - my) for x, y in zip(xs, values))
    if sxx == 0 or syy == 0:
        raise InputError("序列无变异（全部相同），无趋势可拟合")
    slope = sxy / sxx
    intercept = my - slope * mx
    r2 = (sxy * sxy) / (sxx * syy)
    strong = Decimal(str(args.r2_threshold))
    verdict = ("方向性明显（R² ≥ %s），可描述趋势方向" % q(strong)) if r2 >= strong else \
              ("R² < %s，不得称「明显趋势」，只可描述波动" % q(strong))
    emit({
        "engine": VERSION, "n": str(n), "slope": q(slope), "intercept": q(intercept), "r2": q(r2, 4),
        "slope_formula": "Sxy ÷ Sxx = %s ÷ %s" % (q(sxy, 4), q(sxx, 4)),
        "verdict": verdict, "r2_threshold": q(strong),
    })


# ---------------------------------------------------------------- selftest

def run_selftest():
    import io
    import contextlib

    results = []

    def check(name, ok):
        results.append((name, bool(ok)))

    def call(fn, argv):
        buf = io.StringIO()
        with contextlib.redirect_stdout(buf):
            fn(argparse.Namespace(**argv))
        return json.loads(buf.getvalue())

    # 1) 乘法拆解：手算 100000=1250×80 → 101250=1125×90
    r = call(cmd_decompose, {"metric": "销售额", "mode": "mul",
                             "base": "客流:1250,客单价:80", "current": "客流:1125,客单价:90"})
    check("拆解·乘法总变动 101250−100000=1250", r["total_change"] == "1250.00")
    eff = {e["factor"]: e["effect"] for e in r["effects"]}
    check("拆解·客流效应 (1125−1250)×80=−10000", eff["客流"] == "-10000.00")
    check("拆解·客单价效应 1125×(90−80)=11250", eff["客单价"] == "11250.00")
    check("拆解·效应之和精确闭合", r["closure"]["diff"] == "0.00")

    # 2) 加法拆解：利润=收入−成本（减项传负值）
    r = call(cmd_decompose, {"metric": "利润", "mode": "add",
                             "base": "收入:100000,成本:-60000", "current": "收入:95000,成本:-58000"})
    check("拆解·加法总变动 −3000", r["total_change"] == "-3000.00")
    eff = {e["factor"]: e["effect"] for e in r["effects"]}
    check("拆解·成本效应 (−58000)−(−60000)=+2000", eff["成本"] == "2000.00")

    # 3) 两期对比：−10%
    r = call(cmd_compare, {"label": "销售额", "base": "100000", "current": "90000", "base_days": None, "cur_days": None})
    check("对比·pct −10.00%", r["pct_change"] == "-10.00%")

    # 4) 不等长按天对齐：28 天 100000 vs 31 天 100000 → 日均 −3/31
    r = call(cmd_compare, {"label": "销售额", "base": "100000", "current": "100000", "base_days": "28", "cur_days": "31"})
    check("对比·不等长判 false", r["days"]["equal_length"] is False)
    check("对比·日均降幅 = −3/31 = −9.68%", r["daily_aligned"]["daily_pct_change"] == "-9.68%")

    # 5) 3σ：29 个 100 + 一个 200，z≈5.30>3，唯一异常
    values = ",".join(["100"] * 29 + ["200"])
    r = call(cmd_outlier, {"values": values, "method": "3sigma", "min_n": 30})
    check("异常·3σ 唯一异常值 200", r["outlier_count"] == "1" and r["outliers"][0]["value"] == "200.00")
    check("异常·3σ z>3", Decimal(r["outliers"][0]["z"]) > Z_THRESHOLD)

    # 6) 3σ 小样本拒绝（n=5 < 30）
    try:
        call(cmd_outlier, {"values": "1,2,3,4,5", "method": "3sigma", "min_n": 30})
        check("异常·小样本应拒绝", False)
    except InputError:
        check("异常·小样本应拒绝", True)

    # 7) IQR：10×10 + 100 → 唯一越界 100
    values = ",".join(["10"] * 10 + ["100"])
    r = call(cmd_outlier, {"values": values, "method": "iqr", "min_n": 30})
    check("异常·IQR 唯一异常值 100", r["outlier_count"] == "1" and r["outliers"][0]["value"] == "100.00")

    # 8) 加权 vs 算术：A 100×10、B 50×30 → 62.5 vs 75
    r = call(cmd_weighted, {"groups": "A:100:10,B:50:30"})
    check("加权·加权均值 62.50", r["weighted_mean"] == "62.50")
    check("加权·算术均值 75.00，差 12.50", r["arithmetic_mean_of_means"] == "75.00" and r["gap"] == "12.50")

    # 9) 期间：2 月 28 天 vs 3 月 31 天
    r = call(cmd_period, {"base_start": "2026-02-01", "base_end": "2026-02-28",
                          "cur_start": "2026-03-01", "cur_end": "2026-03-31"})
    check("期间·不等长与天数比 110.71%", r["equal_length"] is False and r["day_ratio"] == "110.71%")

    # 10) 趋势：[1..5] 斜率 1、R²=1
    r = call(cmd_trend, {"values": "1,2,3,4,5", "r2_threshold": "0.7"})
    check("趋势·斜率 1、R²=1", r["slope"] == "1.00" and r["r2"] == "1.0000")
    r = call(cmd_trend, {"values": "1,5,1,5,1", "r2_threshold": "0.7"})
    check("趋势·低 R² 不得称明显", "不得称" in r["verdict"])

    # 11) 确定性：同输入两次运行逐字节一致
    argv = {"metric": "销售额", "mode": "mul", "base": "客流:1250,客单价:80", "current": "客流:1125,客单价:90"}
    first, second = call(cmd_decompose, argv), call(cmd_decompose, argv)
    check("确定性·同输入逐字节一致",
          json.dumps(first, ensure_ascii=False, sort_keys=True, separators=(",", ":")) ==
          json.dumps(second, ensure_ascii=False, sort_keys=True, separators=(",", ":")))

    # 12) 口径缺失报错：只给一期天数
    try:
        call(cmd_compare, {"label": "x", "base": "10", "current": "11", "base_days": "28", "cur_days": None})
        check("口径·缺一期天数应拒绝", False)
    except InputError:
        check("口径·缺一期天数应拒绝", True)

    # 13) 闭合保护：构造性闭合下 diff 恒为 0（守卫未来改动）
    r = call(cmd_decompose, {"metric": "三因子", "mode": "mul",
                             "base": "a:2,b:3,c:5", "current": "a:4,b:3,c:10"})
    check("拆解·三因子闭合 (4×3×10)−(2×3×5)=90", r["total_change"] == "90.00" and r["closure"]["diff"] == "0.00")

    failed = [n for n, ok in results if not ok]
    for n, ok in results:
        sys.stdout.write("%s %s\n" % ("✓" if ok else "✗", n))
    sys.stdout.write("== 自测 %d/%d 通过，失败 %d ==\n" % (len(results) - len(failed), len(results), len(failed)))
    return 0 if not failed else 1


# ---------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(prog="calc.py", description="运营数据复算器（验数字；格式与体检见 quality_check.py）")
    parser.add_argument("--selftest", action="store_true", help="运行内置自测")
    parser.add_argument("--list", action="store_true", help="列出子命令")
    sub = parser.add_subparsers(dest="command")

    p = sub.add_parser("decompose", help="指标拆解：效应之和精确闭合")
    p.add_argument("--metric", required=True, help="指标名，如 销售额")
    p.add_argument("--mode", choices=["mul", "add"], default="mul", help="乘法（因子相乘）或加法（因子相加，支持负因子）")
    p.add_argument("--base", required=True, help="基期因子，如 客流:1250,客单价:80（顺序即剥离顺序）")
    p.add_argument("--current", required=True, help="本期因子，名称须与基期一致")

    p = sub.add_parser("compare", help="两期对比，不等长期间按天对齐")
    p.add_argument("--label", required=True)
    p.add_argument("--base", required=True)
    p.add_argument("--current", required=True)
    p.add_argument("--base-days", help="基期天数（与 --cur-days 成对给出）")
    p.add_argument("--cur-days", help="本期天数")

    p = sub.add_parser("outlier", help="异常检测：3σ（n≥30）或 IQR")
    p.add_argument("--values", required=True, help="逗号分隔数值")
    p.add_argument("--method", choices=["3sigma", "iqr"], default="iqr")
    p.add_argument("--min-n", type=int, default=30, help="3σ 法最小样本量，默认 30")

    p = sub.add_parser("weighted", help="加权平均 vs 算术平均（平均的平均陷阱）")
    p.add_argument("--groups", required=True, help="名称:均值:样本数，逗号分隔")

    p = sub.add_parser("period", help="期间等长判定与天数比")
    p.add_argument("--base-start", required=True)
    p.add_argument("--base-end", required=True)
    p.add_argument("--cur-start", required=True)
    p.add_argument("--cur-end", required=True)

    p = sub.add_parser("trend", help="线性趋势：斜率与 R²")
    p.add_argument("--values", required=True, help="按时间顺序的数值序列")
    p.add_argument("--r2-threshold", default="0.7", help="方向性判定阈值，默认 0.7")

    args = parser.parse_args(argv)
    if args.selftest:
        return run_selftest()
    if args.list or not args.command:
        sys.stdout.write("子命令：decompose compare outlier weighted period trend；自测：--selftest\n")
        return 0
    handler = {"decompose": cmd_decompose, "compare": cmd_compare, "outlier": cmd_outlier,
               "weighted": cmd_weighted, "period": cmd_period, "trend": cmd_trend}[args.command]
    try:
        handler(args)
        return 0
    except InputError as e:
        sys.stderr.write("输入错误：%s\n" % e)
        return 2
    except ReconcileError as e:
        sys.stderr.write("闭合失败：%s\n" % e)
        return 3


if __name__ == "__main__":
    sys.exit(main())
