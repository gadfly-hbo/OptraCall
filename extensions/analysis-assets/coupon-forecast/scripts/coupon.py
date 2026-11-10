# -*- coding: utf-8 -*-
"""优惠券测算引擎（OptraCall 分析资产 · 纯 Python，无第三方依赖）。

四子模型（承接 target-forecast 原仓 coupon_tool 提案 §4 逐式实现）：
    ① 命中与核销   ② 凑单与流失   ③ 转化响应   ④ 统一收益账本
所有指标（转化率、订单、核销、补贴、贡献）出自同一组互斥分支；
分支概率合计=1、贡献拆解与 ΔΠ 对平是引擎不变量。
金额单位：分（float 参与期望计算，输出取整到 6 位小数）；概率：float。

用法：
    python3 coupon.py simulate --input scenario.json --threshold 15900 --face 500 [-o out.json]
    python3 coupon.py simulate --input scenario.json --no-coupon
    python3 coupon.py compare  --input scenario.json [-o out.json]
    python3 coupon.py stress   --input scenario.json --variants variants.json [-o out.json]
    python3 coupon.py template [-o scenario-template.json]
    python3 coupon.py selftest
"""
from __future__ import annotations

import copy
import hashlib
import json
import math
import sys
from dataclasses import dataclass, field, asdict

ENGINE_VERSION = "optracall-coupon-2"


class SpecError(ValueError):
    """场景不合法或无法安全测算。"""


def _int_cents(value, name):
    if isinstance(value, bool) or not isinstance(value, int):
        raise SpecError(f"{name} 必须是整数分（int），得到 {value!r}")
    if abs(value) > sys.float_info.max:
        raise SpecError(f"{name} 超出可计算范围（约 1.8e308 分）")
    return value


def _prob(value, name, errors):
    if not (isinstance(value, (int, float)) and 0.0 <= value <= 1.0):
        errors.append(f"{name} 必须是 [0,1] 内的概率，得到 {value!r}")
    return value


# ---------------- 场景模型 ----------------

@dataclass
class Basket:
    """基准成交篮子类型：券前金额、条件权重、可选覆盖毛利率。"""
    amount_cents: int
    weight: float
    margin_rate: float | None = None
    label: str = ""
    topup_amount_cents: int | None = None
    bucket_min_cents: int | None = None
    bucket_max_cents: int | None = None

    def __post_init__(self):
        self.amount_cents = _int_cents(self.amount_cents, "篮子金额")
        if self.topup_amount_cents is not None:
            self.topup_amount_cents = _int_cents(self.topup_amount_cents, "加购后金额")


@dataclass
class Baseline:
    visitors: int | None
    conversion_rate: float
    baskets: list
    data_snapshot_id: str | None = None


@dataclass
class CostProfile:
    margin_base_rate: float
    margin_addon_rate: float | None
    merchant_share_rho: float = 1.0
    fixed_fee_cents: float = 0.0
    fee_rate: float = 0.0
    fee_basis: str = "customer_paid"
    return_adj_cents: float = 0.0
    fixed_activity_cost_cents: float = 0.0
    margin_includes_fulfillment: bool = False


@dataclass
class Behavior:
    reach_base: float | list = 1.0
    reach_new: float = 1.0
    redeem_natural: float | list = 0.8
    redeem_topup: float | list = 1.0
    churn: float | list = 0.0
    q_mode: str = "curve"
    q_curve: dict = field(default_factory=lambda: {"q_cap": 0.8, "lam": 2.2, "d_ref": 0.1})
    q_table: list = field(default_factory=list)
    conversion: dict = field(default_factory=lambda: {"mode": "relative", "k": 0.9, "s_max": 0.5})
    new_basket: list = field(default_factory=list)
    topup_amount_mode: str = "at_threshold"


@dataclass
class Constraints:
    merchant_coupon_budget_cents: float | None = None
    min_incremental_contribution_cents: float = 0.0
    allow_controlled_loss: bool = False
    max_loss_cents: float | None = None
    min_conversion_rate: float | None = None
    min_delta_c: float | None = None
    min_gmv_pre_cents: float | None = None
    min_avg_contribution_cents: float | None = None
    max_ft_ratio: float | None = None


@dataclass
class ScenarioSpec:
    schema_version: str
    scenario_id: str
    currency: str = "CNY"
    observation_unit: str = "unique_visitor_first_paid_order"
    window: dict = field(default_factory=dict)
    baseline: Baseline | None = None
    candidates: list = field(default_factory=list)
    cost: CostProfile | None = None
    behavior: Behavior | None = None
    constraints: Constraints = field(default_factory=Constraints)
    objective: str = "incremental_contribution"
    objective_params: dict = field(default_factory=dict)
    evidence_status: str = "synthetic_assumptions"
    parameter_sources: dict = field(default_factory=dict)

    def to_dict(self) -> dict:
        return asdict(self)


# ---------------- 载入与校验 ----------------

def _check_semantics(spec: ScenarioSpec) -> list:
    errors: list = []
    b = spec.baseline
    if b is None:
        return ["缺少 baseline"]
    wsum = math.fsum(bk.weight for bk in b.baskets)
    if abs(wsum - 1.0) > 1e-9:
        errors.append(f"基准篮子权重合计必须为 1，实际 {wsum:.6f}")
    for i, bk in enumerate(b.baskets):
        if bk.weight < 0:
            errors.append(f"篮子[{i}]权重为负")
        if bk.amount_cents <= 0:
            errors.append(f"篮子[{i}]金额必须 > 0")
        if bk.margin_rate is not None and not 0.0 <= bk.margin_rate <= 1.0:
            errors.append(f"篮子[{i}]毛利率必须在 [0,1]")
    _prob(b.conversion_rate, "基准转化率 C₀", errors)
    if not (0.0 <= b.conversion_rate < 1.0):
        errors.append("C₀ 必须在 [0,1)（C₀=1 时无新增空间）")
    if b.visitors is not None and b.visitors <= 0:
        errors.append("N 必须为正整数（缺 N 请置 None 走每单位口径）")
    if not b.baskets:
        errors.append("基准篮子分布为空")
    return errors


def _check_cost(spec: ScenarioSpec) -> list:
    errors: list = []
    c = spec.cost
    if c is None:
        return ["缺少 cost"]
    if not 0.0 <= c.margin_base_rate <= 1.0:
        errors.append("原篮子毛利率必须在 [0,1]")
    if c.margin_addon_rate is not None and not 0.0 <= c.margin_addon_rate <= 1.0:
        errors.append("加购毛利率必须在 [0,1]")
    _prob(c.merchant_share_rho, "商家承担比例 ρ", errors)
    if c.fee_basis not in ("customer_paid", "pre_coupon"):
        errors.append(f"不支持的收费基数 {c.fee_basis!r}")
    if c.fixed_fee_cents < 0 or c.fee_rate < 0 or c.return_adj_cents < 0:
        errors.append("费用/退货调整为负")
    if c.margin_includes_fulfillment and (c.fixed_fee_cents > 0 or c.fee_rate > 0):
        errors.append("成本重复扣减：毛利率已包含履约成本，又填写了履约费（先明确口径再测算）")
    return errors


def _per_basket_ok(values, n) -> bool:
    if isinstance(values, list):
        return len(values) == n and all(isinstance(v, (int, float)) for v in values)
    return isinstance(values, (int, float))


def _check_reach_and_churn(h, n: int, errors: list) -> None:
    for name in ("reach_base", "redeem_natural", "redeem_topup", "churn"):
        values = getattr(h, name)
        if not _per_basket_ok(values, n):
            errors.append(f"{name} 必须是标量或与篮子数等长的列表")
        else:
            vals = values if isinstance(values, list) else [values] * n
            for i, v in enumerate(vals):
                _prob(v, f"{name}[{i}]", errors)
    _prob(h.reach_new, "新增触达 e⁺", errors)


def _check_q(h, errors: list) -> None:
    if h.q_mode not in ("curve", "table", "zero"):
        errors.append(f"未知凑单模式 {h.q_mode!r}")
    if h.q_mode == "curve":
        qc = h.q_curve
        _prob(qc.get("q_cap", 0.8), "q_cap", errors)
        if qc.get("lam", 2.2) < 0:
            errors.append("λ 必须 ≥ 0")
        if qc.get("d_ref", 0.1) <= 0:
            errors.append("d_ref 必须 > 0")
    if h.q_mode == "table" and not h.q_table:
        errors.append("凑单参数表为空")
    if h.q_mode == "table":
        for i, row in enumerate(h.q_table):
            q = row.get("q")
            if not isinstance(q, (int, float)) or isinstance(q, bool) or not 0 <= q <= 1:
                errors.append(f"q_table[{i}].q 必须在 [0,1]")
            for field in ("gap_max", "ftr_max"):
                value = row.get(field)
                if value is not None and (not isinstance(value, (int, float))
                                          or not math.isfinite(value) or value < 0):
                    errors.append(f"q_table[{i}].{field} 必须为有限非负数或 null")


def _check_conversion(h, errors: list) -> None:
    conv = h.conversion
    if conv.get("mode") == "relative":
        if conv.get("k", 0.9) < 0:
            errors.append("k 必须 ≥ 0")
        if conv.get("s_max", 0.5) < 0:
            errors.append("s_max 必须 ≥ 0")
    elif conv.get("mode") == "absolute":
        dcp = conv.get("delta_c_plus")
        if not isinstance(dcp, (int, float)) or dcp < 0:
            errors.append("绝对 ΔC⁺ 必须为非负数")
    else:
        errors.append(f"未知转化响应模式 {conv.get('mode')!r}")


def _check_new_basket(h, errors: list) -> None:
    wsum = math.fsum(nb.get("weight", 0.0) for nb in h.new_basket)
    if h.new_basket and abs(wsum - 1.0) > 1e-9:
        errors.append(f"新增结果分布 vⱼ 权重合计必须为 1，实际 {wsum:.6f}")
    for j, nb in enumerate(h.new_basket):
        _prob(nb.get("weight"), f"新增结果[{j}].weight", errors)
        if nb.get("margin_rate") is not None:
            _prob(nb["margin_rate"], f"新增结果[{j}].margin_rate", errors)
        amt = nb.get("amount_cents", "at_threshold")
        if amt != "at_threshold" and (not isinstance(amt, int) or isinstance(amt, bool) or amt <= 0):
            errors.append(f"新增结果[{j}]金额必须是正整数分或 'at_threshold'")
        if nb.get("redeem") not in (0, 1):
            errors.append(f"新增结果[{j}]核销状态必须为 0/1")
    if not h.new_basket:
        errors.append("缺少新增结果分布 vⱼ")


def _check_behavior(spec: ScenarioSpec) -> list:
    errors: list = []
    h = spec.behavior
    if h is None:
        return ["缺少 behavior"]
    n = len(spec.baseline.baskets)
    _check_reach_and_churn(h, n, errors)
    _check_q(h, errors)
    _check_conversion(h, errors)
    _check_new_basket(h, errors)
    return errors


def validate_spec(spec: ScenarioSpec) -> dict:
    errors = _check_semantics(spec) + _check_cost(spec) + _check_behavior(spec)
    if spec.constraints.allow_controlled_loss and spec.constraints.max_loss_cents is None:
        errors.append("受控亏损必须显式设置最大损失额度（max_loss_cents），不得静默退化为底线 0")
    warnings: list = []
    if spec.cost is not None and spec.cost.margin_addon_rate is None:
        warnings.append("加购毛利率未显式设置，按原篮子毛利率计算（提案要求显式确认）")
    if spec.baseline is not None and spec.baseline.visitors is None:
        warnings.append("缺 N：结果为每观察单位口径，不输出活动总量")
    return {"errors": errors, "warnings": warnings}


def load_spec(data: dict, strict: bool = True) -> ScenarioSpec:
    try:
        base = data.get("baseline", {})
        baskets = [Basket(**bk) for bk in base.get("baskets", [])]
        baseline = Baseline(
            visitors=base.get("visitors"),
            conversion_rate=float(base.get("conversion_rate", 0.0)),
            baskets=baskets,
            data_snapshot_id=base.get("data_snapshot_id"),
        )
        cost_data = dict(data.get("cost", {}))
        cost = CostProfile(margin_base_rate=float(cost_data.pop("margin_base_rate", 0.0)),
                           margin_addon_rate=(float(cost_data["margin_addon_rate"])
                                              if cost_data.get("margin_addon_rate") is not None else None),
                           merchant_share_rho=float(cost_data.get("merchant_share_rho", 1.0)),
                           fixed_fee_cents=float(cost_data.get("fixed_fee_cents", 0.0)),
                           fee_rate=float(cost_data.get("fee_rate", 0.0)),
                           fee_basis=cost_data.get("fee_basis", "customer_paid"),
                           return_adj_cents=float(cost_data.get("return_adj_cents", 0.0)),
                           fixed_activity_cost_cents=float(cost_data.get("fixed_activity_cost_cents", 0.0)),
                           margin_includes_fulfillment=bool(cost_data.get("margin_includes_fulfillment", False)))
        h = dict(data.get("behavior", {}))
        behavior = Behavior(
            reach_base=h.get("reach_base", 1.0),
            reach_new=float(h.get("reach_new", 1.0)),
            redeem_natural=h.get("redeem_natural", 0.8),
            redeem_topup=h.get("redeem_topup", 1.0),
            churn=h.get("churn", 0.0),
            q_mode=h.get("q_mode", "curve"),
            q_curve=dict(h.get("q_curve", {})) or {"q_cap": 0.8, "lam": 2.2, "d_ref": 0.1},
            q_table=list(h.get("q_table", [])),
            conversion=dict(h.get("conversion", {})) or {"mode": "relative", "k": 0.9, "s_max": 0.5},
            new_basket=list(h.get("new_basket", [])),
            topup_amount_mode=h.get("topup_amount_mode", "at_threshold"),
        )
        cons = dict(data.get("constraints", {}))
        constraints = Constraints(
            merchant_coupon_budget_cents=cons.get("merchant_coupon_budget_cents"),
            min_incremental_contribution_cents=float(cons.get("min_incremental_contribution_cents", 0.0)),
            allow_controlled_loss=bool(cons.get("allow_controlled_loss", False)),
            max_loss_cents=cons.get("max_loss_cents"),
            min_conversion_rate=cons.get("min_conversion_rate"),
            min_delta_c=cons.get("min_delta_c"),
            min_gmv_pre_cents=cons.get("min_gmv_pre_cents"),
            min_avg_contribution_cents=cons.get("min_avg_contribution_cents"),
            max_ft_ratio=cons.get("max_ft_ratio"),
        )
        spec = ScenarioSpec(
            schema_version=str(data.get("schema_version", "2.0")),
            scenario_id=str(data.get("scenario_id", "unnamed")),
            currency=data.get("currency", "CNY"),
            observation_unit=data.get("observation_unit", "unique_visitor_first_paid_order"),
            window=dict(data.get("window", {})),
            baseline=baseline,
            candidates=list(data.get("candidates", [])),
            cost=cost,
            behavior=behavior,
            constraints=constraints,
            objective=data.get("objective", "incremental_contribution"),
            objective_params=dict(data.get("objective_params", {})),
            evidence_status=data.get("evidence_status", "synthetic_assumptions"),
            parameter_sources=dict(data.get("parameter_sources", {})),
        )
    except SpecError:
        raise
    except (TypeError, KeyError, ValueError, OverflowError) as exc:
        raise SpecError(f"场景结构不合法：{exc}") from exc

    if strict:
        result = validate_spec(spec)
        if result["errors"]:
            raise SpecError("；".join(result["errors"]))
    return spec


# ---------------- L2 引擎 ----------------

def _per_basket(value, i, n):
    if isinstance(value, list):
        if len(value) != n:
            raise SpecError("逐篮子参数长度与篮子数不一致")
        return float(value[i])
    return float(value)


def _q_i(spec: ScenarioSpec, amount_cents: int, t: int, f: int) -> float:
    h = spec.behavior
    if h.q_mode == "zero":
        return 0.0
    if h.q_mode == "table":
        g = (t - amount_cents) / amount_cents
        ftr = f / t
        for row in h.q_table:
            gap_ok = row.get("gap_max") is None or g <= row["gap_max"]
            ftr_ok = row.get("ftr_max") is None or ftr <= row["ftr_max"]
            if gap_ok and ftr_ok:
                return float(row["q"])
        return 0.0
    qc = h.q_curve
    g = (t - amount_cents) / amount_cents
    return float(qc["q_cap"]) * math.exp(-float(qc["lam"]) * g) * min(1.0, (f / t) / float(qc["d_ref"]))


def _variable_fee(spec: ScenarioSpec, amount: float, u: int, f: int) -> float:
    c = spec.cost
    base = (amount - u * f) if c.fee_basis == "customer_paid" else amount
    return c.fixed_fee_cents + c.fee_rate * base


def _row(group, branch, basket, prob, orders, amount, u, f, spec, margin_rate, m_addon, base_amount,
         basket_index=None):
    """构造一条成交分支账本行；contribution = G − 商家券补 − V − H。"""
    c = spec.cost
    if group == "loss":
        gross = merchant = platform = v_fee = h_adj = contrib = 0.0
    else:
        addon = max(0.0, amount - base_amount) if group != "new" else 0.0
        if group == "new":
            gross = amount * margin_rate
        else:
            gross = base_amount * margin_rate + addon * m_addon
        merchant = u * c.merchant_share_rho * f
        platform = u * (1.0 - c.merchant_share_rho) * f
        v_fee = _variable_fee(spec, amount, u, f)
        h_adj = c.return_adj_cents
        contrib = gross - merchant - v_fee - h_adj
    return {
        "group": group, "branch": branch, "basket": basket, "basket_index": basket_index,
        "probability": prob, "expected_orders": orders,
        "amount_cents": round(amount, 6), "customer_paid_cents": round(amount - u * f, 6),
        "redeemed": u,
        "merchant_subsidy_cents": round(merchant * orders, 6),
        "platform_subsidy_cents": round(platform * orders, 6),
        "gross_margin_cents": round(gross * orders, 6),
        "variable_fee_cents": round(v_fee * orders, 6),
        "return_adj_cents": round(h_adj * orders, 6),
        "contribution_cents": round(contrib * orders, 6),
        "_pi_single": contrib,
    }


def _baseline_basket_rows(spec: ScenarioSpec) -> list:
    c = spec.cost
    rows = []
    for i, bk in enumerate(spec.baseline.baskets):
        m_i = bk.margin_rate if bk.margin_rate is not None else c.margin_base_rate
        rows.append(_row("base", "无券基准原样购买", bk.label or f"A={bk.amount_cents}",
                         1.0, 1.0, float(bk.amount_cents), 0, 0, spec, m_i, 0.0, float(bk.amount_cents),
                         basket_index=i))
    return rows


def _validate_candidate(candidate: dict):
    if not isinstance(candidate, dict):
        raise SpecError("candidate 必须是 dict")
    enabled = bool(candidate.get("enabled"))
    t = candidate.get("threshold_cents")
    f = candidate.get("face_value_cents", 0) or 0
    if enabled:
        if isinstance(t, bool) or not isinstance(t, int):
            raise SpecError("门槛必须是整数分")
        if isinstance(f, bool) or not isinstance(f, int):
            raise SpecError("面额必须是整数分")
        if abs(t) > sys.float_info.max:
            raise SpecError("门槛超出可计算范围（约 1.8e308 分）")
        if abs(f) > sys.float_info.max:
            raise SpecError("面额超出可计算范围（约 1.8e308 分）")
        if f <= 0:
            raise SpecError("有效券要求 0 < F（面额必须为正整数分）")
        if f >= t:
            raise SpecError(f"有效券要求 0 < F < T（当前 F={f}, T={t}）")
    return enabled, t, f


def _basket_branches(spec: ScenarioSpec, bk, i: int, t, f, limitations: list):
    """子模型①②：自然命中三分支 / 凑单流失五分支 + 桶穿 limitation。"""
    h = spec.behavior
    n_baskets = len(spec.baseline.baskets)
    a = float(bk.amount_cents)
    e_i = _per_basket(h.reach_base, i, n_baskets)
    d_i = _per_basket(h.churn, i, n_baskets)
    topup_default_used = False

    if a >= t:
        r_i = _per_basket(h.redeem_natural, i, n_baskets)
        branches = [
            ("natural", "未触达·按原计划购买", 1.0 - e_i, a, 0),
            ("natural", "已触达并核销", e_i * r_i, a, 1),
            ("natural", "已触达未核销·按原计划购买", e_i * (1.0 - r_i), a, 0),
        ]
        loss_i = 0.0
    else:
        q_i = _q_i(spec, bk.amount_cents, t, f)
        b_amt = float(bk.topup_amount_cents if bk.topup_amount_cents is not None else t)
        if b_amt < t:
            raise SpecError(f"加购后金额 Bᵢ({b_amt}) 不得低于门槛 T({t})")
        if bk.topup_amount_cents is None:
            topup_default_used = True
        rp_i = _per_basket(h.redeem_topup, i, n_baskets)
        branches = [
            ("keep", "未触达·原样购买", 1.0 - e_i, a, 0),
            ("topup", "加购达标并核销", e_i * q_i * rp_i, b_amt, 1),
            ("topup", "加购达标未核销", e_i * q_i * (1.0 - rp_i), b_amt, 0),
            ("keep", "未加购·仍原样购买", e_i * (1.0 - q_i) * (1.0 - d_i), a, 0),
            ("loss", "未加购·放弃原本购买", e_i * (1.0 - q_i) * d_i, 0.0, 0),
        ]
        loss_i = e_i * (1.0 - q_i) * d_i

    if (bk.bucket_min_cents is not None and bk.bucket_max_cents is not None
            and bk.bucket_min_cents < t <= bk.bucket_max_cents):
        limitations.append(
            f"门槛 {t / 100:.0f} 元穿过粗桶 [{bk.bucket_min_cents / 100:.0f},"
            f"{bk.bucket_max_cents / 100:.0f}]：桶内分布未知，结果基于桶均金额——请细分或提供上下界")
    return branches, loss_i, topup_default_used


def _conversion_response(spec: ScenarioSpec, t, f, c0: float, retention: float,
                         enabled: bool, limitations: list) -> float:
    h = spec.behavior
    conv = h.conversion
    if not enabled:
        return 0.0
    if conv.get("mode") == "absolute":
        d_c_plus = float(conv["delta_c_plus"])
        if d_c_plus > (1.0 - c0 * retention):
            limitations.append(f"绝对 ΔC⁺={d_c_plus:.4f} 超出可触达非购买者上限，模型与证据不相容")
    else:
        s_plus = min(float(conv.get("k", 0.9)) * (f / t), float(conv.get("s_max", 0.5)))
        e_new = float(h.reach_new)
        d_c_plus = min((1.0 - c0) * e_new, c0 * s_plus * e_new)
        if c0 == 0.0:
            limitations.append("C₀=0：相对响应曲线无法产生新增成交，如需新增请显式输入绝对 ΔC⁺")
    return d_c_plus


def _aggregate_ledger(ledger: list, n_visitors, c0: float, e_pi0: float, l_rate: float,
                      d_c_plus: float, k_cost: float) -> dict:
    def _sum(key):
        return math.fsum(r[key] for r in ledger)

    retention = 1.0 - l_rate
    orders = math.fsum(r["expected_orders"] for r in ledger if r["group"] != "loss")
    gmv_pre = math.fsum(r["expected_orders"] * r["amount_cents"] for r in ledger)
    gmv_paid = math.fsum(r["expected_orders"] * r["customer_paid_cents"] for r in ledger)
    merchant_sub = _sum("merchant_subsidy_cents")
    platform_sub = _sum("platform_subsidy_cents")
    pi_coupon = _sum("contribution_cents") - k_cost
    pi0_total = n_visitors * c0 * e_pi0
    delta_pi = pi_coupon - pi0_total
    conversion = c0 * retention + d_c_plus
    natural_red = math.fsum(r["expected_orders"] for r in ledger
                      if r["group"] == "natural" and r["redeemed"] == 1)
    topup_red = math.fsum(r["expected_orders"] for r in ledger
                    if r["group"] == "topup" and r["redeemed"] == 1)
    new_orders = math.fsum(r["expected_orders"] for r in ledger if r["group"] == "new")
    lost_orders = math.fsum(r["expected_orders"] for r in ledger if r["group"] == "loss")

    return {
        "conversion_rate": conversion,
        "delta_c": d_c_plus - c0 * l_rate,
        "churn_rate": c0 * l_rate,
        "retention": retention,
        "gross_new_rate": d_c_plus,
        "orders": orders,
        "orders_baseline": n_visitors * c0,
        "new_orders": new_orders,
        "lost_orders": lost_orders,
        "natural_redemptions": natural_red,
        "topup_redemptions": topup_red,
        "gmv_pre_cents": round(gmv_pre, 6),
        "gmv_paid_cents": round(gmv_paid, 6),
        "merchant_subsidy_cents": round(merchant_sub, 6),
        "platform_subsidy_cents": round(platform_sub, 6),
        "baseline_contribution_cents": round(pi0_total, 6),
        "total_contribution_cents": round(pi_coupon, 6),
        "incremental_contribution_cents": round(delta_pi, 6),
        "roi": None if round(merchant_sub, 6) == 0 else delta_pi / merchant_sub,
        "avg_contribution_cents": (round(pi_coupon / orders, 6) if orders > 0 else None),
    }


def _decompose(ledger: list, pi0_by_basket: list, k_cost: float) -> dict:
    def _delta_vs_pi0(group_filter, redeemed_only=None):
        total = 0.0
        for r in ledger:
            if r["group"] != group_filter:
                continue
            if redeemed_only is not None and r["redeemed"] != redeemed_only:
                continue
            idx = r.get("basket_index")
            pi0_ref = pi0_by_basket[idx] if idx is not None else 0.0
            if r["group"] == "loss":
                total += r["expected_orders"] * (0.0 - pi0_ref)
            else:
                total += r["expected_orders"] * (r["_pi_single"] - pi0_ref)
        return total

    return {
        "natural_redemption": _delta_vs_pi0("natural", 1),
        "topup": _delta_vs_pi0("topup"),
        "other_retained": _delta_vs_pi0("natural", 0) + _delta_vs_pi0("keep") + _delta_vs_pi0("base"),
        "lost_orders": _delta_vs_pi0("loss"),
        "new_orders": math.fsum(r["contribution_cents"] for r in ledger if r["group"] == "new"),
        "fixed_costs": -float(k_cost),
    }


def simulate(spec: ScenarioSpec, candidate: dict) -> dict:
    """对单个候选（含 enabled=false 无券候选）执行四子模型与统一账本。"""
    enabled, t, f = _validate_candidate(candidate)

    vres = validate_spec(spec)
    if vres["errors"]:
        raise SpecError("；".join(vres["errors"]))

    bl = spec.baseline
    h = spec.behavior
    c = spec.cost
    n_visitors = bl.visitors if bl.visitors is not None else 1
    c0 = bl.conversion_rate

    limitations: list = []
    if bl.visitors is None:
        limitations.append("缺 N：以下结果为每观察单位口径，不代表活动总量")

    base_rows = _baseline_basket_rows(spec)
    pi0_by_basket = [r["_pi_single"] for r in base_rows]

    ledger: list = []
    l_rate = 0.0
    e_pi0 = 0.0
    topup_at_threshold = False

    for i, bk in enumerate(bl.baskets):
        w = bk.weight
        m_i = bk.margin_rate if bk.margin_rate is not None else c.margin_base_rate
        m_addon = c.margin_addon_rate if c.margin_addon_rate is not None else m_i
        label = bk.label or f"A={bk.amount_cents}"
        a = float(bk.amount_cents)
        pi0 = pi0_by_basket[i]
        e_pi0 += w * pi0

        if not enabled:
            row = _row("base", "无券基准原样购买", label, 1.0, n_visitors * c0 * w, a, 0, 0,
                       spec, m_i, m_addon, a, basket_index=i)
            ledger.append(row)
            continue

        branches, loss_i, topup_default = _basket_branches(spec, bk, i, t, f, limitations)
        topup_at_threshold = topup_at_threshold or topup_default
        l_rate += w * loss_i
        for group, name, p, amt, u in branches:
            row = _row(group, name, label, p, n_visitors * c0 * w * p, amt, u, f, spec, m_i, m_addon, a,
                       basket_index=i)
            ledger.append(row)

    retention = 1.0 - l_rate
    conv = h.conversion
    d_c_plus = _conversion_response(spec, t, f, c0, retention, enabled, limitations)

    if d_c_plus > 0:
        if not h.new_basket:
            raise SpecError("ΔC⁺>0 但缺少新增结果分布 vⱼ")
        for nb in h.new_basket:
            m_j = nb.get("margin_rate", c.margin_base_rate)
            amt_j = t if nb.get("amount_cents", "at_threshold") == "at_threshold" else nb["amount_cents"]
            row = _row("new", f"新增·{nb.get('label', amt_j)}", "新增成交",
                       float(nb["weight"]), n_visitors * d_c_plus * float(nb["weight"]),
                       float(amt_j), int(nb["redeem"]), f, spec, m_j, 0.0,
                       float(amt_j), basket_index=None)
            ledger.append(row)

    k_cost = c.fixed_activity_cost_cents if enabled else 0.0
    metrics = _aggregate_ledger(ledger, n_visitors, c0, e_pi0, l_rate, d_c_plus, k_cost)

    if topup_at_threshold and enabled:
        limitations.append("加购金额按“恰好凑到门槛”(B=T)简化，非商品可凑性保证")
    if h.q_mode == "curve" and enabled:
        limitations.append("凑单概率使用演示情景曲线 q=q_cap·exp(−λg)·min(1,(F/T)/d_ref)，非行为定律，参数须可替换")
    if c.fixed_fee_cents == 0 and c.fee_rate == 0:
        limitations.append("可变费用未配置（按 0 计），履约/支付费用需另行确认")
    if c.return_adj_cents == 0:
        limitations.append("退货调整为 0 的情景估计，未含退货结算规则")
    if enabled and len(h.new_basket) == 1 and h.new_basket[0].get("amount_cents", "at_threshold") == "at_threshold":
        limitations.append("新增成交篮子为单一结果类型（金额=门槛）——演算简化，寻优需对新增篮子做压力检查")
    if conv.get("mode") == "relative" and enabled:
        limitations.append("新增篮子结构未随门槛调整（静态假设），跨候选比较时需显式说明")

    decomposition = _decompose(ledger, pi0_by_basket, k_cost)

    for r in ledger:
        r.pop("_pi_single", None)

    return {
        "candidate": dict(candidate),
        "metrics": metrics,
        "ledger": ledger,
        "validation": vres,
        "limitations": limitations,
        "decomposition": {k: round(v, 6) for k, v in decomposition.items()},
        "engine_version": ENGINE_VERSION,
    }


# ---------------- L3 决策层 ----------------

QUANTILES = (0.40, 0.50, 0.60, 0.70, 0.75)
FT_GRID = (0.03, 0.05, 0.08, 0.12, 0.15)


def _round_yuan_cents(ratio_cents: float) -> int:
    return int(ratio_cents / 100.0 + 0.5) * 100


def _weighted_quantile_amounts(spec: ScenarioSpec) -> list:
    baskets = sorted(spec.baseline.baskets, key=lambda b: b.amount_cents)
    out, cum = [], 0.0
    for q in QUANTILES:
        acc = 0.0
        for bk in baskets:
            acc += bk.weight
            if acc >= q - 1e-12:
                out.append(bk.amount_cents)
                break
        else:
            out.append(baskets[-1].amount_cents)
    return out


def generate_candidates(spec: ScenarioSpec) -> list:
    """分位数锚定 + F/T 档位生成候选，与人工候选合并去重，始终包含无券候选。"""
    manual = list(spec.candidates)
    generated: list = []
    if spec.baseline.baskets:
        max_amount = max(b.amount_cents for b in spec.baseline.baskets)
        for t in sorted(set(_weighted_quantile_amounts(spec))):
            for ratio in FT_GRID:
                f = _round_yuan_cents(t * ratio)
                if 0 < f < t:
                    generated.append({
                        "enabled": True, "threshold_cents": t, "face_value_cents": f,
                        "label": f"满{t // 100}减{f // 100}",
                        "extrapolated": t > max_amount,
                        "origin": "quantile",
                    })
    merged: dict = {}
    for cand in generated:
        key = (cand["threshold_cents"], cand["face_value_cents"])
        merged.setdefault(key, cand)
    for cand in manual:
        if not cand.get("enabled", True):
            merged[("none", 0)] = dict(cand)
            continue
        key = (cand["threshold_cents"], cand["face_value_cents"])
        if key in merged:
            kept = dict(cand)
            kept["extrapolated"] = merged[key].get("extrapolated", False)
            kept.setdefault("origin", "manual")
            merged[key] = kept
        else:
            entry = dict(cand)
            entry.setdefault("label", f"满{cand['threshold_cents'] // 100}减{cand['face_value_cents'] // 100}")
            entry["extrapolated"] = (cand["threshold_cents"]
                                     > max((b.amount_cents for b in spec.baseline.baskets), default=0))
            entry.setdefault("origin", "manual")
            merged[key] = entry
    if ("none", 0) not in merged:
        merged[("none", 0)] = {"enabled": False, "threshold_cents": None,
                               "face_value_cents": 0, "label": "无券", "origin": "baseline"}
    rows = list(merged.values())
    enabled = sorted([r for r in rows if r.get("enabled")],
                     key=lambda r: (r["threshold_cents"], r["face_value_cents"]))
    disabled = [r for r in rows if not r.get("enabled")]
    return disabled + enabled


def _check_constraints(spec: ScenarioSpec, cand: dict, metrics: dict) -> tuple:
    cons = spec.constraints
    violations = []
    controlled_loss = False
    if not cand.get("enabled"):
        floor = 0.0
    else:
        floor = cons.min_incremental_contribution_cents
        if cons.allow_controlled_loss:
            floor = -(cons.max_loss_cents or 0.0)
    delta_pi = metrics["incremental_contribution_cents"]
    if delta_pi < floor - 1e-6:
        violations.append({
            "constraint": "incremental_contribution",
            "message": f"增量贡献 {delta_pi / 100:.2f} 元低于底线 {floor / 100:.2f} 元",
        })
    elif cand.get("enabled") and delta_pi < 0:
        controlled_loss = True
    if (cons.merchant_coupon_budget_cents is not None
            and metrics["merchant_subsidy_cents"] > cons.merchant_coupon_budget_cents + 1e-6):
        violations.append({
            "constraint": "merchant_coupon_budget",
            "message": (f"商家券补 {metrics['merchant_subsidy_cents'] / 100:.2f} 元 "
                        f"超预算 {cons.merchant_coupon_budget_cents / 100:.2f} 元（预估过滤，非投放限额）"),
        })
    if cons.min_conversion_rate is not None and metrics["conversion_rate"] < cons.min_conversion_rate:
        violations.append({
            "constraint": "min_conversion_rate",
            "message": f"转化率 {metrics['conversion_rate']:.4%} 低于目标 {cons.min_conversion_rate:.4%}",
        })
    if cons.min_delta_c is not None and metrics["delta_c"] < cons.min_delta_c:
        violations.append({
            "constraint": "min_delta_c",
            "message": f"净转化变化 {metrics['delta_c']:.4%} 低于目标 {cons.min_delta_c:.4%}",
        })
    if (cons.min_gmv_pre_cents is not None
            and metrics["gmv_pre_cents"] < cons.min_gmv_pre_cents):
        violations.append({
            "constraint": "min_gmv_pre",
            "message": f"券前 GMV {metrics['gmv_pre_cents'] / 100:.2f} 元低于目标 "
                       f"{cons.min_gmv_pre_cents / 100:.2f} 元",
        })
    if (cons.min_avg_contribution_cents is not None and metrics["avg_contribution_cents"] is not None
            and metrics["avg_contribution_cents"] < cons.min_avg_contribution_cents):
        violations.append({
            "constraint": "min_avg_contribution",
            "message": f"单均贡献 {metrics['avg_contribution_cents'] / 100:.2f} 元低于底线 "
                       f"{cons.min_avg_contribution_cents / 100:.2f} 元",
        })
    if (cons.max_ft_ratio is not None and cand.get("enabled")
            and cand["face_value_cents"] / cand["threshold_cents"] > cons.max_ft_ratio):
        violations.append({
            "constraint": "max_ft_ratio",
            "message": (f"F/T={cand['face_value_cents'] / cand['threshold_cents']:.2%} "
                        f"超过业务折扣上限 {cons.max_ft_ratio:.2%}（业务规则，非套利证明）"),
        })
    return violations, controlled_loss


def _breakeven(spec: ScenarioSpec, cand: dict, row: dict) -> dict:
    """回本所需毛新增成交率及其预算复核（复用主循环测算结果）。"""
    n = spec.baseline.visitors if spec.baseline.visitors is not None else 1
    c0 = spec.baseline.conversion_rate
    h, c = spec.behavior, spec.cost
    t, f = cand["threshold_cents"], cand["face_value_cents"]

    def _pi_new(nb: dict) -> float:
        amt = t if nb.get("amount_cents", "at_threshold") == "at_threshold" else nb["amount_cents"]
        m_j = nb.get("margin_rate", c.margin_base_rate)
        paid = amt - int(nb["redeem"]) * f
        v_fee = c.fixed_fee_cents + (c.fee_rate * paid if c.fee_basis == "customer_paid" else c.fee_rate * amt)
        return amt * m_j - int(nb["redeem"]) * c.merchant_share_rho * f - v_fee - c.return_adj_cents

    pi_new_avg = math.fsum(float(nb["weight"]) * _pi_new(nb) for nb in h.new_basket)
    k = c.fixed_activity_cost_cents
    pi_base_after = row["metrics"]["total_contribution_cents"] - row["decomposition"]["new_orders"] + k
    pi0 = row["metrics"]["baseline_contribution_cents"]
    nonpositive = pi_new_avg <= 0
    if nonpositive:
        return {"pi_new_avg_cents": pi_new_avg, "nonpositive_pi_new": True,
                "note": "新增成交单均贡献非正，无法靠增加新增成交回本，需改变券或成本结构"}
    d_be = max(0.0, (pi0 + k - pi_base_after) / (n * pi_new_avg))
    retention = row["metrics"]["retention"]
    c_be = c0 * retention + d_be
    reachable_cap = (1.0 - c0) * float(h.reach_new)
    within = d_be <= reachable_cap + 1e-12

    data = spec.to_dict()
    data["behavior"]["conversion"] = {"mode": "absolute", "delta_c_plus": d_be}
    subsidy_at_be, budget_ok = None, True
    try:
        res_be = simulate(load_spec(data), cand)
        subsidy_at_be = res_be["metrics"]["merchant_subsidy_cents"]
        budget = spec.constraints.merchant_coupon_budget_cents
        if budget is not None and subsidy_at_be > budget:
            budget_ok = False
    except SpecError:
        budget_ok = False
    return {
        "pi_new_avg_cents": pi_new_avg,
        "nonpositive_pi_new": False,
        "d_c_plus_be": d_be,
        "c_be": c_be,
        "delta_c_be": c_be - c0,
        "reachable_cap": reachable_cap,
        "within_reachable_cap": within,
        "merchant_subsidy_at_be_cents": subsidy_at_be,
        "budget_ok_at_be": budget_ok,
        "note": None if within else "回本所需新增超过可触达非购买者上限：当前假设下不可回本",
    }


def _neighbors(rows: list) -> None:
    enabled_rows = [r for r in rows if r["candidate"].get("enabled") and r.get("metrics")]
    for row in enabled_rows:
        cand = row["candidate"]
        t, f = cand["threshold_cents"], cand["face_value_cents"]
        same_f = [r for r in enabled_rows if r is not row
                  and r["candidate"]["face_value_cents"] == f]
        same_t = [r for r in enabled_rows if r is not row
                  and r["candidate"]["threshold_cents"] == t]
        picked = []
        below = sorted((r for r in same_f if r["candidate"]["threshold_cents"] < t),
                       key=lambda r: -r["candidate"]["threshold_cents"])
        above = sorted((r for r in same_f if r["candidate"]["threshold_cents"] > t),
                       key=lambda r: r["candidate"]["threshold_cents"])
        less = sorted((r for r in same_t if r["candidate"]["face_value_cents"] < f),
                      key=lambda r: -r["candidate"]["face_value_cents"])
        more = sorted((r for r in same_t if r["candidate"]["face_value_cents"] > f),
                      key=lambda r: r["candidate"]["face_value_cents"])
        for group in (below[:1], above[:1], less[:1], more[:1]):
            picked.extend(group)
        row["neighbors"] = [{
            "label": nb["label"],
            "threshold_cents": nb["candidate"]["threshold_cents"],
            "face_value_cents": nb["candidate"]["face_value_cents"],
            "feasible": nb["feasible"],
            "filtered_reason": "；".join(v["message"] for v in nb["violations"]) or None,
        } for nb in picked]


def _dominates(a: dict, b: dict) -> bool:
    da, db = a["metrics"], b["metrics"]
    return (da["incremental_contribution_cents"] >= db["incremental_contribution_cents"]
            and da["delta_c"] >= db["delta_c"]
            and (da["incremental_contribution_cents"] > db["incremental_contribution_cents"]
                 or da["delta_c"] > db["delta_c"]))


def compare(spec: ScenarioSpec, candidates: list | None = None) -> dict:
    """对候选集（缺省取 spec.candidates）执行同口径比较，输出排序、约束、结论与盈亏平衡。"""
    vres = validate_spec(spec)
    if vres["errors"]:
        raise SpecError("；".join(vres["errors"]))

    cand_list = candidates if candidates is not None else spec.candidates
    if not cand_list:
        cand_list = generate_candidates(spec)
    else:
        cand_list = list(cand_list)
        if not any(not candidate.get("enabled") for candidate in cand_list):
            cand_list.insert(0, {"enabled": False, "threshold_cents": None,
                                 "face_value_cents": 0, "label": "无券"})

    rows = []
    for cand in cand_list:
        cand = dict(cand)
        row = {
            "label": cand.get("label") or (
                "无券" if not cand.get("enabled")
                else f"满{cand['threshold_cents'] // 100}减{cand['face_value_cents'] // 100}"),
            "candidate": cand,
            "extrapolated": bool(cand.get("extrapolated", False)),
            "metrics": None, "violations": [], "feasible": False,
            "controlled_loss": False, "neighbors": [], "breakeven": None,
            "limitations": [],
        }
        try:
            res = simulate(spec, cand)
        except SpecError as exc:
            row["violations"].append({"constraint": "coupon_legality", "message": str(exc)})
            rows.append(row)
            continue
        row["metrics"] = res["metrics"]
        row["warnings"] = [lim for lim in res["limitations"] if "穿过粗桶" in lim]
        row["ledger"] = res["ledger"]
        row["decomposition"] = res["decomposition"]
        row["limitations"] = res["limitations"]
        violations, controlled = _check_constraints(spec, cand, res["metrics"])
        row["violations"] = violations
        row["controlled_loss"] = controlled
        row["feasible"] = not violations
        rows.append(row)

    valid_rows = [r for r in rows if r["metrics"] is not None]
    coupon_rows = [r for r in rows if r["candidate"].get("enabled")]
    if not valid_rows or (coupon_rows and all(r["metrics"] is None for r in coupon_rows)):
        return {"rows": rows, "ranking": [], "pareto": [], "objective": spec.objective,
                "conclusion": {"type": "invalid_comparison",
                                "message": "所有优惠券候选均不合法，保留无券基线，请先修复输入再比较",
                                "evidence_status": spec.evidence_status}}

    feasible = [r for r in valid_rows if r["feasible"]]
    for row in feasible:
        if row["candidate"].get("enabled"):
            row["breakeven"] = _breakeven(spec, row["candidate"], row)
    _neighbors(rows)

    objective = spec.objective or "incremental_contribution"
    if objective == "conversion":
        ranking = sorted(feasible, key=lambda r: (-r["metrics"]["conversion_rate"],
                                                  -r["metrics"]["incremental_contribution_cents"]))
    elif objective == "balanced":
        params = spec.objective_params or {}
        w_profit = float(params.get("w_profit", 0.5))
        w_conv = float(params.get("w_conversion", 0.5))
        if "profit_scale" not in params or "conversion_scale" not in params:
            raise SpecError("均衡模式必须在 objective_params 显式提供 profit_scale（分）"
                            "与 conversion_scale，不得从候选集自动推导")
        profit_scale = float(params["profit_scale"])
        conv_scale = float(params["conversion_scale"])
        if profit_scale <= 0 or conv_scale <= 0:
            raise SpecError("均衡模式尺度必须为正数")
        for r in feasible:
            r["score"] = (w_profit * r["metrics"]["incremental_contribution_cents"] / profit_scale
                          + w_conv * r["metrics"]["delta_c"] / conv_scale)
        ranking = sorted(feasible, key=lambda r: -r["score"])
    else:
        ranking = sorted(feasible, key=lambda r: -r["metrics"]["incremental_contribution_cents"])

    pareto = [r for r in feasible
              if not any(_dominates(o, r) for o in feasible if o is not r)]

    enabled_feasible = [r for r in feasible if r["candidate"].get("enabled")]
    no_coupon = next((r for r in valid_rows if not r["candidate"].get("enabled")), None)
    weak_evidence = spec.evidence_status in ("synthetic_assumptions", "historical_descriptive", "business_input")
    if not enabled_feasible:
        if no_coupon is not None and no_coupon["feasible"]:
            conclusion = {"type": "no_feasible_coupon",
                          "message": "建议不发券：当前候选与约束下没有满足约束的券方案（无券候选可行）",
                          "evidence_status": spec.evidence_status}
        else:
            conclusion = {"type": "no_feasible_coupon",
                          "message": "当前候选与约束下无可行解：券方案不满足约束，且无券基准也不满足业务目标",
                          "evidence_status": spec.evidence_status}
    elif weak_evidence:
        conclusion = {"type": "needs_validation",
                      "message": "存在潜在可行方案，但关键行为参数缺少适用证据（证据状态："
                                 f"{spec.evidence_status}），建议小范围验证后再放量",
                      "evidence_status": spec.evidence_status}
    else:
        conclusion = {"type": "feasible",
                      "message": "当前候选集合、模型结构、参数与约束下的条件性建议",
                      "evidence_status": spec.evidence_status}

    return {"rows": rows, "ranking": ranking, "pareto": pareto,
            "conclusion": conclusion, "objective": objective}


# ---------------- 敏感性与压力 ----------------

def _set_path(data: dict, path: str, value):
    keys = path.split(".")
    node = data
    for k in keys[:-1]:
        node = node[k]
    node[keys[-1]] = value


def _variant_spec(spec: ScenarioSpec, changes: dict) -> ScenarioSpec:
    data = copy.deepcopy(spec.to_dict())
    for path, value in changes.items():
        _set_path(data, path, value)
    return load_spec(data)


def stress_test(spec: ScenarioSpec, variants: dict) -> dict:
    """对显式变体逐情景重跑 compare；变体不修改原 spec。"""
    if not variants:
        raise ValueError("无情景变体：敏感性范围必须由用户显式指定（不内置 ±20%）")

    base = compare(spec)
    base_order = [r["label"] for r in base["ranking"]]
    selected = base["ranking"][0]["label"] if base["ranking"] else None
    baseline = {
        "selected_label": selected,
        "top_label": base["ranking"][0]["label"] if base["ranking"] else None,
        "delta_pi_cents": {r["label"]: r["metrics"]["incremental_contribution_cents"]
                           for r in base["rows"] if r["metrics"]},
        "conclusion": base["conclusion"],
    }

    scenarios = []
    for name, changes in sorted(variants.items()):
        spec_v = _variant_spec(spec, changes)
        budget_v = spec_v.constraints.merchant_coupon_budget_cents
        cmp_v = compare(spec_v)
        order = [r["label"] for r in cmp_v["ranking"]]
        rows = []
        for r in cmp_v["rows"]:
            if r["metrics"] is None:
                continue
            rows.append({
                "label": r["label"],
                "delta_pi_cents": r["metrics"]["incremental_contribution_cents"],
                "merchant_subsidy_cents": r["metrics"]["merchant_subsidy_cents"],
                "budget_exceeded": (budget_v is not None
                                    and r["metrics"]["merchant_subsidy_cents"] > budget_v),
                "feasible": r["feasible"],
                "conversion_rate": r["metrics"]["conversion_rate"],
            })
        selected_row = next((r for r in rows if r["label"] == selected), None)
        scenarios.append({
            "name": name,
            "changes": changes,
            "rows": rows,
            "ranking_changed": order != base_order,
            "top_label": order[0] if order else None,
            "selected_still_feasible": bool(selected_row and selected_row["feasible"]),
        })

    by_param: dict = {}
    for sc in scenarios:
        if len(sc["changes"]) != 1:
            continue  # Joint scenarios cannot identify a single parameter's effect.
        param = next(iter(sc["changes"]))
        row = next((r for r in sc["rows"] if r["label"] == selected), None) if selected else None
        if row:
            by_param.setdefault(param, []).append(row["delta_pi_cents"])
    if selected and selected in baseline["delta_pi_cents"]:
        for param, vals in list(by_param.items()):
            vals.append(baseline["delta_pi_cents"][selected])
    single_factor = [
        {"param": param, "delta_pi_values_cents": vals,
         "delta_pi_spread_cents": max(vals) - min(vals)}
        for param, vals in by_param.items()
    ]
    sensitive_params = sorted(single_factor, key=lambda p: -p["delta_pi_spread_cents"])

    return {"baseline": baseline, "scenarios": scenarios,
            "single_factor": single_factor, "sensitive_params": sensitive_params}


# ---------------- 身份与输出 ----------------

def _canonical(obj) -> str:
    return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def input_digest(obj) -> str:
    return hashlib.sha256(_canonical(obj).encode("utf-8")).hexdigest()[:16]


def _public_simulate_result(res: dict, with_ledger: bool) -> dict:
    out = {k: res[k] for k in ("candidate", "metrics", "limitations", "decomposition",
                               "engine_version")}
    if with_ledger:
        out["ledger"] = res["ledger"]
    return out


# ---------------- CLI ----------------

SCENARIO_TEMPLATE = {
    "_说明": "金额一律整数分；概率/比率为 0-1 小数；生成候选可省（compare 会按分位数锚定自动生成并始终含无券候选）",
    "schema_version": "2.0",
    "scenario_id": "scenario-example-001",
    "window": {"type": "fixed_activity_window", "days": 7},
    "baseline": {
        "visitors": 100000,
        "conversion_rate": 0.08,
        "baskets": [
            {"amount_cents": 6000, "weight": 0.20, "label": "A=60"},
            {"amount_cents": 9000, "weight": 0.20, "label": "A=90"},
            {"amount_cents": 11000, "weight": 0.30, "label": "A=110"},
            {"amount_cents": 14000, "weight": 0.20, "label": "A=140"},
            {"amount_cents": 19000, "weight": 0.10, "label": "A=190"},
        ],
    },
    "candidates": [
        {"enabled": False, "threshold_cents": None, "face_value_cents": 0, "label": "无券"},
        {"enabled": True, "threshold_cents": 15900, "face_value_cents": 500, "label": "满159减5"},
    ],
    "cost": {
        "margin_base_rate": 0.30, "margin_addon_rate": 0.30, "merchant_share_rho": 1.0,
        "fixed_fee_cents": 0.0, "fee_rate": 0.0, "fee_basis": "customer_paid",
        "return_adj_cents": 0.0, "fixed_activity_cost_cents": 0.0,
    },
    "behavior": {
        "reach_base": 1.0, "reach_new": 1.0, "redeem_natural": 0.80, "redeem_topup": 1.0,
        "churn": 0.02, "q_mode": "curve",
        "q_curve": {"q_cap": 0.8, "lam": 2.2, "d_ref": 0.1},
        "conversion": {"mode": "relative", "k": 0.9, "s_max": 0.5},
        "new_basket": [{"label": "新增成交", "weight": 1.0, "amount_cents": "at_threshold",
                        "margin_rate": 0.30, "redeem": 1}],
    },
    "constraints": {
        "merchant_coupon_budget_cents": None,
        "min_incremental_contribution_cents": 0.0,
    },
    "evidence_status": "synthetic_assumptions",
    "_注意": "以上数值为合成示例，非行业真值；behavior 参数必须有可说明依据并可用 stress 检验",
}


def _load_json(path: str) -> dict:
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def _emit(obj, out_path):
    text = json.dumps(obj, ensure_ascii=False, indent=2, sort_keys=True, allow_nan=False)
    if out_path:
        with open(out_path, "w", encoding="utf-8") as fh:
            fh.write(text + "\n")
        digest = obj.get("input_digest", "")
        print(f"已写入 {out_path}（engine {obj.get('engine_version', '')}"
              f"{', input_digest ' + digest if digest else ''}）")
    else:
        print(text)


def _golden_path() -> str:
    return __file__.rsplit("/", 1)[0] + "/golden/coupon-expected.json"


def selftest() -> bool:
    golden = _load_json(_golden_path())
    spec = load_spec(golden["input_spec"])
    problems = []

    for i, g in enumerate(golden["rows"]):
        res = simulate(spec, g["candidate"])
        for basket_index in range(len(spec.baseline.baskets)):
            branches = [row for row in res["ledger"]
                        if row["basket_index"] == basket_index and row["group"] != "new"]
            probabilities = [row["probability"] for row in branches]
            if (any(not 0 <= value <= 1 for value in probabilities)
                    or abs(math.fsum(probabilities) - 1) > 1e-12):
                problems.append(f"row[{i}] 篮子[{basket_index}] 互斥分支概率不合法")
        if g["candidate"].get("enabled"):
            budget_spec = copy.deepcopy(spec)
            budget_spec.constraints.merchant_coupon_budget_cents = 0
            budget_result = simulate(budget_spec, g["candidate"])
            if budget_result["metrics"] != res["metrics"]:
                problems.append(f"row[{i}] 预算约束截断了原始测算")
            violations, _ = _check_constraints(budget_spec, g["candidate"], budget_result["metrics"])
            if res["metrics"]["merchant_subsidy_cents"] > 0 and not any(
                    violation["constraint"] == "merchant_coupon_budget" for violation in violations):
                problems.append(f"row[{i}] 超预算未过滤")
        for k in ("metrics", "decomposition", "limitations"):
            if res[k] != g[k]:
                problems.append(f"row[{i}] {g['candidate'].get('label')}/{k}: 期望 {g[k]!r} 实得 {res[k]!r}")
        dec_sum = math.fsum(res["decomposition"].values())
        if abs(dec_sum - res["metrics"]["incremental_contribution_cents"]) > 1e-3:
            problems.append(f"row[{i}] 拆解对平不变量失败: {dec_sum} vs "
                            f"{res['metrics']['incremental_contribution_cents']}")
        for row in golden["golden_table"]:
            label = row[0]
            if g["candidate"].get("label") == label and row[3] is not None:
                if abs(res["metrics"]["conversion_rate"] - row[3]) > 1e-6:
                    problems.append(f"{label} 转化率与黄金表不符")
                if abs(res["metrics"]["merchant_subsidy_cents"] - row[4] * 100) > 1.0:
                    problems.append(f"{label} 商家券补与黄金表不符（±1分）")
                if abs(res["metrics"]["total_contribution_cents"] - row[5] * 100) > 1.0:
                    problems.append(f"{label} 总贡献与黄金表不符（±1分）")
                if abs(res["metrics"]["incremental_contribution_cents"] - row[6] * 100) > 1.0:
                    problems.append(f"{label} ΔΠ 与黄金表不符（±1分）")

    cmp_res = compare(load_spec(golden["input_spec"]))
    g_cmp = golden["compare"]
    if [r["label"] for r in cmp_res["ranking"]] != g_cmp["ranking"]:
        problems.append(f"ranking: 期望 {g_cmp['ranking']!r} 实得 {[r['label'] for r in cmp_res['ranking']]!r}")
    if [r["label"] for r in cmp_res["pareto"]] != g_cmp["pareto"]:
        problems.append(f"pareto 不符")
    if cmp_res["conclusion"] != g_cmp["conclusion"]:
        problems.append(f"conclusion: 期望 {g_cmp['conclusion']!r} 实得 {cmp_res['conclusion']!r}")
    for gr in g_cmp["rows"]:
        mine = next((r for r in cmp_res["rows"] if r["label"] == gr["label"]), None)
        if mine is None:
            problems.append(f"compare 缺少行 {gr['label']}")
            continue
        if mine["metrics"] != gr["metrics"]:
            problems.append(f"compare/{gr['label']}/metrics 不符")
        if mine["violations"] != gr["violations"]:
            problems.append(f"compare/{gr['label']}/violations 不符")
        if mine["feasible"] != gr["feasible"] or mine["controlled_loss"] != gr["controlled_loss"]:
            problems.append(f"compare/{gr['label']}/feasible 不符")
        gb, mb = gr.get("breakeven"), mine.get("breakeven")
        if (gb is None) != (mb is None):
            problems.append(f"compare/{gr['label']}/breakeven 存在性不符")
        elif gb is not None:
            for k in ("d_c_plus_be", "c_be", "delta_c_be", "reachable_cap", "within_reachable_cap",
                      "budget_ok_at_be", "nonpositive_pi_new"):
                if mb.get(k) != gb.get(k):
                    problems.append(f"compare/{gr['label']}/breakeven/{k}: 期望 {gb.get(k)!r} 实得 {mb.get(k)!r}")

    sg = _load_json(__file__.rsplit("/", 1)[0] + "/golden/coupon-stress-expected.json")
    st = stress_test(load_spec(golden["input_spec"]), sg["input"]["variants"])
    se = sg["expected"]
    if st["baseline"]["selected_label"] != se["baseline"]["selected_label"]:
        problems.append("stress selected_label 不符")
    for gsc in se["scenarios"]:
        msc = next((s for s in st["scenarios"] if s["name"] == gsc["name"]), None)
        if msc is None:
            problems.append(f"stress 缺情景 {gsc['name']}")
            continue
        if msc["ranking_changed"] != gsc["ranking_changed"]:
            problems.append(f"stress/{gsc['name']}/ranking_changed 不符")
        if msc["top_label"] != gsc["top_label"]:
            problems.append(f"stress/{gsc['name']}/top_label 不符")
        if msc["selected_still_feasible"] != gsc["selected_still_feasible"]:
            problems.append(f"stress/{gsc['name']}/selected_still_feasible 不符")
        for grow in gsc["rows"]:
            mrow = next((r for r in msc["rows"] if r["label"] == grow["label"]), None)
            if mrow is None or abs(mrow["delta_pi_cents"] - grow["delta_pi_cents"]) > 1.0:
                problems.append(f"stress/{gsc['name']}/{grow['label']} ΔΠ 不符（±1分）")

    # 确定性：同输入重复运行逐字节一致
    again = json.loads(_canonical(simulate(load_spec(golden["input_spec"]),
                                           golden["rows"][3]["candidate"])))
    first = json.loads(_canonical(simulate(load_spec(golden["input_spec"]),
                                            golden["rows"][3]["candidate"])))
    if _canonical(again) != _canonical(first):
        problems.append("确定性检查失败：同输入两次运行输出不一致")

    if problems:
        print(f"SELFTEST FAIL（{len(problems)} 项）:")
        for p in problems[:20]:
            print(" -", p)
        return False
    n_rows = len(golden["rows"])
    print(f"SELFTEST PASS: coupon 黄金案例（{n_rows} 行黄金表 + 压力 4 情景）全部一致；"
          f"拆解对平与确定性不变量通过")
    return True


def main(argv: list) -> int:
    if len(argv) < 2:
        print(__doc__)
        return 2
    cmd, args = argv[1], argv[2:]
    try:
        if cmd == "simulate":
            if not args or args[0] != "--input":
                print("用法: coupon.py simulate --input scenario.json (--threshold T --face F | --no-coupon)"
                      " [--ledger] [-o out.json]", file=sys.stderr)
                return 2
            spec = load_spec(_load_json(args[1]))
            if "--no-coupon" in args:
                cand = {"enabled": False, "threshold_cents": None, "face_value_cents": 0, "label": "无券"}
            else:
                ti = args.index("--threshold") if "--threshold" in args else -1
                fi = args.index("--face") if "--face" in args else -1
                if ti < 0 or fi < 0:
                    print("需要 --threshold 与 --face（整数分），或 --no-coupon", file=sys.stderr)
                    return 2
                cand = {"enabled": True, "threshold_cents": int(args[ti + 1]),
                        "face_value_cents": int(args[fi + 1])}
            res = simulate(spec, cand)
            out = {"engine_version": ENGINE_VERSION,
                   "input_digest": input_digest({"scenario": spec.to_dict(), "candidate": cand}),
                   "result": _public_simulate_result(res, "--ledger" in args)}
            out_path = args[args.index("-o") + 1] if "-o" in args else None
            _emit(out, out_path)
            return 0
        if cmd == "compare":
            if not args or args[0] != "--input":
                print("用法: coupon.py compare --input scenario.json [-o out.json]", file=sys.stderr)
                return 2
            spec_data = _load_json(args[1])
            spec = load_spec(spec_data)
            res = compare(spec)
            rows_pub = [{k: r.get(k) for k in ("label", "candidate", "extrapolated", "metrics",
                                               "violations", "feasible", "controlled_loss",
                                               "breakeven", "neighbors", "warnings", "limitations",
                                               "decomposition")}
                        for r in res["rows"]]
            out = {"engine_version": ENGINE_VERSION,
                   "input_digest": input_digest(spec_data),
                   "result": {"rows": rows_pub,
                              "ranking": [r["label"] for r in res["ranking"]],
                              "pareto": [r["label"] for r in res["pareto"]],
                              "conclusion": res["conclusion"], "objective": res["objective"]}}
            out_path = args[args.index("-o") + 1] if "-o" in args else None
            _emit(out, out_path)
            return 0
        if cmd == "stress":
            if not args or args[0] != "--input" or "--variants" not in args:
                print("用法: coupon.py stress --input scenario.json --variants variants.json [-o out.json]",
                      file=sys.stderr)
                return 2
            spec = load_spec(_load_json(args[1]))
            variants = _load_json(args[args.index("--variants") + 1])
            res = stress_test(spec, variants)
            out = {"engine_version": ENGINE_VERSION,
                   "input_digest": input_digest({"scenario": spec.to_dict(), "variants": variants}),
                   "result": res}
            out_path = args[args.index("-o") + 1] if "-o" in args else None
            _emit(out, out_path)
            return 0
        if cmd == "template":
            out_path = args[args.index("-o") + 1] if "-o" in args else None
            _emit(SCENARIO_TEMPLATE, out_path)
            return 0
        if cmd in ("selftest", "--selftest"):
            return 0 if selftest() else 1
        print(f"未知命令 {cmd!r}；可用: simulate / compare / stress / template / selftest",
              file=sys.stderr)
        return 2
    except (SpecError, ValueError) as exc:
        print(json.dumps({"error": {"type": "invalid_input", "message": str(exc)}},
                         ensure_ascii=False), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
