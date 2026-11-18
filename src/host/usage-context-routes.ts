import type { createUsageContextStore } from './usage-context-store.ts';
import { UsageContextFault, type UsageContextUpdate } from './usage-context-types.ts';

export function createUsageContextRoutes(options: {
  store: ReturnType<typeof createUsageContextStore>;
  mutate<T>(run: () => T | Promise<T>): Promise<T>;
  isClosing(): boolean;
}) {
  return async (pathname: string, method: string, input: Record<string, unknown> = {}): Promise<{ body: unknown } | null> => {
    if (pathname === '/api/settings/usage-context') {
      if (method === 'GET') return { body: await options.store.read() };
      if (method === 'PUT') return { body: await options.mutate(() => {
        if (options.isClosing()) throw new UsageContextFault('host_closing');
        return options.store.update(input as unknown as UsageContextUpdate);
      }) };
    }
    const operation = /^\/api\/settings\/usage-context\/operations\/([^/]+)$/.exec(pathname);
    if (method === 'GET' && operation) return { body: { operation: await options.store.readOperation(operation[1]!) } };
    return null;
  };
}
