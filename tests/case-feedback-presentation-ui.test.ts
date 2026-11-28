import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

type Element={type:string|((props:any)=>any);props:Record<string,any>};
const nodes=(value:any):Element[]=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(nodes):[value,...nodes(value.props?.children)];
const text=(value:any):string=>value==null||value===false?'':typeof value==='string'||typeof value==='number'?String(value):Array.isArray(value)?value.map(text).join(''):text(value.props?.children);
const visible=(value:any):Element[]=>!value||typeof value!=='object'?[]:Array.isArray(value)?value.flatMap(visible):value.type==='details'&&!value.props.open?[value,...nodes(value.props.children).filter((node:Element)=>node.type==='summary')]:[value,...visible(value.props?.children)];
let bundle:string;
async function mount(props:any,fetcher:typeof fetch=async url=>Response.json(String(url).includes('action-authorizations')?{authorizations:[]}:{revisions:[]})){
  bundle??=(await build({stdin:{contents:"export { FeedbackDialog,feedbackDraft } from './extensions/business-plugins/decision-board/ui/DecisionBoardPage.tsx';",resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,loader:{'.css':'empty'},platform:'browser',format:'iife',globalName:'CompactFeedback',plugins:[{name:'feedback-presentation',setup(plugin){
    plugin.onResolve({filter:/^react(?:\/jsx-runtime)?$/},args=>({path:args.path,namespace:'feedback-hooks'}));
    plugin.onLoad({filter:/.*/,namespace:'feedback-hooks'},args=>({contents:args.path.endsWith('jsx-runtime')?'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";':'export const useId=()=>"unused-id";export const useState=v=>globalThis.hooks.state(v);export const useRef=v=>globalThis.hooks.ref(v);export const useEffect=(f,d)=>globalThis.hooks.effect(f,d);export const useMemo=(f,d)=>globalThis.hooks.memo(f,d);export const useCallback=(f,d)=>globalThis.hooks.memo(()=>f,d);'}));
    plugin.onResolve({filter:/CaseDialogs\.tsx$/},args=>({path:args.path,namespace:'feedback-dialog'}));plugin.onLoad({filter:/.*/,namespace:'feedback-dialog'},()=>({contents:'export function CaseDialog(){return null;} export const caseError=e=>e.message; export function CaseFormError(){return null;}'}));
  }}]})).outputFiles[0].text;
  const sandbox:any={fetch:fetcher,Response,URL,URLSearchParams,crypto};const values:any[]=[],dependencies:any[][]=[],effects:(()=>void)[]=[],cleanups:(()=>void)[]=[];let cursor=0,tree:Element;
  const changed=(i:number,next:any[])=>!dependencies[i]||next.some((value,index)=>value!==dependencies[i][index]);
  sandbox.hooks={state(initial:any){const i=cursor++;if(!(i in values))values[i]=typeof initial==='function'?initial():initial;return[values[i],(next:any)=>{values[i]=typeof next==='function'?next(values[i]):next;}];},ref(initial:any){const i=cursor++;return values[i]??={current:initial};},memo(fn:()=>any,deps:any[]){const i=cursor++;if(changed(i,deps)){dependencies[i]=deps;values[i]=fn();}return values[i];},effect(fn:()=>any,deps:any[]){const i=cursor++;if(changed(i,deps)){dependencies[i]=deps;effects.push(()=>{cleanups[i]?.();cleanups[i]=fn();});}}};
  runInNewContext(bundle,sandbox);const render=()=>{cursor=0;tree=sandbox.CompactFeedback.FeedbackDialog(props);while(effects.length)effects.shift()!();};
  const settle=async()=>{for(let i=0;i<6;i++){await new Promise(resolve=>setImmediate(resolve));render();}};render();
  return{props,render,settle,nodes:()=>nodes(tree),visible:()=>visible(tree),text:()=>text(tree),factory:sandbox.CompactFeedback.feedbackDraft,close:()=>{for(const cleanup of cleanups)cleanup?.();}};
}
const draft=()=>({executed:'unknown',outcome:'三家门店的实际观察，仍有未知',metricDelta:'',review:'',score:'',effect:'unknown',expectedLatestRevisionId:null,operationId:'original-operation',observationDate:'2026-11-28',sourceScope:'三店现场记录'});
const base=()=>({presentation:'case',contextLabel:'门店缺货原因 · 第1轮',task:{id:'task-A',title:'原授权行动'},subject:{projectId:'project-A',itemId:'item-A',taskId:'task-A'},draft:draft(),busy:false,unknownOperation:null,onChange(){},onClose(){},onAsk(){},async onSubmit(_input:any){},async onQuery(){}});

test('D14: Case presentation exposes the three frozen observation fields and folds original request and optional judgement controls',async()=>{
 const ui=await mount(base());try{await ui.settle();const labels=ui.visible().filter(node=>node.type==='label').map(node=>text(node));assert.deepEqual(labels,['观察日期','实际观察到什么','来源与范围 可选']);assert.ok(ui.visible().some(node=>node.type==='button'&&text(node)==='保存反馈'));assert.ok(ui.nodes().some(node=>node.type==='details'&&!node.props.open&&text(node).includes('补充记录')));assert.ok(ui.nodes().some(node=>node.type==='details'&&!node.props.open&&text(node).includes('原请求与来源')));}finally{ui.close();}
});

test('D14: a date and actual observation can save unknown execution as null without inventing effect, rating or request',async()=>{
 const posted:any[]=[];const ui=await mount({...base(),onSubmit:async(input:any)=>{posted.push(input);}});try{await ui.settle();const form=ui.nodes().find(node=>node.type==='form')!;form.props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(posted.length,1);assert.equal(posted[0].adopted,null);assert.equal(posted[0].effect,'unknown');assert.equal(posted[0].score,null);assert.equal(posted[0].observationDate,'2026-11-28');assert.equal(posted[0].sourceScope,'三店现场记录');assert.equal(posted[0].respondsToRequest,undefined);}finally{ui.close();}
});


test('D14: a failed source read blocks even ordinary compact observation without erasing its text',async()=>{
 for(const status of [403,503]){const posted:any[]=[];const ui=await mount({...base(),onSubmit:async(input:any)=>{posted.push(input);}},async()=>Response.json({code:'unavailable'},{status}));try{await ui.settle();assert.equal(ui.nodes().find(node=>node.type==='button'&&node.props.type==='submit')!.props.disabled,true);ui.nodes().find(node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(posted.length,0);assert.equal(ui.props.draft.outcome,draft().outcome);}finally{ui.close();}}
});


test('D14: compact rejects missing/invalid observation dates and preserves explicit original judgement edits only',async()=>{
 for(const patch of [{observationDate:''},{observationDate:'2026-02-30'},{outcome:'  '},{outcome:'x'.repeat(1001)}]){const posted:any[]=[];const ui=await mount({...base(),draft:{...draft(),...patch},onSubmit:async(input:any)=>{posted.push(input);}});try{await ui.settle();assert.equal(ui.nodes().find(node=>node.type==='button'&&node.props.type==='submit')!.props.disabled,true);ui.nodes().find(node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(posted.length,0);}finally{ui.close();}}
 const posted:any[]=[];const ui=await mount({...base(),draft:{...draft(),executed:'no',effect:'negative',score:'2',review:'原判断需修订',metricDelta:'-2%'},onSubmit:async(input:any)=>{posted.push(input);}});try{await ui.settle();ui.nodes().find(node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(posted[0].adopted,false);assert.equal(posted[0].effect,'negative');assert.equal(posted[0].score,2);assert.equal(posted[0].review,'原判断需修订');}finally{ui.close();}
});

test('D14: compact exact request saves recheck authorization and feedback baseline without substituting a later request',async()=>{
 const context={caseId:'case-A',issueId:'issue-A',requestId:'request-A',revision:3,target:{kind:'observe',projectId:'project-A',itemId:'item-A',taskId:'task-A',authorizationId:'authorization-A',feedbackBaseRevisionId:null}};
 const request={...context,kind:'observe',status:'open',lifecycle:'open',text:'原观察请求',assignee:{label:'原负责人'},source:{ref:'原文'},requestedAt:'2026-11-27'};
 const authorization={authorizationId:'authorization-A',decision:'authorize',projectId:'project-A',itemId:'item-A',taskId:'task-A',source:{caseId:'case-A',caseStoreId:'store-A',strategyRef:{caseId:'case-A',caseStoreId:'store-A'}},caseConfirmation:{issueId:'issue-A'}};
 for(const changed of [false,true]){const posted:any[]=[];let latest:string|null=null,reads=0;const ui=await mount({...base(),requestScope:context,draft:{...draft(),requestContext:context},onSubmit:async(input:any)=>{posted.push(input);}},async url=>{reads++;return Response.json(String(url).includes('action-authorizations')?{authorizations:[authorization]}:String(url).includes('feedback/history')?{revisions:latest?[{revisionId:latest}]:[]}:{requests:[request]});});try{await ui.settle();const before=reads;if(changed)latest='feedback-new';ui.nodes().find(node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await ui.settle();assert.ok(reads>before,'Every business save rereads the original source');if(changed){assert.equal(posted.length,0);assert.match(ui.text(),/基线已变化/);}else{assert.equal(posted.length,1);assert.deepEqual(JSON.parse(JSON.stringify(posted[0].respondsToRequest)),{requestId:'request-A',revision:3,authorizationId:'authorization-A'});assert.equal(posted[0].adopted,null);}}finally{ui.close();}}
});

test('D14: original Board forms preserve boolean payloads without new metadata and read unknown execution accurately',async()=>{
 const posted:any[]=[];const legacy={...draft(),executed:'yes'};delete (legacy as any).observationDate;delete (legacy as any).sourceScope;
 const ui=await mount({...base(),presentation:'board',draft:legacy,onSubmit:async(input:any)=>{posted.push(input);}});try{await ui.settle();ui.nodes().find(node=>node.type==='form')!.props.onSubmit({preventDefault(){}});await ui.settle();assert.equal(posted[0].adopted,true);assert.equal(Object.hasOwn(posted[0],'observationDate'),false);assert.equal(Object.hasOwn(posted[0],'sourceScope'),false);const restored=ui.factory({feedback:{revisionId:'feedback-1',adopted:null,outcome:'原观察',observationDate:'2026-11-20',sourceScope:'两店原来源'}});assert.equal(restored.executed,'unknown');assert.equal(restored.observationDate,'2026-11-20');assert.equal(restored.sourceScope,'两店原来源');}finally{ui.close();}
});
