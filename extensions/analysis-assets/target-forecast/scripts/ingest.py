# -*- coding: utf-8 -*-
"""目标测算数据导入（OptraCall 分析资产 · 依赖 openpyxl）。

两种输入 → 统一月度指标层（platform, month, gmv, orders, units, buyers, uv,
new_customers, new_gmv, new_orders, old_customers, old_gmv, old_orders）：

    模式A 订单明细  日期/订单号/用户ID/商品ID/实付金额[必填]；品类/件数/原价金额[可选]
                   订单级聚合 + 滚动窗口新老客分类（左截断：数据起点前的购买史不可见）
    模式B 聚合指标  月份/新客数/新客客单/老客数/老客复购频次/老客客单[必填]；
                   UV[可选，有则启用场视角]；新客订单数/GMV/转化率[可选，仅一致性校验]

质量三级：
    blocker     数据错误，定位 Excel 行号，拒绝产出（重复月份/非正金额/订单身份冲突/
                日期不可解析/必填缺失/零业务量）
    confirmable 填写值与派生值不一致（GMV 差>5%、转化率差>10%），需确认口径
    quality     覆盖事实（缺月/短历史/观察单位提示），如实披露不阻断

口径：实付金额 = 支付净额（已扣退款），本工具不做退款抵减；非正金额行拒绝。

用法：
    python3 ingest.py detail --input 订单明细.xlsx --platform 天猫 [-o unified.json]
    python3 ingest.py agg --input 聚合指标.xlsx --platform 私域 [-o unified.json]
    python3 ingest.py selftest
"""
from __future__ import annotations

import calendar
import json
import math
import os
import sys
from datetime import date, datetime, timedelta

ENGINE_VERSION = "optracall-forecast-ingest-2"

DETAIL_REQUIRED = ["日期", "订单号", "用户ID", "商品ID", "实付金额"]
DETAIL_OPTIONAL = ["品类", "件数", "原价金额"]
AGG_REQUIRED = ["月份", "新客数", "新客客单", "老客数", "老客复购频次", "老客客单"]
AGG_OPTIONAL = ["UV", "新客订单数", "转化率", "GMV"]
UNIFIED_COLUMNS = ["platform", "month", "gmv", "orders", "units", "buyers", "uv",
                   "new_customers", "new_gmv", "new_orders",
                   "old_customers", "old_gmv", "old_orders"]


def _norm_str_id(value) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _to_num(value):
    if isinstance(value, bool) or value is None or value == "":
        return None
    try:
        number = float(value)
        return number if math.isfinite(number) else None
    except (TypeError, ValueError):
        return None


def _parse_date(value):
    """Excel 单元格 → date；无法解析返回 None。支持 datetime、YYYY-MM-DD、YYYY/M/D。"""
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y-%m-%d %H:%M:%S", "%Y/%m/%d %H:%M:%S"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _norm_month(value) -> str:
    """月份 → 'YYYY-MM'；支持 2026-01 / 2026/1 / 2026.01 / 202601 / datetime。"""
    if isinstance(value, datetime):
        return f"{value.year:04d}-{value.month:02d}"
    if isinstance(value, date):
        return f"{value.year:04d}-{value.month:02d}"
    s = str(value).strip()
    s2 = s.replace("/", "-").replace(".", "-")
    parts = s2.split("-")
    try:
        if len(parts) == 2:
            parsed = date(int(parts[0]), int(parts[1]), 1)
            return f"{parsed.year:04d}-{parsed.month:02d}"
        if len(s) in (6, 8) and s.isdigit():
            parsed = date(int(s[:4]), int(s[4:6]), 1)
            return f"{parsed.year:04d}-{parsed.month:02d}"
    except ValueError:
        pass
    raise ValueError(f"无法解析月份: {value!r}，请用 YYYY-MM")


class WorksheetRow(dict):
    """Keep physical row provenance separate from user-controlled column names."""
    def __init__(self, values, excel_row):
        super().__init__(values)
        self.excel_row = excel_row


def read_xlsx_rows(path: str):
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
    for excel_row, values in enumerate(rows_iter, start=2):
        if all(v is None or str(v).strip() == "" for v in values):
            continue
        out.append(WorksheetRow({h: v for h, v in zip(headers, values) if h}, excel_row))
    wb.close()
    return headers, out


class BlockerError(ValueError):
    """blocker 级数据错误：消息定位 Excel 行号（表头=第1行，数据从第2行起）。"""


# ---------------- 模式A：订单明细 ----------------

def validate_detail_rows(rows: list, platform: str) -> list:
    if not rows:
        raise BlockerError(f"[{platform}] 订单明细为空")
    missing = [c for c in DETAIL_REQUIRED if c not in rows[0]]
    if missing:
        raise BlockerError(f"[{platform}] 订单明细缺少必填字段: {missing}")
    recs = []
    bad_dates, bad_amounts = [], []
    by_order_user: dict = {}
    for idx, r in enumerate(rows, start=2):
        idx = getattr(r, "excel_row", idx)
        for column in ("订单号", "用户ID", "商品ID"):
            if not _norm_str_id(r.get(column)):
                raise BlockerError(f"[{platform}] 「{column}」缺失（第 {idx} 行）")
        d = _parse_date(r.get("日期"))
        if d is None:
            bad_dates.append(idx)
        amt = _to_num(r.get("实付金额"))
        if amt is None or amt <= 0:
            bad_amounts.append(idx)
        oid = _norm_str_id(r.get("订单号"))
        uid = _norm_str_id(r.get("用户ID"))
        if oid and uid:
            prev = by_order_user.setdefault(oid, uid)
            if prev != uid:
                pass  # 汇总在下方统一报
        recs.append({"row": idx, "date": d, "oid": oid, "uid": uid,
                     "sid": _norm_str_id(r.get("商品ID")),
                     "amount": amt,
                     "category": (str(r.get("品类")).strip() if r.get("品类") not in (None, "") else "未分类"),
                     "units": (_to_num(r.get("件数")) if r.get("件数") not in (None, "") else 1) or 1,
                     "orig": _to_num(r.get("原价金额"))})
    if bad_dates:
        raise BlockerError(f"[{platform}] 「日期」列存在无法解析的值（第 {'、'.join(map(str, bad_dates[:5]))} 行），请检查格式")
    if bad_amounts:
        raise BlockerError(
            f"[{platform}] 「实付金额」存在空值/非正值（第 {'、'.join(map(str, bad_amounts[:5]))} 行，共 {len(bad_amounts)} 行）。"
            "口径：实付金额=支付净额（已扣退款），本工具不做退款抵减；请按净额口径导出或剔除退款行")
    ident: dict = {}
    conflict: set = set()
    for rec in recs:
        prev = ident.setdefault(rec["oid"], rec["uid"])
        if prev != rec["uid"]:
            conflict.add(rec["oid"])
    if conflict:
        bad_ids = sorted(conflict)[:5]
        bad_rows = [r["row"] for r in recs if r["oid"] in bad_ids][:5]
        raise BlockerError(f"[{platform}] 同一订单号对应多个用户（订单号 {'、'.join(bad_ids)}，"
                           f"如第 {'、'.join(map(str, bad_rows))} 行），请先核对订单身份")
    if sum(r["amount"] for r in recs) <= 0:
        raise BlockerError(f"[{platform}] 实付金额合计为 0 或负值，没有可测算的业务量")
    return recs


def order_level(recs: list) -> list:
    """订单行 → 订单级（一订单号一行）。"""
    by_oid: dict = {}
    for r in recs:
        o = by_oid.setdefault(r["oid"], {"date": r["date"], "uid": r["uid"],
                                         "amount": 0.0, "units": 0.0})
        o["amount"] += r["amount"]
        o["units"] += r["units"]
    od = sorted(by_oid.values(), key=lambda o: o["date"])
    return od


def classify_new(od: list, window_days: int) -> list:
    """滚动口径新老客：下单前 window_days 天内无购买 → 新客。

    用户当月新老身份由当月首单决定，当月全部订单计入同一桶；
    数据起点之前的购买史不可见（左截断），首单一律记新客。
    """
    ordered = sorted(od, key=lambda o: (o["uid"], o["date"]))
    result = []
    prev_by_uid: dict = {}
    for o in sorted(od, key=lambda o: (o["uid"], o["date"])):
        prev = prev_by_uid.get(o["uid"])
        gap = (o["date"] - prev).days if prev is not None else None
        rec = dict(o)
        rec["is_new"] = prev is None or gap > window_days
        rec["month"] = f"{rec['date'].year:04d}-{rec['date'].month:02d}"
        prev_by_uid[rec["uid"]] = rec["date"]
        result.append(rec)
    status: dict = {}
    for rec in result:
        key = (rec["uid"], rec["month"])
        if key not in status:
            status[key] = rec["is_new"]
    for rec in result:
        rec["is_new"] = status[(rec["uid"], rec["month"])]
    return sorted(result, key=lambda o: o["date"])


def to_unified_detail(od: list, platform: str) -> list:
    by_month: dict = {}
    for o in od:
        m = by_month.setdefault(o["month"], {"gmv": 0.0, "orders": 0, "units": 0.0,
                                             "buyers": set(), "uv": None,
                                             "new_customers": set(), "new_gmv": 0.0, "new_orders": 0,
                                             "old_customers": set(), "old_gmv": 0.0, "old_orders": 0})
        m["gmv"] += o["amount"]
        m["orders"] += 1
        m["units"] += o["units"]
        m["buyers"].add(o["uid"])
        if o["is_new"]:
            m["new_customers"].add(o["uid"])
            m["new_gmv"] += o["amount"]
            m["new_orders"] += 1
        else:
            m["old_customers"].add(o["uid"])
            m["old_gmv"] += o["amount"]
            m["old_orders"] += 1
    rows = []
    for month in sorted(by_month):
        m = by_month[month]
        rows.append({
            "platform": platform, "month": month,
            "gmv": m["gmv"], "orders": m["orders"], "units": m["units"],
            "buyers": len(m["buyers"]), "uv": m["uv"],
            "new_customers": len(m["new_customers"]), "new_gmv": m["new_gmv"],
            "new_orders": m["new_orders"],
            "old_customers": len(m["old_customers"]), "old_gmv": m["old_gmv"],
            "old_orders": m["old_orders"],
        })
    return rows


def _shift_months(d: date, months: int) -> date:
    """日历月位移（与 pandas DateOffset(months=) 同语义：日夹到月末）。"""
    total = d.year * 12 + (d.month - 1) - months
    y, m = divmod(total, 12)
    m += 1
    day = min(d.day, calendar.monthrange(y, m)[1])
    return date(y, m, day)


def goods_structure(recs: list, caliber: dict, history_end: date) -> list:
    """基期（goods_window_months 内）品类×梯队结构：[品类, 梯队, gmv, 款数]。

    首次售卖距基期末 ≤ new_product_days 的款记「新品」，不参与帕累托划分。
    """
    window_start = _shift_months(history_end, int(caliber.get("goods_window_months", 12)))
    win = [r for r in recs if r["date"] > window_start]
    if not win:
        return []
    first_seen: dict = {}
    for r in recs:
        if r["sid"] not in first_seen or r["date"] < first_seen[r["sid"]]:
            first_seen[r["sid"]] = r["date"]
    sku: dict = {}
    for r in win:
        s = sku.setdefault(r["sid"], {"gmv": 0.0, "category": r["category"]})
        s["gmv"] += r["amount"]
    new_cut = history_end - timedelta(days=int(caliber.get("new_product_days", 90)))

    def assign_tiers(group_items: list) -> list:
        order = sorted(group_items, key=lambda s: -s["gmv"])
        tiers = ["腰部"] * len(order)
        total = sum(s["gmv"] for s in order)
        if total <= 0:
            return tiers
        cum = 0.0
        for i, s in enumerate(order):
            cum += s["gmv"]
            if i == 0 or cum / total <= caliber.get("tier_pareto_pct", 0.78):
                tiers[i] = "爆款"
            else:
                break
        cum_bottom = 0.0
        bottoms = [0.0] * len(order)
        for i in range(len(order) - 1, -1, -1):
            cum_bottom += order[i]["gmv"]
            bottoms[i] = cum_bottom
        for i in range(len(order) - 1, -1, -1):
            if tiers[i] != "腰部":
                continue
            if i == len(order) - 1 or bottoms[i] / total <= caliber.get("tier_tail_pct", 0.20):
                tiers[i] = "尾部"
            else:
                break
        for s, t in zip(order, tiers):
            s["tier"] = t
        return tiers

    items = []
    for sid, s in sku.items():
        tier = "新品" if first_seen[sid] >= new_cut else ""
        items.append({"sid": sid, "gmv": s["gmv"], "category": s["category"], "tier": tier})
    core = [s for s in items if s["tier"] == ""]
    if core:
        if caliber.get("tier_scope", "platform") == "category":
            by_cat: dict = {}
            for s in core:
                by_cat.setdefault(s["category"], []).append(s)
            for group in by_cat.values():
                assign_tiers(group)
        else:
            assign_tiers(core)
        for s in items:
            if s["tier"] == "":
                s["tier"] = next((c["tier"] for c in core if c["sid"] == s["sid"]), "腰部")
    struct: dict = {}
    for s in items:
        key = (s["category"], s["tier"])
        e = struct.setdefault(key, {"gmv": 0.0, "款数": set()})
        e["gmv"] += s["gmv"]
        e["款数"].add(s["sid"])
    rows = [{"品类": k[0], "梯队": k[1], "gmv": v["gmv"], "款数": len(v["款数"])}
            for k, v in struct.items()]
    return sorted(rows, key=lambda r: -r["gmv"])


# ---------------- 模式B：聚合指标 ----------------

def validate_agg_rows(rows: list, platform: str):
    if not rows:
        raise BlockerError(f"[{platform}] 聚合指标表为空")
    missing = [c for c in AGG_REQUIRED if c not in rows[0]]
    if missing:
        raise BlockerError(f"[{platform}] 聚合指标表缺少必填字段: {missing}")
    confirmable = []
    recs = []
    seen_months: dict = {}
    for idx, r in enumerate(rows, start=2):
        idx = getattr(r, "excel_row", idx)
        try:
            month = _norm_month(r.get("月份"))
        except ValueError as exc:
            raise BlockerError(f"[{platform}] {exc}（第 {idx} 行）")
        if month in seen_months:
            same = [seen_months[month], idx]
            raise BlockerError(f"[{platform}] 月份 {month} 重复出现（第 {'、'.join(map(str, same))} 行），请先消除重复月份")
        seen_months[month] = idx
        rec = {"row": idx, "month": month}
        for c in AGG_REQUIRED[1:]:
            v = _to_num(r.get(c))
            if v is None or v < 0:
                raise BlockerError(f"[{platform}] 「{c}」存在空值/非法数值（第 {idx} 行）")
            rec[c] = v
        for c in ("UV", "新客订单数", "转化率", "GMV"):
            rec[c] = _to_num(r.get(c)) if c in r else None
            if r.get(c) not in (None, ""):
                value = rec[c]
                if value is None or value < 0 or (c == "转化率" and not 0 < value <= 1):
                    raise BlockerError(f"[{platform}] 「{c}」存在非法数值（第 {idx} 行）")
        recs.append(rec)
    if sum(x["新客数"] * x["新客客单"] + x["老客数"] * x["老客复购频次"] * x["老客客单"] for x in recs) <= 0:
        raise BlockerError(f"[{platform}] 派生 GMV 合计为 0，没有可测算的业务量")
    return sorted(recs, key=lambda x: x["month"]), confirmable


def to_unified_agg(recs: list, platform: str) -> tuple:
    unified, confirmable = [], []
    for r in recs:
        new_gmv = r["新客数"] * r["新客客单"]
        old_orders = r["老客数"] * r["老客复购频次"]
        old_gmv = old_orders * r["老客客单"]
        new_orders = r["新客订单数"] if r.get("新客订单数") is not None else r["新客数"]
        orders = new_orders + old_orders
        gmv = new_gmv + old_gmv
        uv = r.get("UV")
        if r.get("GMV") is not None and r["GMV"] > 0:
            if gmv / r["GMV"] - 1 > 0.05 or gmv / r["GMV"] - 1 < -0.05:
                confirmable.append(
                    f"[{platform}] {r['month']} 填写的GMV与公式派生GMV差>5%: "
                    f"填写{r['GMV']:.0f} vs 派生{gmv:.0f}")
        if r.get("转化率") is not None and uv is not None and uv > 0:
            implied = orders / uv
            if abs(implied / r["转化率"] - 1) > 0.10:
                confirmable.append(
                    f"[{platform}] {r['month']} 填写的转化率与隐含转化率差>10%: "
                    f"填写{r['转化率']:.3f} vs 隐含{implied:.3f}")
        unified.append({
            "platform": platform, "month": r["month"],
            "gmv": gmv, "orders": orders, "units": None,
            "buyers": r["新客数"] + r["老客数"], "uv": uv,
            "new_customers": r["新客数"], "new_gmv": new_gmv, "new_orders": new_orders,
            "old_customers": r["老客数"], "old_gmv": old_gmv, "old_orders": old_orders,
        })
    return unified, confirmable


# ---------------- 覆盖事实（quality 级） ----------------

def coverage(unified: list) -> dict:
    months = [r["month"] for r in unified]
    if not months:
        return {"history_months": 0, "history_start": None, "history_end": None,
                "missing_months": [], "short_history": True}
    lo = _month_tuple(min(months))
    hi = _month_tuple(max(months))
    have = set(months)
    missing = []
    y, m = lo
    while (y, m) <= hi:
        label = f"{y:04d}-{m:02d}"
        if label not in have:
            missing.append(label)
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return {"history_months": len(months), "history_start": min(months), "history_end": max(months),
            "missing_months": missing, "short_history": len(months) < 12}


def _month_tuple(label: str):
    y, m = label.split("-")
    return int(y), int(m)


# ---------------- 输入 ----------------

def ingest_detail(path: str, platform: str, caliber: dict) -> dict:
    headers, rows = read_xlsx_rows(path)
    recs = validate_detail_rows(rows, platform)
    od = order_level(recs)
    od = classify_new(od, int(caliber.get("new_customer_window_days", 365)))
    unified = to_unified_detail(od, platform)
    hist_end = max(r["date"] for r in recs)
    structure = goods_structure(recs, caliber, hist_end)
    cov = coverage(unified)
    quality = []
    if cov["missing_months"]:
        quality.append(f"[{platform}] 历史区间缺月：{'、'.join(cov['missing_months'][:8])}"
                       f"（共 {len(cov['missing_months'])} 个月）——季节性与基线受影响，请确认")
    if cov["short_history"]:
        quality.append(f"[{platform}] 历史仅 {cov['history_months']} 个月（<12）：基期年化为月均×12 外推，季节性不完整")
    quality.append(f"[{platform}] 新老客为滚动口径（{caliber.get('new_customer_window_days', 365)} 天内无购买=新客），"
                   "数据起点前购买史不可见（左截断），首批用户一律记新客")
    return {
        "engine_version": ENGINE_VERSION,
        "input": {"file": os.path.basename(path), "platform": platform, "mode": "A",
                  "rows": len(rows)},
        "input_digest": _digest({"headers": headers, "rows": rows, "platform": platform,
                                 "mode": "A", "caliber": caliber}),
        "unified": unified,
        "structure": structure,
        "coverage": cov,
        "blockers": [],
        "confirmable": [],
        "quality": quality,
    }


def ingest_agg(path: str, platform: str) -> dict:
    headers, rows = read_xlsx_rows(path)
    recs, _ = validate_agg_rows(rows, platform)
    unified, confirmable = to_unified_agg(recs, platform)
    cov = coverage(unified)
    quality = []
    if cov["missing_months"]:
        quality.append(f"[{platform}] 历史区间缺月：{'、'.join(cov['missing_months'][:8])}"
                       f"（共 {len(cov['missing_months'])} 个月）")
    if cov["short_history"]:
        quality.append(f"[{platform}] 历史仅 {cov['history_months']} 个月（<12）：基期年化为月均×12 外推")
    return {
        "engine_version": ENGINE_VERSION,
        "input": {"file": os.path.basename(path), "platform": platform, "mode": "B",
                  "rows": len(rows)},
        "input_digest": _digest({"headers": headers, "rows": rows, "platform": platform, "mode": "B"}),
        "unified": unified,
        "structure": None,
        "coverage": cov,
        "blockers": [],
        "confirmable": confirmable,
        "quality": quality,
    }


def _digest(obj) -> str:
    import hashlib
    canon = json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"),
                       allow_nan=False, default=lambda value: value.isoformat())
    return hashlib.sha256(canon.encode("utf-8")).hexdigest()[:16]


# ---------------- selftest ----------------

def _golden():
    return json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                       "golden/ingest-expected.json"), encoding="utf-8"))


def _close(a, b, rel=1e-9, abs_=1e-6):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))
    return a == b


def _rows_close(mine, gold, label, problems):
    if len(mine) != len(gold):
        problems.append(f"{label}: 行数 {len(mine)} vs 期望 {len(gold)}")
        return
    for i, (m, g) in enumerate(zip(mine, gold)):
        for k, v in g.items():
            if not _close(m.get(k), v):
                problems.append(f"{label}[{i}].{k}: 期望 {v!r} 实得 {m.get(k)!r}")


def selftest() -> bool:
    golden = _golden()
    problems = []

    detail_rows = []
    for r in golden["input"]["detail_rows"]:
        r = dict(r)
        r["日期"] = _parse_date(r["日期"])
        detail_rows.append(r)
    recs = validate_detail_rows(detail_rows, "天猫")
    od = classify_new(order_level(recs), 365)
    unified = to_unified_detail(od, "天猫")
    _rows_close(unified, golden["expected"]["detail_unified"], "detail_unified", problems)
    structure = goods_structure(recs, golden["input"]["caliber"],
                                max(r["date"] for r in recs))
    _rows_close(structure, golden["expected"]["detail_structure"], "detail_structure", problems)

    agg_rows = [dict(r) for r in golden["input"]["agg_rows"]]
    arecs, _ = validate_agg_rows(agg_rows, "私域")
    aunified, confirmable = to_unified_agg(arecs, "私域")
    _rows_close(aunified, golden["expected"]["agg_unified"], "agg_unified", problems)

    for name, bad_rows in {
        "dup_month": [dict(r) for r in [
            {"月份": "2025-01", "新客数": 100, "新客客单": 150.0, "老客数": 300,
             "老客复购频次": 1.2, "老客客单": 200.0},
            {"月份": "2025-01", "新客数": 90, "新客客单": 140.0, "老客数": 280,
             "老客复购频次": 1.1, "老客客单": 190.0}]],
        "nonpositive_amount": [{"日期": "2025-01-10", "订单号": "O1", "用户ID": "U1",
                                "商品ID": "S1", "实付金额": -5.0}],
        "order_identity": [
            {"日期": "2025-01-10", "订单号": "O1", "用户ID": "U1", "商品ID": "S1", "实付金额": 10.0},
            {"日期": "2025-01-11", "订单号": "O1", "用户ID": "U2", "商品ID": "S2", "实付金额": 20.0}],
        "bad_date": [{"日期": "不是日期", "订单号": "O1", "用户ID": "U1", "商品ID": "S1", "实付金额": 10.0}],
    }.items():
        want = golden["expected"]["blockers"][name]["error"]
        got = None
        try:
            rows = [dict(r) for r in bad_rows]
            if name == "dup_month":
                validate_agg_rows(rows, "测试")
            else:
                rows = [{**r, "日期": _parse_date(r["日期"]) if name != "bad_date" else r["日期"]}
                        for r in rows]
                validate_detail_rows(rows, "测试")
        except BlockerError as exc:
            got = str(exc)
        if got != want:
            problems.append(f"blocker/{name}: 期望 {want!r} 实得 {got!r}")

    if problems:
        print(f"SELFTEST FAIL（{len(problems)} 项）:")
        for p in problems[:20]:
            print(" -", p)
        return False
    n_u = len(golden["expected"]["detail_unified"]) + len(golden["expected"]["agg_unified"])
    print(f"SELFTEST PASS: ingest 黄金案例（明细→月度 {len(golden['expected']['detail_unified'])} 月 + "
          f"结构 {len(golden['expected']['detail_structure'])} 行 + 聚合 {len(golden['expected']['agg_unified'])} 月，"
          f"共 {n_u} 行月度 + 4 类 blocker 消息）与原仓实现一致（数值容差 1e-9）")
    return True


def main(argv: list) -> int:
    if len(argv) >= 2 and argv[1] in ("selftest", "--selftest"):
        return 0 if selftest() else 1
    if len(argv) < 4 or argv[1] not in ("detail", "agg") or argv[2] != "--input":
        print(__doc__, file=sys.stderr)
        return 2
    mode, path = argv[1], argv[3]
    platform, out_path, caliber = "未命名平台", None, {}
    i = 4
    while i < len(argv):
        if argv[i] == "--platform" and i + 1 < len(argv):
            platform = argv[i + 1]; i += 2
        elif argv[i] == "-o" and i + 1 < len(argv):
            out_path = argv[i + 1]; i += 2
        elif argv[i] == "--caliber" and i + 1 < len(argv):
            with open(argv[i + 1], encoding="utf-8") as fh:
                caliber = json.load(fh); i += 2
        else:
            print(f"未知参数 {argv[i]!r}", file=sys.stderr)
            return 2
    try:
        result = ingest_detail(path, platform, caliber) if mode == "detail" else ingest_agg(path, platform)
    except BlockerError as exc:
        print(json.dumps({"ok": False, "blockers": [str(exc)]}, ensure_ascii=False), file=sys.stderr)
        return 1
    result["ok"] = True
    text = json.dumps(result, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        nq = len(result["confirmable"]) + len(result["quality"])
        print(f"已写入 {out_path}（{len(result['unified'])} 个月度行，{nq} 条质量提示，"
              f"engine {ENGINE_VERSION}）")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main(sys.argv))
    except ModuleNotFoundError as exc:
        if exc.name != "openpyxl":
            raise
        import shlex
        print(f"缺少 openpyxl；请在获准的 Python 环境安装：{shlex.quote(sys.executable)} -m pip install -r "
              f"{shlex.quote(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'requirements.txt'))}", file=sys.stderr)
        sys.exit(1)
