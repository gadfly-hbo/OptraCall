import { configureHttpTransport } from '../../scripts/http-transport.mjs';

const transport = configureHttpTransport();
const { AgentRuntime } = await import('../../src/agent/runtime.ts');
const [name, baseUrl] = process.argv.slice(2);
if (new URL(baseUrl).hostname !== '127.0.0.1') throw new Error('Only synthetic loopback providers are allowed.');
const runtime = new AgentRuntime('/optracall-virtual');
const config = { name: 'synthetic', provider: 'openai-compatible', baseUrl, model: 'synthetic-model', apiKey: 'synthetic-runtime-key', revision: 1 };
try {
  if (name === 'immediate-stop') {
    const session = await runtime.create('p', config);
    const events = []; runtime.subscribe(session.id, event => events.push(event));
    const run = runtime.start(session.id, '合成取消测试');
    await runtime.stop(session.id);
    const result = await run.completion;
    process.stdout.write(`${JSON.stringify({ outcome: result.outcome, terminal: events.filter(event => event.type === 'run.settled').map(event => event.outcome) })}\n`);
  } else if (name === 'create-clear') {
    const warmup = await runtime.create('warmup', config); await runtime.close(warmup.id);
    const pending = runtime.create('p', config);
    await runtime.clear();
    let pendingResult;
    try { await pending; pendingResult = 'resolved'; } catch (error) { pendingResult = error.code; }
    let recreated = false;
    try { await runtime.create('p', config); recreated = true; } catch {}
    process.stdout.write(`${JSON.stringify({ pendingResult, recreated })}\n`);
  } else throw new Error('Unknown synthetic case.');
} finally { await runtime.clear(); await transport.close(); }
