import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

const nodes=(n:any):any[]=>!n||typeof n!=='object'?[]:Array.isArray(n)?n.flatMap(nodes):[n,...nodes(n.props?.children)];
const text=(n:any):string=>n==null||n===false?'':typeof n!=='object'?String(n):Array.isArray(n)?n.map(text).join(''):text(n.props?.children);
let bundle:string;
async function harness(fetcher:typeof fetch,props:any) {
  bundle??=(await build({stdin:{contents:"export { FeedbackDialog } from './extensions/business-plugins/decision-board/ui/DecisionBoardPage.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},platform:'browser',format:'iife',globalName:'OriginalFeedback',plugins:[{name:'independent-hooks',setup(p){
    p.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:args.path,namespace:'hooks'}));
    p.onLoad({filter:/.*/,namespace:'hooks'},args=>({contents:args.path.endsWith('jsx-runtime')?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";':'export const useState=v=>globalThis.hooks.state(v);export const useRef=v=>globalThis.hooks.ref(v);export const useEffect=(f,d)=>globalThis.hooks.effect(f,d);export const useLayoutEffect=useEffect;export const useMemo=(f,d)=>globalThis.hooks.memo(f,d);export const useCallback=(f,d)=>globalThis.hooks.memo(()=>f,d);export const useId=()=>globalThis.hooks.id();export const memo=x=>x;export const forwardRef=x=>x;export const createContext=x=>({value:x});export const useContext=x=>x.value;export const useReducer=()=>{throw Error("unused reducer")};'}));
  }}]})).outputFiles[0].text;
  const values:any[]=[],deps:any[][]=[],cleanups:(()=>void)[]=[],effects:(()=>void)[]=[];let cursor=0,tree:any;
  const hooks={state(v:any){const i=cursor++;if(!(i in values))values[i]=typeof v==='function'?v():v;return [values[i],(n:any)=>{values[i]=typeof n==='function'?n(values[i]):n;}];},ref(v:any){return values[cursor++]??=( {current:v});},memo(f:any,d:any[]){const i=cursor++;if(!deps[i]||d.some((x,n)=>x!==deps[i][n])){deps[i]=d;values[i]=f();}return values[i];},effect(f:any,d:any[]){const i=cursor++;if(!deps[i]||d.some((x,n)=>x!==deps[i][n])){deps[i]=d;effects.push(()=>{cleanups[i]?.();cleanups[i]=f();});}},id(){return `id-${cursor++}`;}};
  const sandbox:any={hooks,fetch:fetcher,crypto,Response,Request,Headers,URL,URLSearchParams,setTimeout,clearTimeout,TextDecoder,AbortController};runInNewContext(bundle,sandbox);
  const render=()=>{cursor=0;tree=sandbox.OriginalFeedback.FeedbackDialog(props);while(effects.length)effects.shift()!();};render();
  return {props,render,nodes:()=>nodes(tree),text:()=>text(tree),root:()=>tree,settle:async()=>{for(let i=0;i<5;i++){await new Promise(r=>setImmediate(r));render();}},close:()=>cleanups.forEach(f=>f?.())};
}
const subject={projectId:'project',itemId:'item',taskId:'task'};
const target={kind:'observe',...subject,authorizationId:'auth',feedbackBaseRevisionId:null};
const request=(id:string)=>({kind:'observe',caseId:'case',issueId:'issue',requestId:id,revision:2,status:'open',lifecycle:'open',text:`original ${id}`,source:{ref:'original statement'},assignee:{label:'person',source:'original'},requestedAt:'2026-01-01',target});
const context=(id:string)=>({caseId:'case',issueId:'issue',requestId:id,revision:2,target});
const auth={authorizationId:'auth',decision:'authorize',...subject,source:{caseId:'case',caseStoreId:'store',choiceId:'choice',strategyRef:{caseId:'case',caseStoreId:'store'}},caseConfirmation:{issueId:'issue'}};
function fixture(opts:any={}) {
  const submitted:any[]=[],reads:string[]=[];let closed=0;
  const props={task:{id:'task',title:'task',feedback:null},subject,draft:{executed:'yes',outcome:'exact observed text',metricDelta:'',review:'unknown remains',score:'',effect:'unknown',expectedLatestRevisionId:null,operationId:'original-op',requestContext:context('B')},busy:false,readOnly:false,unknownOperation:null,requestScope:context('B'),onChange(){},onClose(){closed++;},onAsk(){},onQuery:async()=>{},onSubmit:async(v:any)=>{submitted.push(v);},...opts};
  const fetcher:typeof fetch=async(url)=>{const s=String(url);reads.push(s);if(s.includes('action-authorizations/history'))return Response.json({authorizations:[auth]});if(s.includes('feedback/history'))return Response.json({revisions:opts.changedBase?[{revisionId:'new-base'}]:[]});if(s.includes('/decisions/requests'))return Response.json({requests:[request('A'),request('B')]});throw Error('unexpected read '+s);};
  return {props,fetcher,submitted,reads,closed:()=>closed};
}
test('independent original FeedbackDialog: fixed explicit request rejects a different restored context and permits cancel',async()=>{
  const f=fixture();f.props.draft={...f.props.draft,requestContext:context('A')};const ui=await harness(f.fetcher,f.props);await ui.settle();
  assert.match(ui.text(),/原草稿的请求与本次入口不同/);
  await ui.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(f.submitted.length,0);
  const editable=ui.nodes().filter(n=>n.type==='option'&&!n.props.disabled).map(text);assert.ok(editable.some(t=>t.includes('original B')));assert.ok(!editable.some(t=>t.includes('original A')));
  ui.root().props.onClose();assert.equal(f.closed(),1);ui.close();
});
test('independent original FeedbackDialog: read-only draft disables saving without locking cancellation',async()=>{
  const f=fixture({readOnly:true});const ui=await harness(f.fetcher,f.props);await ui.settle();
  assert.equal(ui.root().props.busy,false);assert.ok(ui.nodes().find(n=>n.type==='button'&&n.props.type==='submit').props.disabled);
  await ui.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(f.submitted.length,0);ui.root().props.onClose();assert.equal(f.closed(),1);ui.close();
});
test('independent original FeedbackDialog: exact request uses original authorization and baseline; moved baseline blocks',async()=>{
  for(const changedBase of [false,true]){const f=fixture({changedBase});const ui=await harness(f.fetcher,f.props);await ui.settle();await ui.nodes().find(n=>n.type==='form').props.onSubmit({preventDefault(){}});await ui.settle();
    if(changedBase){assert.equal(f.submitted.length,0);assert.match(ui.text(),/原反馈修订基线已变化/);}else{assert.equal(f.submitted.length,1);assert.deepEqual(JSON.parse(JSON.stringify(f.submitted[0].respondsToRequest)),{requestId:'B',revision:2,authorizationId:'auth'});assert.equal(f.submitted[0].expectedLatestRevisionId,null);assert.equal(f.submitted[0].operationId,'original-op');}ui.close();}
});
