import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { ProjectAgent, type ProjectAgentOptions } from '../src/agent/project-runtime.ts';
import { startToolProvider, providerMessageText } from './fixtures/tool-provider.ts';
import { createToolContextAdapter } from '../src/agent/tool-context-adapter.ts';

const target = { type: 'retained', storeId: 'synthetic', materialId: 'synthetic', decisionId: 'synthetic', revisionId: 'synthetic', expectedBodySha256: 'a'.repeat(64) };

test('R1: changing or removing an optional loadout hook remains visible through the public definition view', () => {
  const original = { name: 'mutable_bridge', label: 'Synthetic', description: 'Synthetic mutable metadata', parameters: {},
    execute: async () => ({ content: [{ type: 'text' as const, text: 'synthetic' }], details: {} }),
    prepareLoadout: (() => ({ descriptions: { mutable_bridge: 'first' } })) as (() => { descriptions: { mutable_bridge: string } }) | undefined };
  const view = createToolContextAdapter(() => () => true).tool(original);
  const currentLoadout = () => view.prepareLoadout;
  assert.equal(view.prepareLoadout?.().descriptions.mutable_bridge, 'first');
  original.prepareLoadout = undefined;
  assert.equal(currentLoadout(), undefined);
  original.prepareLoadout = () => ({ descriptions: { mutable_bridge: 'changed' } });
  assert.equal(view.prepareLoadout?.().descriptions.mutable_bridge, 'changed');
});

test('R1 review regression: SDK member renderers retain private receivers while raw callbacks keep their identity', () => {
  class Definition {
    #marker = 'SYNTHETIC_PRIVATE_RENDERER';
    name = 'private_renderer'; label = 'Synthetic renderer'; description = 'Synthetic private renderer'; parameters = {};
    prepareArguments = (value: unknown) => value;
    execute = async () => ({ content: [{ type: 'text' as const, text: 'synthetic' }], details: {} });
    renderCall() { const text = this.#marker; return { render: (_width: number) => [text], invalidate() {} }; }
    renderResult() { const text = this.#marker + '_RESULT'; return { render: (_width: number) => [text], invalidate() {} }; }
  }
  const original = Object.freeze(new Definition()), view = createToolContextAdapter(() => () => true).tool(original);
  assert.deepEqual(original.renderCall().render(80), ['SYNTHETIC_PRIVATE_RENDERER']);
  assert.deepEqual(view.renderCall().render(80), ['SYNTHETIC_PRIVATE_RENDERER']);
  assert.deepEqual(view.renderResult().render(80), ['SYNTHETIC_PRIVATE_RENDERER_RESULT']);
  assert.equal(view.prepareArguments, original.prepareArguments, 'SDK forwards prepareArguments as a raw callback');
});

async function fixture(t: TestContext) {
  const root = path.resolve('.local/pi-sdk-adaptation-repair/runtime', randomUUID());
  const projectDirectory = path.join(root, 'project'), resourceRoot = path.join(root, 'resources');
  for (const name of ['010_draw', '020_clean', '060_reports']) await mkdir(path.join(projectDirectory, name), { recursive: true });
  await mkdir(path.join(resourceRoot, 'extensions'), { recursive: true });
  const provider = await startToolProvider(), agents: ProjectAgent[] = [];
  const options: ProjectAgentOptions = { projectId: randomUUID(), taskId: randomUUID(), projectDirectory, resourceRoot,
    codeRoot: process.cwd(), sessionDirectory: path.join(root, 'native'), managementPorts: [],
    configuration: { id: 'synthetic-sdk-adaptation', name: 'Synthetic SDK adaptation', revision: 1, provider: 'synthetic',
      api: 'openai-completions', baseUrl: provider.baseUrl, model: 'synthetic-sdk-adaptation', apiKey: 'synthetic-only' },
    personalContext: async () => ({ content: [{ type: 'text', text: 'SYNTHETIC_CONTEXT_FROM_HOST' }], details: { schemaVersion: 1, type: 'optracall.personal-context-delivery', action: 'read', items: [], partial: false, continuation: null, issues: [] } }),
  };
  const create = (overrides: Partial<ProjectAgentOptions> = {}) => { const agent = new ProjectAgent({ ...options, ...overrides }); agents.push(agent); return agent; };
  t.after(async () => { for (const agent of agents) await agent.close(); await provider.close(); });
  return { root, options, provider, create };
}

test('R1: a frozen original extension definition remains usable for legitimate nested Host access', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'frozen.ts'), `export default pi=>{
    const definition=Object.freeze({name:'immutable_context_bridge',label:'Synthetic immutable bridge',description:'Synthetic immutable tool',
      parameters:{type:'object',properties:{},additionalProperties:false},
      execute:async function(_id,_args,_signal,_update,ctx){
        const outcome=await ctx.executeTool('read_personal_context',${JSON.stringify({ target })});
        return {content:[{type:'text',text:JSON.stringify({receiverPreserved:this===definition,outcome})}],details:{}};
      }});
    pi.registerTool(definition);
  };`);
  f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'immutable_context_bridge', arguments: {} }] } : { text: 'Synthetic immutable extension completed.' });
  const agent = f.create(), opened = await agent.open();
  assert.ok(opened.tools.includes('immutable_context_bridge'));
  assert.equal((await agent.start('Synthetic legitimate nested access.', randomUUID()).completion).outcome, 'completed');
  const snapshot = await agent.snapshot();
  const native = (await readFile(snapshot.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const result = native.find(entry => entry.message?.role === 'toolResult' && entry.message.toolName === 'immutable_context_bridge')?.message;
  assert.equal(result?.isError, false);
  const body = JSON.parse(result.content[0].text);
  assert.equal(body.receiverPreserved, true);
  assert.equal(body.outcome.isError, false);
  assert.equal(body.outcome.result.content[0].text, 'SYNTHETIC_CONTEXT_FROM_HOST');
});

test('R1: late frozen tools retain private metadata, loadout receiver, hidden replacement and reload semantics', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'late.ts'), `export default pi=>{
    let version=0;
    class Bridge {
      #version;
      constructor(exposure){this.#version=++version;this.name='late_context_bridge';this.label='Synthetic late bridge';
        this.parameters={type:'object',properties:{},additionalProperties:false};this.exposure=exposure;
        this.promptSnippet='Synthetic optional bridge';this.promptGuidelines=['Synthetic guideline'];
        this.annotations={readOnlyHint:true};Object.freeze(this);}
      get description(){return 'Private metadata '+this.#version;}
      prepareLoadout(){return {descriptions:{[this.name]:'Prepared private metadata '+this.#version}};}
      async execute(_id,_args,_signal,_update,ctx){const outcome=await ctx.executeTool('read_personal_context',${JSON.stringify({ target })});
        return {content:[{type:'text',text:JSON.stringify({version:this.#version,outcome})}],details:{}};}
    }
    pi.registerCommand('r1_install',{description:'Synthetic late registration',handler:async()=>{pi.registerTool(new Bridge('direct'));}});
    pi.registerCommand('r1_hide',{description:'Synthetic hide replacement',handler:async()=>{pi.registerTool(new Bridge('hidden'));}});
  };`);
  f.provider.setResponder(({ recentToolResults }) => recentToolResults.length ? { text: 'Synthetic late registration complete.' } : { calls: [{ name: 'late_context_bridge', arguments: {} }] });
  const agent = f.create();
  assert.ok(!(await agent.open()).tools.includes('late_context_bridge'));
  assert.ok((await agent.command('/r1_install')).snapshot.tools.includes('late_context_bridge'));
  assert.equal((await agent.start('Synthetic call after late registration.', randomUUID()).completion).outcome, 'completed');
  assert.ok(JSON.stringify(f.provider.requests[1].body.messages).includes('SYNTHETIC_CONTEXT_FROM_HOST'));
  assert.equal((f.provider.requests[0].body.tools?.find(tool => tool.function?.name === 'late_context_bridge')?.function as { description?: string })?.description, 'Prepared private metadata 1');
  assert.ok(!(await agent.command('/r1_hide')).snapshot.tools.includes('late_context_bridge'));
  assert.ok((await agent.command('/r1_install')).snapshot.tools.includes('late_context_bridge'));
  assert.equal((await agent.start('Synthetic call after hidden replacement.', randomUUID()).completion).outcome, 'completed');
  assert.equal(JSON.parse(providerMessageText(f.provider.requests[3].body.messages?.filter(message => message.role === 'tool').at(-1)?.content)).version, 3);
  assert.equal((f.provider.requests[2].body.tools?.find(tool => tool.function?.name === 'late_context_bridge')?.function as { description?: string })?.description, 'Prepared private metadata 3');
  assert.ok(!(await agent.command('/reload')).snapshot.tools.includes('late_context_bridge'), 'reload must not retain an old registration generation');
  assert.ok((await agent.command('/r1_install')).snapshot.tools.includes('late_context_bridge'));
});

test('R1: a completed nested caller stays revoked while another nested caller is still legitimately active', { timeout: 30_000 }, async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.options.resourceRoot, 'extensions', 'lifetimes.ts'), `export default pi=>{
    const parameters={type:'object',properties:{},additionalProperties:false};
    let prior,entered,release;const waiting=new Promise(resolve=>{entered=resolve;});
    pi.registerTool({name:'r1_capture_finished',label:'Capture',description:'Synthetic completed child',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{prior=ctx;return {content:[{type:'text',text:'captured'}],details:{}};}});
    pi.registerTool({name:'r1_still_running',label:'Running',description:'Synthetic active child',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{await new Promise(resolve=>{release=resolve;entered();});return (await ctx.executeTool('read_personal_context',${JSON.stringify({ target })})).result;}});
    pi.registerTool({name:'r1_lifetime_parent',label:'Parent',description:'Synthetic parallel lifetime test',parameters,execute:async(_id,_args,_signal,_update,ctx)=>{
      await ctx.executeTool('r1_capture_finished',{});
      const live=ctx.executeTool('r1_still_running',{});await waiting;
      const old=await prior.executeTool('read_personal_context',${JSON.stringify({ target })},{signal:new AbortController().signal});
      release();const current=await live;return {content:[{type:'text',text:JSON.stringify({old,current})}],details:{}};
    }});
  };`);
  f.provider.setResponder(({ requestNumber }) => requestNumber === 1 ? { calls: [{ name: 'r1_lifetime_parent', arguments: {} }] } : { text: 'Synthetic paired lifetime complete.' });
  const agent = f.create();
  assert.equal((await agent.start('Synthetic simultaneous completed and live child contexts.', randomUUID()).completion).outcome, 'completed');
  const saved = (await readFile((await agent.snapshot()).sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  const message = saved.find(entry => entry.message?.toolName === 'r1_lifetime_parent')?.message;
  assert.equal(message?.isError, false);
  const body = JSON.parse(message.content[0].text);
  assert.equal(body.old.isError, true);
  assert.equal(body.old.result.content[0].text, 'personal_context_run_unavailable');
  assert.equal(body.current.isError, false);
  assert.equal(body.current.result.content[0].text, 'SYNTHETIC_CONTEXT_FROM_HOST');
});
