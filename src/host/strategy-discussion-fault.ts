export class StrategyDiscussionFault extends Error {
  readonly code: string;
  readonly status: number;

  constructor(code: string, status = 409) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
