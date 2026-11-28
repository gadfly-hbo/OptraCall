import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (value: any): Element[] => !value || typeof value !== 'object' ? [] : Array.isArray(value) ? value.flatMap(nodes) : [value, ...nodes(value.props?.children)];
const text = (value: any): string => value == null || value === false ? '' : typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value) ? value.map(text).join('') : typeof value.type === 'function' && value.type.name === 'InputValues' ? text(value.type(value.props)) : text(value.props?.children);
let bundle: string;
async function mount(fetcher: typeof fetch, props: any) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/CaseActionDraftRecovery.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Recovery', plugins: [{ name: 'hooks', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useState=v=>globalThis.hooks.state(v); export const useRef=v=>globalThis.hooks.ref(v); export const useEffect=(f,d)=>globalThis.hooks.effect(f,d);' }));
  } }] })).outputFiles[0].text;
  const sandbox: any = { fetch: fetcher, Response, URL, URLSearchParams };
  const values: any[] = [], dependencies: any[][] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  let cursor = 0, tree: Element;
  sandbox.hooks = {
    state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (value: any) => { values[i] = typeof value === 'function' ? value(values[i]) : value; }]; },
    ref(initial: any) { const i = cursor++; return values[i] ??= { current: initial }; },
    effect(fn: () => any, deps: any[]) { const i = cursor++; if (!dependencies[i] || deps.some((v, n) => v !== dependencies[i][n])) { dependencies[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = fn(); }); } },
  };
  runInNewContext(bundle, sandbox);
  const render = () => { cursor = 0; tree = sandbox.Recovery.CaseActionDraftRecovery(props); while (effects.length) effects.shift()!(); };
  const settle = async () => { for (let i=0;i<5;i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  render();
  return { props, render, settle, text: () => text(tree), button: (label: string) => nodes(tree).find(node => node.type==='button' && text(node).includes(label)), close: () => { for(const cleanup of cleanups)cleanup?.(); } };
}
const owner = { id:'choice:case:issue',caseId:'case',issueId:'issue',kind:'choice' };
const draft = () => ({ value:{reason:'我的输入'},conflict:null,isRestricted:false,error:'',dirty:false,retainedInput:null,recoveryDraftId:'backup-A',flush:async()=>true,resolveConflict:async()=>true,discardLocal(){} });
const receipt = (id: string, reason: string, extra: any={}) => ({ draft:{id,kind:'issue-draft',revision:1,payload:{caseId:'case',issueId:'issue',text:'',appendedFragmentIds:[],actionForm:{kind:'choice',fields:{reason}},recovery:{originalId:owner.id,sourceRevision:2},...extra}} });


test('independent recovery: exact source revision mismatch never appears',async()=>{
 const value={...draft(),preservedDrafts:[{id:'backup-A',sourceRevision:7}]};
 const ui=await mount(async()=>Response.json(receipt('backup-A','WRONG VERSION')),{draft:value,owner,onDiscard(){}});
 try{ui.button('回读保留副本')!.props.onClick();await ui.settle();assert.doesNotMatch(ui.text(),/WRONG VERSION/);assert.match(ui.text(),/准确归属未能核对/);}finally{ui.close();}
});
test('independent recovery: switching owner hides cached text immediately and rejects late previous owner',async()=>{
 let resolveLate!:()=>void;const gate=new Promise<void>(r=>resolveLate=r);let first=true;
 const ui=await mount(async()=>{if(first){first=false;await gate;}return Response.json(receipt('backup-A','OWNER A ONLY'));},{draft:draft(),owner,onDiscard(){}});
 try{ui.button('回读保留副本')!.props.onClick();ui.props.owner={...owner,id:'choice:other:issue',caseId:'other'};ui.render();resolveLate();await ui.settle();assert.doesNotMatch(ui.text(),/OWNER A ONLY/);ui.button('回读保留副本')!.props.onClick();await ui.settle();assert.doesNotMatch(ui.text(),/OWNER A ONLY/);assert.match(ui.text(),/准确归属未能核对/);}finally{resolveLate();ui.close();}
});
