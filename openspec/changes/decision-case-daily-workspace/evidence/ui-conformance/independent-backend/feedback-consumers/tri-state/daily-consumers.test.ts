import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element = { type: string | ((props: any) => any); props: Record<string, any> };
const nodes = (node: any): Element[] => !node || typeof node !== 'object' ? [] : Array.isArray(node) ? node.flatMap(nodes) : [node, ...nodes(node.props?.children)];
const text = (node: any): string => node == null || node === false ? '' : typeof node === 'string' || typeof node === 'number' ? String(node) : Array.isArray(node) ? node.map(text).join('') : text(node.props?.children);
let bundle: string | undefined;
async function harness(fetcher: typeof fetch, props: Record<string, any>) {
  bundle ??= (await build({ entryPoints: ['src/host/ui/DailyCaseHistory.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'HistoryUiTest', plugins: [{ name: 'history-ui-fixture', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'history-hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'history-hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props}); export const jsxs=jsx; export const Fragment="fragment";' : 'export const useState=v=>globalThis.__hooks.state(v); export const useEffect=(f,d)=>globalThis.__hooks.effect(f,d);' }));
    plugin.onResolve({ filter: /CaseDialogs\.tsx$/ }, args => ({ path: args.path, namespace: 'history-dialog' }));
    plugin.onLoad({ filter: /.*/, namespace: 'history-dialog' }, () => ({ contents: 'export const caseError=e=>e.message; export const caseDate=value=>value; export function CaseDialog(){return null;}' }));
    plugin.onLoad({ filter: /\.css$/ }, () => ({ contents: '', loader: 'js' }));
  } }] })).outputFiles[0].text;
  const sandbox: Record<string, any> = { fetch: fetcher, Response, URL, URLSearchParams };
  runInNewContext(bundle, sandbox);
  const values: any[] = [], dependencies: any[][] = [], cleanup: (() => void)[] = [], effects: (() => void)[] = [];
  let cursor = 0, tree: Element;
  sandbox.__hooks = {
    state(initial: any) { const i = cursor++; if (!(i in values)) values[i] = typeof initial === 'function' ? initial() : initial; return [values[i], (v: any) => { values[i] = typeof v === 'function' ? v(values[i]) : v; }]; },
    effect(fn: () => any, deps: any[]) { const i = cursor++; if (!dependencies[i] || deps.some((value, n) => value !== dependencies[i][n])) { dependencies[i] = deps; effects.push(() => { cleanup[i]?.(); cleanup[i] = fn(); }); } },
  };
  const render = () => { cursor = 0; tree = sandbox.HistoryUiTest.DailyCaseHistory(props); while (effects.length) effects.shift()!(); };
  const settle = async () => { for (let i = 0; i < 5; i++) { await new Promise(resolve => setImmediate(resolve)); render(); } };
  render();
  return { props, render, settle, text: () => text(tree), nodes: () => nodes(tree), find: (type: string, label: string) => nodes(tree).find(node => node.type === type && text(node).includes(label)), close() { cleanup.forEach(fn => fn?.()); } };
}


const props=()=>({caseId:'consumer-case',revision:1,issues:[{id:'consumer-issue',caseId:'consumer-case',title:'原事项'}],selectedIssueId:'consumer-issue',onSelectIssue(){},onReturnCurrent(){}});
const first={revisionId:'exact-first-feedback',authorizationId:'original-authority',actionTitle:'原行动',observedAt:'2026-11-28T11:22:33Z',observationDate:'2020-01-02',sourceScope:'FIRST_SCOPE 原现场记录',outcome:'FIRST_BODY 执行尚未知',effect:'unknown',metricDelta:'',review:''};
const second={...first,revisionId:'exact-second-feedback',observedAt:'2026-11-29T12:23:34Z',observationDate:'2021-02-03',sourceScope:'SECOND_SCOPE 新记录',outcome:'SECOND_BODY'};
const round={choice:{choiceId:'choice',caseId:'consumer-case',issueId:'consumer-issue',previousChoiceId:null,choice:'trial',reason:'选择原话',strategyRef:{recordId:'plan',revision:1},occurredAt:'2026-11-20',operationId:'original-choice-operation'},strategy:{payload:{title:'方案'}},actions:[{taskId:'action',projectId:'project',title:'原行动',status:'doing',authorizations:[],feedback:[first,second]}],review:null};
function api(value:any){const calls:any[]=[];const fetcher:typeof fetch=async(input,init)=>{calls.push({url:String(input),method:init?.method??'GET'});return String(input).endsWith('/requests')?Response.json({requests:[]}):Response.json(value);};return {calls,fetcher};}
test('independent D14 daily history: each source button opens its exact feedback revision and date/scope, never latest',async()=>{
 const server=api({issue:props().issues[0],rounds:[round]});const ui=await harness(server.fetcher,props());try{await ui.settle();const buttons=ui.nodes().filter(n=>n.type==='button'&&text(n).includes('查看反馈原记录'));assert.equal(buttons.length,2);buttons[0].props.onClick();ui.render();let dl=ui.nodes().find(n=>n.type==='dl')!;assert.match(text(dl),/反馈修订exact-first-feedback/);assert.match(text(dl),/观察日期2020-01-02/);assert.match(text(dl),/来源与范围FIRST_SCOPE 原现场记录/);assert.match(text(dl),/回录时间2026-11-28T11:22:33Z/);assert.doesNotMatch(text(dl),/SECOND_SCOPE|exact-second-feedback|2021-02-03/);
 buttons[1].props.onClick();ui.render();dl=ui.nodes().find(n=>n.type==='dl')!;assert.match(text(dl),/反馈修订exact-second-feedback/);assert.match(text(dl),/观察日期2021-02-03/);assert.match(text(dl),/来源与范围SECOND_SCOPE 新记录/);assert.ok(server.calls.every(c=>c.method==='GET'));}finally{ui.close();}
});
test('independent D14 daily history: legacy absent metadata stays unrecorded in list/detail; saved time is never used as observation date',async()=>{
 const {observationDate:_date,sourceScope:_scope,...legacy}=first;const server=api({issue:props().issues[0],rounds:[{...round,actions:[{...round.actions[0],feedback:[legacy]}]}]});const ui=await harness(server.fetcher,props());try{await ui.settle();assert.match(ui.text(),/观察日期未记录/);assert.doesNotMatch(ui.text(),/观察日期：2026-11-28/);ui.find('button','查看反馈原记录')!.props.onClick();ui.render();const details=text(ui.nodes().find(n=>n.type==='dl'));assert.match(details,/观察日期未记录/);assert.match(details,/来源与范围未记录/);assert.match(details,/回录时间2026-11-28T11:22:33Z/);assert.ok(server.calls.every(c=>c.method==='GET'));}finally{ui.close();}
});
