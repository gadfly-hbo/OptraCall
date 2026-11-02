import { createHash } from 'node:crypto';
import {
  ENGINE_VERSION,
  type SimParameters,
  type SimVariant,
  type SimPerturbation,
  type SimRunResult,
  type SimDailyRecord,
} from '../types.ts';

export class EngineFault extends Error {
  readonly code: string;
  constructor(code: string, message: string) { super(message); this.name = 'EngineFault'; this.code = code; }
}

const PARAMETER_RULES: Record<string, { min: number; max: number; integer: boolean }> = {
  days: { min: 7, max: 90, integer: true },
  demand: { min: 0, max: 5000, integer: true },
  inventory: { min: 0, max: 100000, integer: true },
  capacity: { min: 0, max: 10000, integer: true },
  leadTime: { min: 1, max: 30, integer: true },
  promoStart: { min: 1, max: 90, integer: true },
  promoEnd: { min: 1, max: 90, integer: true },
  promoLift: { min: 0, max: 200, integer: false },
  price: { min: 0, max: 100000, integer: false },
  cost: { min: 0, max: 100000, integer: false },
  fulfillmentCost: { min: 0, max: 1000, integer: false },
  holdingCost: { min: 0, max: 100, integer: false },
  cash: { min: 0, max: 100000000, integer: false },
  maxWait: { min: 0, max: 30, integer: true },
  cashThreshold: { min: 0, max: 100000000, integer: false },
};

export function validateParameters(p: SimParameters): void {
  for (const [key, rule] of Object.entries(PARAMETER_RULES)) {
    const value = (p as unknown as Record<string, unknown>)[key];
    if (typeof value !== 'number' || !Number.isFinite(value) || value < rule.min || value > rule.max || (rule.integer && !Number.isInteger(value))) {
      throw new EngineFault('invalid_parameters', `参数 ${key} 超出允许范围或不是有效${rule.integer ? '整数' : '数值'}（${rule.min}–${rule.max}）。`);
    }
  }
  if (p.promoEnd < p.promoStart || p.promoEnd > p.days) throw new EngineFault('invalid_parameters', '活动窗口须在推演窗口内且结束不早于开始。');
  if (typeof p.demandShock !== 'boolean' || typeof p.supplyShock !== 'boolean') throw new EngineFault('invalid_parameters', '冲击开关必须是布尔值。');
}

export function validateVariant(v: SimVariant, days: number): void {
  if (!v.id || !/^[a-z0-9][a-z0-9-]{0,30}$/.test(v.id)) throw new EngineFault('invalid_variant', '变体 id 需为小写字母数字连字符。');
  if (typeof v.name !== 'string' || !v.name.trim() || v.name.length > 80) throw new EngineFault('invalid_variant', '变体名称必填且不超过 80 字。');
  if (!Number.isInteger(v.openingExtraStock) || v.openingExtraStock < 0 || v.openingExtraStock > 100000) throw new EngineFault('invalid_variant', 'D0 额外现货须为 0–100000 的整数。');
  if (v.acceptanceCap !== null && (!Number.isInteger(v.acceptanceCap) || v.acceptanceCap < 0 || v.acceptanceCap > 10000)) throw new EngineFault('invalid_variant', '日承接上限须为空或 0–10000 的整数。');
  if (v.promoWindow) {
    const { start, end } = v.promoWindow;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > days) throw new EngineFault('invalid_variant', '变体活动窗口须在推演窗口内且结束不早于开始。');
  }
  if (v.promoLiftScale !== undefined && (typeof v.promoLiftScale !== 'number' || !Number.isFinite(v.promoLiftScale) || v.promoLiftScale < 0 || v.promoLiftScale > 1)) throw new EngineFault('invalid_variant', '活动力度系数须为 0–1。');
}

export function validatePerturbation(perturbation: SimPerturbation): void {
  const multipliers: [string, number | undefined][] = [
    ['demandMultiplier', perturbation.demandMultiplier],
    ['capacityMultiplier', perturbation.capacityMultiplier],
    ['priceMultiplier', perturbation.priceMultiplier],
  ];
  for (const [key, value] of multipliers) {
    if (value === undefined) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 10) throw new EngineFault('invalid_perturbation', `扰动 ${key} 须为 (0, 10] 的乘数。`);
  }
  if (perturbation.leadTimeDelta !== undefined && (!Number.isInteger(perturbation.leadTimeDelta) || Math.abs(perturbation.leadTimeDelta) > 30)) throw new EngineFault('invalid_perturbation', '扰动 leadTimeDelta 须为 −30–30 的整数天数。');
  for (const key of Object.keys(perturbation)) {
    if (!['demandMultiplier', 'capacityMultiplier', 'leadTimeDelta', 'priceMultiplier'].includes(key)) throw new EngineFault('invalid_perturbation', `未知扰动维度 ${key}。`);
  }
}

export function inputHashOf(p: SimParameters, v: SimVariant, perturbation: SimPerturbation): string {
  const canonical = JSON.stringify({ engineVersion: ENGINE_VERSION, parameters: p, variant: v, perturbation }, (_key, value) =>
    value && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b))) : value);
  return createHash('sha256').update(canonical).digest('hex');
}

type QueueOrder = { day: number; qty: number };
type PipelineOrder = { arrival: number; qty: number };

/** 确定性 FIFO 逐日推演：同参数+同变体+同扰动+同引擎版本，结果逐字节一致。 */
export function simulate(p: SimParameters, variant: SimVariant, perturbation: SimPerturbation = {}): SimRunResult {
  validateParameters(p);
  validateVariant(variant, p.days);
  validatePerturbation(perturbation);
  const capacity = Math.max(0, Math.round(p.capacity * (perturbation.capacityMultiplier ?? 1)));
  const leadTime = p.leadTime + (perturbation.leadTimeDelta ?? 0);
  if (leadTime < 1) throw new EngineFault('invalid_perturbation', '扰动后提前期须至少为 1 天。');
  const demandMultiplier = perturbation.demandMultiplier ?? 1;
  const price = p.price * (perturbation.priceMultiplier ?? 1);
  const promoWindow = variant.promoWindow ?? { start: p.promoStart, end: p.promoEnd };
  const liftScale = variant.promoLiftScale ?? 1;
  const procureQty = Math.round(p.demand * 7);

  let stock = p.inventory + variant.openingExtraStock;
  let cash = p.cash - variant.openingExtraStock * p.cost;
  const openingStock = stock, openingCash = cash;
  let queue: QueueOrder[] = [], pipeline: PipelineOrder[] = [];
  const rows: SimDailyRecord[] = [];
  let validDays = 0;
  let tDemand = 0, tAccepted = 0, tShipped = 0, tCancelled = 0, tUnaccepted = 0;
  let tRevenue = 0, tContribution = 0, tPurchases = 0, tReceived = 0, tFulfillment = 0, tHolding = 0;
  let minCash = cash, minCashDay = 0, peakBacklog = 0, stockoutDays = 0;
  let firstNegative: number | null = cash < 0 ? 0 : null;
  const backlogOf = () => queue.reduce((a, o) => a + o.qty, 0);

  for (let day = 1; day <= p.days; day++) {
    const startStock = stock, startCash = cash, startBacklog = backlogOf();
    let received = 0;
    for (const po of pipeline) if (po.arrival === day) received += po.qty;
    pipeline = pipeline.filter(po => po.arrival > day);
    stock += received; tReceived += received;

    const promoActive = day >= promoWindow.start && day <= promoWindow.end;
    let factor = promoActive ? 1 + (p.promoLift / 100) * liftScale : 1;
    if (p.demandShock && day >= 8 && day <= 21) factor *= 1.3;
    const demand = Math.round(p.demand * factor * demandMultiplier);
    const accepted = variant.acceptanceCap !== null ? Math.min(demand, variant.acceptanceCap) : demand;
    const unaccepted = demand - accepted;
    if (accepted > 0) queue.push({ day, qty: accepted });
    const waiting = backlogOf();
    if (stock < Math.min(waiting, capacity)) stockoutDays++;
    let remaining = Math.min(stock, capacity, waiting);
    const shipped = remaining;
    while (remaining > 0 && queue.length) {
      const order = queue[0]!, count = Math.min(order.qty, remaining);
      order.qty -= count; remaining -= count;
      if (!order.qty) queue.shift();
    }
    stock -= shipped;
    let cancelled = 0;
    queue = queue.filter(o => { if (day - o.day >= p.maxWait) { cancelled += o.qty; return false; } return true; });
    const backlog = backlogOf();

    let purchaseQuantity = 0, purchasePayment = 0;
    if ((day - 1) % 7 === 0) {
      purchaseQuantity = procureQty;
      purchasePayment = procureQty * p.cost;
      pipeline.push({ arrival: day + leadTime + (p.supplyShock ? 3 : 0), qty: procureQty });
      tPurchases += purchasePayment;
    }
    const revenue = shipped * price;
    const fulfillmentFee = shipped * p.fulfillmentCost;
    const holdingFee = stock * p.holdingCost;
    const contribution = shipped * (price - p.cost - p.fulfillmentCost);
    cash += revenue - purchasePayment - fulfillmentFee - holdingFee;

    tDemand += demand; tAccepted += accepted; tShipped += shipped; tCancelled += cancelled; tUnaccepted += unaccepted;
    tRevenue += revenue; tContribution += contribution; tFulfillment += fulfillmentFee; tHolding += holdingFee;
    if (cash < minCash) { minCash = cash; minCashDay = day; }
    if (backlog > peakBacklog) peakBacklog = backlog;
    if (firstNegative === null && cash < 0) firstNegative = day;

    const dayValid = stock === startStock + received - shipped
      && backlog === startBacklog + accepted - shipped - cancelled
      && Math.abs(cash - (startCash + revenue - purchasePayment - fulfillmentFee - holdingFee)) <= Math.max(1e-6,
        Number.EPSILON * 8 * (Math.abs(cash) + Math.abs(startCash) + revenue + purchasePayment + fulfillmentFee + holdingFee))
      && stock >= 0 && backlog >= 0;
    if (dayValid) validDays++;
    rows.push({
      day, demand, accepted, unaccepted, received, shipped, cancelled, backlog,
      inventory: stock, cash, purchaseQuantity, purchasePayment, revenue, contribution,
      inTransit: pipeline.reduce((a, po) => a + po.qty, 0), promoActive,
    });
  }

  const closingBacklog = backlogOf(), inTransit = pipeline.reduce((a, po) => a + po.qty, 0);
  const conservation = validDays === p.days
    && stock === openingStock + tReceived - tShipped
    && tAccepted === tShipped + tCancelled + closingBacklog
    && Math.abs(cash - (openingCash + tRevenue - tPurchases - tFulfillment - tHolding)) <= Math.max(0.01,
      Number.EPSILON * 8 * p.days * (Math.abs(cash) + Math.abs(openingCash) + tRevenue + tPurchases + tFulfillment + tHolding));
  return {
    engineVersion: ENGINE_VERSION,
    inputHash: inputHashOf(p, variant, perturbation),
    perturbation: Object.fromEntries(Object.entries(perturbation).sort(([a], [b]) => a.localeCompare(b))),
    rows,
    summary: {
      demand: tDemand, accepted: tAccepted, shipped: tShipped, cancelled: tCancelled, unaccepted: tUnaccepted,
      revenue: tRevenue, purchases: tPurchases, contribution: tContribution,
      closingInventory: stock, closingBacklog, closingCash: cash,
      minCash, minCashDay, peakBacklog, firstNegative, stockoutDays,
      fulfillmentRate: tDemand ? tShipped / tDemand : 0,
      cancelRate: tAccepted ? tCancelled / tAccepted : 0,
      inTransit,
    },
    validDays,
    conservation,
  };
}

export const DEFAULT_PARAMETERS: SimParameters = {
  days: 30, demand: 180, inventory: 1800, capacity: 250, leadTime: 5,
  promoStart: 8, promoEnd: 14, promoLift: 80, demandShock: true, supplyShock: true,
  price: 128, cost: 72, fulfillmentCost: 9, holdingCost: 0.15,
  cash: 180000, maxWait: 3, cashThreshold: 60000,
};

export function defaultVariants(days = DEFAULT_PARAMETERS.days): SimVariant[] {
  return [
    { id: 'baseline', name: '基线 · 常规补货', openingExtraStock: 0, acceptanceCap: null },
    { id: 'advance', name: '提前囤货 +900 件', openingExtraStock: 900, acceptanceCap: null },
    { id: 'split', name: '限量分批 · 日上限 250', openingExtraStock: 0, acceptanceCap: 250, promoWindow: { start: Math.min(8, days), end: Math.min(21, days) }, promoLiftScale: 0.5 },
  ];
}
