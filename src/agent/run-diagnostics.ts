import type { Outcome } from './events.ts';

export type RunDiagnosticCode = 'authentication_failed' | 'rate_limited' | 'request_terminated' | 'request_failed' | 'http_body_timeout' | 'http_headers_timeout' | 'http_connect_timeout' | 'http_connection_closed' | 'command_failed' | 'runtime_stopped' | 'runtime_start_failed' | 'runtime_start_timeout' | 'cancelled' | 'completed_after_retry' | 'verification_source_changed' | 'verification_source_missing';
export type RunDiagnostic = { code: RunDiagnosticCode; stage: 'native_request' | 'native_command' | 'runtime'; message: string; retryCount: number };
const messages: Record<RunDiagnosticCode, string> = {
  authentication_failed: '原生模型请求被拒绝认证，请检查该任务的模型配置。',
  rate_limited: '原生模型请求收到限流响应；本次操作未能完成。',
  request_terminated: '原生模型请求意外终止，底层原因尚未确定。',
  request_failed: '原生模型请求未能完成，具体原因尚未确定。',
  http_body_timeout: '本轮观测到模型服务响应体空闲超时，请求未能完成。',
  http_headers_timeout: '本轮等待模型服务响应头超时，请求未能完成。',
  http_connect_timeout: '本轮连接模型服务超时，请求未能完成。',
  http_connection_closed: '本轮观测到模型服务连接关闭；关闭来源尚未确定。',
  command_failed: '原生命令或扩展未能完成。',
  runtime_stopped: '原生运行进程已停止，执行结果需核对。',
  runtime_start_failed: '原生运行环境未能启动。',
  runtime_start_timeout: '等待原生运行环境启动超时。',
  cancelled: '本次操作已取消。',
  completed_after_retry: '本次操作经原生重试后完成。',
  verification_source_changed: '本次核对的原始文件已变化，修订交付失败；原冻结证据保留。',
  verification_source_missing: '本次核对的原始文件或项目目录已缺失，修订交付失败；原冻结证据保留。',
};
const count = (value: unknown): number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
function diagnostic(code: RunDiagnosticCode, stage: RunDiagnostic['stage'], retryCount: number): RunDiagnostic { return { code, stage, message: messages[code], retryCount: count(retryCount) }; }

/** Only classify explicit observations. Provider error text is never copied into
 * a diagnostic; ambiguous failures retain an unknown-cause message. */
export function runDiagnostic(input: { outcome: Outcome; kind: 'prompt' | 'command'; retryCount?: number; error?: unknown; commandFailed?: boolean; transportCause?: string }): RunDiagnostic | undefined {
  const retryCount = count(input.retryCount), stage = input.kind === 'command' ? 'native_command' : 'native_request';
  if (input.outcome === 'completed') return retryCount ? diagnostic('completed_after_retry', stage, retryCount) : undefined;
  if (input.outcome === 'cancelled') return diagnostic('cancelled', stage, retryCount);
  if (input.commandFailed || input.kind === 'command') return diagnostic('command_failed', stage, retryCount);
  const message = typeof input.error === 'string' ? input.error.trim() : input.error instanceof Error ? input.error.message.trim() : '';
  const code: RunDiagnosticCode = /^(?:401|403)(?:\s|:|$)/.test(message) ? 'authentication_failed'
    : /^429(?:\s|:|$)/.test(message) ? 'rate_limited'
    : input.transportCause === 'UND_ERR_BODY_TIMEOUT' ? 'http_body_timeout'
    : input.transportCause === 'UND_ERR_HEADERS_TIMEOUT' ? 'http_headers_timeout'
    : input.transportCause === 'UND_ERR_CONNECT_TIMEOUT' ? 'http_connect_timeout'
    : input.transportCause === 'UND_ERR_SOCKET' || input.transportCause === 'ECONNRESET' ? 'http_connection_closed'
    : message.toLowerCase() === 'terminated' ? 'request_terminated' : 'request_failed';
  return diagnostic(code, stage, retryCount);
}

/** Runtime exceptions can occur before a native terminal result exists. Do not
 * inspect cause/stack or emit the original exception message. */
export function runtimeDiagnostic(error: unknown): RunDiagnostic {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
  const observed: RunDiagnosticCode = code === 'verification_source_changed' || code === 'verification_source_missing' ? code
    : code === 'runtime_process_stopped' || code === 'runtime_closed' ? 'runtime_stopped'
    : code === 'runtime_start_failed' || code === 'runtime_start_timeout' ? code : 'request_failed';
  return diagnostic(observed, 'runtime', 0);
}

/** Rebuild safe messages when reading saved/native metadata. Old records need
 * no diagnostic; unrecognised optional metadata is ignored without rewriting it. */
export function readRunDiagnostic(value: unknown, outcome?: Outcome): RunDiagnostic | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const item = value as Record<string, unknown>;
  if (typeof item.code !== 'string' || !Object.hasOwn(messages, item.code) || typeof item.stage !== 'string' || !['native_request', 'native_command', 'runtime'].includes(item.stage) || typeof item.retryCount !== 'number' || !Number.isSafeInteger(item.retryCount) || item.retryCount < 0) return undefined;
  if (outcome === 'completed' && item.code !== 'completed_after_retry' || outcome === 'cancelled' && item.code !== 'cancelled' || outcome === 'failed' && (item.code === 'cancelled' || item.code === 'completed_after_retry')) return undefined;
  return diagnostic(item.code as RunDiagnosticCode, item.stage as RunDiagnostic['stage'], item.retryCount);
}
