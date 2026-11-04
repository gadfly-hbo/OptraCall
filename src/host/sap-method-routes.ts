import type { IncomingMessage } from 'node:http';
import type { SapMethodStore } from '../../extensions/business-plugins/metric-factory/methods/store.ts';
import { SapMethodStoreError, id, positive, object } from '../../extensions/business-plugins/metric-factory/methods/validate.ts';
import type { SapMethodIssueInput, SapMethodPublishInput, SapMethodSaveInput } from '../../extensions/business-plugins/metric-factory/methods/types.ts';

export type SapMethodRouteResult = { status: number; value: unknown };
export type SapMethodSourceText = { label: string; text: string; complete: boolean; limitation?: string; governance?: string };

/** Transport adapter for the same SAP method authority; it cannot publish through extraction. */
export function createSapMethodRoutes(options: {
  store: SapMethodStore;
  readBody(request: IncomingMessage): Promise<Record<string, unknown>>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  isClosing(): boolean;
  enabled?: boolean;
  readSource?(methodId: string, version: number, index: number): Promise<SapMethodSourceText>;
}) {
  const write = <T,>(use: () => T | Promise<T>) => options.mutate(() => {
    if (options.enabled === false) throw new SapMethodStoreError('METHOD_FEATURE_DISABLED', 409);
    if (options.isClosing()) throw new SapMethodStoreError('METHOD_HOST_CLOSING', 409);
    return use();
  });
  const fields = (input: Record<string, unknown>, allowed: string[]) => {
    if (Object.keys(input).some(key => !allowed.includes(key))) throw new SapMethodStoreError('METHOD_INPUT_INVALID');
  };
  return async (request: IncomingMessage, url: URL): Promise<SapMethodRouteResult | undefined> => {
    if (url.pathname !== '/api/sap/methods' && !url.pathname.startsWith('/api/sap/methods/')) return;
    try {
      const parts = url.pathname.slice('/api/sap/methods'.length).split('/').filter(Boolean);
      if (!parts.length && request.method === 'GET') {
        const origin = url.searchParams.get('origin') ?? undefined, status = url.searchParams.get('status') ?? undefined;
        if (origin !== undefined && origin !== 'ir' && origin !== 'other' || status !== undefined && status !== 'draft' && status !== 'published') throw new SapMethodStoreError('METHOD_INPUT_INVALID');
        return { status: 200, value: { methods: options.store.list({ origin, status, query: url.searchParams.get('query') ?? undefined }) } };
      }
      if (!parts.length && request.method === 'POST') {
        const input = await options.readBody(request);
        fields(input, ['requestId', 'title', 'content', 'sources', 'relation']);
        const result = await write(() => options.store.save({ ...input, sources: input.sources ?? [], origin: 'other' } as SapMethodSaveInput));
        return { status: 201, value: result };
      }
      if (parts.length === 1 && parts[0] === 'published' && request.method === 'GET') return { status: 200, value: { methods: options.enabled === false ? [] : options.store.listPublished() } };
      if (parts.length === 2 && parts[0] === 'operations' && request.method === 'GET') {
        const operation = options.store.operation(id(parts[1]));
        return { status: 200, value: { operation, ...(operation?.status === 'committed' ? { method: options.store.read(operation.methodId, operation.version) } : {}) } };
      }
      const methodId = id(parts[0]);
      if (parts.length === 1 && request.method === 'GET') return { status: 200, value: { method: options.store.read(methodId) } };
      if (parts[1] === 'versions' && parts.length === 3 && request.method === 'GET') return { status: 200, value: { method: options.store.read(methodId, positive(Number(parts[2]))) } };
      if (parts[1] === 'versions' && parts.length === 2 && request.method === 'POST') {
        const input = await options.readBody(request);
        fields(input, ['requestId', 'methodId', 'baseVersion', 'title', 'content', 'sources', 'relation']);
        if (input.methodId !== undefined && input.methodId !== methodId) throw new SapMethodStoreError('METHOD_ID_MISMATCH');
        const result = await write(() => {
          const original = options.store.read(methodId);
          return options.store.save({ ...input, methodId, origin: original.origin, sources: input.sources ?? [] } as SapMethodSaveInput);
        });
        return { status: 201, value: result };
      }
      if (parts[1] === 'publish' && parts.length === 2 && request.method === 'POST') {
        const input = await options.readBody(request);
        fields(input, ['requestId', 'version', 'expectedSha256']);
        return { status: 200, value: await write(() => options.store.publish(methodId, input as SapMethodPublishInput)) };
      }
      if (parts[1] === 'issues' && parts.length === 2 && request.method === 'POST') {
        const input = await options.readBody(request);
        fields(input, ['requestId', 'version', 'expectedRevision', 'status', 'note', 'replacement']);
        return { status: 200, value: { method: await write(() => options.store.markIssue(methodId, input as SapMethodIssueInput)) } };
      }
      if (parts[1] === 'versions' && parts[3] === 'sources' && parts.length === 5 && request.method === 'GET') {
        const version = positive(Number(parts[2])), index = Number(parts[4]);
        if (!Number.isSafeInteger(index) || index < 0) throw new SapMethodStoreError('METHOD_SOURCE_INVALID');
        if (!options.readSource) throw new SapMethodStoreError('METHOD_SOURCE_UNAVAILABLE', 409);
        return { status: 200, value: await options.readSource(methodId, version, index) };
      }
      return { status: 404, value: { code: 'METHOD_ROUTE_NOT_FOUND', message: '方法入口不存在。' } };
    } catch (error) {
      const status = error instanceof SapMethodStoreError ? error.status : object(error) && typeof error.status === 'number' ? error.status : 500;
      const code = error instanceof SapMethodStoreError ? error.code : 'METHOD_REQUEST_UNKNOWN';
      return { status, value: { code, message: status >= 500 ? '方法请求结果未能核定，请保留输入和原请求，先读取状态核对。' : '方法请求未完成，请核对版本、内容或来源；原输入与已有版本保持。' } };
    }
  };
}
