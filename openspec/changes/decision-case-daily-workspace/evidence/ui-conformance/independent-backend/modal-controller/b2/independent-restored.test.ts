import test from 'node:test';
import assert from 'node:assert/strict';
import { createCaseActionDraft, type CaseActionDraftPayload } from '/workspace/OptraCall-issue149-ui-conformance/src/host/ui/case-action-draft.ts';
import type { WorkspaceDraftRecord } from '/workspace/OptraCall-issue149-ui-conformance/src/host/workspace-draft-store.ts';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Fields = { reason: string; operationId: string; responseKey: string };
const owner = { id: 'choice:case:issue', caseId: 'case', issueId: 'issue', kind: 'choice' as const };
const initial: Fields = { reason: '', operationId: 'op-1', responseKey: '' };
type Draft = WorkspaceDraftRecord<CaseActionDraftPayload<Fields>>;
function store() {
  let record: Draft | null = null;
  const calls: CaseActionDraftPayload<Fields>[] = [];
  return {
    get record() { return record; }, set record(next: Draft | null) { record = next; }, calls,
    read: async () => record,
    save: async (revision: number, payload: CaseActionDraftPayload<Fields>) => {
      if (revision !== (record?.revision ?? 0)) throw Object.assign(Error('draft_revision_conflict'), { status: 409 });
      calls.push(structuredClone(payload));
      return record = { kind: 'issue-draft', id: owner.id, revision: revision + 1, payload: structuredClone(payload), createdAt: '', updatedAt: '' };
    },
  };
}

let hookBundle: string | undefined;
async function hookHarness(fetcher: typeof fetch) {
  hookBundle ??= (await build({ stdin: { contents: "export { useCaseActionDraft } from './src/host/ui/useCaseActionDraft.ts'; export { flushWorkspaceInputs } from './src/host/ui/workspace-input-guards.ts';", resolveDir: process.cwd(), loader: 'ts' }, bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'ActionDraftUi', plugins: [{ name: 'action-draft-hooks', setup(plugin) {
    plugin.onResolve({ filter: /^react$/ }, args => ({ path: args.path, namespace: 'action-draft-react' }));
    plugin.onLoad({ filter: /.*/, namespace: 'action-draft-react' }, () => ({ contents: 'export const useState=v=>globalThis.hooks.state(v); export const useRef=v=>globalThis.hooks.ref(v); export const useEffect=(f,d)=>globalThis.hooks.effect(f,d); export const useMemo=(f,d)=>globalThis.hooks.memo(f,d); export const useCallback=(f,d)=>globalThis.hooks.memo(()=>f,d);' }));
  } }] })).outputFiles[0].text;
  const events = new Map<string, Set<(event: any) => void>>();
  const sandbox: Record<string, any> = { fetch: fetcher, structuredClone, crypto, URL, URLSearchParams, Response, Request, Headers, setTimeout, clearTimeout,
    window: { addEventListener(name: string, fn: (event: any) => void) { if (!events.has(name)) events.set(name, new Set()); events.get(name)!.add(fn); }, removeEventListener(name: string, fn: (event: any) => void) { events.get(name)?.delete(fn); } },
  };
  runInNewContext(hookBundle, sandbox);
  let cursor = 0, result: ReturnType<typeof import('/workspace/OptraCall-issue149-ui-conformance/src/host/ui/useCaseActionDraft.ts').useCaseActionDraft<Fields>>;
  let props = { ...owner, initial };
  const values: any[] = [], dependencies: any[][] = [], cleanups: any[] = [], effects: (() => void)[] = [];
  const changed = (i: number, next: any[]) => !dependencies[i] || next.some((v, n) => v !== dependencies[i][n]);
  sandbox.hooks = {
    state(value: any) { const i = cursor++; if (!(i in values)) values[i] = typeof value === 'function' ? value() : value; return [values[i], (next: any) => { values[i] = typeof next === 'function' ? next(values[i]) : next; }]; },
    ref(value: any) { const i = cursor++; return values[i] ??= { current: value }; },
    memo(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; values[i] = fn(); } return values[i]; },
    effect(fn: () => any, deps: any[]) { const i = cursor++; if (changed(i, deps)) { dependencies[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  const render = () => { cursor = 0; result = sandbox.ActionDraftUi.useCaseActionDraft(props); while (effects.length) effects.shift()!(); return result; };
  const settle = async () => { for (let i = 0; i < 6; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } return result; };
  render();
  return { render, settle, get result() { return result; }, changeOwner(next: typeof props) { props = next; render(); }, flush: () => sandbox.ActionDraftUi.flushWorkspaceInputs() as Promise<boolean>,
    unload(event: any) { events.get('beforeunload')?.forEach(fn => fn(event)); }, close() { for (const cleanup of cleanups) cleanup?.(); } };
}


test('B2 independent: absent draft is ready but not restored, including after its first save',async()=>{
 const api=store();const d=createCaseActionDraft({...owner,initial,read:api.read,save:api.save});assert.equal(d.getSnapshot().restored,false);await d.load();assert.equal(d.getSnapshot().ready,true);assert.equal(d.getSnapshot().restored,false);d.update({...initial,reason:'new'});await d.flush();assert.equal(d.getSnapshot().restored,false);
});
test('B2 independent: explicitly saved empty selections count as restored and override supplied defaults',async()=>{
 const api=store();await api.save(0,{caseId:owner.caseId,issueId:owner.issueId,text:'',appendedFragmentIds:[],actionForm:{kind:'choice',fields:{...initial,reason:'',responseKey:'',operationId:'saved-original'}}});const d=createCaseActionDraft({...owner,initial:{...initial,reason:'new default',responseKey:'default-request'},read:api.read,save:api.save});await d.load();assert.equal(d.getSnapshot().restored,true);assert.equal(d.getSnapshot().value.reason,'');assert.equal(d.getSnapshot().value.responseKey,'');assert.equal(d.getSnapshot().value.operationId,'saved-original');assert.equal(await d.flush(),true);assert.equal(api.calls.length,1);
});
test('B2 independent: rejected owner or unavailable reads cannot assert restored',async()=>{
 for(const mode of ['owner','503','403']){const d=createCaseActionDraft({...owner,initial,read:async()=>{if(mode!=='owner')throw Object.assign(Error(mode),{status:Number(mode)});return {kind:'issue-draft',id:'wrong-owner',revision:1,payload:{caseId:owner.caseId,issueId:owner.issueId,text:'',appendedFragmentIds:[],actionForm:{kind:'choice',fields:initial}},createdAt:'',updatedAt:''};},save:async()=>{throw Error('unexpected');}});await assert.rejects(d.load());assert.equal(d.getSnapshot().restored,false);assert.equal(d.getSnapshot().ready,false);}
});
test('B2 independent: hook exposes restored only for the loaded owner and preserves empty request selection',async()=>{
 const record={kind:'issue-draft',id:owner.id,revision:1,payload:{caseId:owner.caseId,issueId:owner.issueId,text:'',appendedFragmentIds:[],actionForm:{kind:'choice',fields:{...initial,responseKey:''}}},createdAt:'',updatedAt:''};
 const h=await hookHarness(async url=>String(url).endsWith(encodeURIComponent(owner.id))?Response.json({draft:record}):Response.json({code:'not_found'},{status:404}));
 try{assert.equal(h.result.restored,false);await h.settle();assert.equal(h.result.restored,true);assert.equal(h.result.value.responseKey,'');h.changeOwner({...owner,id:'choice:case:second',issueId:'second',initial});assert.equal(h.result.restored,false);await h.settle();assert.equal(h.result.ready,true);assert.equal(h.result.restored,false);}finally{h.close();}
});
