import test from 'node:test';
import assert from 'node:assert/strict';
import { simulate, validateParameters, validateVariant, validatePerturbation, DEFAULT_PARAMETERS, defaultVariants } from '../extensions/business-plugins/sim-lab/kernel/engine.ts';
import type { SimParameters, SimVariant } from '../extensions/business-plugins/sim-lab/types.ts';

const base = (): SimParameters => ({ ...DEFAULT_PARAMETERS });
const baseline = (): SimVariant => ({ id: 'baseline', name: '基线', openingExtraStock: 0, acceptanceCap: null });
const throwsCode = (fn: () => unknown, code: string) => {
  assert.throws(fn, (error: unknown) => { assert.equal((error as { code?: string }).code, code); return true; });
};

test('SIM-ENGINE-01: conservation holds across a parameter matrix', () => {
  const daysOptions = [7, 30, 60, 90];
  let cases = 0;
  for (const days of daysOptions) {
    for (const demand of [0, 180, 500]) {
      for (const capacity of [0, 250]) {
        for (const maxWait of [0, 3]) {
          for (const supplyShock of [true, false]) {
            const p = { ...base(), days, demand, capacity, maxWait, supplyShock, promoStart: Math.min(8, days - 1), promoEnd: Math.min(14, days) };
            for (const variant of [
              baseline(),
              { ...baseline(), id: 'advance', openingExtraStock: 900 },
              { ...baseline(), id: 'split', acceptanceCap: 250, promoWindow: { start: Math.min(8, days - 1), end: Math.min(21, days) }, promoLiftScale: 0.5 },
            ]) {
              const result = simulate(p, variant);
              assert.equal(result.conservation, true, `days=${days} demand=${demand} capacity=${capacity} maxWait=${maxWait} supplyShock=${supplyShock} variant=${variant.id}`);
              assert.equal(result.validDays, days);
              assert.equal(result.rows.length, days);
              assert.equal(result.summary.minCash, Math.min(p.cash - variant.openingExtraStock * p.cost, ...result.rows.map(r => r.cash)));
              for (const row of result.rows) {
                assert.equal(row.unaccepted, row.demand - row.accepted);
                assert.ok(row.accepted <= row.demand);
                assert.ok(row.inventory >= 0 && row.backlog >= 0);
              }
              assert.ok(result.summary.fulfillmentRate >= 0 && result.summary.fulfillmentRate <= 1);
              cases++;
            }
          }
        }
      }
    }
  }
  assert.ok(cases >= 100, `expected a broad matrix, got ${cases}`);
});

test('SIM-ENGINE-02: determinism — same input produces byte-identical output and hash', () => {
  const p = base(), v = defaultVariants();
  for (const variant of v) {
    const first = simulate(p, variant), second = simulate(p, variant);
    assert.equal(JSON.stringify(first), JSON.stringify(second));
    assert.equal(first.inputHash, second.inputHash);
  }
  const perturbed = simulate(p, v[0]!, { demandMultiplier: 1.25 });
  assert.notEqual(perturbed.inputHash, simulate(p, v[0]!).inputHash);
  assert.equal(JSON.stringify(perturbed), JSON.stringify(simulate(p, v[0]!, { demandMultiplier: 1.25 })));
});

test('SIM-ENGINE-03: perturbation dimensions take effect and are validated', () => {
  const p = base(), v = baseline();
  const baseResult = simulate(p, v);
  assert.notEqual(simulate(p, v, { demandMultiplier: 1.25 }).summary.demand, baseResult.summary.demand);
  assert.notEqual(simulate(p, v, { priceMultiplier: 1.1 }).summary.revenue, baseResult.summary.revenue);
  assert.ok(simulate(p, v, { capacityMultiplier: 0.5 }).summary.shipped <= baseResult.summary.shipped);
  for (const bad of [{ demandMultiplier: 0 }, { demandMultiplier: -1 }, { capacityMultiplier: 11 }, { priceMultiplier: Number.NaN }, { leadTimeDelta: 0.5 }, { leadTimeDelta: 31 }, { unknown: 1 }]) {
    throwsCode(() => simulate(p, v, bad as never), 'invalid_perturbation');
  }
  throwsCode(() => simulate({ ...p, leadTime: 1 }, v, { leadTimeDelta: -1 }), 'invalid_perturbation');
  assert.doesNotThrow(() => validatePerturbation({}));
});

test('SIM-ENGINE-04: parameter and variant boundaries are enforced', () => {
  const p = base(), v = baseline();
  for (const bad of [{ days: 6 }, { days: 91 }, { days: 30.5 }, { demand: -1 }, { leadTime: 0 }, { promoLift: 201 }, { promoEnd: 7 }, { promoStart: 8, promoEnd: 31 }]) {
    throwsCode(() => simulate({ ...p, ...bad }, v), 'invalid_parameters');
  }
  throwsCode(() => validateParameters({ ...p, demandShock: 'yes' as never }), 'invalid_parameters');
  for (const bad of [
    { ...v, id: 'BAD ID' }, { ...v, name: '' }, { ...v, openingExtraStock: -1 },
    { ...v, acceptanceCap: -5 }, { ...v, promoWindow: { start: 9, end: 8 } },
    { ...v, promoWindow: { start: 8, end: 31 } }, { ...v, promoLiftScale: 1.5 },
  ]) throwsCode(() => simulate(p, bad), 'invalid_variant');
  assert.doesNotThrow(() => validateVariant(v, 30));
});
