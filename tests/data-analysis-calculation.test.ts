import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('../extensions/analysis-assets/data-analysis/scripts/calc.py', import.meta.url));
const pythonAvailable = spawnSync('python3', ['--version']).status === 0;
const options = { skip: pythonAvailable ? false : 'python3 unavailable' };
function run(args: string[], status = 0): any {
  const result = spawnSync('python3', [script, ...args], { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } });
  assert.equal(result.status, status, result.stderr || result.stdout);
  assert.doesNotMatch(result.stderr, /Traceback/);
  if (status === 0) return JSON.parse(result.stdout);
  assert.equal(result.stdout, '', 'invalid input must not deliver a result');
}

test('DA03 fractional effects close before output formatting and preserve their shares', options, () => {
  const value = run(['decompose', '--metric', 'synthetic', '--mode', 'add', '--base', 'a:1,b:1,c:1,d:1', '--current', 'a:1.004,b:1.004,c:1.004,d:1.004']);
  assert.equal(value.total_change, '0.016');
  assert.equal(value.closure.sum_effects, '0.016');
  assert.equal(value.closure.diff, '0.00');
  assert.deepEqual(value.effects.map((row: any) => [row.effect, row.share_of_change]), Array.from({ length: 4 }, () => ['0.004', '25.00%']));
});

test('DA04 the displayed decomposition formula uses the actual precise operands', options, () => {
  const value = run(['decompose', '--metric', 'synthetic', '--base', 'a:1.234', '--current', 'a:1.235']);
  assert.equal(value.effects[0].effect, '0.001');
  assert.equal(value.effects[0].share_of_change, '100.00%');
  assert.equal(value.effects[0].formula, '(1.235 − 1.234) = 0.001');
});

test('DA04 constant normal-sized samples have no outliers without dividing by zero', options, () => {
  const value = run(['outlier', '--values', Array(30).fill('10').join(','), '--method', '3sigma']);
  assert.equal(value.sample_std, '0.00');
  assert.deepEqual(value.outliers, []);
});

for (const value of ['NaN', 'sNaN', 'Infinity', '-Infinity']) {
  test(`DA04 nonfinite numeric input ${value} is rejected without a result`, options, () => {
    run(['compare', '--label', 'synthetic', `--base=${value}`, '--current', '5'], 2);
  });
}

test('DA05 fractional days are rejected rather than silently truncated', options, () => {
  run(['compare', '--label', 'synthetic', '--base', '100', '--current', '100', '--base-days', '28.9', '--cur-days', '31.9'], 2);
});

test('DA04 fractional population counts are rejected rather than silently truncated', options, () => {
  run(['weighted', '--groups', 'A:100:1.9,B:50:3'], 2);
});

test('DA04 the 3sigma minimum cannot be lowered below thirty', options, () => {
  run(['outlier', '--values', '1,2,3,4,5', '--method', '3sigma', '--min-n', '3'], 2);
});

test('DA04 an IQR result includes the actual distance beyond its boundary', options, () => {
  const value = run(['outlier', '--values', [...Array(10).fill('10'), '100'].join(','), '--method', 'iqr']);
  assert.equal(value.outliers[0].reference_bound, '10.00');
  assert.equal(value.outliers[0].deviation, '90.00');
});

test('DA04 custom trend thresholds cannot relax the declared 0.7 floor', options, () => {
  run(['trend', '--values', '1,5,1,5,2', '--r2-threshold', '0.1'], 2);
});
