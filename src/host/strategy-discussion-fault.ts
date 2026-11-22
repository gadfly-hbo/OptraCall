export type StrategyDiscussionFaultDetail = {
  reason: string;
  path?: string;
  itemKind?: 'node' | 'edge' | 'source';
  itemId?: string;
  page?: number;
};

export class StrategyDiscussionFault extends Error {
  readonly code: string;
  readonly status: number;
  readonly exposure = 'safe-tool-error-v1' as const;
  readonly details?: { issues: StrategyDiscussionFaultDetail[] };

  constructor(code: string, status = 409, options: { message?: string; details?: { issues: StrategyDiscussionFaultDetail[] } } = {}) {
    super(options.message ?? code);
    this.code = code;
    this.status = status;
    this.details = options.details;
  }
}
