import path from 'node:path';
import { isPublicWebUrl } from '../agent/public-web-url.ts';
import { TARGET_MODELS, type RuntimeModelConfiguration } from './config-store.ts';
import { atomicJson, isMissing, object, parse, readBytes, safePath } from './project-data-context-io.ts';

export type SearchProvider = 'minimax' | 'deepseek';
export type WebSearchSettings = { order: SearchProvider[]; configured: Record<SearchProvider, boolean> };

const defaultOrder = ['minimax', 'deepseek'] as const;
const searchRoutes = {
  minimax: { id: 'minimax-m31-flash', url: 'https://api.minimaxi.com/v1/coding_plan/search' },
  deepseek: { id: 'deepseek-flash', url: 'https://api.deepseek.com/v1/tools/search' },
} as const;
const deepSeekFetchUrl = 'https://api.deepseek.com/v1/tools/fetch';
const timeoutMs = 12_000;
const maximumResponseBytes = 2 * 1024 * 1024;
const maximumMarkdownBytes = 128 * 1024;
const maximumToolReceiptBytes = 240 * 1024;
const count = 10;

const messages = {
  invalid_query: '请输入 1 至 128 个字符的非空关键词。',
  invalid_url: '请输入不含账户信息的公开 HTTP(S) 网页网址。',
  invalid_search_order: '搜索优先级必须包含 MiniMax 和 DeepSeek 各一次。',
  search_settings_unavailable: '无法读取或保存搜索优先级。',
  not_configured: '搜索所需的正式模型线路和凭据尚未配置。',
  providers_unavailable: '两条关键词搜索线路均不可用。',
  cancelled: '已取消本次网络工具调用。',
  timeout: '供应商请求超时。',
  network_error: '无法与供应商建立有效连接。',
  auth_invalid: '供应商拒绝了该线路的凭据或权限。',
  quota_exhausted: '供应商额度或余额不足。',
  verification_required: '供应商要求完成账户实名验证。',
  rate_limited: '供应商请求频率受限。',
  safety_rejected: '供应商安全策略拒绝读取此网页。',
  page_unavailable: '供应商未能读取到该网页的可用正文。',
  upstream_error: '供应商请求失败。',
  malformed_response: '供应商返回的结果结构无效。',
  response_too_large: '供应商返回的响应或正文超过预算。',
} as const;
type ErrorCode = keyof typeof messages;
type SearchError = { code: ErrorCode; message: string };
type Attempt = { provider: SearchProvider; status: 'success' } | { provider: SearchProvider; status: 'not_configured' | 'failed'; error: SearchError };
type Failure = { ok: false; error: SearchError; attempts: Attempt[] };
type SearchHit = { title: string; url: string; snippet: string; summary?: string; site?: string; date?: string };
export type WebSearchResult = Failure | { ok: true; provider: SearchProvider; results: SearchHit[]; attempts: Attempt[]; usedFallback: boolean };
export type WebFetchResult = Failure | { ok: true; provider: 'deepseek'; url: string; title: string; markdown: string };

class SearchFault extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode) { super(messages[code]); this.code = code; }
}

const detail = (code: ErrorCode): SearchError => ({ code, message: messages[code] });
const failure = (code: ErrorCode, attempts: Attempt[] = []): Failure => ({ ok: false, error: detail(code), attempts });
const codeOf = (error: unknown): ErrorCode => error instanceof SearchFault ? error.code : 'network_error';

function boundedReceipt<T>(receipt: T): T {
  if (Buffer.byteLength(JSON.stringify(receipt)) > maximumToolReceiptBytes) throw new SearchFault('response_too_large');
  return receipt;
}

function validOrder(value: unknown): value is SearchProvider[] {
  return Array.isArray(value) && value.length === 2 && value.includes('minimax') && value.includes('deepseek');
}

function httpFailure(status: number, page: boolean): ErrorCode {
  switch (status) {
    case 401: return 'auth_invalid';
    case 402: return 'quota_exhausted';
    case 403: return page ? 'safety_rejected' : 'auth_invalid';
    case 404: return page ? 'page_unavailable' : 'upstream_error';
    case 408: case 504: return 'timeout';
    case 429: return 'rate_limited';
    default: return 'upstream_error';
  }
}

function miniMaxHits(value: Record<string, unknown>): unknown {
  const status = object(value.base_resp) ? value.base_resp.status_code : undefined;
  if (status === 0) return value.organic;
  if (!Number.isInteger(status)) throw new SearchFault('malformed_response');
  switch (status) {
    case 1001: throw new SearchFault('timeout');
    case 1002: case 1039: throw new SearchFault('rate_limited');
    case 1004: throw new SearchFault('auth_invalid');
    case 1008: throw new SearchFault('quota_exhausted');
    case 2038: throw new SearchFault('verification_required');
    default: throw new SearchFault('upstream_error');
  }
}

function projectHits(value: unknown, provider: SearchProvider, apiKey: string): SearchHit[] {
  if (!object(value)) throw new SearchFault('malformed_response');
  const rows = provider === 'minimax' ? miniMaxHits(value) : value.results;
  if (!Array.isArray(rows)) throw new SearchFault('malformed_response');
  const redact = (text: string, limit: number) => text.replaceAll(apiKey, '[redacted]').slice(0, limit);
  return rows.slice(0, count).map((row: unknown) => {
    if (!object(row)) throw new SearchFault('malformed_response');
    const url = provider === 'minimax' ? row.link : row.url;
    if (!isPublicWebUrl(url) || url.includes(apiKey) || typeof row.title !== 'string' || typeof row.snippet !== 'string') {
      throw new SearchFault('malformed_response');
    }
    return {
      title: redact(row.title, 512), url, snippet: redact(row.snippet, 4096),
      ...(provider === 'deepseek' && typeof row.summary === 'string' && row.summary ? { summary: redact(row.summary, 4096) } : {}),
      ...(typeof row.site_name === 'string' && row.site_name ? { site: redact(row.site_name, 256) } : {}),
      ...(typeof row.date === 'string' && row.date ? { date: redact(row.date, 128) } : {}),
    };
  });
}

async function responseJson(response: Response, signal: AbortSignal): Promise<unknown> {
  if (!response.body) throw new SearchFault('malformed_response');
  if (Number(response.headers.get('content-length')) > maximumResponseBytes) {
    void response.body.cancel().catch(() => {});
    throw new SearchFault('response_too_large');
  }
  const reader = response.body.getReader();
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener('abort', cancel, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maximumResponseBytes) throw new SearchFault('response_too_large');
      chunks.push(value);
    }
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks, size))); }
    catch { throw new SearchFault('malformed_response'); }
  } finally {
    signal.removeEventListener('abort', cancel);
    cancel();
    reader.releaseLock();
  }
}

export function createWebSearch(options: {
  dataRoot: string;
  configuration: (id: string) => RuntimeModelConfiguration | null;
  fetch?: typeof fetch;
}) {
  const fetchImpl = options.fetch ?? fetch;
  const root = path.resolve(options.dataRoot);
  let writeGate: Promise<unknown> = Promise.resolve();

  function credential(provider: SearchProvider): string | undefined {
    const { id } = searchRoutes[provider];
    const expected = TARGET_MODELS.find(model => model.id === id);
    const model = options.configuration(id);
    if (expected && model?.id === id && model.provider === expected.provider && model.api === expected.api
      && model.baseUrl === expected.baseUrl && model.model === expected.model && model.apiKey.trim()) return model.apiKey;
  }

  async function readOrder(): Promise<SearchProvider[]> {
    try {
      const file = await safePath(root, 'web-search.json');
      const value = parse(await readBytes(file, 1024));
      if (!object(value) || value.schema !== 1 || !validOrder(value.order)) throw new SearchFault('search_settings_unavailable');
      return value.order;
    } catch (error) {
      if (isMissing(error)) return [...defaultOrder];
      throw new SearchFault('search_settings_unavailable');
    }
  }

  function configured(): WebSearchSettings['configured'] {
    return { minimax: Boolean(credential('minimax')), deepseek: Boolean(credential('deepseek')) };
  }

  async function settings(): Promise<WebSearchSettings> { return { order: await readOrder(), configured: configured() }; }

  async function saveOrder(input: unknown): Promise<WebSearchSettings> {
    if (!validOrder(input)) throw new SearchFault('invalid_search_order');
    const order = [...input];
    const write = writeGate.then(async () => {
      try { await atomicJson(await safePath(root, 'web-search.json'), { schema: 1, order }); }
      catch { throw new SearchFault('search_settings_unavailable'); }
      return { order, configured: configured() };
    });
    writeGate = write.catch(() => {});
    return write;
  }

  async function request(url: string, body: Record<string, unknown>, key: string, signal?: AbortSignal, miniMax = false): Promise<unknown> {
    if (signal?.aborted) throw new SearchFault('cancelled');
    const timeout = AbortSignal.timeout(timeoutMs);
    const upstream = signal ? AbortSignal.any([signal, timeout]) : timeout;
    const onAbort = () => rejectAbort(new SearchFault(signal?.aborted ? 'cancelled' : 'timeout'));
    let rejectAbort!: (error: SearchFault) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    upstream.addEventListener('abort', onAbort, { once: true });
    const exchange = async () => {
      const response = await fetchImpl(url, {
        method: 'POST', redirect: 'error', signal: upstream,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...(miniMax ? { 'MM-API-Source': 'Minimax-MCP' } : {}) },
        body: JSON.stringify(body),
      });
      if (upstream.aborted || !response.ok) {
        void response.body?.cancel().catch(() => {});
        if (upstream.aborted) throw new SearchFault(signal?.aborted ? 'cancelled' : 'timeout');
        throw new SearchFault(httpFailure(response.status, url === deepSeekFetchUrl));
      }
      return responseJson(response, upstream);
    };
    try {
      const result = await Promise.race([exchange(), aborted]);
      if (upstream.aborted) throw new SearchFault(signal?.aborted ? 'cancelled' : 'timeout');
      return result;
    } catch (error) {
      throw new SearchFault(signal?.aborted ? 'cancelled' : timeout.aborted ? 'timeout' : codeOf(error));
    } finally { upstream.removeEventListener('abort', onAbort); }
  }

  async function search(query: string, signal?: AbortSignal): Promise<WebSearchResult> {
    if (signal?.aborted) return failure('cancelled');
    if (typeof query !== 'string' || !query.trim() || query.length > 256 || [...query].length > 128 || /[\0\uD800-\uDFFF]/u.test(query)) return failure('invalid_query');
    let order: SearchProvider[];
    try { order = await readOrder(); } catch { return failure(signal?.aborted ? 'cancelled' : 'search_settings_unavailable'); }
    const attempts: Attempt[] = [];
    for (const provider of order) {
      if (signal?.aborted) return failure('cancelled', attempts);
      const key = credential(provider);
      if (!key) { attempts.push({ provider, status: 'not_configured', error: detail('not_configured') }); continue; }
      try {
        const miniMax = provider === 'minimax';
        const payload = miniMax ? { q: query } : { query, count, need_content: false };
        const results = projectHits(await request(searchRoutes[provider].url, payload, key, signal, miniMax), provider, key);
        if (signal?.aborted) return failure('cancelled', attempts);
        return boundedReceipt<WebSearchResult>({
          ok: true, provider, results, attempts: [...attempts, { provider, status: 'success' }], usedFallback: provider !== order[0],
        });
      } catch (error) {
        const code = codeOf(error);
        attempts.push({ provider, status: 'failed', error: detail(code) });
        if (code === 'cancelled' || signal?.aborted) return failure('cancelled', attempts);
      }
    }
    return failure('providers_unavailable', attempts);
  }

  async function fetchPage(url: string, signal?: AbortSignal): Promise<WebFetchResult> {
    if (signal?.aborted) return failure('cancelled');
    if (!isPublicWebUrl(url)) return failure('invalid_url');
    const key = credential('deepseek');
    if (!key) return failure('not_configured', [{ provider: 'deepseek', status: 'not_configured', error: detail('not_configured') }]);
    if (url.includes(key)) return failure('invalid_url');
    try {
      const value = await request(deepSeekFetchUrl, { url }, key, signal);
      if (signal?.aborted) throw new SearchFault('cancelled');
      if (!object(value) || typeof value.title !== 'string' || typeof value.content !== 'string') throw new SearchFault('malformed_response');
      if (!value.content.trim()) throw new SearchFault('page_unavailable');
      if (Buffer.byteLength(value.content) > maximumMarkdownBytes) throw new SearchFault('response_too_large');
      return boundedReceipt<WebFetchResult>({
        ok: true, provider: 'deepseek', url, title: value.title.replaceAll(key, '[redacted]').slice(0, 512), markdown: value.content.replaceAll(key, '[redacted]'),
      });
    } catch (error) {
      const code = codeOf(error);
      return failure(code, [{ provider: 'deepseek', status: 'failed', error: detail(code) }]);
    }
  }

  return { settings, saveOrder, search, fetchPage };
}
