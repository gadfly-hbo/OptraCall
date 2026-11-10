// 经营推演共享类型：引擎输入输出、草稿/运行/快照记录与工具合同。
export const ENGINE_VERSION = 'optracall-sim-2';
export const MAX_VARIANTS_PER_DRAFT = 8;

export type SimParameters = {
  days: number;
  demand: number;
  inventory: number;
  capacity: number;
  leadTime: number;
  promoStart: number;
  promoEnd: number;
  promoLift: number;
  demandShock: boolean;
  supplyShock: boolean;
  price: number;
  cost: number;
  fulfillmentCost: number;
  holdingCost: number;
  cash: number;
  maxWait: number;
  cashThreshold: number;
};

export type SimVariant = {
  id: string;
  name: string;
  openingExtraStock: number;
  acceptanceCap: number | null;
  promoWindow?: { start: number; end: number };
  promoLiftScale?: number;
};

export type SimPerturbation = {
  demandMultiplier?: number;
  capacityMultiplier?: number;
  leadTimeDelta?: number;
  priceMultiplier?: number;
};

export type SimDailyRecord = {
  day: number;
  demand: number;
  accepted: number;
  unaccepted: number;
  received: number;
  shipped: number;
  cancelled: number;
  backlog: number;
  inventory: number;
  cash: number;
  purchaseQuantity: number;
  purchasePayment: number;
  revenue: number;
  contribution: number;
  inTransit: number;
  promoActive: boolean;
};

export type SimSummary = {
  demand: number;
  accepted: number;
  shipped: number;
  cancelled: number;
  unaccepted: number;
  revenue: number;
  purchases: number;
  contribution: number;
  closingInventory: number;
  closingBacklog: number;
  closingCash: number;
  minCash: number;
  minCashDay: number;
  peakBacklog: number;
  firstNegative: number | null;
  stockoutDays: number;
  fulfillmentRate: number;
  cancelRate: number;
  inTransit: number;
};

export type SimRunResult = {
  engineVersion: string;
  inputHash: string;
  perturbation: SimPerturbation;
  rows: SimDailyRecord[];
  summary: SimSummary;
  validDays: number;
  conservation: boolean;
};

export type DraftRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  name: string;
  parameters: SimParameters;
  variants: SimVariant[];
  revision: number;
  createdAt: string;
  updatedAt: string;
};

export type RunRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  draftId: string;
  draftRevision: number;
  engineVersion: string;
  inputHash: string;
  createdAt: string;
  results: Record<string, SimRunResult>;
};

export type SnapshotRecord = {
  schemaVersion: 1;
  id: string;
  projectId: string;
  draftId: string;
  draftRevision: number;
  runId: string;
  name: string;
  frozenAt: string;
  engineVersion: string;
  inputHash: string;
  parameters: SimParameters;
  variant: SimVariant;
  result: SimRunResult;
};

export type StressRow = {
  variantId: string;
  variantName: string;
  perturbation: SimPerturbation;
  base: SimSummary;
  after: SimSummary;
  cashTurnedNegative: boolean;
  crossedCashThreshold: boolean;
};

export const UNMODELED_CAPABILITIES = [
  '退货退款', '多仓与调拨', '账期与信用', '税费与固定成本',
  '日内现金流', '需求反馈回路', '概率分布与随机仿真', '外部数据源接入',
] as const;
