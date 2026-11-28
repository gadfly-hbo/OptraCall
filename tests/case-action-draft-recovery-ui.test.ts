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

test('DW13/16: recovery readback is bound to its exact owner and backup ID; late previous-version responses never replace the new source',async()=>{
  let release!:()=>void;const deferred=new Promise<void>(resolve=>{release=resolve;});
  const ui=await mount(async input=>{const id=String(input).split('/').at(-1)!;if(id==='backup-A')await deferred;return Response.json(receipt(id,id==='backup-A'?'旧副本A':'新副本B'));},{draft:draft(),owner,onDiscard(){}});
  try {
    ui.button('回读保留副本')!.props.onClick();
    ui.props.draft={...draft(),recoveryDraftId:'backup-B'};ui.render();assert.doesNotMatch(ui.text(),/旧副本A/);
    ui.button('回读保留副本')!.props.onClick();await ui.settle();assert.match(ui.text(),/新副本B/);
    release();await ui.settle();assert.match(ui.text(),/新副本B/);assert.doesNotMatch(ui.text(),/旧副本A/);
  } finally {release();ui.close();}
});

test('DW16: forbidden or misbound recovery reads remove source content and cannot be presented as the requested version',async()=>{
  for(const mode of ['forbidden','wrong-owner','wrong-source']){
    let invalid=false;
    const ui=await mount(async()=>invalid ? mode==='forbidden'?Response.json({code:'forbidden'},{status:403}):Response.json(receipt('backup-A','不应出现',mode==='wrong-owner'?{caseId:'other-case'}:{recovery:{originalId:'other-draft',sourceRevision:2}})) : Response.json(receipt('backup-A','曾读到的正文')),{draft:draft(),owner,onDiscard(){}});
    try {ui.button('回读保留副本')!.props.onClick();await ui.settle();assert.match(ui.text(),/曾读到的正文/);invalid=true;ui.button('回读保留副本')!.props.onClick();await ui.settle();assert.doesNotMatch(ui.text(),/曾读到的正文|不应出现/);assert.match(ui.text(),/准确归属未能核对/);}finally{ui.close();}
  }
});

test('DW13: conflict replacement requires a successful preservation receipt before explicitly flushing my draft',async()=>{
  for(const accepted of [false,true]){
    const calls:string[]=[];const value={...draft(),recoveryDraftId:null,conflict:{revision:7,value:{reason:'另一处的原输入'}},dirty:true,resolveConflict:async(revision:number)=>{calls.push(`preserve:${revision}`);return accepted;},flush:async()=>{calls.push('flush');return true;}};
    const ui=await mount(async()=>Response.json({}),{draft:value,owner,onDiscard(){}});
    try{assert.match(ui.text(),/另一处的原输入/);await ui.button('保留另一版本，并保存我的输入')!.props.onClick();assert.deepEqual(calls,accepted?['preserve:7','flush']:['preserve:7']);}finally{ui.close();}
  }
});
