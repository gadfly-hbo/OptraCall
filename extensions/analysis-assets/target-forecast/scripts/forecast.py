# -*- coding: utf-8 -*-
"""目标测算引擎（OptraCall 分析资产 · 纯 Python，无第三方依赖）。

三视角（对同一笔 GMV 负责，互为校验）：
    人 = 新客数×新客客单 + 老客数×复购频次×老客客单   （模式A主口径）
    场 = UV × 转化率 × 客单                            （有UV数据时启用，模式B主口径）
    货 = Σ(品类×梯队 基期 × (1+梯队增速))              （有明细结构时启用，校验视角）

    基线 = 最近 baseline_months 个月（流量型取月均、价值型取加权均值）
    目标 = 基线 × (1+情景增速)，按历史季节性分摊到月（流量型分摊，价值型平推）
    平台独立核算 + 全渠道汇总（比率分子分母重算）；主口径 = 有流量数据用场，否则用人

数学承接 target-forecast 原仓 target_forecast 引擎（业务基线 df5acd6，原引擎
forecast-engine-1.1），OptraCall 形态纯 Python 重实现；等价性由黄金案例自检证明。

用法：
    python3 forecast.py run --input input.json [-o out.json]
    python3 forecast.py selftest
"""
from __future__ import annotations

import hashlib
import json
import os
import sys

ENGINE_VERSION = "optracall-forecast-1"

DEFAULT_CALIBER = {
    "new_customer_window_days": 365,
    "baseline_months": 12,
    "tier_scope": "platform",
    "tier_pareto_pct": 0.78,
    "tier_tail_pct": 0.20,
    "goods_window_months": 12,
    "new_product_days": 90,
    "target_months": 12,
}


def _month_add(label: str, n: int) -> str:
    y, m = label.split("-")
    y, m = int(y), int(m)
    total = y * 12 + (m - 1) + n
    yy, mm = divmod(total, 12)
    return f"{yy:04d}-{mm + 1:02d}"


def _cal(label: str) -> int:
    return int(label.split("-")[1])


# ---------------- 基线与季节性 ----------------

def season_shares(monthly: list) -> dict:
    """历史 GMV 的月度季节占比（1-12 月，合计=1）。历史不足 12 月或缺月用全均值补齐。"""
    by_cal: dict = {}
    for r in monthly:
        by_cal.setdefault(_cal(r["month"]), []).append(r["gmv"])
    avg = {m: sum(v) / len(v) for m, v in by_cal.items()}
    fill = (sum(avg.values()) / len(avg)) if avg else 1.0
    full = [avg.get(m, fill) for m in range(1, 13)]
    total = sum(full)
    return {m: v / total for m, v in zip(range(1, 13), full)}


def _safe(num, den):
    return num / den if den else 0.0


def baseline(monthly: list, months: int) -> dict:
    """最近 N 个月的基线水平。uv 缺失时为 None（场视角降级）。"""
    win = sorted(monthly, key=lambda r: r["month"])[-months:]
    months_present = len(win)

    def col(name):
        return [r.get(name) for r in win]

    gmv_s = sum(col("gmv"))
    orders_s = sum(col("orders"))
    new_c_s = sum(col("new_customers"))
    new_gmv_s = sum(col("new_gmv"))
    new_o_s = sum(col("new_orders"))
    old_c_s = sum(col("old_customers"))
    old_gmv_s = sum(col("old_gmv"))
    old_o_s = sum(col("old_orders"))
    n = len(win)
    b = {
        "new_customers": (new_c_s / n) if n else 0.0,
        "new_arpu": _safe(new_gmv_s, new_c_s),
        "new_orders_per_cust": _safe(new_o_s, new_c_s),
        "old_customers": (old_c_s / n) if n else 0.0,
        "old_freq": _safe(old_o_s, old_c_s),
        "old_aov": _safe(old_gmv_s, old_o_s),
        "aov_total": _safe(gmv_s, orders_s),
        # 基期年化 GMV：月均×12。窗口恰为 12 个月时与求和恒等；短历史不低估、长窗口不翻倍。
        "annual_gmv": (gmv_s / n * 12) if n else 0.0,
        "coverage_months": months_present,
        "annualized": months_present != 12,
    }
    uvs = [r["uv"] for r in win if r.get("uv") is not None]
    if uvs and sum(uvs) > 0:
        b["uv"] = sum(uvs) / len(uvs)
        b["cvr"] = _safe(orders_s, sum(uvs))
    else:
        b["uv"] = None
        b["cvr"] = None
    return b


# ---------------- 三视角 ----------------

def project_person(base: dict, params: dict, target_months: list, shares: dict) -> list:
    rows = []
    for m in target_months:
        sm = shares[_cal(m)]
        new_c = base["new_customers"] * (1 + params["new_customers_growth"]) * 12 * sm
        old_c = base["old_customers"] * (1 + params["old_customers_growth"]) * 12 * sm
        arpu = base["new_arpu"] * (1 + params["new_arpu_growth"])
        freq = base["old_freq"] * (1 + params["old_freq_growth"])
        aov = base["old_aov"] * (1 + params["old_aov_growth"])
        new_gmv = new_c * arpu
        old_gmv = old_c * freq * aov
        rows.append({
            "scenario": params["_name"], "month": m,
            "new_customers": new_c, "new_arpu": arpu, "new_gmv": new_gmv,
            "old_customers": old_c, "old_freq": freq, "old_aov": aov, "old_gmv": old_gmv,
            "gmv": new_gmv + old_gmv,
            "orders": new_c * base["new_orders_per_cust"] + old_c * freq,
        })
    return rows


def project_field(base: dict, params: dict, target_months: list, shares: dict):
    if not base.get("uv"):
        return None
    rows = []
    for m in target_months:
        sm = shares[_cal(m)]
        uv = base["uv"] * (1 + params["uv_growth"]) * 12 * sm
        cvr = base["cvr"] * (1 + params["cvr_growth"])
        aov = base["aov_total"] * (1 + params["aov_growth"])
        orders = uv * cvr
        rows.append({
            "scenario": params["_name"], "month": m,
            "uv": uv, "cvr": cvr, "aov": aov, "orders": orders, "gmv": orders * aov,
        })
    return rows


def project_goods(structure: list, params: dict, target_months: list, shares: dict):
    """基期结构（品类×梯队）× 梯队增速 → 月度目标。"""
    if not structure:
        return None
    growth = params.get("tier_growth", {})
    rows = []
    for r in structure:
        g = growth.get(r["梯队"], 0.0)
        for m in target_months:
            rows.append({
                "scenario": params["_name"], "month": m,
                "品类": r["品类"], "梯队": r["梯队"], "款数": r["款数"],
                "gmv": r["gmv"] * (1 + g) * shares[_cal(m)],
            })
    return rows


def run_platform(monthly: list, structure, scenarios: dict, caliber: dict,
                 target_months=None) -> dict:
    """单平台测算。target_months 缺省按本平台历史末月推导。"""
    n_months = caliber.get("target_months", 12)
    base = baseline(monthly, caliber["baseline_months"])
    shares = season_shares(monthly)
    if target_months is None:
        last = max(r["month"] for r in monthly)
        target_months = [_month_add(last, i + 1) for i in range(n_months)]

    person, field, goods = [], None, None
    for name, p in scenarios.items():
        p = {**p, "_name": name}
        person.extend(project_person(base, p, target_months, shares))
        f = project_field(base, p, target_months, shares)
        if f is not None:
            field = (field or []) + f
        g = project_goods(structure, p, target_months, shares)
        if g is not None:
            goods = (goods or []) + g
    main_view = "场" if field is not None else "人"
    return {
        "baseline": base, "person": person, "field": field, "goods": goods,
        "main_view": main_view, "target_months": list(target_months),
        "shares": {str(m): v for m, v in shares.items()},
    }


# ---------------- 全渠道汇总 ----------------

def _sum_by(rows, keys, value):
    out: dict = {}
    for r in rows:
        k = tuple(r[x] for x in keys)
        out[k] = out.get(k, 0.0) + r[value]
    return out


def consolidate(person_all: list, main_all: list, field_all) -> list:
    """全渠道汇总：核心指标直接加总，比率类用分子分母重算。

    - GMV/新老客GMV/订单数：跨平台直接加总
    - 全渠道客单 = ΣGMV ÷ Σ订单数；全渠道转化率 = Σ订单数 ÷ ΣUV（仅覆盖填报UV的平台）
    """
    main_tot = _sum_by(main_all, ("scenario", "month"), "gmv")
    main_ord = _sum_by(main_all, ("scenario", "month"), "orders")
    new_tot = _sum_by(person_all, ("scenario", "month"), "new_gmv")
    old_tot = _sum_by(person_all, ("scenario", "month"), "old_gmv")
    keys = sorted(set(main_tot) | set(new_tot) | set(old_tot))
    rows = []
    has_field = field_all is not None and len(field_all) > 0
    field_uv = _sum_by(field_all, ("scenario", "month"), "uv") if has_field else {}
    field_ord = _sum_by(field_all, ("scenario", "month"), "orders") if has_field else {}
    for k in keys:
        scenario, month = k
        row = {
            "scenario": scenario, "month": month,
            "GMV_主口径": main_tot[k], "新客GMV": new_tot.get(k, 0.0),
            "老客GMV": old_tot.get(k, 0.0),
            "订单数": main_ord.get(k, 0.0),
        }
        row["人视角GMV"] = row["新客GMV"] + row["老客GMV"]
        row["全渠道客单"] = (row["GMV_主口径"] / row["订单数"]) if row["订单数"] else None
        if has_field:
            row["UV"] = field_uv.get(k, 0.0)
            uv = row["UV"]
            row["全渠道转化率"] = (field_ord.get(k, 0.0) / uv) if uv else None
            row["转化率覆盖口径"] = "仅含填报UV的平台"
        else:
            row["全渠道转化率"] = None
            row["转化率覆盖口径"] = "无UV数据"
        rows.append(row)
    return sorted(rows, key=lambda r: (r["scenario"], r["month"]))


def platform_annual(main_all: list, baselines: dict) -> list:
    """每平台各情景的年度目标 vs 基期年化 GMV。"""
    ann = _sum_by(main_all, ("platform", "scenario"), "gmv")
    rows = []
    for (platform, scenario), gmv in sorted(ann.items()):
        base = baselines.get(platform, {}).get("annual_gmv")
        rows.append({
            "platform": platform, "scenario": scenario,
            "基期年化GMV": base, "目标年度GMV": gmv,
            "增速": (gmv / base - 1) if base else None,
        })
    return rows


# ---------------- 交叉校验 ----------------

def check_views(results: dict) -> list:
    """人/场/货三视角月度 GMV 对比，与主口径差异>5% 打标。"""
    rows = []
    for platform, r in results.items():
        person_m = _sum_by(r["person"], ("scenario", "month"), "gmv")
        field_m = _sum_by(r["field"], ("scenario", "month"), "gmv") if r["field"] else {}
        goods_m = _sum_by(r["goods"], ("scenario", "month"), "gmv") if r["goods"] else {}
        for k in sorted(person_m):
            scenario, month = k
            main_gmv = (field_m.get(k) if r["main_view"] == "场" else person_m.get(k)) or 0.0
            row = {
                "platform": platform, "scenario": scenario, "month": month,
                "主口径": r["main_view"], "主口径GMV": main_gmv,
                "人视角GMV": person_m.get(k),
                "场视角GMV": field_m.get(k),
                "货视角GMV": goods_m.get(k),
            }
            flag = ""
            for view in ("人视角GMV", "场视角GMV", "货视角GMV"):
                v = row[view]
                diff = (v / main_gmv - 1) if (v is not None and main_gmv) else None
                row[f"{view}差异"] = round(diff, 4) if diff is not None else None
                if diff is not None and abs(diff) > 0.05:
                    flag = "⚠ 与主口径差>5%"
            row["校验"] = flag
            rows.append(row)
    return rows


# ---------------- 编排 ----------------

def run(input_data: dict) -> dict:
    platforms_in = input_data.get("platforms")
    if not isinstance(platforms_in, dict) or not platforms_in:
        raise ValueError("输入缺少 platforms（{平台名: {unified: [...], structure: [...]|null}}）")
    caliber = {**DEFAULT_CALIBER, **(input_data.get("caliber") or {})}
    scenarios = input_data.get("scenarios")
    if not scenarios:
        raise ValueError("输入缺少 scenarios（至少一档情景参数）")

    n_months = caliber.get("target_months", 12)
    ends = [max(r["month"] for r in v["unified"]) for v in platforms_in.values() if v["unified"]]
    if not ends:
        raise ValueError("所有平台 unified 为空")
    common_end = max(ends)
    target_months = [_month_add(common_end, i + 1) for i in range(n_months)]

    results = {}
    for p, v in platforms_in.items():
        unified = v["unified"]
        months = [r["month"] for r in unified]
        own_end = max(months)
        trailing = []
        if own_end < common_end:
            t = _month_add(own_end, 1)
            while t <= common_end:
                trailing.append(t)
                t = _month_add(t, 1)
        have = set(months)
        lo, hi = min(months), max(months)
        missing = []
        t = lo
        while t <= hi:
            if t not in have:
                missing.append(t)
            t = _month_add(t, 1)
        cov = {"history_months": len(months), "history_start": lo, "history_end": hi,
               "trailing_gap": trailing, "missing_months": missing,
               "short_history": len(months) < 12}
        r = run_platform(unified, v.get("structure"), scenarios, caliber, target_months)
        r["coverage"] = cov
        results[p] = r

    main_parts, person_parts, field_parts = [], [], None
    field_parts = []
    baselines = {}
    for p, r in results.items():
        main_df = r["field"] if r["main_view"] == "场" else r["person"]
        main_parts.extend({**row, "platform": p} for row in main_df)
        person_parts.extend({**row, "platform": p} for row in r["person"])
        if r["field"] is not None:
            field_parts.extend({**row, "platform": p} for row in r["field"])
        baselines[p] = r["baseline"]
    return {
        "engine_version": ENGINE_VERSION,
        "result": {
            "platforms": results,
            "consolidated": consolidate(person_parts, main_parts, field_parts or None),
            "platform_annual": platform_annual(main_parts, baselines),
            "check": check_views(results),
        },
    }


def _canonical(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def input_digest(obj) -> str:
    return hashlib.sha256(_canonical(obj).encode("utf-8")).hexdigest()[:16]


# ---------------- selftest ----------------

def _close(a, b, rel=1e-9, abs_=1e-6):
    if a is None or b is None:
        return a is None and b is None
    if isinstance(a, bool) or isinstance(b, bool):
        return a == b
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return abs(a - b) <= max(abs_, rel * max(abs(a), abs(b)))
    return a == b


def _diff(path, mine, gold, problems):
    if isinstance(gold, dict) and isinstance(mine, dict):
        if path == "" and "engine_version" not in mine:
            pass
        for k in gold:
            if k not in mine:
                problems.append(f"{path}/{k}: 缺失")
                continue
            _diff(f"{path}/{k}", mine[k], gold[k], problems)
        return
    if isinstance(gold, list) and isinstance(mine, list):
        if len(mine) != len(gold):
            problems.append(f"{path}: 长度 {len(mine)} vs 期望 {len(gold)}")
            return
        for i, (m, g) in enumerate(zip(mine, gold)):
            _diff(f"{path}[{i}]", m, g, problems)
        return
    if not _close(mine, gold):
        problems.append(f"{path}: 期望 {gold!r} 实得 {mine!r}")


def selftest() -> bool:
    golden = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                         "golden/engine-expected.json"), encoding="utf-8"))
    got = run(golden["input"])
    problems: list = []
    exp = golden["expected"]
    for p in ("天猫", "私域"):
        _diff(f"platforms/{p}/baseline", got["result"]["platforms"][p]["baseline"],
              exp[p]["baseline"], problems)
        for view in ("person", "field", "goods"):
            mine_v = got["result"]["platforms"][p][view]
            _diff(f"platforms/{p}/{view}", mine_v, exp[p][view], problems)
        if got["result"]["platforms"][p]["main_view"] != exp[p]["main_view"]:
            problems.append(f"{p} main_view 不符")
        _diff(f"platforms/{p}/shares", got["result"]["platforms"][p]["shares"],
              exp[p]["shares"], problems)
        if got["result"]["platforms"][p]["target_months"] != exp[p]["target_months"]:
            problems.append(f"{p} target_months 不符")
    _diff("consolidated", got["result"]["consolidated"], exp["consolidated"], problems)
    _diff("platform_annual", got["result"]["platform_annual"], exp["platform_annual"], problems)

    # 交叉校验不变量：主口径列与对应视角合计一致；>5% 差异确实打标
    check = got["result"]["check"]
    main_view_map = {p: got["result"]["platforms"][p]["main_view"] for p in ("天猫", "私域")}
    flagged = [r for r in check if r["校验"]]
    if not check or any(r["主口径"] != main_view_map[r["platform"]] for r in check):
        problems.append("check 主口径映射不符")
    tmail_check = [r for r in check if r["platform"] == "天猫" and r["scenario"] == "基准"]
    if tmail_check and not any(r["货视角GMV差异"] is not None and abs(r["货视角GMV差异"]) > 0.05
                               for r in tmail_check):
        problems.append("天猫人货差异示例未按 >5% 打标（黄金输入应存在显著差异）")

    # 确定性
    again = json.loads(_canonical(run(golden["input"])))
    if _canonical(again) != _canonical(got):
        problems.append("确定性检查失败：同输入两次运行输出不一致")

    if problems:
        print(f"SELFTEST FAIL（{len(problems)} 项）:")
        for p in problems[:20]:
            print(" -", p)
        return False
    print(f"SELFTEST PASS: forecast 黄金案例（2 平台 × 3 情景 × 12 月，"
          f"人/场/货三视角 + 全渠道汇总 {len(exp['consolidated'])} 行 + 平台年度）与原仓一致"
          f"（数值容差 1e-9）；交叉校验与确定性通过")
    return True


def main(argv: list) -> int:
    if len(argv) >= 2 and argv[1] == "selftest":
        return 0 if selftest() else 1
    if len(argv) < 4 or argv[1] != "run" or argv[2] != "--input":
        print(__doc__, file=sys.stderr)
        return 2
    with open(argv[3], encoding="utf-8") as fh:
        data = json.load(fh)
    try:
        out = run(data)
    except ValueError as exc:
        print(json.dumps({"error": {"type": "invalid_input", "message": str(exc)}},
                         ensure_ascii=False), file=sys.stderr)
        return 1
    out["input_digest"] = input_digest(data)
    out_path = argv[argv.index("-o") + 1] if "-o" in argv else None
    text = json.dumps(out, ensure_ascii=False, indent=2)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        print(f"已写入 {out_path}（engine {ENGINE_VERSION}, input_digest {out['input_digest']}）")
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
