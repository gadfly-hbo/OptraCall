# -*- coding: utf-8 -*-
"""优惠券测算数据导入（OptraCall 分析资产 · 依赖 openpyxl）。

两种输入 → 基准篮子分布（ScenarioSpec.baseline 片段）：
    分桶表    bucket_min_cents / bucket_max_cents / avg_amount_cents / orders 或 weight / avg_margin_rate
    订单明细  order_id / amount_cents（券前商品金额，分）/ margin_cents 可选 / refunded 可选

金额一律整数分；质量检查 error/warning 分级，error 未决时拒绝出基准。
口径：amount_cents 是"本次券前可用商品金额"，不是实付金额、不含运费与其他优惠。

用法：
    python3 bucket.py --input 数据.xlsx [--kind buckets|orders] [--visitors 100000 --conversion 0.08] [-o baseline.json]
    python3 bucket.py selftest
"""
from __future__ import annotations

import json
import os
import sys
import tempfile

sys.dont_write_bytecode = True  # 同目录导入不落 __pycache__，保持分析资产目录干净
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coupon import Basket  # noqa: E402


def _issue(level, code, message):
    return {"level": level, "code": code, "message": message}


def _int_cents_or_issue(value, issues, label="金额"):
    try:
        f = float(value)
    except (TypeError, ValueError):
        issues.append(_issue("error", "non_integer_cents", f"{label}不是数字：{value!r}"))
        return None
    if abs(f - round(f)) > 1e-9:
        issues.append(_issue("error", "non_integer_cents", f"{label}必须是整数分，得到 {value}"))
        return None
    cents = int(round(f))
    if 0 < cents < 100:
        issues.append(_issue("warning", "currency_unit_suspect",
                             f"{label}={cents} 分（<1 元）：疑似把“元”填进了“分”列"))
    return cents


def _num(value, default=None):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def read_xlsx_file(path: str):
    from openpyxl import load_workbook
    wb = load_workbook(path, read_only=True, data_only=True)
    ws = wb.active
    rows_iter = ws.iter_rows(values_only=True)
    try:
        headers = [str(h).strip() if h is not None else "" for h in next(rows_iter)]
    except StopIteration:
        wb.close()
        return [], []
    out = []
    for values in rows_iter:
        if all(v is None or str(v).strip() == "" for v in values):
            continue
        out.append({h: v for h, v in zip(headers, values) if h})
    wb.close()
    return headers, out


def detect_kind(headers, rows) -> str:
    h = set(headers)
    if "avg_amount_cents" in h:
        return "buckets"
    if "order_id" in h and "amount_cents" in h:
        return "orders"
    if rows:
        raise ValueError(f"无法识别输入类型（表头 {sorted(h)}）：需要分桶表（avg_amount_cents）或订单明细（order_id+amount_cents）")
    raise ValueError("输入为空")


def import_buckets(rows) -> dict:
    issues: list = []
    buckets: list = []
    weight_mode = bool(rows) and all(
        (r.get("orders") in (None, "")) and r.get("weight") not in (None, "") for r in rows)

    for idx, r in enumerate(rows, start=2):
        avg = _int_cents_or_issue(r.get("avg_amount_cents"), issues, label=f"第{idx}行桶均金额")
        if avg is None:
            continue
        if avg <= 0:
            issues.append(_issue("error", "nonpositive_amount", f"第{idx}行桶均金额 ≤ 0"))
            continue
        bmin = _int_cents_or_issue(r["bucket_min_cents"], issues,
                                   label=f"第{idx}行桶下限") if r.get("bucket_min_cents") not in (None, "") else None
        bmax = _int_cents_or_issue(r["bucket_max_cents"], issues,
                                   label=f"第{idx}行桶上限") if r.get("bucket_max_cents") not in (None, "") else None
        margin = _num(r.get("avg_margin_rate"))
        if margin is not None and not 0.0 <= margin <= 1.0:
            issues.append(_issue("error", "illegal_probability", f"第{idx}行毛利率必须在 [0,1]"))
            margin = None
        if weight_mode:
            w = _num(r.get("weight"))
            if w is None or w < 0:
                issues.append(_issue("error", "illegal_weight", f"第{idx}行权重非法"))
                continue
        else:
            orders = _num(r.get("orders"))
            if orders is None or orders < 0:
                issues.append(_issue("error", "missing_value", f"第{idx}行缺少订单数/权重"))
                continue
            w = orders
        buckets.append({"avg": avg, "w": w, "margin": margin, "bmin": bmin, "bmax": bmax})

    total_w = sum(b["w"] for b in buckets)
    if not buckets:
        issues.append(_issue("error", "empty_input", "没有可用的分桶行"))
    elif weight_mode and abs(total_w - 1.0) > 1e-6:
        issues.append(_issue("error", "weight_not_conserved",
                             f"权重合计必须为 1，实际 {total_w:.6f}"))
    elif not weight_mode and total_w <= 0:
        issues.append(_issue("error", "weight_not_conserved", "订单数合计必须 > 0"))

    baskets = []
    for b in buckets:
        norm = b["w"] / total_w if total_w > 0 else 0.0
        bk = Basket(
            amount_cents=b["avg"], weight=norm, margin_rate=b["margin"],
            label=f"桶[{b['bmin'] if b['bmin'] is not None else '−∞'},"
                  f"{b['bmax'] if b['bmax'] is not None else '+∞'}]均值{b['avg']}",
            bucket_min_cents=b["bmin"], bucket_max_cents=b["bmax"],
        )
        baskets.append({"amount_cents": bk.amount_cents, "weight": bk.weight,
                        "margin_rate": bk.margin_rate, "label": bk.label,
                        "bucket_min_cents": bk.bucket_min_cents, "bucket_max_cents": bk.bucket_max_cents})
    return {"baskets": baskets, "issues": issues, "row_count": len(rows)}


def import_orders(rows) -> dict:
    issues: list = []
    seen_ids: set = set()
    by_amount: dict = {}
    refunded_seen = False
    count = 0

    for idx, r in enumerate(rows, start=2):
        oid = r.get("order_id")
        if oid in (None, ""):
            issues.append(_issue("error", "missing_value", f"第{idx}行缺少订单号"))
            continue
        if oid in seen_ids:
            issues.append(_issue("error", "duplicate_order", f"订单号重复：{oid}"))
            continue
        seen_ids.add(oid)
        amount = _int_cents_or_issue(r.get("amount_cents"), issues, label=f"订单{oid}金额")
        if amount is None:
            continue
        if amount <= 0:
            issues.append(_issue("error", "nonpositive_amount", f"订单{oid}券前金额 ≤ 0"))
            continue
        margin = _int_cents_or_issue(r.get("margin_cents"), issues,
                                     label=f"订单{oid}毛利") if r.get("margin_cents") not in (None, "") else None
        if r.get("refunded") not in (None, "", 0, "0", False):
            refunded_seen = True
        slot = by_amount.setdefault(amount, {"n": 0, "margin_sum": 0.0, "margin_n": 0})
        slot["n"] += 1
        if margin is not None:
            slot["margin_sum"] += margin / amount
            slot["margin_n"] += 1
        count += 1

    if refunded_seen:
        issues.append(_issue("warning", "refund_unspecified",
                             "存在退款单但未说明退款处理口径（含/剔除/净额），请先确认"))

    total = sum(s["n"] for s in by_amount.values())
    baskets = []
    for amount in sorted(by_amount):
        s = by_amount[amount]
        rate = (s["margin_sum"] / s["margin_n"]) if s["margin_n"] else None
        baskets.append({"amount_cents": amount, "weight": s["n"] / total,
                        "margin_rate": rate, "label": f"A={amount}×{s['n']}"})

    if not baskets:
        issues.append(_issue("error", "empty_input", "没有可用订单"))
    return {"baskets": baskets, "issues": issues, "row_count": len(rows)}


def import_file(path: str, kind: str | None = None, visitors=None, conversion=None) -> dict:
    headers, rows = read_xlsx_file(path)
    kind = kind or detect_kind(headers, rows)
    if kind == "buckets":
        snap = import_buckets(rows)
    elif kind == "orders":
        snap = import_orders(rows)
    else:
        raise ValueError(f"未知输入类型 {kind!r}（buckets / orders）")

    errors = [i for i in snap["issues"] if i["level"] == "error"]
    baseline = None
    if not errors:
        baseline = {
            "visitors": visitors,
            "conversion_rate": conversion,
            "data_snapshot_id": os.path.splitext(os.path.basename(path))[0],
            "baskets": snap["baskets"],
        }
        if conversion is None:
            snap["issues"].append(_issue("warning", "missing_conversion",
                                         "未提供 --conversion（无券基准转化率 C₀）：基准片段中为空，测算前必须补"))
    return {"kind": kind, "row_count": snap["row_count"],
            "issues": snap["issues"], "ok": not errors, "baseline": baseline}


def selftest() -> bool:
    from openpyxl import Workbook
    problems = []
    with tempfile.TemporaryDirectory() as td:
        wb = Workbook()
        ws = wb.active
        ws.title = "分桶数据"
        ws.append(["bucket_min_cents", "bucket_max_cents", "avg_amount_cents", "orders", "avg_margin_rate"])
        for row in ([10000, 14999, 12000, 350, 0.30], [15000, 19999, 17000, 400, 0.28], [None, None, 9900, 250, 0.30]):
            ws.append(row)
        p1 = os.path.join(td, "buckets.xlsx")
        wb.save(p1)
        r1 = import_file(p1, visitors=100000, conversion=0.08)
        if not r1["ok"] or len(r1["baseline"]["baskets"]) != 3:
            problems.append(f"分桶导入失败: {r1['issues']}")
        else:
            w = sum(b["weight"] for b in r1["baseline"]["baskets"])
            if abs(w - 1.0) > 1e-9:
                problems.append(f"权重归一失败: {w}")
            if r1["baseline"]["baskets"][0]["weight"] != 350 / 1000:
                problems.append("桶权重计算不符")

        wb = Workbook()
        ws = wb.active
        ws.title = "订单明细"
        ws.append(["order_id", "amount_cents", "margin_cents", "refunded"])
        for row in (["o-0001", 9900, 3000, 0], ["o-0002", 15800, 4700, 0],
                    ["o-0003", 12000, None, 1], ["o-0003", 12000, None, 0]):
            ws.append(row)
        p2 = os.path.join(td, "orders.xlsx")
        wb.save(p2)
        r2 = import_file(p2)
        errs = [i["code"] for i in r2["issues"] if i["level"] == "error"]
        if r2["ok"] or "duplicate_order" not in errs:
            problems.append(f"重复订单未被拦截: {errs}")
        ws_prob = [i["code"] for i in r2["issues"] if i["level"] == "warning"]
        if "refund_unspecified" not in ws_prob:
            problems.append(f"退款口径警告缺失: {ws_prob}")

    if problems:
        print(f"SELFTEST FAIL（{len(problems)} 项）:")
        for p in problems:
            print(" -", p)
        return False
    print("SELFTEST PASS: bucket 分桶/订单导入、权重归一、重复订单拦截与退款口径警告全部符合")
    return True


def main(argv: list) -> int:
    if len(argv) >= 2 and argv[1] == "selftest":
        return 0 if selftest() else 1
    if len(argv) < 3 or argv[1] != "--input":
        print(__doc__, file=sys.stderr)
        return 2
    args = argv[2:]
    path = args[0]
    kind = None
    visitors = conversion = None
    out_path = None
    i = 1
    while i < len(args):
        if args[i] == "--kind" and i + 1 < len(args):
            kind = args[i + 1]; i += 2
        elif args[i] == "--visitors" and i + 1 < len(args):
            visitors = int(args[i + 1]); i += 2
        elif args[i] == "--conversion" and i + 1 < len(args):
            conversion = float(args[i + 1]); i += 2
        elif args[i] == "-o" and i + 1 < len(args):
            out_path = args[i + 1]; i += 2
        else:
            print(f"未知参数 {args[i]!r}", file=sys.stderr)
            return 2
    try:
        result = import_file(path, kind, visitors, conversion)
    except (ValueError, FileNotFoundError) as exc:
        print(json.dumps({"error": {"type": "invalid_input", "message": str(exc)}},
                         ensure_ascii=False), file=sys.stderr)
        return 1
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(f"已写入 {out_path}（ok={result['ok']}，{len(result['issues'])} 条质量提示）")
    else:
        print(text)
    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
