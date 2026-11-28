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
  let props: { id:string; caseId:string; issueId:string; kind:'choice'; initial:Fields; readOnly?:boolean } = { ...owner, initial };
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


function captureStore(){const records=new Map<string,any>();const writes:string[]=[];return{records,writes,fetcher:async(url:any,init:any)=>{const id=decodeURIComponent(String(url).split('/').at(-1)!);const old=records.get(id);if(init?.method==='PUT'){const body=JSON.parse(String(init.body));writes.push(id);const d={id,kind:'issue-draft',revision:body.expectedRevision+1,payload:body.payload};records.set(id,d);return Response.json({draft:d});}return old?Response.json({draft:old}):Response.json({code:'not_found'},{status:404});}};}

test('B3 independent: actual keyed remount boundary keeps closed owner input from writing while a new owner is open',async()=>{
 const api=captureStore();const a=await hookHarness(api.fetcher);await a.settle();a.result.change(v=>({...v,reason:'A unsaved'}));a.render();a.changeOwner({...owner,initial,readOnly:true});await a.settle();a.close();const b=await hookHarness(api.fetcher);b.changeOwner({...owner,id:'choice:other:other-issue',caseId:'other',issueId:'other-issue',initial,readOnly:false});try{await b.settle();await new Promise(r=>setTimeout(r,350));await b.settle();assert.deepEqual(api.writes,[]);assert.equal(b.result.value.reason,'');}finally{b.close();}
});
