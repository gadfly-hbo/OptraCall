import { randomUUID } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

/** Synthetic v3 ledger for deterministic append timing; all test-owned paths are supplied by the caller. */
export function syntheticNativeHistory(directory: string, cwd: string) {
  const id = randomUUID(), file = path.join(directory, id + '.jsonl');
  writeFileSync(file, JSON.stringify({ type: 'session', version: 3, id, cwd, timestamp: new Date().toISOString() }) + '\n');
  let parentId: string | null = null;
  const append = (value: Record<string, unknown>) => {
    const id = randomUUID();
    appendFileSync(file, JSON.stringify({ ...value, id, parentId, timestamp: new Date().toISOString() }) + '\n'); parentId = id;
  };
  return { file, append,
    message(role: 'user' | 'assistant', text: string) {
      const message = role === 'user' ? { role, content: text, timestamp: Date.now() } : {
        role, content: [{ type: 'text', text }], timestamp: Date.now(), api: 'openai-completions', provider: 'synthetic', model: 'synthetic',
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }, stopReason: 'stop',
      };
      append({ type:'message', message });
    },
  };
}
