# -*- coding: utf-8 -*-
"""目标测算输入模板生成（OptraCall 分析资产 · 依赖 openpyxl）。

产出三件：
    目标测算_订单明细模板.xlsx   模式A：日期/订单号/用户ID/商品ID/实付金额[必填]，品类/件数/原价金额[可选]
    目标测算_聚合指标模板.xlsx   模式B：月份/新客数/新客客单/老客数/老客复购频次/老客客单[必填]，UV 等[可选]
    target-input-template.json   测算参数模板（caliber 口径 + scenarios 情景）

用法：
    python3 template.py --out-dir <目录>     # 目录缺省当前目录
    python3 template.py selftest
"""
from __future__ import annotations

import json
import os
import sys

DETAIL_ROWS = [
    ["2025-01-10", "O0001", "U0001", "S001", "上衣", 1, 199.0, 199.0],
    ["2025-01-10", "O0001", "U0001", "S002", "裤装", 2, 158.0, 158.0],
    ["2025-01-20", "O0002", "U0002", "S001", "上衣", 1, 199.0, 199.0],
]
DETAIL_COLS = ["日期", "订单号", "用户ID", "商品ID", "品类", "件数", "实付金额", "原价金额"]
DETAIL_NOTES = [
    ("日期", "订单日期（YYYY-MM-DD）"),
    ("订单号", "一笔订单跨商品多行共用同一订单号"),
    ("用户ID", "买家标识（滚动新老客口径按此计算）"),
    ("商品ID", "商品/款标识（货维度结构与梯队按此聚合）"),
    ("品类", "可选，缺省记「未分类」"),
    ("件数", "可选，缺省 1"),
    ("实付金额", "必填。支付净额（已扣退款），非正金额行会被拒绝"),
    ("原价金额", "可选，不参与测算仅存档"),
]

AGG_ROWS = [
    ["2025-01", 100, 150.0, 300, 1.20, 200.0, 7800, None, None, None],
    ["2025-02", 110, 155.0, 310, 1.25, 205.0, 8100, None, None, None],
]
AGG_COLS = ["月份", "新客数", "新客客单", "老客数", "老客复购频次", "老客客单",
            "UV", "新客订单数", "转化率", "GMV"]
AGG_NOTES = [
    ("月份", "YYYY-MM（每平台每月一行，重复月份拒绝）"),
    ("新客数 / 新客客单", "必填。人公式：新客 GMV = 新客数 × 新客客单"),
    ("老客数 / 老客复购频次 / 老客客单", "必填。老客 GMV = 老客数 × 复购频次 × 客单"),
    ("UV", "可选。填报则该平台启用场视角（UV×转化×客单）并成为主口径"),
    ("新客订单数", "可选。缺省按新客数计"),
    ("转化率 / GMV", "可选。仅做一致性校验（差>10% / >5% 提示确认），不参与测算"),
]

PARAMS_TEMPLATE = {
    "_说明": "caliber=口径（一般用默认）；scenarios=各档情景对三视角各杠杆的增速假设；"
             "平台 unified/structure 来自 ingest.py 输出，合并进 platforms 后交给 forecast.py",
    "caliber": {
        "new_customer_window_days": 365, "baseline_months": 12, "target_months": 12,
        "tier_scope": "platform", "tier_pareto_pct": 0.78, "tier_tail_pct": 0.20,
        "goods_window_months": 12, "new_product_days": 90,
    },
    "scenarios": {
        "保守": {"new_customers_growth": 0.03, "new_arpu_growth": 0.00,
                 "old_customers_growth": -0.02, "old_freq_growth": 0.02, "old_aov_growth": 0.00,
                 "uv_growth": 0.02, "cvr_growth": 0.00, "aov_growth": 0.00,
                 "tier_growth": {"爆款": 0.00, "腰部": 0.05, "尾部": -0.15, "新品": 0.05}},
        "基准": {"new_customers_growth": 0.10, "new_arpu_growth": 0.01,
                 "old_customers_growth": 0.01, "old_freq_growth": 0.04, "old_aov_growth": 0.01,
                 "uv_growth": 0.08, "cvr_growth": 0.01, "aov_growth": 0.01,
                 "tier_growth": {"爆款": 0.03, "腰部": 0.12, "尾部": -0.10, "新品": 0.20}},
        "挑战": {"new_customers_growth": 0.18, "new_arpu_growth": 0.02,
                 "old_customers_growth": 0.03, "old_freq_growth": 0.07, "old_aov_growth": 0.02,
                 "uv_growth": 0.15, "cvr_growth": 0.02, "aov_growth": 0.02,
                 "tier_growth": {"爆款": 0.05, "腰部": 0.20, "尾部": -0.05, "新品": 0.35}},
    },
}


def generate(out_dir: str) -> list:
    from openpyxl import Workbook
    os.makedirs(out_dir, exist_ok=True)
    written = []

    wb = Workbook()
    ws = wb.active
    ws.title = "通用订单明细"
    ws.append(DETAIL_COLS)
    for row in DETAIL_ROWS:
        ws.append(row)
    note = wb.create_sheet("填数说明")
    note.append(["列", "说明"])
    for col, desc in DETAIL_NOTES:
        note.append([col, desc])
    p = os.path.join(out_dir, "目标测算_订单明细模板.xlsx")
    wb.save(p)
    written.append(os.path.basename(p))

    wb = Workbook()
    ws = wb.active
    ws.title = "聚合指标"
    ws.append(AGG_COLS)
    for row in AGG_ROWS:
        ws.append(row)
    note = wb.create_sheet("填数说明")
    note.append(["列", "说明"])
    for col, desc in AGG_NOTES:
        note.append([col, desc])
    p = os.path.join(out_dir, "目标测算_聚合指标模板.xlsx")
    wb.save(p)
    written.append(os.path.basename(p))

    p = os.path.join(out_dir, "target-input-template.json")
    with open(p, "w", encoding="utf-8") as fh:
        json.dump(PARAMS_TEMPLATE, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    written.append(os.path.basename(p))
    return written


def selftest() -> bool:
    import tempfile
    problems = []
    with tempfile.TemporaryDirectory() as td:
        written = generate(td)
        if len(written) != 3:
            problems.append(f"生成文件数不符: {written}")
        params = json.load(open(os.path.join(td, "target-input-template.json"), encoding="utf-8"))
        if set(params["scenarios"]) != {"保守", "基准", "挑战"}:
            problems.append("情景模板不符")
        from openpyxl import load_workbook
        wb = load_workbook(os.path.join(td, "目标测算_订单明细模板.xlsx"), read_only=True)
        head = next(wb.active.iter_rows(values_only=True))
        if list(head)[:5] != DETAIL_COLS[:5]:
            problems.append(f"明细模板表头不符: {head}")
        wb.close()
        sys.dont_write_bytecode = True  # 同目录导入不落 __pycache__
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        from ingest import read_xlsx_rows, validate_detail_rows
        headers, rows = read_xlsx_rows(os.path.join(td, "目标测算_订单明细模板.xlsx"))
        try:
            recs = validate_detail_rows(rows, "模板自检")
            if len(recs) != 3:
                problems.append(f"模板示例行应为 3 行，实得 {len(recs)}")
        except Exception as exc:  # noqa: BLE001
            problems.append(f"模板示例行未通过校验: {exc}")
    if problems:
        print("SELFTEST FAIL:")
        for p in problems:
            print(" -", p)
        return False
    print("SELFTEST PASS: template 两张 xlsx 模板 + 参数 JSON 生成正确，示例行通过 ingest 校验")
    return True


def main(argv: list) -> int:
    if len(argv) >= 2 and argv[1] in ("selftest", "--selftest"):
        return 0 if selftest() else 1
    out_dir = "."
    if len(argv) >= 3 and argv[1] == "--out-dir":
        out_dir = argv[2]
    elif len(argv) > 1:
        print(__doc__, file=sys.stderr)
        return 2
    for name in generate(out_dir):
        print("生成", os.path.join(out_dir, name))
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
