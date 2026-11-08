export class ModelPackError extends Error {
  code: string; status: number; detail: {stage: string; reason: string; hint?: string};
  constructor(code: string, status = 400, stage = 'structure', reason = code) {
    super(reason); this.code=code; this.status=status; this.detail={stage,reason,hint:'请核对输入或从 MPS 重新导出；不自动重试。'};
  }
}
