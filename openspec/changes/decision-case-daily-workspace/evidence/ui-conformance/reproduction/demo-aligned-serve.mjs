import {createHost} from '../../src/host/server.ts';
import {buildUi,evidenceRoot,uiRoot} from './build-ui.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {startToolProvider} from '../../tests/fixtures/tool-provider.ts';
const provider=await startToolProvider();
const runRoot=path.join(evidenceRoot,'demo-aligned');await fs.mkdir(runRoot,{recursive:true});
const dataRoot=path.join(runRoot,'fixture-data'),projectsRoot=path.join(runRoot,'fixture-projects');
const port=43150,base=`http://127.0.0.1:${port}`;
let host;
async function start(){host=createHost({cwd:process.cwd(),uiPorts:[],transportVersion:'1',dataRoot,projectsRoot,staticUiRoot:uiRoot});await host.ready;await new Promise(r=>host.server.listen(port,'127.0.0.1',r));}
async function api(route,method='GET',body){const res=await fetch(base+route,{method,headers:{'content-type':'application/json','x-optracall-client':'1',origin:base},...(body?{body:JSON.stringify(body)}:{})});const value=await res.json();if(!res.ok)throw Error(route+' '+res.status+':'+JSON.stringify(value));return value;}
const op=()=>randomUUID();
if(process.env.REUSE_UI_BUILD!=='1')await buildUi();await start();
const idsPath=path.join(runRoot,'fixture-ids.json');
let ids;
try{ids=JSON.parse(await fs.readFile(idsPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
if(!ids){
 await api('/api/configuration','PUT',{name:'UI 验收本地合成 Provider',provider:'openai-compatible',baseUrl:provider.baseUrl,model:'synthetic-ui-local',apiKey:'synthetic-only-not-a-real-key'});
 await api('/api/cases/storage/initialize','POST',{});
 const cases=host.cases,storeId=cases.getStatus().storeId;
 const personal={kind:'personal',id:'ui-acceptance-synthetic',name:'林予安（合成验收）'};
 async function createCase(title,goalTitle,strategy,description){const {goal}=await api('/api/strategy/goals','POST',{operationId:op(),title:goalTitle,outcome:goalTitle,perspective:'personal',scope:personal,measurement:{kind:'deliverable',criterion:'沿本事项原始记录和完整观察窗口核对；合成验收场景'},baseline:{state:'pending',description:'合成数据，未将演示数字当真实实绩'},responsible:'林予安',strategies:[strategy]});await api(`/api/strategy/goals/${goal.goalId}/adopt`,'POST',{operationId:op(),version:goal.version,expectedVersion:goal.version,decision:'为隔离 UI 验收明确采纳合成 G/S'});const {case:record}=await api('/api/cases','POST',{operationId:op(),title,description,goalBinding:{primary:{goalId:goal.goalId,version:goal.version},related:[],strategy}});cases.updateCase({operationId:op(),caseId:record.id,expectedRevision:record.revision,status:'analyzing'});return{caseId:record.id,goalId:goal.goalId,strategy};}
 const main=await createCase('改善华东会员复购','60天会员复购率达到 23%','先验证缺货治理','先把口径和缺货原因弄清楚，再决定是否扩大三店试点。');
 const career=await createCase('探索下一步职业方向','形成下一阶段职业选择','先做访谈与小规模尝试','从实际访谈和工作片段逐步明确适合自己的方向。');
 const empty=await createCase('梳理家庭年度安排','形成全家共同认可的年度安排','先收集现有约束','可以先继续已有独立项目工作，不必立刻建立事项。');
 function issue(c,title){return cases.createDecisionIssue({operationId:op(),caseId:c.caseId,expectedRevision:cases.getCase(c.caseId).revision,title});}
 const expand=issue(main,'扩大试点范围'),stock=issue(main,'门店缺货原因'),metric=issue(main,'复购口径校准'),interview=issue(career,'访谈里反复出现的要求');
 const projects={};
 for(const [key,name,owner,next,status] of [['growth','华东会员增长实验','林予安','等待三店核查资料，再讨论是否扩围','awaiting_feedback'],['metric','会员数据口径校准','周明','确认完整60天观察窗口','completed'],['career','职业访谈与小试','林予安','补充两次访谈中的实际片段','in_progress'],['independent','季度资料整理','许知微','整理原始资料与索引','in_progress'],['shared','门店共用资料','周明','统一维护门店数据与资料约定','not_started'],['archived','去年第四季度回顾','许知微','历史资料留存','completed']]){const {project}=await api('/api/projects','POST',{name});projects[key]=project;cases.saveProjectWork({operationId:op(),projectId:project.id,expectedRevision:0,workStatus:status,workScope:name+'的合成验收资料与原任务工作空间',assignee:owner,nextStep:next,statusReason:null});await host.projects.confirmAgreement(project.id,{operationId:op(),expectedVersion:0,text:'项目内共享同一份资料与约定；Case 只引用明确关联的原任务与成果。'});}
 function link(c,p){cases.linkProject({operationId:op(),caseId:c.caseId,expectedRevision:cases.getCase(c.caseId).revision,projectId:p.id});}
 link(main,projects.growth);link(main,projects.metric);link(main,projects.shared);link(career,projects.career);link(career,projects.shared);
 const tasks={};
 async function task(key,p,name,type,c,i){const assignment={type,skill:null,...(c&&i?{issue:{caseId:c.caseId,issueId:i.id}}:{})};const t=await host.projects.createTask(p.id,{name,assignment});tasks[key]={...t,projectId:p.id};return t;}
 await task('scope',projects.growth,'三店试点范围梳理','requirement',main,expand);
 await task('report',projects.growth,'华东三店试点观察','analysis',main,expand);
 await task('plan',projects.growth,'是否扩大试点的备选方案','plan',main,expand);
 await task('choice',projects.growth,'本轮扩围取舍','decision',main,expand);
 await task('stock',projects.growth,'三店缺货核查行动记录','do',main,stock);
 await task('metric',projects.metric,'60天会员复购口径说明','teach',main,metric);
 await task('interview',projects.career,'两次职业访谈原始观察','analysis',career,interview);
 await task('independent',projects.independent,'季度资料归档索引','analysis');
 await task('archived',projects.archived,'上季度回顾材料','analysis');
 await api(`/api/projects/${projects.archived.id}/archive`,'POST',{});
 function plan(c,i,title,proposal){return cases.saveDecisionDraft({operationId:op(),caseStoreId:storeId,caseId:c.caseId,expectedRevision:0,kind:'strategy',payload:{title,proposal}}, {actorKind:'agent',projectId:(c===career?projects.career:projects.growth).id,taskId:(c===career?tasks.interview:tasks.plan).id,requestId:op(),sessionId:'synthetic-fixture-no-provider',toolCallId:'synthetic-fixture-plan'});}
 function ref(c,p){return{type:'case-decision',caseStoreId:storeId,caseId:c.caseId,recordId:p.recordId,revision:p.revision};}
 function choose(c,i,p,choice,reason,previous=null){return cases.chooseStrategy({operationId:op(),caseStoreId:storeId,caseId:c.caseId,issueId:i.id,strategyRef:ref(c,p),choice,reason,expectedPreviousChoiceId:previous});}
 const expand1=plan(main,expand,'先完成三店试点','先用三家门店观察缺货治理与复购表现，再决定扩围。');const ch1=choose(main,expand,expand1,'trial','先在现有三店核对，保持样本范围。');
 const expand2=plan(main,expand,'补齐证据后决定扩围','先补齐三店原始记录与完整观察窗口，再讨论扩大试点范围。');const ch2=ch1; // One saved choice plus an explicit pending request is round 2.
 const stockPlan=plan(main,stock,'三店缺货核查','回收门店补货单与上架记录，核查缺货原因。');const stockChoice=choose(main,stock,stockPlan,'trial','仅核查已确认三店的缺货情况，不扩大经营动作。');
 const metricPlan=plan(main,metric,'统一复购统计口径','按首购会员计算60天复购，统一退款与跨店交易处理。');const metricChoice=choose(main,metric,metricPlan,'no_action','口径已经明确；待完整60天观察窗口，不把口径校准当成复购改善。');
 const careerPlan=plan(career,interview,'整理两次访谈观察','保留自己在意的工作片段和反复出现的要求。');
 const teachText='复购口径已按首购会员计算60天复购，并统一退款与跨店交易处理。三店本轮口径已可以前后比较；完整60天观察窗口尚未结束，目标结果仍待补充。以上为隔离UI验收的合成资料。';
 provider.setResponder(()=>({text:teachText}));
 const {task:teachTask}=await api(`/api/projects/${projects.metric.id}/tasks`,'POST',{name:'复购口径校准本轮复盘',assignment:{type:'teach',skill:null,issue:{caseId:main.caseId,issueId:metric.id,choiceId:metricChoice.choiceId}}});
 const teachRequestId=op();await api(`/api/projects/${projects.metric.id}/tasks/${teachTask.id}/messages`,'POST',{requestId:teachRequestId,text:'请基于本轮统一的复购口径给出复盘；本次为本地合成Provider验收，不代表真实经营结果。'});
 let teachState;for(let i=0;i<300;i++){teachState=await api(`/api/projects/${projects.metric.id}/tasks/${teachTask.id}`);if(teachState.task.lastRun?.status==='failed')throw Error('Teach fixture run failed: '+JSON.stringify(teachState.task.lastRun));if(teachState.task.lastRun?.status==='completed')break;await new Promise(r=>setTimeout(r,100));}
 if(teachState.task.lastRun?.status!=='completed')throw Error('Teach fixture timeout');
 const sourceView=await api(`/api/cases/${main.caseId}/decisions/issues/${metric.id}/sources`);
 const teachSource=sourceView.replies.find(r=>r.source.taskId===teachTask.id)?.source;if(!teachSource)throw Error('Real Teach reply absent: '+JSON.stringify(sourceView));
 const {review:metricReview}=await api(`/api/cases/${main.caseId}/decisions/issues/${metric.id}/review`,'POST',{operationId:op(),expectedRevision:cases.getCase(main.caseId).revision,choiceId:metricChoice.choiceId,source:teachSource,observation:'三店已按同一首购会员、退款和跨店交易规则记录；完整60天窗口仍待补。',judgement:'按首购会员计算60天复购，口径已可前后比较。',nextStep:'在获得完整60天窗口后回录复购结果。'});
 tasks.metricTeach={...teachTask,projectId:projects.metric.id};
 await fs.writeFile(path.join(runRoot,'real-teach-receipt.json'),JSON.stringify({provider:'local-synthetic',providerRequestCount:provider.requests.length,teachRequestId,teachTask,teachSource,metricReview},null,2));

 const {arrangement:stockArrangement}=await api(`/api/cases/${main.caseId}/decisions/issues/${stock.id}/authorize`,'POST',{operationId:op(),choiceId:stockChoice.choiceId,projectId:projects.growth.id,title:'三店缺货核查',scope:'仅核查三家门店的补货单与上架记录，等待门店回收资料。'});
 const stockAction=stockArrangement.actions[0];
 await api(`/api/decision-board/tasks/${stockAction.taskId}/status`,'POST',{status:'doing'});
 cases.saveIssueEdge({operationId:op(),caseId:main.caseId,expectedRevision:cases.getCase(main.caseId).revision,fromIssueId:metric.id,toIssueId:expand.id,expectedEdgeRevision:0,explanation:'先有可比较的复购口径，才能讨论是否扩围。',source:{kind:'user-declaration',ref:'synthetic-fixture:explicit-metric-to-expand'}});
 cases.saveIssueEdge({operationId:op(),caseId:main.caseId,expectedRevision:cases.getCase(main.caseId).revision,fromIssueId:stock.id,toIssueId:expand.id,expectedEdgeRevision:0,explanation:'缺货核查结果为本轮扩围取舍提供依据。',source:{kind:'user-declaration',ref:'synthetic-fixture:explicit-stock-to-expand'}});
 const requests=[];
 for(const [c,i,p,text,prev] of [[main,expand,expand2,'记录本轮扩围取舍',ch2.choiceId],[career,interview,careerPlan,'整理访谈观察后的下一步取舍',null]])requests.push(cases.saveDecisionRequest({operationId:op(),caseId:c.caseId,expectedRevision:cases.getCase(c.caseId).revision,expectedRequestRevision:0,issueId:i.id,kind:'choose',text,source:{kind:'user-declaration',ref:'synthetic-fixture:explicit-request:'+i.id},assignee:{label:'林予安',source:'合成场景中的明确承担人声明'},requestedAt:'2026-11-27T02:00:00.000Z',target:{kind:'choose',strategyRef:ref(c,p),expectedPreviousChoiceId:prev}}));
 for(const [key,c,p,t,title,body] of [['report',main,projects.growth,tasks.report,'华东三店试点观察','三家门店首周缺货与会员表现的观察，包含样本范围、同期活动与待补数据。'],['metric',main,projects.metric,tasks.metric,'60天会员复购口径说明','首购会员、复购窗口、退款及跨店交易的统一处理规则。'],['stock',main,projects.growth,tasks.stock,'三店缺货核查行动记录','仅记录已授权范围、负责人和当前反馈状态，保留缺失信息。']]){const relativePath='060_reports/'+key+'.md';const text='# '+title+'\n\n'+body+'\n\n合成 UI 验收资料，不代表真实经营结果。\n';await fs.writeFile(path.join(host.projects.projectDirectory(p.id),relativePath),text);cases.saveArtifact({operationId:op(),caseId:c.caseId,expectedRevision:cases.getCase(c.caseId).revision,projectId:p.id,taskId:t.id,relativePath,role:'report',displayName:title,observedSha256:createHash('sha256').update(text).digest('hex'),observedBytes:Buffer.byteLength(text),observedAt:new Date().toISOString()});}
 ids={base,port,pid:process.pid,dataRoot,projectsRoot,createdAt:new Date().toISOString(),scope:'synthetic-only; actual Host and official Pi with one local synthetic Provider Teach run; no real model/provider/business data',main,career,empty,issues:{expand,stock,metric,interview},projects:Object.fromEntries(Object.entries(projects).map(([k,p])=>[k,{id:p.id,name:p.name}])),tasks,requests,choices:{expandInitial:ch1,stockChoice,metricChoice}};
 await fs.writeFile(idsPath,JSON.stringify(ids,null,2));
}
ids={...ids,pid:process.pid,base};await fs.writeFile(idsPath,JSON.stringify(ids,null,2));
console.log('READY',JSON.stringify({base,pid:process.pid,caseId:ids.main.caseId,issues:ids.issues,idsPath}));
let restarting=false;
process.on('SIGUSR2',async()=>{if(restarting)return;restarting=true;try{await buildUi();await host.close();delete process.env.SKIP_UI_BUILD;await start();console.log('REBUILT',new Date().toISOString());}catch(e){console.error(e);}finally{restarting=false;}});
process.on('SIGTERM',async()=>{await host.close();await provider.close();process.exit(0);});
process.on('SIGINT',async()=>{await host.close();await provider.close();process.exit(0);});
