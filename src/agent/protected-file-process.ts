import path from 'node:path';
import { Socket } from 'node:net';
import { createReadTool, createWriteTool, createEditTool, createLsTool } from './sdk.ts';

const VERSION = 2;
const MAX_LINE = 32 * 1024 * 1024;
const identityKeys = ['scopeId', 'nonce', 'toolCallId'] as const;
type Identity = Readonly<Record<typeof identityKeys[number], string>>;
type Message = Record<string, unknown>;
type FileTool = ReturnType<typeof createReadTool | typeof createWriteTool | typeof createEditTool | typeof createLsTool>;

/** Native file operations only, inside the scope's OS-constrained execution group. */
export function runProtectedFileProcess() {
  const channel = new Socket({ fd: 3, readable: true, writable: true });
  let identity: Identity | undefined;
  let tools: FileTool[] | undefined;
  let sealed = false, released = false, disconnected = false;
  const seen = new Set<string>();
  const pending = new Map<string, AbortController>();

  const disconnect = () => {
    if (disconnected) return;
    disconnected = true;
    // The channel is the only deliberate keepalive. Native fs/image work may
    // outlive the SDK's outer promise, and must be allowed to finish naturally.
    channel.end();
    channel.unref();
  };
  const finishRelease = () => { if (sealed && pending.size === 0) disconnect(); };
  const fault = () => {
    sealed = true;
    for (const controller of pending.values()) controller.abort();
    finishRelease();
  };
  const send = (kind: string, value: Message = {}) => {
    if (!identity || disconnected || channel.destroyed || !channel.writable) return;
    channel.write(JSON.stringify({ kind, version: VERSION, ...identity, ...value }) + '\n');
  };
  const exactKeys = (message: Message, extra: string[]) => {
    const allowed = new Set(['kind', 'version', ...identityKeys, ...extra]);
    return Object.keys(message).every(key => allowed.has(key));
  };
  const validIdentity = (message: Message) => message.version === VERSION && identityKeys.every(key => typeof message[key] === 'string' && message[key].length > 0 && message[key].length <= 1024 && (!identity || message[key] === identity[key]));
  const receive = (input: unknown) => {
    if (disconnected) return;
    if (!input || typeof input !== 'object' || Array.isArray(input)) { fault(); return; }
    const message = input as Message;
    if (!validIdentity(message)) { fault(); return; }
    if (!identity) {
      if (message.kind !== 'protected.open' || !exactKeys(message, ['cwd']) || typeof message.cwd !== 'string' || !path.isAbsolute(message.cwd) || path.resolve(message.cwd) !== process.cwd()) { fault(); return; }
      identity = Object.freeze(Object.fromEntries(identityKeys.map(key => [key, message[key]]))) as Identity;
      const cwd = message.cwd;
      // Each factory is constructed once. In particular, keep the SDK's own
      // file mutation queue and its read/image implementation intact.
      tools = [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createLsTool(cwd)];
      send('protected.worker-ready');
      return;
    }
    if (message.kind === 'protected.release') {
      if (!exactKeys(message, [])) { fault(); return; }
      sealed = true; released = true; finishRelease();
      return;
    }
    if (message.kind === 'protected.cancel') {
      if (!exactKeys(message, ['callId']) || typeof message.callId !== 'string' || !message.callId.length) { fault(); return; }
      pending.get(message.callId)?.abort();
      return;
    }
    if (message.kind !== 'protected.execute' || !exactKeys(message, ['callId', 'tool', 'params']) || typeof message.callId !== 'string' || !message.callId.length || message.callId.length > 1024 || typeof message.tool !== 'string') { fault(); return; }
    const callId = message.callId;
    // Keep only the small replay identity after settlement, never a result or
    // callback. Neither duplicate nor cancelled calls are executed again.
    if (seen.has(callId)) return;
    seen.add(callId);
    if (sealed) { send('protected.result', { callId, error: 'protected_executor_draining' }); return; }
    const tool = tools!.find(item => item.name === message.tool);
    if (!tool) { send('protected.result', { callId, error: 'protected_tool_unavailable' }); return; }
    const controller = new AbortController();
    pending.set(callId, controller);
    void (async () => {
      try {
        const result = await tool.execute(callId, message.params as never, controller.signal, result => {
          if (!controller.signal.aborted && pending.get(callId) === controller) send('protected.progress', { callId, result });
        });
        send('protected.result', { callId, result });
      } catch (error) {
        send('protected.result', { callId, error: error instanceof Error ? error.message : String(error) });
      } finally {
        pending.delete(callId);
        finishRelease();
      }
    })();
  };

  let fragments: Buffer[] = [], bufferedBytes = 0;
  channel.on('data', (chunk: Buffer) => {
    let offset = 0;
    while (offset < chunk.length && !disconnected) {
      const end = chunk.indexOf(10, offset);
      const piece = chunk.subarray(offset, end < 0 ? chunk.length : end);
      bufferedBytes += piece.length;
      if (bufferedBytes > MAX_LINE) { fragments = []; fault(); return; }
      if (end < 0) { fragments.push(piece); return; }
      const line = fragments.length ? Buffer.concat([...fragments, piece], bufferedBytes) : piece;
      fragments = []; bufferedBytes = 0;
      try { receive(JSON.parse(line.toString('utf8'))); } catch { fault(); return; }
      offset = end + 1;
    }
  });
  channel.on('end', () => { if (!released) fault(); });
  channel.on('error', fault);
  process.on('SIGTERM', fault);
  process.on('SIGHUP', fault);
  process.on('disconnect', fault);
}
