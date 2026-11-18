#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""运营数据分析 · 格式与数据门禁（OptraCall 自研，纯标准库）

定位：calc.py 验适用数字，本脚本按交付/建议声明验有限格式与红线，并核CSV疑点。
完整报告与聊天摘要分别检查；正式计划的字段检查不证明真实确认、经营授权或文件存在。
只做可判定的规则检查，不判断内容好坏；检查器本身须对坏样例命中、对好样例通过（--self-test 对抗验证）。

用法：
  python quality_check.py --report report.md     # 按完整报告/摘要、诊断/正式计划声明检查
  python quality_check.py --data table.csv [--key 门店] [--key 月份]   # CSV 体检
  python quality_check.py --self-test            # 内置正反样例对抗验证

退出码：0 无 error；1 存在 error（须修正后重跑）；2 输入错误。
warning 不阻断交付，但必须逐条向用户披露。
"""

import argparse
import csv
import io
import json
import re
import sys
from decimal import Decimal, InvalidOperation

VERSION = "optracall-data-quality-2-candidate"

SECTIONS = ["口径", "趋势", "异常", "拆解", "洞察", "行动"]
INCOMPLETE_MARK = "输入不完整"
DIRECT_MODE = "输出形态：直答"
INCOMPLETE_PERIOD_WORDS = ["至今", "本月还没结束", "进行中的", "截至今天"]
COMPARE_WORDS = ["同比", "环比", "上一期相比", "前期对比"]
ALIGNED_PERIOD = r"(?:按天对齐|同天数期间|同期等长|等长期间)"
CAUSAL_GUARD = ["未做因果检验", "相关性不等于因果", "需进一步验证"]
INTERPOLATE_WORDS = ["填充了缺失", "对缺失值进行填充"]
INTERPOLATE_NEGATION = re.compile(r"[未不没](?:做|进行|曾)?插补")
INTERPOLATE_RE = re.compile(r"插补")


class InputError(Exception):
    """输入不合法 → 退出码 2"""


def d(value):
    try:
        number = Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None
    if not number.is_finite():
        raise InputError("数值须为有限数：%r" % value)
    return number


def emit(payload):
    sys.stdout.write(json.dumps(payload, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n")


# ---------------------------------------------------------------- report

def heading_lines(text):
    """返回 [(位置, 段关键词, 行文本)]，只认 Markdown 标题行。"""
    found = []
    for m in re.finditer(r"^[ \t]{0,3}#{1,6}[ \t]+.*$", text, re.MULTILINE):
        line = m.group(0)
        if "诊断建议" in line:
            found.append((m.start(), "行动", line))
            continue
        for kw in SECTIONS:
            if kw in line:
                found.append((m.start(), kw, line))
                break
    return found


def without_fenced_code(text):
    """让 R2 只检查正文，代码示例与相邻行动项保持段落分隔。"""
    lines = []
    fence = None
    for line in text.splitlines(keepends=True):
        match = re.match(r"^ {0,3}(`{3,}|~{3,})([^\r\n]*)", line)
        if fence:
            if match and match[1].startswith(fence) and not match[2].strip(" \t"):
                fence = None
            continue
        if match and (match[1][0] == "~" or "`" not in match[2]):
            fence = match[1]
            lines.append("\n")
        else:
            lines.append(line)
    return "".join(lines)


def check_report(text):
    checks = []

    def add(cid, level, hit, detail):
        checks.append({"id": cid, "level": level, "hit": bool(hit), "detail": detail})

    prefix = text[:400]
    direct = bool(re.search(r"(?m)^输出形态[：:][ \t]*直答[ \t]*$", prefix))
    delivery_values = re.findall(r"(?m)^交付形态[：:][ \t]*(.*)$", prefix)
    advice_values = re.findall(r"(?m)^建议类型[：:][ \t]*(.*)$", prefix)
    delivery = delivery_values[0].strip() if delivery_values else ("直答" if direct else "完整报告")
    advice_kind = advice_values[0].strip() if advice_values else "旧版行动建议"
    invalid_mode = (len(delivery_values) > 1 or len(advice_values) > 1 or
                    bool(delivery_values) and delivery not in {"完整报告", "聊天摘要"} or
                    bool(advice_values) and advice_kind not in {"诊断建议", "正式行动计划"} or
                    direct and bool(delivery_values) and delivery != "聊天摘要")
    if invalid_mode:
        add("F0", "error", True, "交付形态/建议类型声明重复、未知或冲突，请按本次实际约定明确一种；不能据冲突声明跳过完整检查")
    concise = direct or delivery == "聊天摘要"
    diagnostic = advice_kind == "诊断建议"
    headings = heading_lines(text)
    order = [kw for _, kw, _ in headings]

    if concise:
        add("F0", "ok", True, "直答/聊天摘要按实际任务简述结论，不强制重复完整六段；专业红线仍检查")
    else:
        seq = [SECTIONS.index(k) for k in order if k in SECTIONS]
        strictly_increasing = all(a < b for a, b in zip(seq, seq[1:]))
        complete = all(k in order for k in SECTIONS)
        add("F1", "error", not (complete and strictly_increasing),
            "六段须齐全且顺序为 口径→趋势→异常→拆解→洞察→行动；实际顺序 %s" % ("→".join(order) or "（未检出任何段标题）"))
        if complete and strictly_increasing:
            add("F1", "ok", False, "六段齐全且顺序正确")

    declared_incomplete = INCOMPLETE_MARK in text
    required_terms = ["口径", "统计期间"] if direct else ["统计期间", "来源", "样本量", "口径"]
    missing_terms = [t for t in required_terms if t not in text]
    if missing_terms:
        add("F2", "warning" if declared_incomplete else "error", True,
            ("已声明「%s」，以下要素未出现：%s，报告须说明缺失影响" % (INCOMPLETE_MARK, "、".join(missing_terms)))
            if declared_incomplete else
            ("以下要素未出现且未声明「%s」：%s；五项输入缺任一必须在首段声明" % (INCOMPLETE_MARK, "、".join(missing_terms))))
    else:
        add("F2", "ok", False, "期间/来源/样本量/口径要素齐备")

    open_period = any(w in text for w in INCOMPLETE_PERIOD_WORDS)
    paragraphs = re.split(r"\n[ \t]*\n|(?m:^[ \t]{0,3}#{1,6}[ \t]+.*$)", text)

    def omit_tracking_name(match):
        name = match.group(1).strip()
        # 仅排除明确标注、无数值或当前比较断言的指标名，不豁免行动段。
        named_metric = re.fullmatch(r"[\u4e00-\u9fffA-Za-z_]+(?:率|额|量|数|价|指数)", name)
        asserted = re.search(r"本月至今|截至今天|当前|现为|已|增长了|下降了|增加了|减少了|提升了|持平|翻倍|高于|低于", name)
        return "" if named_metric and not asserted else match.group(0)

    unaligned_comparisons = []
    for paragraph in paragraphs:
        comparison = re.sub(r"跟踪指标[：:]([^，,。；;\n]+)", omit_tracking_name, paragraph)
        if any(w in comparison for w in COMPARE_WORDS):
            aligned = re.sub(r"(?:尚未|未|没有|不|需要?|应当?|建议)(?:做|进行)?" + ALIGNED_PERIOD, "", comparison)
            if not re.search(ALIGNED_PERIOD, aligned):
                unaligned_comparisons.append(paragraph)
    add("R1", "error", open_period and bool(unaligned_comparisons),
        "报告出现未完成期间词（%s）；对应比较段须明确等长或按天对齐，其他段的对齐说明不替代该比较"
        % "、".join(w for w in INCOMPLETE_PERIOD_WORDS if w in text))

    action_text = without_fenced_code(text) if not direct else ""
    action_headings = heading_lines(action_text)
    action = next((heading for heading in action_headings if heading[1] == "行动"), None)
    if diagnostic:
        add("R2", "ok", False, "诊断建议允许提出建议角色、试点期限和待确认事项，不强制编造执行责任或承诺")
    elif action:
        pos, _, action_heading = action
        level = len(action_heading.lstrip().split()[0])
        end = next((p for p, _, line in action_headings
                    if p > pos and len(line.lstrip().split()[0]) <= level), len(action_text))
        start = action_text.find("\n", pos)
        action_body = action_text[start + 1:end] if start != -1 else ""
        appendix = re.search(rf"(?m)^[ \t]{{0,3}}#{{1,{level}}}[ \t]+附录(?=[ \t：:]|$)", action_body)
        if appendix:
            action_body = action_body[:appendix.start()]
        advice = [item.strip()
                  for paragraph in re.split(r"\n[ \t]*\n", action_body)
                  if not re.fullmatch(r"-{3,}", paragraph.strip())
                  for item in re.split(r"(?m)(?=^[ \t]{0,3}(?:[-*+]|\d+[.、])[ \t]+)", paragraph)
                  if item.strip()]
        if advice_kind == "正式行动计划":
            fields = [r"(?:责任人|负责人)[：:]([^；;\n]+)", r"时限[：:]([^；;\n]+)",
                      r"授权(?:依据|范围)[：:]([^；;\n]+)", r"(?:跟踪指标|验证依据)[：:]([^；;\n]+)"]
            def confirmed_fields(line):
                values = [re.search(pattern, line) for pattern in fields]
                return all(value and value.group(1).strip() and
                           not re.search(r"待确认|待定|未知|未授权|尚未确认|建议人选", value.group(1))
                           for value in values)
            bad = [line for line in advice if not confirmed_fields(line)]
            add("R2", "error", not advice or bool(bad),
                "正式行动计划须列真实确认的责任人、时限、授权依据/范围和跟踪指标；以下 %d 条缺字段或仍待确认：%s"
                % (len(bad), " ｜ ".join(line.strip()[:80] for line in bad[:3])))
            if advice and not bad:
                add("R2", "ok", False, "正式计划字段已呈现；本检查只核存在性，真实性和经营授权须回原记录核实")
        else:
            bad = [ln for ln in advice
                   if not (re.search(r"责任人|负责[人人]", ln) and re.search(r"时限|日前|天内|周内|月底前|季度内", ln))]
            add("R2", "error", bool(bad),
                "行动建议须四要素（做什么+谁做+何时完成+什么指标验证）；以下 %d 条缺责任人或时限：%s"
                % (len(bad), " ｜ ".join(ln.strip()[:40] for ln in bad[:3])))
            if advice and not bad:
                add("R2", "ok", False, "行动建议均含责任人与时限")
    elif not concise:
        add("R2", "error", True, "未找到行动段，无法核建议四要素")
    elif advice_kind == "正式行动计划":
        add("R2", "warning", True, "当前只检查计划的聊天摘要，未重复完整计划；正式计划字段及真实确认须在准确原成果和原授权记录另核，摘要PASS不代替计划通过")

    corr = re.search(r"相关系数|r\s*=|ρ\s*=|皮尔逊|斯皮尔曼", text)
    guarded = any(w in text for w in CAUSAL_GUARD)
    add("R3", "error", bool(corr) and not guarded,
        "报告给出相关系数，但未声明「未做因果检验／相关性不等于因果」")

    small_sample = re.search(r"样本量[^。]{0,12}(<\s*30|不足)", text)
    low_conf = any(w in text for w in ["仅供参考", "置信不足", "置信度不足"])
    add("R4", "warning", bool(small_sample) and not low_conf,
        "报告自述样本量不足但未标注「仅供参考/置信不足」")

    scrubbed = INTERPOLATE_NEGATION.sub("已剔除", text)
    interpolated = bool(INTERPOLATE_RE.search(scrubbed)) or any(w in text for w in INTERPOLATE_WORDS)
    add("R5", "error", interpolated,
        "报告出现缺失值插补表述（「未插补/未做插补」等否定形式不算）；缺失值只标注不插补，插补数据不得支撑趋势结论")

    errors = [c for c in checks if c["level"] == "error" and c["hit"]]
    warnings = [c for c in checks if c["level"] == "warning" and c["hit"]]
    return {"engine": VERSION, "mode": "report", "form": "直答" if direct else ("摘要" if concise else "六段"),
            "delivery": delivery, "advice": advice_kind, "checks": checks, "error_count": len(errors), "warning_count": len(warnings),
            "verdict": "PASS" if not errors else "FAIL"}


# ---------------------------------------------------------------- data

def check_data(path, key_columns):
    try:
        with io.open(path, encoding="utf-8-sig", newline="") as f:
            reader = csv.DictReader(f)
            if not reader.fieldnames:
                raise InputError("CSV 无表头")
            rows = list(reader)
    except OSError as e:
        raise InputError("无法读取数据文件：%s" % e)
    if not rows:
        raise InputError("数据文件没有数据行")
    for col in key_columns:
        if col not in (reader.fieldnames or []):
            raise InputError("--key 列 %r 不在表头 %s 中" % (col, reader.fieldnames))

    checks = []

    def add(cid, level, hit, detail):
        checks.append({"id": cid, "level": level, "hit": bool(hit), "detail": detail})

    seen, dup_full = {}, []
    for i, row in enumerate(rows, 2):
        sig = tuple((k, v.strip()) for k, v in row.items())
        if sig in seen:
            dup_full.append("第%d行与第%d行完全重复" % (i, seen[sig]))
        else:
            seen[sig] = i
    add("DA1", "error", bool(dup_full), "；".join(dup_full) or "无完全重复行")

    if key_columns:
        seen_key, dup_key = {}, []
        for i, row in enumerate(rows, 2):
            sig = tuple(row[c].strip() for c in key_columns)
            if sig in seen_key:
                dup_key.append("主键%r 第%d行与第%d行重复" % (list(sig), i, seen_key[sig]))
            else:
                seen_key[sig] = i
        add("DA2", "error", bool(dup_key), "；".join(dup_key) or "主键 %s 唯一" % "、".join(key_columns))

    month_col = next((c for c in (reader.fieldnames or []) if c.strip() in ("月份", "月", "period_month")), None)
    if month_col:

        def month_gaps(months):
            if len(months) < 2:
                return []
            def ym(s):
                y, m = s.split("-")
                return int(y) * 12 + int(m)
            gaps, expect = [], ym(months[0]) + 1
            for s in months[1:]:
                while expect < ym(s):
                    gaps.append(expect)
                    expect += 1
                expect = ym(s) + 1
            return gaps

        groups = {}
        if key_columns and month_col in key_columns:
            group_cols = [c for c in key_columns if c != month_col]
            for row in rows:
                groups.setdefault(tuple(row[c].strip() for c in group_cols), set()).add(row[month_col].strip())
        else:
            groups[()] = {row[month_col].strip() for row in rows}
        missing = []
        for name, month_set in sorted(groups.items()):
            months = sorted(m for m in month_set if re.fullmatch(r"\d{4}-\d{2}", m))
            missing += ["%s@%s" % ("%04d-%02d" % (m // 12, m % 12), "/".join(name)) for m in month_gaps(months)]
        if groups and all(len([m for m in ms if re.fullmatch(r"\d{4}-\d{2}", m)]) < 2 for ms in groups.values()):
            detail = "各主体月份均不足 2 个，无法查连续性"
        else:
            detail = ("月份缺口：%s（按主体分组检查）" % "、".join(missing)) if missing else "月份连续（按主体分组检查）"
        add("DA3", "warning", bool(missing), detail)
    else:
        add("DA3", "warning", False, "无月份列，跳过时间轴检查")

    rate_cols = [c for c in (reader.fieldnames or []) if any(w in c for w in ("率", "占比", "percent", "ratio"))]
    rate_problems = []
    for col in rate_cols:
        vals = [(i, d(row[col])) for i, row in enumerate(rows, 2)]
        nums = [v for _, v in vals if v is not None]
        bad_range = [(i, str(v)) for i, v in vals if v is not None and (v < 0 or v > 100)]
        mixed = nums and any(v > 1 for _, v in vals if v is not None) and any(v < 1 for _, v in vals if v is not None)
        if bad_range:
            rate_problems.append("%s 超出 [0,100]：%s" % (col, "、".join("第%d行=%s" % p for p in bad_range[:3])))
        elif mixed:
            rate_problems.append("%s 同时存在 <1 与 >1 的值（疑似 0-1 比例与百分数单位混用）" % col)
    add("DA4", "error", bool(rate_problems),
        ("；".join(rate_problems) or ("率列未见区间/单位疑点" if rate_cols else "无率类列"))
        + ("；仅检查数值区间与单位疑点，分母定义需资料确认" if rate_cols else ""))

    numeric_cols = [c for c in (reader.fieldnames or []) if all(d(row[c]) is not None for row in rows)]
    total_hits = []
    for col in numeric_cols:
        vals = [d(row[col]) for row in rows]
        total = sum(vals)
        for i, v in enumerate(vals, 2):
            rest = total - v
            if rest != 0 and abs(v - rest) <= Decimal("0.01"):
                name_col = next((c for c in (reader.fieldnames or []) if c not in numeric_cols), None)
                label = rows[i - 2].get(name_col, "") if name_col else ""
                total_hits.append("第%d行(%s) 的 %s ≈ 其余行之和，疑似合计行（分析前应剔除或单列）" % (i, label or "?", col))
                break
    add("DA5", "warning", bool(total_hits), "；".join(total_hits) or "未发现疑似合计行")

    errors = [c for c in checks if c["level"] == "error" and c["hit"]]
    warnings = [c for c in checks if c["level"] == "warning" and c["hit"]]
    return {"engine": VERSION, "mode": "data", "rows": str(len(rows)), "columns": reader.fieldnames,
            "checks": checks, "error_count": len(errors), "warning_count": len(warnings),
            "verdict": "PASS" if not errors else "FAIL"}


# ---------------------------------------------------------------- self-test

GOOD_REPORT = """# 门店销售额分析
## 一、数据口径与质量说明
统计期间：2026-02-01~2026-02-28 与 2026-03-01~2026-03-31。来源：门店系统导出（2026-04-01）。样本量：12（<30，仅供参考）。
口径：销售额=系统导出月度值（含税口径待确认）；客流=到店人次。缺失值未插补，仅标注。
## 二、趋势与结构
销售额按天对齐后日均下降 9.17%（calc.py compare 复算）。
## 三、异常识别
IQR 法（n=12）未检出越界门店，方法与偏离度已写明。
## 四、指标拆解
销售额=成交笔数×客单价；效应之和精确闭合（calc.py decompose 复算，剥离顺序：成交笔数→客单价）。
## 五、洞察结论
客流变化是待核线索，数学拆解不直接证明因果；客单价相关系数 r = 0.3，未做因果检验，相关性不等于因果。
## 六、行动建议与跟踪指标
- 由门店运营负责人在两周内核对 3 家门店客流计数设备，跟踪指标：日均客流回复率。
- 由数据组负责人在月底前确认含税口径，跟踪指标：口径差异金额。
"""

BAD_REPORT = """# 分析
## 一、口径说明
统计期间：本月至今。来源：口头提供。样本量：12（<30）。
## 二、趋势
环比上升 5%，本月至今数据仍在增长，导致了客单价提升（相关系数 r = 0.8）。
## 三、异常识别
无。
## 四、指标拆解
略。
## 五、洞察结论
结论成立。
## 六、行动建议
- 建议加强运营。
- 建议关注客单价。
"""

DIRECT_REPORT = """输出形态：直答
3 月销售额 900,000 元（口径：系统导出含税，统计期间 2026-03-01~03-31，来源：门店系统）；基期 2 月 1,000,000 元，环比 −10.00%（calc.py compare 复算）。
"""

GOOD_CSV = """门店,月份,客流,转化率
直营A,2026-01,10000,0.12
直营A,2026-02,10100,0.13
直营B,2026-01,8000,0.10
直营B,2026-02,8100,0.11
"""

DIRTY_CSV = """门店,月份,客流,转化率
直营A,2026-01,10000,0.12
直营A,2026-01,10000,0.12
直营A,2026-03,10200,12
直营B,2026-01,8000,0.10
直营B,2026-02,8100,130
"""

DIRTY_CSV_TOTALS = """门店,月份,销售额
直营A,2026-01,1000
直营B,2026-01,2000
合计,2026-01,3000
"""


def run_selftest():
    import contextlib
    import os
    import tempfile

    results = []

    def check(name, ok):
        results.append((name, bool(ok)))

    # 报告·好样例必须通过
    r = check_report(GOOD_REPORT)
    check("报告·好样例 PASS", r["verdict"] == "PASS" and r["error_count"] == 0)
    check("报告·好样例六段识别", "F1" in [c["id"] for c in r["checks"] if c["level"] == "ok" or not c["hit"]])
    r = check_report(GOOD_REPORT + "\n---\n")
    check("报告·行动段分隔线不触发 R2", r["verdict"] == "PASS")
    appendix = "\n\n## 附录：复算清单\n\n| 来源 | 指标 |\n"
    r = check_report(GOOD_REPORT + "\n---" + appendix)
    check("报告·行动段后的附录不触发 R2", r["verdict"] == "PASS")

    for missing, action in (
        ("责任人", "- 在两周内核对活动订单。"),
        ("时限", "- 由运营负责人核对活动订单。"),
    ):
        r = check_report(GOOD_REPORT + "\n---\n\n" + action + appendix)
        check(f"报告·分隔线后的行动缺{missing}仍触发 R2",
              r["verdict"] == "FAIL" and any(
                  c["id"] == "R2" and c["hit"] and c["detail"].endswith(action)
                  for c in r["checks"]))
    r = check_report(GOOD_REPORT + "\n### 行动说明\n\n- 建议核对活动订单。\n")
    check("报告·下级标题后的真实行动仍检查 R2", any(
        c["id"] == "R2" and c["hit"] and c["detail"].endswith("- 建议核对活动订单。")
        for c in r["checks"]))
    fenced_appendix = "\n```markdown\n责任人与时限填写示例\n## 附录\n```\n"
    r = check_report(GOOD_REPORT + fenced_appendix + "\n- 建议加强运营。\n")
    check("报告·围栏内的附录示例不截断 R2", r["verdict"] == "FAIL" and any(
        c["id"] == "R2" and c["hit"] and c["detail"].endswith("- 建议加强运营。")
        for c in r["checks"]))
    tilde_fence = "\n  ~~~~markdown\n~~~\n```\n~~~~text\n## 附录\n- 围栏内的示例。\n  ~~~~~\n"
    r = check_report(GOOD_REPORT + tilde_fence + appendix)
    check("报告·围栏后的真实附录仍结束 R2", r["verdict"] == "PASS")
    r = check_report(GOOD_REPORT + tilde_fence + "\n- 建议加强运营。\n" + appendix)
    check("报告·围栏内伪关闭不跳过真实行动", r["verdict"] == "FAIL" and any(
        c["id"] == "R2" and c["hit"] and c["detail"].endswith("- 建议加强运营。")
        for c in r["checks"]))

    # 报告·坏样例必须命中（对抗：检查器不许空转）
    r = check_report(BAD_REPORT)
    hits = {c["id"] for c in r["checks"] if c["hit"] and c["level"] == "error"}
    check("报告·期间不完整 R1 命中", "R1" in hits)
    check("报告·建议缺四要素 R2 命中", "R2" in hits)
    check("报告·相关当因果 R3 命中", "R3" in hits)
    check("报告·小样本无标注 R4 命中（warning）", any(c["id"] == "R4" and c["hit"] for c in r["checks"]))

    # 报告·直答形态分流
    r = check_report(DIRECT_REPORT)
    check("报告·直答只跑红线", r["form"] == "直答" and r["verdict"] == "PASS")

    # 报告·段落乱序必须 FAIL
    r = check_report(BAD_REPORT.replace("## 二、趋势", "## 五、洞察临时").replace("## 五、洞察结论", "## 二、趋势"))
    check("报告·乱序检出 F1", any(c["id"] == "F1" and c["hit"] and c["level"] == "error" for c in r["checks"]))

    # 报告·插补红线（肯定式命中、否定式放行）
    r = check_report(GOOD_REPORT.replace("缺失值未插补，仅标注。", "缺失值已插补为均值。"))
    check("报告·插补 R5 命中", any(c["id"] == "R5" and c["hit"] for c in r["checks"]))
    r = check_report(GOOD_REPORT.replace("缺失值未插补，仅标注。", "缺失值未做插补，仅标注。"))
    check("报告·「未做插补」不误报 R5", r["verdict"] == "PASS")

    # v2候选：交付载体与建议类型独立，保留专业红线与旧报告兼容。
    diagnostic = ("交付形态：完整报告\n建议类型：诊断建议\n" +
                  GOOD_REPORT.split("## 六、")[0] +
                  "## 六、诊断建议与跟踪指标\n- 建议先核对计数口径，建议角色与试点期限待确认；跟踪日均客流。\n")
    r = check_report(diagnostic)
    check("契约·完整诊断不编造责任时限", r["verdict"] == "PASS" and r["advice"] == "诊断建议")
    summary = """交付形态：聊天摘要
建议类型：诊断建议
统计期间：2026年2月与3月，按天对齐。来源：合成门店月表。样本量：12，仅供参考。口径：同一含税销售额。
总量增长0.57%，日均下降9.17%，原因尚未确定；完整成果为060_reports/合成报告-v1.md的示例引用，未宣称本次已保存。
"""
    r = check_report(summary)
    check("契约·摘要不重复六段全文", r["verdict"] == "PASS" and r["form"] == "摘要")
    formal = diagnostic.replace("建议类型：诊断建议", "建议类型：正式行动计划").replace(
        "- 建议先核对计数口径，建议角色与试点期限待确认；跟踪日均客流。",
        "- 核对计数设备；责任人：已确认的门店运营负责人；时限：2026-04-15日前；授权依据：合成确认U-01，仅核设备；跟踪指标：计数偏差率。")
    r = check_report(formal)
    check("契约·正式计划保留已确认字段", r["verdict"] == "PASS")
    r = check_report(formal.replace("；授权依据：合成确认U-01，仅核设备", ""))
    check("契约·正式计划缺授权拒绝", any(c["id"] == "R2" and c["hit"] and c["level"] == "error" for c in r["checks"]))
    r = check_report(formal.replace("责任人：已确认的门店运营负责人", "责任人：待确认"))
    check("契约·待确认不冒充正式计划", r["verdict"] == "FAIL")
    r = check_report(summary.replace("建议类型：诊断建议", "建议类型：正式行动计划"))
    check("契约·计划摘要不代完整计划通过", r["verdict"] == "PASS" and any(c["id"] == "R2" and c["level"] == "warning" and c["hit"] for c in r["checks"]))
    r = check_report("交付形态：完整报告\n" + summary)
    check("契约·冲突声明拒绝", any(c["id"] == "F0" and c["level"] == "error" and c["hit"] for c in r["checks"]))
    r = check_report(summary.replace("建议类型：诊断建议", "建议类型：看情况"))
    check("契约·未知建议类型拒绝", r["verdict"] == "FAIL")
    r = check_report(summary + "\n相关系数r = 0.8。")
    check("契约·摘要仍核相关因果R3", any(c["id"] == "R3" and c["hit"] for c in r["checks"]))
    r = check_report(summary + "\n本月至今环比上升5%。")
    check("契约·摘要仍核未对齐R1", any(c["id"] == "R1" and c["hit"] for c in r["checks"]))
    r = check_report("交付形态：聊天摘要\n建议类型：诊断建议\n输入不完整：首购历史缺失，只交已核窗口内描述；其余待补。")
    check("契约·缺证可受限交付并提示", r["verdict"] == "PASS" and any(c["id"] == "F2" and c["level"] == "warning" and c["hit"] for c in r["checks"]))

    # 数据·好样例通过
    tmp = tempfile.mkdtemp(prefix="qc-selftest-")
    good = os.path.join(tmp, "good.csv")
    with io.open(good, "w", encoding="utf-8", newline="") as f:
        f.write(GOOD_CSV)
    r = check_data(good, ["门店", "月份"])
    check("数据·好样例 PASS", r["verdict"] == "PASS" and r["error_count"] == 0)

    # 数据·脏样例命中：完全重复（DA1）、主键重复（DA2）、月份缺口（DA3）、率列混口径（DA4）
    dirty = os.path.join(tmp, "dirty.csv")
    with io.open(dirty, "w", encoding="utf-8", newline="") as f:
        f.write(DIRTY_CSV)
    r = check_data(dirty, ["门店", "月份"])
    hits = {c["id"] for c in r["checks"] if c["hit"]}
    check("数据·完全重复 DA1", "DA1" in hits)
    check("数据·主键重复 DA2", "DA2" in hits)
    check("数据·月份缺口 DA3（缺 2026-02 的 A 店）", "DA3" in hits)
    check("数据·率列混口径 DA4", "DA4" in hits)

    # 数据·合计行
    totals = os.path.join(tmp, "totals.csv")
    with io.open(totals, "w", encoding="utf-8", newline="") as f:
        f.write(DIRTY_CSV_TOTALS)
    r = check_data(totals, ["门店", "月份"])
    check("数据·疑似合计行 DA5", any(c["id"] == "DA5" and c["hit"] for c in r["checks"]))

    # 数据·key 列不存在 → 退出码 2 语义
    try:
        check_data(good, ["不存在列"])
        check("数据·非法 key 拒绝", False)
    except InputError:
        check("数据·非法 key 拒绝", True)

    failed = [n for n, ok in results if not ok]
    for n, ok in results:
        sys.stdout.write("%s %s\n" % ("✓" if ok else "✗", n))
    sys.stdout.write("== 自测 %d/%d 通过，失败 %d ==\n" % (len(results) - len(failed), len(results), len(failed)))
    return 0 if not failed else 1


# ---------------------------------------------------------------- main

def main(argv=None):
    parser = argparse.ArgumentParser(prog="quality_check.py", description="格式与数据门禁（数字复算见 calc.py）")
    parser.add_argument("--self-test", action="store_true", help="运行内置对抗自测")
    parser.add_argument("--report", help="待校验的 Markdown 报告路径")
    parser.add_argument("--data", help="待体检的 CSV 路径")
    parser.add_argument("--key", default="", help="CSV 主键列，逗号分隔（建议如：门店,月份）")
    args = parser.parse_args(argv)

    if args.self_test:
        return run_selftest()
    if not args.report and not args.data:
        parser.error("须给出 --report 或 --data（或 --self-test）")
    results = []
    try:
        if args.report:
            try:
                with io.open(args.report, encoding="utf-8") as f:
                    results.append(check_report(f.read()))
            except OSError as e:
                raise InputError("无法读取报告：%s" % e)
        if args.data:
            results.append(check_data(args.data, [c.strip() for c in args.key.split(",") if c.strip()]))
    except InputError as e:
        sys.stderr.write("输入错误：%s\n" % e)
        return 2
    for r in results:
        emit(r)
    return 0 if all(r["error_count"] == 0 for r in results) else 1


if __name__ == "__main__":
    sys.exit(main())
