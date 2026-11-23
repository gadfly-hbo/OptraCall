export type StrategyDiscussionFaultDetail = {
  reason: string;
  path?: string;
  itemKind?: 'node' | 'edge' | 'source';
  itemId?: string;
  page?: number;
};

/** Only forward an item identifier that cannot echo a filesystem path or raw location.
 * Errors are located by the public field path and structural index regardless. */
export function safeStrategyItemId(id: unknown): string | undefined {
  return typeof id === 'string' && id.length > 0 && id.length <= 300 && !/[/\\\u0000-\u001f\u007f]/.test(id) && !/^[A-Za-z]:/.test(id) && !id.startsWith('~') ? id : undefined;
}

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
