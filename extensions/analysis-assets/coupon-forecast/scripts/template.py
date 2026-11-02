# -*- coding: utf-8 -*-
"""优惠券测算输入模板生成（OptraCall 分析资产 · 依赖 openpyxl）。

产出三件：
    scenario-template.json      场景配置模板（金额分、概率 0-1，含合成示例值）
    优惠券测算_分桶模板.xlsx     分桶表模板（bucket_min/max、桶均金额、订单数/权重、毛利率）
    优惠券测算_订单明细模板.xlsx 订单明细模板（order_id、券前商品金额分、毛利、退款标记）

用法：
    python3 template.py --out-dir <目录>      # 三件全部生成（目录缺省当前目录）
    python3 template.py selftest
"""
from __future__ import annotations

import json
import os
import sys

sys.dont_write_bytecode = True  # 同目录导入不落 __pycache__，保持分析资产目录干净
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from coupon import SCENARIO_TEMPLATE  # noqa: E402

_BUCKET_TEMPLATE_ROWS = [
    [10000, 14999, 12000, 350, 0.30],
    [15000, 19999, 17000, 400, 0.28],
    [None, None, 9900, 250, 0.30],
]
_ORDER_TEMPLATE_ROWS = [
    ["o-0001", 9900, 3000, 0],
    ["o-0002", 15800, 4700, 0],
    ["o-0003", 12000, 3500, 1],
]


def generate(out_dir: str) -> list:
    from openpyxl import Workbook
    os.makedirs(out_dir, exist_ok=True)
    written = []

    scenario_path = os.path.join(out_dir, "scenario-template.json")
    with open(scenario_path, "w", encoding="utf-8") as fh:
        json.dump(SCENARIO_TEMPLATE, fh, ensure_ascii=False, indent=2)
        fh.write("\n")
    written.append(os.path.basename(scenario_path))

    wb = Workbook()
    ws = wb.active
    ws.title = "分桶数据"
    ws.append(["bucket_min_cents", "bucket_max_cents", "avg_amount_cents", "orders", "avg_margin_rate", "weight"])
    for row in _BUCKET_TEMPLATE_ROWS:
        ws.append(row + [None])
    note = wb.create_sheet("填数说明")
    note.append(["列", "说明"])
    for col, desc in [
        ("bucket_min_cents", "桶下限（分，可空=开区间）"),
        ("bucket_max_cents", "桶上限（分，可空）"),
        ("avg_amount_cents", "桶内平均券前可用商品金额（分，必填）——不是实付金额"),
        ("orders", "桶内订单数（与 weight 二选一）"),
        ("avg_margin_rate", "桶均商品毛利率 [0,1]（可空）"),
        ("weight", "直接给权重时填写（与 orders 二选一，合计必须=1）"),
    ]:
        note.append([col, desc])
    path = os.path.join(out_dir, "优惠券测算_分桶模板.xlsx")
    wb.save(path)
    written.append(os.path.basename(path))

    wb = Workbook()
    ws = wb.active
    ws.title = "订单明细"
    ws.append(["order_id", "amount_cents", "margin_cents", "refunded"])
    for row in _ORDER_TEMPLATE_ROWS:
        ws.append(row)
    note = wb.create_sheet("填数说明")
    note.append(["列", "说明"])
    for col, desc in [
        ("order_id", "订单号（用于查重，不进入测算）"),
        ("amount_cents", "本次券前可用商品金额（分，必填），不含运费与其他优惠"),
        ("margin_cents", "商品毛利（分，可空；空则用场景级毛利率）"),
        ("refunded", "是否退款单（0/1；存在 1 时需在导入确认退款口径）"),
    ]:
        note.append([col, desc])
    path = os.path.join(out_dir, "优惠券测算_订单明细模板.xlsx")
    wb.save(path)
    written.append(os.path.basename(path))
    return written


def selftest() -> bool:
    import tempfile
    problems = []
    with tempfile.TemporaryDirectory() as td:
        written = generate(td)
        if sorted(written) != sorted(["scenario-template.json", "优惠券测算_分桶模板.xlsx",
                                      "优惠券测算_订单明细模板.xlsx"]):
            problems.append(f"生成文件清单不符: {written}")
        data = json.load(open(os.path.join(td, "scenario-template.json"), encoding="utf-8"))
        if data["schema_version"] != "2.0" or not data["baseline"]["baskets"]:
            problems.append("场景模板内容不符")
        from openpyxl import load_workbook
        for name, header in (("优惠券测算_分桶模板.xlsx", "bucket_min_cents"),
                             ("优惠券测算_订单明细模板.xlsx", "order_id")):
            wb = load_workbook(os.path.join(td, name), read_only=True)
            first = next(wb.active.iter_rows(values_only=True))[0]
            if first != header and name.endswith("分桶模板.xlsx"):
                if "bucket_min_cents" not in str(first):
                    problems.append(f"{name} 表头不符: {first}")
            elif name.endswith("订单明细模板.xlsx") and first != "order_id":
                problems.append(f"{name} 表头不符: {first}")
            wb.close()
    if problems:
        print("SELFTEST FAIL:")
        for p in problems:
            print(" -", p)
        return False
    print("SELFTEST PASS: template 三件模板（场景 JSON + 分桶 xlsx + 订单明细 xlsx）生成与表头正确")
    return True


def main(argv: list) -> int:
    if len(argv) >= 2 and argv[1] == "selftest":
        return 0 if selftest() else 1
    out_dir = "."
    if len(argv) >= 3 and argv[1] == "--out-dir":
        out_dir = argv[2]
    elif len(argv) > 1:
        print(__doc__, file=sys.stderr)
        return 2
    written = generate(out_dir)
    for name in written:
        print("生成", os.path.join(out_dir, name))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
