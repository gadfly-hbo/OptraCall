import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';

const root = new URL('../', import.meta.url).pathname;
const script = `${root}extensions/analysis-assets/data-analysis/scripts/quality_check.py`;
const scratch = `${root}.local/data-analysis-delivery/quality-author`;
mkdirSync(scratch, { recursive: true });
const temporary = mkdtempSync(`${scratch}/regression-`);
const python = String.raw`
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("quality_check", sys.argv[1])
quality = importlib.util.module_from_spec(spec)
spec.loader.exec_module(quality)
payload = json.load(sys.stdin)
print(json.dumps(quality.check_report(payload["report"]), ensure_ascii=False))
`;
type QualityResult = { verdict: 'PASS' | 'FAIL'; checks: { id: string; hit: boolean; level: string; detail: string }[] };
function report(text: string): QualityResult {
  const result = spawnSync('python3', ['-c', python, script], {
    input: JSON.stringify({ report: text }), encoding: 'utf8', cwd: temporary,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', TMPDIR: temporary },
  });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}
function data(csv: string) {
  const path = `${temporary}/data.csv`;
  writeFileSync(path, csv, 'utf8');
  return spawnSync('python3', [script, '--data', path], {
    encoding: 'utf8', cwd: temporary,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1', TMPDIR: temporary },
  });
}
const base = `# 合成门店复盘
## 一、数据口径
统计期间：2026-01 与 2025-01。来源：合成资料。样本量：100。口径：净销售额。
## 二、趋势
净销售额同比增长 5%。
## 三、异常
未发现异常。
## 四、拆解
笔数变化效应 5 元，单价变化效应 0 元。
## 五、洞察
净销售额由 100 元变为 105 元。
## 六、行动
- 由运营负责人在两周内核对订单明细，跟踪指标：净销售额。
`;
const action = '- 由运营负责人在两周内核对订单明细，跟踪指标：净销售额。';
const hit = (result: QualityResult, id: string) => result.checks.some(check => check.id === id && check.hit && check.level === 'error');

test('DA06: action paragraphs require an owner and deadline just as bullet items do', () => {
  assert.equal(report(base).verdict, 'PASS');
  assert.equal(hit(report(base.replace(action, '建议提升销售额。')), 'R2'), true);
  assert.equal(hit(report(base.replace(action, '由运营负责人建议提升销售额。')), 'R2'), true);
  assert.equal(report(base.replace(action, '由运营负责人在两周内核对订单明细，跟踪指标：净销售额。')).verdict, 'PASS');
});

test('DA06: correlation conclusions disclose the absence of causal testing even without causal verbs', () => {
  const conclusion = '净销售额由 100 元变为 105 元。';
  for (const text of ['相关系数r=0.8，销售额与客流相关。', '相关系数r=0.8，导致销售额增长。']) {
    assert.equal(hit(report(base.replace(conclusion, text)), 'R3'), true);
    assert.equal(report(base.replace(conclusion, `${text}未做因果检验，相关性不等于因果。`)).verdict, 'PASS');
  }
});

test('DA06: partial-period comparisons permit local alignment while unrelated or negated alignment cannot bypass R1', () => {
  const comparison = '净销售额同比增长 5%。';
  for (const text of [
    '本月至今，已取去年同天数期间、按天对齐后日均销售额同比增长5%。',
    '本月至今，已取去年同期等长期间，销售额同比增长5%。',
  ]) assert.equal(report(base.replace(comparison, text)).verdict, 'PASS', text);
  for (const text of [
    '本月至今销售额同比增长5%。',
    '本月至今销售额同比增长5%。\n\n另一个指标已按天对齐。',
    '本月至今，按天对齐后日均销售额同比增长5%。\n\n本月至今订单数环比增长3%。',
    '本月至今，未按天对齐，销售额同比增长5%。',
    '本月至今，需按天对齐，销售额同比增长5%。',
  ]) assert.equal(hit(report(base.replace(comparison, text)), 'R1'), true, text);
});

test('DA06: a tracking metric name is not a comparison, while unaligned action conclusions still trigger R1', () => {
  const aligned = base.replace('净销售额同比增长 5%。', '本月至今已按天对齐，日均销售额同比增长5%。');
  const tracking = '- 由运营负责人在两周内核对订单明细，跟踪指标：日均客流环比回复率。';
  assert.equal(report(aligned.replace(action, tracking)).verdict, 'PASS');
  assert.equal(hit(report(base.replace('净销售额同比增长 5%。', '本月至今销售额同比增长5%。').replace(action, tracking)), 'R1'), true);
  for (const body of [
    '- 由运营负责人在两周内核对订单明细，本月至今销售额环比增长5%，跟踪指标：日均客流环比回复率。',
    '- 由运营负责人在两周内核对订单明细，跟踪指标：本月至今日均客流环比增长5%。',
    '- 由运营负责人在两周内核对订单明细，跟踪指标：日均客流环比回复率提升5%。',
    '- 由运营负责人在两周内核对订单明细，跟踪指标：本月至今客流环比持平。',
  ]) assert.equal(hit(report(aligned.replace(action, body)), 'R1'), true, body);
});

test('DA06: non-finite data values reject with input exit 2 instead of crashing or quietly passing', () => {
  for (const column of ['转化率', '销售额']) for (const value of ['NaN', 'sNaN', 'Infinity', '-Infinity']) {
    const result = data(`门店,${column}\nA,${value}\nB,0.12\n`);
    assert.equal(result.status, 2, `${column}=${value}: ${result.stderr || result.stdout}`);
    assert.match(result.stderr, /输入错误/);
    assert.doesNotMatch(result.stderr, /Traceback/);
  }
  assert.equal(data('门店,转化率\nA,0.12\nB,0.20\n').status, 0);
});
