# -*- coding: utf-8 -*-
"""投放 ROI 测算引擎（OptraCall 分析资产 · 纯 Python，无第三方依赖）。

链路（单计划）：
    点击   = 消耗 ÷ CPC
    订单   = 点击 × CVR
    GMV    = 订单 × 客单
    净毛利 = GMV × (1−退款率) × 毛利率 − 消耗
    ROI    = GMV ÷ 消耗
    盈亏平衡 CVR* = CPC ÷ (客单 × (1−退款率) × 毛利率)

情景对 CVR 与客单施加增速，其余参数平推。不合法输入抛 PlanError（消息带计划名与字段名）。
数学与校验语义承接 target-forecast 原仓 roi_tool（黄金案例对照），引擎身份独立递增。

用法：
    python3 roi.py run --input plans.json [-o out.json]
    python3 roi.py template [-o plans-template.json]
    python3 roi.py selftest
"""
from __future__ import annotations

import hashlib
import json
import sys

ENGINE_VERSION = "optracall-roi-1"

REQUIRED_FIELDS = ("name", "spend_cny", "cpc_cny", "cvr", "aov_cny", "gross_margin", "refund_rate")

DEFAULT_SCENARIOS = {
    "保守": {"cvr_growth": -0.2, "aov_growth": -0.2},
    "基准": {"cvr_growth": 0.0, "aov_growth": 0.0},
    "挑战": {"cvr_growth": 0.2, "aov_growth": 0.2},
}


class PlanError(ValueError):
    """计划参数不合法；消息携带计划名与字段名。"""


def validate_plan(plan: dict) -> None:
    name = plan.get("name", "未命名计划")
    for f in REQUIRED_FIELDS:
        if f not in plan or plan[f] in (None, ""):
            raise PlanError(f"{name}: 缺少字段 {f}")
    checks = [
        ("spend_cny", plan["spend_cny"] > 0, "消耗必须 > 0"),
        ("cpc_cny", plan["cpc_cny"] > 0, "CPC 必须 > 0"),
        ("cvr", 0 < plan["cvr"] < 1, "转化率必须在 (0, 1) 内"),
        ("aov_cny", plan["aov_cny"] > 0, "客单价必须 > 0"),
        ("gross_margin", 0 < plan["gross_margin"] < 1, "毛利率必须在 (0, 1) 内"),
        ("refund_rate", 0 <= plan["refund_rate"] < 1, "退款率必须在 [0, 1) 内"),
    ]
    for field, ok, msg in checks:
        if not ok:
            raise PlanError(f"{name}: {field} {msg}（当前值 {plan[field]}）")


def _eval_plan(plan: dict, cvr_growth: float, aov_growth: float) -> dict:
    cvr = plan["cvr"] * (1 + cvr_growth)
    aov = plan["aov_cny"] * (1 + aov_growth)
    spend, cpc = plan["spend_cny"], plan["cpc_cny"]
    keep = (1 - plan["refund_rate"]) * plan["gross_margin"]

    clicks = spend / cpc
    orders = clicks * cvr
    gmv = orders * aov
    net = gmv * keep - spend
    cvr_star = cpc / (aov * keep)
    return {
        "name": plan["name"],
        "spend": round(spend, 2),
        "clicks": round(clicks, 1),
        "orders": round(orders, 1),
        "cvr": round(cvr, 6),
        "aov": round(aov, 2),
        "gmv": round(gmv, 2),
        "net": round(net, 2),
        "roi": round(gmv / spend, 4),
        # 精度字段不舍入：舍入会破坏与精确分数的比对及盈亏平衡不变量
        "cvr_star": cvr_star,
        "gap": cvr_star - cvr,
        "below_breakeven": cvr < cvr_star,
        "verdict": "净贡献为正" if net > 0 else "净亏损",
    }


def evaluate(plans: list, scenarios: dict) -> dict:
    """测算：plans 全量校验后对每档情景求值，输出每计划明细 + 汇总 + 排名。"""
    if not plans:
        raise PlanError("至少需要 1 个投放计划")
    for p in plans:
        validate_plan(p)
    if not scenarios:
        raise PlanError("至少需要 1 档情景")

    out = {"scenarios": {}}
    for sname, s in scenarios.items():
        cvr_growth = float(s.get("cvr_growth", 0.0))
        aov_growth = float(s.get("aov_growth", 0.0))
        evaluated = [_eval_plan(p, cvr_growth, aov_growth) for p in plans]
        totals = {
            "spend": round(sum(p["spend_cny"] for p in plans), 2),
            "gmv": round(sum(e["gmv"] for e in evaluated), 2),
            "net": round(sum(e["net"] for e in evaluated), 2),
        }
        out["scenarios"][sname] = {
            "growth": {"cvr_growth": cvr_growth, "aov_growth": aov_growth},
            "plans": evaluated,
            "totals": totals,
            "ranking": [e["name"] for e in sorted(evaluated, key=lambda e: e["net"], reverse=True)],
        }

    # 跨情景结论稳定性：某计划在各档下净贡献符号是否一致
    stability = {}
    for idx, p in enumerate(plans):
        nets = [out["scenarios"][sname]["plans"][idx]["net"] for sname in scenarios]
        stability[p["name"]] = {
            "verdicts": {sname: out["scenarios"][sname]["plans"][idx]["verdict"] for sname in scenarios},
            "stable": all(n > 0 for n in nets) or all(n <= 0 for n in nets),
        }
    out["stability"] = stability
    return out


# ---------------- 身份与输出 ----------------

def _canonical(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def input_digest(obj) -> str:
    return hashlib.sha256(_canonical(obj).encode("utf-8")).hexdigest()[:16]


def run(input_data: dict) -> dict:
    plans = input_data.get("plans")
    if not isinstance(plans, list):
        raise PlanError("输入缺少 plans 列表")
    scenarios = input_data.get("scenarios") or DEFAULT_SCENARIOS
    result = evaluate(plans, scenarios)
    return {
        "engine_version": ENGINE_VERSION,
        "input_digest": input_digest({"plans": plans, "scenarios": scenarios}),
        "result": result,
    }


# ---------------- CLI ----------------

TEMPLATE = {
    "plans": [
        {"name": "计划A-示例（合成假设，非行业真值）", "spend_cny": 30000, "cpc_cny": 2.5,
         "cvr": 0.06, "aov_cny": 260, "gross_margin": 0.45, "refund_rate": 0.12},
        {"name": "计划B-示例（合成假设，非行业真值）", "spend_cny": 80000, "cpc_cny": 1.2,
         "cvr": 0.022, "aov_cny": 180, "gross_margin": 0.35, "refund_rate": 0.25},
    ],
    "scenarios_note": "scenarios 可省略（默认 保守/基准/挑战 各 ±20% CVR/客单增速）；增速为对小数的比率，如 0.1 = +10%",
    "scenarios": {
        "保守": {"cvr_growth": -0.2, "aov_growth": -0.2},
        "基准": {"cvr_growth": 0.0, "aov_growth": 0.0},
        "挑战": {"cvr_growth": 0.2, "aov_growth": 0.2},
    },
}

# 黄金案例：原仓 roi_tool 合成演示计划集（GRILL G1），期望输出由原实现
# forecast-engine 之外独立计算固定（见 references/method.md 黄金案例说明）。
GOLDEN_INPUT = {
    "plans": [
        {"name": "天猫直通车-搜索", "spend_cny": 30000, "cpc_cny": 2.5, "cvr": 0.06,
         "aov_cny": 260, "gross_margin": 0.45, "refund_rate": 0.12},
        {"name": "抖音千川-信息流", "spend_cny": 80000, "cpc_cny": 1.2, "cvr": 0.022,
         "aov_cny": 180, "gross_margin": 0.35, "refund_rate": 0.25},
        {"name": "京东快车-站内", "spend_cny": 20000, "cpc_cny": 1.8, "cvr": 0.024,
         "aov_cny": 220, "gross_margin": 0.4, "refund_rate": 0.15},
        {"name": "小红书聚光-种草", "spend_cny": 15000, "cpc_cny": 2.0, "cvr": 0.009,
         "aov_cny": 450, "gross_margin": 0.5, "refund_rate": 0.08},
    ],
    "scenarios": {
        "保守": {"cvr_growth": -0.2, "aov_growth": -0.2},
        "基准": {"cvr_growth": 0.0, "aov_growth": 0.0},
        "挑战": {"cvr_growth": 0.2, "aov_growth": 0.2},
    },
}


def _load_golden_expected() -> dict:
    golden_path = __file__.rsplit("/", 1)[0] + "/golden/roi-expected.json"
    with open(golden_path, encoding="utf-8") as fh:
        return json.load(fh)


def selftest() -> bool:
    expected = _load_golden_expected()
    got = run(GOLDEN_INPUT)
    problems = []
    if got["result"] != expected:
        for sname, exp_scen in expected["scenarios"].items():
            got_scen = got["result"]["scenarios"].get(sname)
            if got_scen is None:
                problems.append(f"缺少情景 {sname}")
                continue
            for i, (gp, ep) in enumerate(zip(got_scen["plans"], exp_scen["plans"])):
                for k in ep:
                    if gp.get(k) != ep[k]:
                        problems.append(f"{sname}/{ep['name']}/{k}: 期望 {ep[k]!r} 实得 {gp.get(k)!r}")
            for k in ("totals", "ranking"):
                if got_scen[k] != exp_scen[k]:
                    problems.append(f"{sname}/{k}: 期望 {exp_scen[k]!r} 实得 {got_scen[k]!r}")
        for name, exp_st in expected["stability"].items():
            got_st = got["result"]["stability"].get(name)
            if got_st != exp_st:
                problems.append(f"stability/{name}: 期望 {exp_st!r} 实得 {got_st!r}")
    # 确定性：同输入重复运行逐字节一致
    again = json.loads(_canonical(run(GOLDEN_INPUT)))
    if _canonical(again) != _canonical(got):
        problems.append("确定性检查失败：同输入两次运行输出不一致")
    if problems:
        print(f"SELFTEST FAIL（{len(problems)} 项）:")
        for p in problems[:20]:
            print(" -", p)
        return False
    print(f"SELFTEST PASS: roi 黄金案例（{len(GOLDEN_INPUT['plans'])} 计划 × 3 情景）全部一致；输出确定性通过")
    return True


def main(argv: list) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd, args = argv[1], argv[2:]
    try:
        if cmd == "run":
            if not args or args[0] != "--input" or len(args) < 2:
                print("用法: roi.py run --input plans.json [-o out.json]", file=sys.stderr)
                return 2
            with open(args[1], encoding="utf-8") as fh:
                data = json.load(fh)
            out = run(data)
            out_path = args[3] if len(args) >= 4 and args[2] == "-o" else None
            text = json.dumps(out, ensure_ascii=False, indent=2)
            if out_path:
                with open(out_path, "w", encoding="utf-8") as fh:
                    fh.write(text + "\n")
                print(f"已写入 {out_path}（engine {ENGINE_VERSION}, input_digest {out['input_digest']}）")
            else:
                print(text)
            return 0
        if cmd == "template":
            out_path = args[1] if args and args[0] == "-o" and len(args) > 1 else None
            text = json.dumps(TEMPLATE, ensure_ascii=False, indent=2)
            if out_path:
                with open(out_path, "w", encoding="utf-8") as fh:
                    fh.write(text + "\n")
                print(f"模板已写入 {out_path}")
            else:
                print(text)
            return 0
        if cmd == "selftest":
            return 0 if selftest() else 1
        print(f"未知命令 {cmd!r}；可用: run / template / selftest", file=sys.stderr)
        return 2
    except (PlanError, ValueError) as exc:
        print(json.dumps({"error": {"type": "invalid_input", "message": str(exc)}},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
