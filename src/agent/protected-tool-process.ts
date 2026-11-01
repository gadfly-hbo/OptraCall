import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Socket } from 'node:net';
import { createReadTool, createWriteTool, createEditTool, createBashTool, createGrepTool, createFindTool, createLsTool, createCodemodeExtension, type ExtensionAPI, type ToolDefinition } from './sdk.ts';
import { groupedBashOperations } from './protected-bash-operations.ts';

/** Runs only inside the OS-constrained subprocess. No model/session API. */
export async function runProtectedToolProcess() {
  let used = false, controller: AbortController | undefined, pending: Promise<void> | undefined;
  const channel = process.argv.includes('--worker-json') ? new Socket({ fd: 3, readable: true, writable: true }) : undefined;
  const disconnect = () => { if (channel) { channel.end(); channel.unref(); } else if (process.connected) process.disconnect?.(); };
  const shutdown = () => { controller?.abort(); void pending?.finally(disconnect); };
  process.on('SIGTERM', shutdown); process.on('SIGHUP', shutdown); process.on('disconnect', shutdown);
  const receive = (input: any) => {
    if (used || input?.kind !== 'protected.execute' || typeof input.nonce !== 'string' || typeof input.scopeId !== 'string' || typeof input.toolCallId !== 'string') return;
    used = true; controller = new AbortController();
    const send = (kind: 'protected.progress' | 'protected.result', value: Record<string, unknown>) => {
      const message = { kind, nonce: input.nonce, scopeId: input.scopeId, toolCallId: input.toolCallId, ...value };
      if (channel && !channel.destroyed) channel.write(JSON.stringify(message) + '\n');
      else if (process.connected) process.send?.(message);
    };
    pending = (async () => {
      try {
        const cwd: string = input.cwd, storePath = path.join(input.writableRoot, '.codemode-store.json');
        const tools = [createReadTool(cwd), createWriteTool(cwd), createEditTool(cwd), createBashTool(cwd, { exposeSessionEnvironment: false, shellPath: '/bin/bash', operations: groupedBashOperations }), createGrepTool(cwd), createFindTool(cwd), createLsTool(cwd)].filter(tool => Array.isArray(input.toolNames) && input.toolNames.includes(tool.name));
        let stores: any[] = [];
        try { const state = JSON.parse(await readFile(storePath, 'utf8')); if (Array.isArray(state)) stores = state; } catch { /* no prior execution-local store */ }
        let codemode: ToolDefinition | undefined;
        const api = { registerTool: (definition: ToolDefinition) => { codemode = definition; }, getAllTools: () => tools, getSettings: () => ({}), appendEntry: (customType: string, data: unknown) => {
          if (customType === 'codemode-store') stores.push({ type: 'custom', customType, data });
        } };
        createCodemodeExtension({ models: false, mode: 'on' })(api as unknown as ExtensionAPI);
        const context = {
          cwd, tools,
          sessionManager: { getBranch: () => stores },
          executeTool: async (name: string, params: unknown, options: { signal?: AbortSignal } = {}) => {
            const tool = tools.find(item => item.name === name);
            if (!tool) throw new Error('protected_tool_unavailable');
            const id = input.toolCallId + '/' + randomUUID();
            try {
              const result = await tool.execute(id, params as never, options.signal ?? controller!.signal);
              return { toolCall: { id, name, arguments: params }, result, isError: Boolean((result as { isError?: boolean }).isError) };
            } catch (error) { return { toolCall: { id, name, arguments: params }, result: { content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }] }, isError: true }; }
          },
        };
        let result;
        if (input.tool === 'codemode' && codemode) result = await codemode.execute(input.toolCallId, input.params, controller!.signal, value => send('protected.progress', { result: value }), context as never);
        else {
          const tool = tools.find(item => item.name === input.tool);
          if (!tool) throw new Error('protected_tool_unavailable');
          result = await tool.execute(input.toolCallId, input.params, controller!.signal, value => send('protected.progress', { result: value }));
        }
        if (stores.length) await writeFile(storePath, JSON.stringify(stores), { mode: 0o600 });
        send('protected.result', { result });
      } catch (error) { send('protected.result', { error: error instanceof Error ? error.message : String(error) }); }
      finally { disconnect(); }
    })();
  };
  if (channel) {
    let buffered = '';
    channel.on('data', chunk => {
      buffered += chunk.toString();
      const end = buffered.indexOf('\n');
      if (end >= 0) { const line = buffered.slice(0, end); buffered = ''; try { receive(JSON.parse(line)); } catch { shutdown(); } }
    });
    channel.on('end', shutdown); channel.on('error', shutdown);
  } else process.on('message', receive);
}
