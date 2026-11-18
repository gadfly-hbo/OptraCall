'use strict';

// This local simulator demonstrates a possible usage experience. It is not an
// Agent/Host execution engine and never calls Pi, a model, or a business API.
const usageQuestion = '哪些门店的首购会员复购偏低，值得优先核查？';
const usageScenarios = { normal:'完整正式依据', missing:'缺少正式指标', 'read-failed':'映射读取失败', 'partial-read':'口径读取不完整', conflict:'资产口径冲突', temporary:'仅本轮临时依据' };
function usageSeed() { return { scenario:'normal', drafts:{A:usageQuestion,B:usageQuestion}, reports:[], attempts:[], selectedReportId:null, currentAttemptId:null, decisions:[], contributions:[], taskId:'T-ANALYSIS-01', caseId:'C-MEM01', projectId:'P-MEMBER', evidenceOpen:false }; }
let usage = usageSeed();
Object.defineProperty(window,'usageSnapshot',{get:()=>JSON.parse(JSON.stringify(usage))});
Object.defineProperty(window,'usageFixture',{get:()=>JSON.parse(JSON.stringify(USAGE_FIXTURE))});
function businessTime(day) { return Date.parse(day+'T00:00:00+08:00'); }
function contentIdentity(text) { let hash=2166136261;for(const char of text){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}return 'demo-fnv1a-'+(hash>>>0).toString(16).padStart(8,'0'); }
function immutableCopy(value) { return freezeFixture(structuredClone(value)); }
function percent(numerator,denominator) { return denominator?`${(100*numerator/denominator).toFixed(1)}%`:'—'; }
function fixtureCompute(policy, fixture=USAGE_FIXTURE) {
  const cutoff=Date.parse(fixture.cutoff),windowMs=fixture.windowDays*86400000;
  const ledger=[],seenRefunds=new Set(),refundTotals=new Map();
  for(const refund of fixture.refunds){
    if(seenRefunds.has(refund.id)){ledger.push({kind:'退款',id:refund.id,reason:'重复退款事件，按事件ID去重，不重复累计'});continue;}
    seenRefunds.add(refund.id);
    if(refund.status!=='succeeded'){ledger.push({kind:'退款',id:refund.id,reason:'退款未成功，不冲减有效购买资格'});continue;}
    if(businessTime(refund.day)>cutoff){ledger.push({kind:'退款',id:refund.id,reason:'晚于观察截止，当前不计'});continue;}
    refundTotals.set(refund.order,(refundTotals.get(refund.order)||0)+refund.amountCents);
  }
  const members=new Map(fixture.members.map(member=>[member.pos,member]));
  const seenOrders=new Set(),validOrders=[];
  for(const order of fixture.transactions){
    if(seenOrders.has(order.id)){ledger.push({kind:'订单',id:order.id,reason:'重复同步记录，按订单事件ID去重'});continue;}seenOrders.add(order.id);
    if(order.status!=='paid'||order.paidCents<=0){ledger.push({kind:'订单',id:order.id,reason:'未成功支付／取消，不计有效购买'});continue;}
    if(businessTime(order.day)>cutoff){ledger.push({kind:'订单',id:order.id,reason:'晚于数据截止，不参与本轮'});continue;}
    const member=members.get(order.pos);
    if(!member){ledger.push({kind:'身份',id:order.id,reason:`交易会员号 ${order.pos} 无获准身份映射，排除并保留缺口`});continue;}
    if(member.internal){ledger.push({kind:'会员',id:member.id,reason:'内部测试身份，排除'});continue;}
    const refund=refundTotals.get(order.id)||0;
    if(!policy.fullRefundCounts&&refund>=order.paidCents){ledger.push({kind:'订单',id:order.id,reason:'截至截止已成功全额退款，依 1.3.0 排除有效购买，首购须重找'});continue;}
    if(refund>0)ledger.push({kind:'订单',id:order.id,reason:refund>=order.paidCents?'1.2.x 按成功支付保留该全退订单；这是本次修订影响点':'仅部分退款，两个版本均保留有效购买'});
    validOrders.push({...order,memberId:member.id,time:businessTime(order.day)});
  }
  const grouped=new Map();for(const order of validOrders){if(!grouped.has(order.memberId))grouped.set(order.memberId,[]);grouped.get(order.memberId).push(order);}
  const memberRows=[],shopRows=fixture.shops.map(shop=>({...shop,numerator:0,denominator:0,immature:0,excluded:0}));
  for(const [memberId,orders] of [...grouped.entries()].sort(([a],[b])=>a.localeCompare(b))){
    orders.sort((a,b)=>a.time-b.time||a.id.localeCompare(b.id));const first=orders[0];const deadline=first.time+windowMs;
    const inCohort=first.time>=businessTime(fixture.cohortStart)&&first.time<businessTime(fixture.cohortEndExclusive);
    const mature=deadline<=cutoff;const shop=shopRows.find(row=>row.id===first.shop);
    const repeats=orders.slice(1).filter(order=>order.time>first.time&&order.time<deadline);
    const outside=orders.slice(1).filter(order=>order.time>=deadline);
    let reason,eligible=false;
    if(!inCohort){reason='企业首购早于本轮首购队列，后续购买不重新当首购';shop.excluded++;}
    else if(!mature){reason='首购后未满30日观察窗，排除分母，不按零复购';shop.immature++;}
    else{eligible=true;shop.denominator++;if(repeats.length)shop.numerator++;reason=repeats.length?'观察窗内有有效复购，计入分子':'完整观察窗内无有效复购';}
    memberRows.push({memberId,shop:first.shop,firstOrder:first.id,firstDay:first.day,deadline:new Date(deadline+8*3600000).toISOString().slice(0,10),eligible,repeated:eligible&&repeats.length>0,repeatOrders:repeats.map(order=>order.id),reason,outsideOrders:outside.map(order=>order.id)});
    for(const order of outside)ledger.push({kind:'观察窗',id:order.id,reason:order.time===deadline?'恰好落在首购+30日右端点，依左闭右开边界不计本窗复购':'晚于首购后30日观察窗，不计本窗复购'});
    for(const repeat of repeats.filter(order=>order.shop!==first.shop))ledger.push({kind:'跨店',id:repeat.id,reason:`跨店复购归首购门店 ${first.shop}，不重复计入购买发生门店 ${repeat.shop}`});
  }
  for(const row of shopRows){row.rate=row.denominator?row.numerator/row.denominator:null;row.comparable=row.denominator>=fixture.minimumComparableMembers;}
  const ranked=shopRows.filter(row=>row.comparable).sort((a,b)=>a.rate-b.rate||a.id.localeCompare(b.id));
  return {shops:shopRows,members:memberRows,ledger,ranked:ranked.map(row=>row.id),numerator:shopRows.reduce((n,row)=>n+row.numerator,0),denominator:shopRows.reduce((n,row)=>n+row.denominator,0),inputCounts:{members:fixture.members.length,transactionRows:fixture.transactions.length,refundRows:fixture.refunds.length},fixtureId:fixture.id};
}
function usageRead(ref,mode,trace) {
  const traceBase={operation:'本地模拟精确读取',authority:ref.authority,id:ref.id,version:ref.version,enterprise:ref.enterprise};
  if(ref.enterprise!==state.company||ref.enterprise!=='A'){const entry={...traceBase,status:'rejected',detail:'企业范围不符，未读取'};trace.push(entry);return {ok:false,error:entry.detail};}
  if(ref.authority!=='task-local'&&!state.sourceEnabled){const entry={...traceBase,status:'rejected',detail:'企业资料当前已停用，不能以历史可查替代当前资格'};trace.push(entry);return {ok:false,error:entry.detail};}
  if(mode==='read-failed'&&ref.authority==='binding'){const entry={...traceBase,status:'failed',detail:'合成映射读取失败，没有返回正文'};trace.push(entry);return {ok:false,error:entry.detail};}
  if(mode==='partial-read'&&ref.authority==='sap-metric'){const entry={...traceBase,status:'partial',detail:'仅返回定义第一页，退款规则与观察边界正文未完整，禁止据此计算',receivedCharacters:42,complete:false};trace.push(entry);return {ok:false,partial:true,error:entry.detail};}
  const content=ref.content;
  if(typeof content!=='string'||!content){trace.push({...traceBase,status:'failed',detail:'没有准确版本正文'});return {ok:false,error:'准确版本正文不存在'};}
  const entry={...traceBase,status:'read',complete:true,characters:content.length,contentIdentity:contentIdentity(content),content};trace.push(entry);return {ok:true,ref:{authority:ref.authority,id:ref.id,version:ref.version,enterprise:ref.enterprise,contentIdentity:entry.contentIdentity,content}};
}
function discoverUsageRefs(temporary=false,pinned=null) {
  if(state.company!=='A')return {error:'B 企业没有获准的本地会员交易资料，也没有可用正式资产；不会借用 A 企业的数据或定义。',refs:[]};
  if(temporary){
    const policy={...USAGE_FIXTURE.policies['1.3.0'],version:'TEMP-01'};
    return {temporary:true,policy,refs:[{authority:'task-local',id:'LOCAL-MEMBER-BASIS',version:'TEMP-01',enterprise:'A',content:'仅本轮合成约定：企业首购、30日完整观察、排除全额退款并顺延首购、部分退款保留，跨店复购归首购门店；样本<3仅描述不排名。'}, {authority:'task-local',id:'LOCAL-FIXTURE-DICTIONARY',version:'1',enterprise:'A',content:'本轮合成数据字典：transactions.pos 经 members.pos 关联 members.id；transactions.shop 为首购门店标识；退款按 refund.id 去重后关联 order.id。'}]};
  }
  if(usage.scenario==='missing'||usage.scenario==='temporary')return {error:'当前没有合格正式指标。本轮可保留缺口；有明确本轮临时依据时才进行受限计算。',refs:[]};
  const version=pinned?.version||state.metricVersion,methodVersion=pinned?.methodVersion||state.methodVersion,methodMetricVersion=pinned?.methodMetricVersion||state.methodMetricVersion;
  if(usage.scenario==='conflict'||methodMetricVersion!==version)return {error:`正式指标 ${version} 与方法 v${methodVersion} 的指标引用 ${methodMetricVersion} 未一致，先核清差异；不能默认混用。`,refs:[]};
  const policy=USAGE_FIXTURE.policies[version];if(!policy)return {error:`本地原型没有 ${version} 的完整定义，停止计算。`,refs:[]};
  const sourceVersion=pinned?.sourceVersion||state.metricSourceVersion;
  const source=state.sourceHistory.find(revision=>revision.version===sourceVersion);
  return {policy,refs:[
    {authority:'sap-metric',id:'MET-MEMBER-01',version,enterprise:'A',content:policy.text+`首购队列[${USAGE_FIXTURE.cohortStart},${USAGE_FIXTURE.cohortEndExclusive})；数据截止${USAGE_FIXTURE.cutoff}；${USAGE_FIXTURE.historyCompleteness}`},
    {authority:'binding',id:'BIND-MEMBER-POS',version:'r3',enterprise:'A',content:'POS.pos 通过获准 members.pos 映射 members.id，未知身份不归并；按订单事件ID和退款事件ID分别去重；首购门店归属，跨店复购归首购门店。'},
    {authority:'sap-method',id:'METHOD-MEMBER-CHECK',version:methodVersion,enterprise:'A',content:`方法v${methodVersion}引用指标${methodMetricVersion}，先核历史完整与观察成熟资格；分母<${USAGE_FIXTURE.minimumComparableMembers}只描述不参与比较；排序属于核查线索，未证明经营因果。`},
    {authority:'enterprise-source',id:'MEMBER-POLICY',version:sourceVersion,enterprise:'A',content:source?.body||''},
  ]};
}
function usageRun(options={}) {
  const question=usage.drafts[state.company]?.trim();
  if(!question||!question.includes('会员')||!question.includes('复购')){notify('本原型仅计算合成会员复购问题，其他问题保留为草稿。');return;}
  const resume=options.resume?usage.attempts.find(attempt=>attempt.id===usage.currentAttemptId):null;
  usage.selectedReportId=null;
  const attempt={id:'TRY-'+String(usage.attempts.length+1).padStart(2,'0'),enterprise:state.company,taskId:usage.taskId,question,scenario:usage.scenario,temporary:Boolean(options.temporary),trace:[],status:'reading',createdAt:new Date().toISOString()};
  const discovered=discoverUsageRefs(Boolean(options.temporary),resume?.pinned);
  attempt.trace.push({operation:'本地模拟目录发现',status:discovered.error?'limited':'discovered',enterprise:state.company,refs:discovered.refs.map(({authority,id,version})=>({authority,id,version})),detail:'仅展示当前企业有资格的来源；未调用 Pi 或模型。'});
  usage.attempts.push(attempt);usage.currentAttemptId=attempt.id;
  if(discovered.error){attempt.status='blocked';attempt.error=discovered.error;render();return;}
  attempt.pinned={version:discovered.policy.version,methodVersion:state.methodVersion,methodMetricVersion:state.methodMetricVersion,sourceVersion:state.metricSourceVersion};
  const refs=[];const mode=options.resume?'normal':usage.scenario;
  for(const ref of discovered.refs){const read=usageRead(ref,mode,attempt.trace);if(!read.ok){attempt.status=read.partial?'partial':'read-failed';attempt.error=read.error;render();return;}refs.push(read.ref);}
  attempt.trace.push({operation:'本地模拟采用判断',status:options.temporary?'temporary':'adopted',detail:options.temporary?'本轮临时依据，不是企业正式标准。':'定义、映射、方法及来源版本完整且相容；只作本合成案例的本地模拟选择，未保存作者使用声明，未执行独立核验。'});
  const result=fixtureCompute(discovered.policy);
  attempt.trace.push({operation:'本地确定性计算',status:'computed',fixtureId:USAGE_FIXTURE.id,policyVersion:discovered.policy.version,counts:result.inputCounts,detail:'直接读取 fixtures.js 的合成明细计算，没有模型或业务系统调用。'});
  const report=immutableCopy({id:'AR'+String(usage.reports.length+1).padStart(2,'0'),enterprise:state.company,caseId:usage.caseId,projectId:usage.projectId,taskId:usage.taskId,question,metricVersion:discovered.policy.version,temporary:Boolean(options.temporary),basisLabel:options.temporary?'本轮临时依据 · 不可作为企业标准':'本企业正式定义 · 本地模拟读取',sourceRefs:refs,fixtureId:USAGE_FIXTURE.id,fixtureIdentity:contentIdentity(JSON.stringify(USAGE_FIXTURE)),cutoff:USAGE_FIXTURE.cutoff,windowDays:USAGE_FIXTURE.windowDays,cohortStart:USAGE_FIXTURE.cohortStart,cohortEndExclusive:USAGE_FIXTURE.cohortEndExclusive,result,trace:structuredClone(attempt.trace),createdAt:new Date().toISOString(),evidenceStates:{authorDeclaration:'not_saved',independentVerification:'not_run'},limitations:['30日为Demo假设，实际企业口径待核定','固定合成样本仅支持筛查，不证明门店运营原因','fixture开业以来历史完整声明只适用于此封闭合成案例','未调用Pi/模型，非产品或专业验收']});
  usage.reports.push(report);usage.selectedReportId=report.id;attempt.status='complete';attempt.reportId=report.id;
  if(state.nextTask&&state.nextTask.company===state.company&&usage.taskId==='T-A19')state.nextTask={...state.nextTask,version:report.metricVersion,used:true,computedReportId:report.id};
  render();notify(`已按 ${report.metricVersion} 完成本地合成计算，生成 ${report.id}；原报告保持。`);
}
function canCreateUsageDecision(report) { return Boolean(report && report.enterprise === state.company && usage.caseId && report.caseId === usage.caseId); }
function canWriteUsageDecision(decision) { return Boolean(decision && decision.enterprise === state.company && usage.caseId && decision.caseId === usage.caseId); }
function selectedUsageReport() { return usage.reports.find(report=>report.id===usage.selectedReportId&&report.enterprise===state.company); }
function currentUsageAttempt() { return usage.attempts.find(attempt=>attempt.id===usage.currentAttemptId&&attempt.enterprise===state.company); }
function usageNavigate(view) { if(overlay.open)closeDialog();state.view=view;render();document.getElementById('page-title')?.focus(); }
function usageView() {
  if(state.view==='cases'||state.view==='projects')return usageBoard();
  if(state.view==='decision')return decisionWorkspace();
  return analysisWorkspace();
}
function usageHeading(title,subtitle,action='') { return `<div class="heading"><div><div class="eyebrow">${esc(state.company)}企业（合成） · ${usage.caseId?'Case '+esc(usage.caseId):'未关联 Case'} / 项目 ${state.company==='A'?'P-MEMBER':'P-MEMBER-B'}</div><h1 id="page-title" tabindex="-1">${title}</h1><p>${subtitle}</p></div><div class="actions">${action}</div></div>`; }
function usageBoard() {
  const isCase=state.view==='cases';return usageHeading(isCase?'会员运营 Case':'门店会员运营项目','围绕业务问题进入普通分析，企业基础资产按权限可发现。')+`<div class="panel"><div class="panel-head"><div><h2>首购会员复购核查</h2><p class="meta" style="margin:5px 0 0">${esc(state.company)}企业 · C-MEM01 · ${state.company==='A'?'P-MEMBER':'P-MEMBER-B'}</p></div>${badge('待分析','accent')}</div><div class="panel-body"><p>${usageQuestion}</p><p class="muted" style="font-size:12px">先检查可比队列、观察完整性和口径，再安排核查。分析结论和实际行动分别保留。</p><div class="actions">${button('进入分析任务','usage-analysis','primary','usage-open-analysis')}${button('查看决策跟进','usage-decision','secondary','usage-open-decision')}</div></div></div>`;
}
function analysisWorkspace() {
  const report=selectedUsageReport(),attempt=currentUsageAttempt();const reports=usage.reports.filter(row=>row.enterprise===state.company);
  return usageHeading('门店首购会员复购核查','直接提问，按需查找并读取企业正式资产，保留计算与解释依据。',button('查看决策跟进','usage-decision','secondary','usage-open-decision'))+`<div class="usage-context"><span>任务 ${esc(usage.taskId)}</span><span>当前企业 ${esc(state.company)}</span><span>30 日观察窗 · 合成示例</span>${badge('本地模拟 · 未调用 Pi / 模型')}</div><div class="usage-main"><section><div class="panel"><div class="panel-body"><label class="usage-question-label" for="usage-question">本次想了解什么？</label><textarea id="usage-question" data-testid="usage-question" aria-label="本次分析问题">${esc(usage.drafts[state.company])}</textarea><div class="flex-between" style="margin-top:12px"><span class="help">无需先选资产；来源与采用版本在结果中可查。</span>${button(reports.length?'按当前依据重新分析':'开始本地模拟分析','usage-run','primary','usage-run')}</div></div></div>${attempt&&attempt.status!=='complete'?usageBlocked(attempt):''}${report?usageReportView(report):!attempt?`<div class="usage-idle"><div class="asset-icon">${icon('metric',20)}</div><h2>从业务问题开始</h2><p>普通任务按企业范围查找合格定义与映射。缺少资产时说明限制，仍保留可以安全推进的工作。</p></div>`:''}</section><aside><section class="panel"><div class="panel-head"><h2>本次依据</h2>${badge(report?report.metricVersion:'按需取得',report?'accent':'')}</div><div class="panel-body">${report?report.sourceRefs.map(ref=>`<div class="resource-item"><strong>${esc(ref.authority==='sap-metric'?'首购会员复购定义':ref.authority==='binding'?'会员与交易映射':ref.authority==='sap-method'?'门店核查方法':ref.authority==='enterprise-source'?'会员制度原文':'本轮临时依据')}</strong><p>${esc(ref.id)} · ${esc(ref.version)}</p></div>`).join(''):`<p class="help">尚未读取。目录存在不等于已采用，未取得完整依据不会生成标准化排名。</p>`}${report?`<div class="divider"></div>${button('查看精确读取与计算证据','usage-evidence','ghost','usage-evidence')}`:''}</div></section><section class="panel section-gap"><div class="panel-head"><h2>已保存分析记录</h2></div><div class="panel-body">${reports.length?reports.map(row=>`<button type="button" class="usage-history-row ${row.id===usage.selectedReportId?'active':''}" data-act="usage-select-report" data-report="${row.id}" data-testid="usage-report-${row.id}"><strong>${row.id} · ${row.metricVersion}</strong><small>${row.temporary?'临时依据':'准确正式版本'} · 原结果保持</small></button>`).join(''):'<p class="help">每次计算生成独立报告，后续发布不会改写旧稿。</p>'}</div></section></aside></div>${usageReviewControls()}`;
}
function usageBlocked(attempt) {
  return `<div class="notice warning section-gap" data-testid="usage-blocked">${icon('info')}<div><strong>${attempt.status==='partial'?'口径尚未完整读取':attempt.status==='read-failed'?'精确来源读取失败':'本轮依据存在限制'}</strong><p>${esc(attempt.error)}</p><p>已保留原请求与已发生的读取记录。尚未执行会员复购计算，不生成门店标准排名。</p><div class="actions">${attempt.status==='partial'?button('继续读取完整版本','usage-read-more','secondary','usage-read-more'):attempt.status==='read-failed'?button('重试读取准确映射','usage-retry','secondary','usage-retry'):''}${state.company==='A'&&attempt.status==='blocked'?button('说明并使用本轮临时依据','usage-temporary','secondary','usage-temporary'):''}${button('查看已发生的读取记录','usage-attempt-evidence','ghost','usage-attempt-evidence')}</div></div></div>`;
}
function usageReportView(report) {
  const result=report.result,lowest=result.shops.find(row=>row.id===result.ranked[0]);const decision=usage.decisions.find(row=>row.reportId===report.id);const contributed=usage.contributions.some(row=>row.reportId===report.id);
  return `<section class="panel section-gap" data-testid="usage-result"><div class="panel-head"><div><h2>优先核查${lowest?esc(lowest.name):'范围待核'}</h2><p class="meta" style="margin:5px 0 0">报告 ${report.id} · ${esc(report.basisLabel)} · 指标 ${report.metricVersion}</p></div>${badge(report.temporary?'受限结果':'本地计算完成',report.temporary?'warning':'success')}</div><div class="panel-body"><p class="usage-conclusion">${lowest?`${esc(lowest.name)}完整观察队列的复购率为 <strong>${percent(lowest.numerator,lowest.denominator)}</strong>（${lowest.numerator}/${lowest.denominator}），在符合本示例比较条件的门店中最低，值得优先核查。`:'当前没有满足比较条件的门店，保持待核。'}</p><p class="muted" style="font-size:12px">雁汀站分母不足 ${USAGE_FIXTURE.minimumComparableMembers} 人，只作描述，不纳入优先排序。观察尚未成熟的会员排除分母，不能记作零复购。</p><p class="usage-scope-note">本结果仅覆盖成功映射且满足购买及观察资格的合成会员。交易 O26 的 P99 身份未映射，已排除并保留缺口；不能外推为全体会员结论。</p><div class="table-wrap"><table><thead><tr><th>首购门店</th><th>复购会员 / 成熟首购会员</th><th>复购率</th><th>本轮判断</th></tr></thead><tbody>${result.shops.map(row=>`<tr data-testid="usage-shop-${row.id}"><td>${row.name}</td><td>${row.numerator} / ${row.denominator}</td><td><strong>${percent(row.numerator,row.denominator)}</strong></td><td>${row.comparable?row.id===result.ranked[0]?badge('优先核查','accent'):'作为可比参考':badge('样本不足，暂不排名','warning')}</td></tr>`).join('')}</tbody></table></div><div class="usage-basis"><h3>怎么算，排除了什么</h3><p>以企业首购门店归属会员；分子是首购后 30 日内有再次有效购买的人数，分母是满足完整观察资格的首购会员。数据截止 ${report.cutoff.replace('T',' ')}。</p><p>当前 ${report.metricVersion==='1.3.0'||report.temporary?'排除成功全额退款订单并重新识别首购，部分退款保留。':'1.2.x 按成功支付识别购买，仍计全额退款订单；这是一项待修订的业务边界。'}跨店复购计入原首购店。${button('查看逐会员与排除明细','usage-details','ghost','usage-details')}</p></div><div class="notice ${report.temporary?'warning':''}" style="margin-bottom:0">${icon('info')}<div><strong>${report.temporary?'本轮临时依据，不能作为企业正式标准':'这是核查线索，尚未证明经营原因'}</strong><p>${report.temporary?'临时约定和数据字典来自本次合成任务，不写回企业基础库。':'建议先核交易覆盖、退款资格和门店人群差异。当前结果不足以直接决定发券、判定门店失误或宣称因果。'}</p></div></div>${!canCreateUsageDecision(report)?'<p class="help section-gap">本任务未关联与报告相同的 Case，仍可分析并保留报告；当前不创建 Case 核查草稿。</p>':''}<div class="actions section-gap">${button(decision?'查看核查跟进':canCreateUsageDecision(report)?'建立核查跟进':'关联 Case 后建立跟进','usage-create-decision','primary','usage-create-decision',!canCreateUsageDecision(report))}${button(contributed?'查看已记录贡献':'将口径问题整理回 Studio','usage-contribute','secondary','usage-contribute')}${button('查看精确依据','usage-evidence','ghost','usage-open-evidence')}</div></div></section>`;
}
function usageReviewControls() {
  return `<details class="review-tools"><summary data-testid="usage-review-scenes">使用主线评审场景</summary><div class="review-controls"><label for="usage-scenario">合成使用条件<select id="usage-scenario" data-testid="usage-scenario">${Object.entries(usageScenarios).map(([key,name])=>`<option value="${key}" ${usage.scenario===key?'selected':''}>${name}</option>`).join('')}</select></label>${button('新建后续分析','usage-new-analysis','secondary','usage-new-analysis')}<label for="usage-case-bound"><input type="checkbox" id="usage-case-bound" data-testid="usage-case-bound" ${usage.caseId?'checked':''}>关联 Case（评审条件）</label></div><p>这是本地模拟的预置执行方式，用于审核“发现—精读—采用—计算—解释—决策—反馈”体验。产品 Agent 的方法与工具选择仍由其自主决定。</p></details>`;
}
function decisionWorkspace() {
  const decisions=usage.decisions.filter(decision=>decision.enterprise===state.company);
  return usageHeading('会员运营核查与决策跟进','保留建议、人的选择、实际行动与效果的区别。',button('返回普通分析','usage-analysis','secondary','usage-back-analysis'))+`<div class="panel"><div class="panel-head"><h2>核查事项</h2>${badge(decisions.length+' 项')}</div>${decisions.length?decisions.map(decision=>`<article class="work-card"><div class="work-title"><h3>${esc(decision.title)}</h3>${badge(decision.status,decision.status==='待核查'?'warning':'accent')}${!canWriteUsageDecision(decision)?badge('只读 · 当前未关联此 Case','warning'):''}</div><p>${esc(decision.reason)}</p><div class="work-meta">来源报告 ${decision.reportId} · 指标 ${decision.metricVersion} · ${esc(decision.taskId)}</div><div class="usage-decision-boundary">这是 Case 核查建议草稿，尚未派发或执行核查。建议先核退款与会员映射，再核同队列条件；效果尚未验证。</div><label class="field" for="decision-note-${decision.id}"><span>本次决定或核查记录</span><textarea id="decision-note-${decision.id}" data-decision-id="${decision.id}" aria-label="本次决定或核查记录" ${!canWriteUsageDecision(decision)?'readonly':''}>${esc(decision.draft??decision.note)}</textarea><p class="help">“已安排”仅作人工事实回填；原型不会向任何人或业务系统派发。</p></label><div class="actions">${button('保存核查记录','usage-save-decision','primary','usage-save-decision',!canWriteUsageDecision(decision),`data-decision="${decision.id}"`)}${button('回填：已安排核查','usage-plan-decision','secondary','usage-plan-decision',!canWriteUsageDecision(decision),`data-decision="${decision.id}"`)}${button('回看原分析依据','usage-decision-report','ghost','usage-decision-report',false,`data-report="${decision.reportId}"`)}</div></article>`).join(''):`<div class="empty"><h2>尚无核查跟进事项</h2><p>先根据分析结果建立有依据的核查建议，保留未决定和效果未知。</p>${button('进入分析任务','usage-analysis','primary','decision-start-analysis')}</div>`}</div>`;
}
function usageDetailsDialog(report) {
  dialogFrame(`报告 ${report.id} 的本地计算明细`,`${report.metricVersion} · 固定合成输入 ${report.fixtureId}`,`<div class="inline-note">${esc(USAGE_FIXTURE.historyCompleteness)} ${esc(USAGE_FIXTURE.sameDayAssumption)}</div><p class="help">首购队列 [${report.cohortStart}, ${report.cohortEndExclusive})；观察窗为首购后30日左闭右开；首购本身不计复购。下表“到期日”以中国标准时间业务日表示。</p><div class="table-wrap"><table><thead><tr><th>会员 / 首购店</th><th>有效首购</th><th>复购事件</th><th>分母 / 分子</th><th>说明</th></tr></thead><tbody>${report.result.members.map(row=>`<tr><td>${row.memberId} / ${row.shop}</td><td>${row.firstOrder}<p>${row.firstDay}</p></td><td>${row.repeatOrders.join('、')||'无'}</td><td>${row.eligible?'1':'0'} / ${row.repeated?'1':'0'}</td><td>${row.reason}${row.outsideOrders.length?`<p>窗外：${row.outsideOrders.join('、')}</p>`:''}</td></tr>`).join('')}</tbody></table></div><h3 class="section-gap">订单、退款及边界处理</h3><ul class="mini-list">${report.result.ledger.map(row=>`<li><strong>${esc(row.kind)} ${esc(row.id)}</strong><small>${esc(row.reason)}</small></li>`).join('')}</ul>`,button('关闭明细','close','secondary'),true);
}
function usageEvidenceDialog(report=null,attempt=null) {
  const trace=report?.trace||attempt?.trace||[];
  dialogFrame(report?`报告 ${report.id} 的读取与计算证据`:'本次尚未完成的读取记录','本地模拟精确读取与本地确定性计算 · 未调用 Pi / 模型',`<div class="notice">${icon('info')}<div><strong>真实产品中的边界</strong><p>Host 提供获准目录与工具环境，Agent 自主决定是否采用及如何计算。本原型的本地读取函数和固定fixture不证明真实SDK或各profile已具备这些能力。</p></div></div><section class="panel"><div class="panel-body"><h3>供给、使用与核验分别记录</h3><div class="check-line"><span>完整正文读取</span><span>${trace.filter(entry=>entry.status==='read'&&entry.complete).length} 条本地模拟回读</span></div><div class="check-line"><span>采用判断</span><span>${trace.some(entry=>entry.status==='adopted'||entry.status==='temporary')?'本地模拟选择；不代表作者声明':'尚未采用'}</span></div><div class="check-line"><span>本地计算</span><span>${trace.some(entry=>entry.status==='computed')?'已完成合成明细计算':'未执行'}</span></div><div class="check-line"><span>作者使用声明</span><span data-testid="usage-author-declaration">未保存</span></div><div class="check-line"><span>独立核验</span><span data-testid="usage-independent-verification">未执行</span></div></div></section>${report?`<dl class="detail-grid"><dt>归属</dt><dd>${report.enterprise}企业 / ${report.caseId} / ${report.projectId} / ${report.taskId}</dd><dt>输入</dt><dd>${report.fixtureId} · ${report.fixtureIdentity}</dd><dt>授权</dt><dd>${USAGE_FIXTURE.permission}</dd><dt>结果</dt><dd>${report.result.numerator} / ${report.result.denominator} · 报告版本保持不变</dd></dl>`:''}<div class="divider"></div>${trace.map((entry,index)=>`<section class="resource-item"><strong>${index+1}. ${esc(entry.operation)} ${badge(entry.status,entry.status==='read'||entry.status==='computed'?'success':entry.status==='partial'||entry.status==='failed'||entry.status==='rejected'?'warning':'')}</strong><p>${esc(entry.id||entry.fixtureId||'')}${entry.version?' · '+esc(entry.version):''}${entry.contentIdentity?' · '+esc(entry.contentIdentity):''}</p>${entry.content?`<details><summary class="link-text">查看实际返回正文</summary><pre class="usage-code">${esc(entry.content)}</pre></details>`:`<p>${esc(entry.detail||'')}</p>`}${entry.refs?`<p>${entry.refs.map(ref=>esc(ref.id+'@'+ref.version)).join('；')||'未发现可用正式引用'}</p>`:''}</section>`).join('')}<p class="help section-gap">demo-fnv1a 仅是此原型内容一致性标识，不是密码学签名或生产证据。</p>`,button('关闭证据','close','secondary'),true);
}
function openUsageDialog(kind,report,attempt) {
  if(!overlay.open)returnFocus={element:document.activeElement,testId:document.activeElement?.getAttribute('data-testid')};
  dialogState={kind:'usage-'+kind};
  if(kind==='details')usageDetailsDialog(report);else if(kind==='evidence')usageEvidenceDialog(report,attempt);else if(kind==='temporary')dialogFrame('使用本轮临时依据','仅影响本次合成分析，不修改企业正式资产',`<div class="notice warning">${icon('info')}<div><strong>这份结果将明确标注“临时依据”</strong><p>采用30日完整观察、全额退款排除并顺延首购、跨店归首购店的合成约定，同时使用本轮合成数据字典。它不会成为企业默认口径。</p></div></div><p class="help">B 企业缺少自己的获准交易资料，不能通过此动作借用 A 企业fixture。</p>`,`${button('取消','close','secondary')}${button('按本轮临时依据计算','usage-confirm-temporary','primary','usage-confirm-temporary',state.company!=='A')}`);
  if(!overlay.open)overlay.showModal();requestAnimationFrame(()=>overlay.querySelector('.dialog-head button')?.focus());
}
document.addEventListener('click',event=>{
  const control=event.target.closest('[data-act]');if(!control||control.disabled)return;const action=control.dataset.act;
  if(action==='usage-cases')return usageNavigate('cases');
  if(action==='usage-projects')return usageNavigate('projects');
  if(action==='usage-analysis')return usageNavigate('analysis');
  if(action==='usage-decision')return usageNavigate('decision');
  if(action==='usage-new-analysis'){if(overlay.open)closeDialog();usage.taskId=state.nextTask?.company===state.company?'T-A19':'T-ANALYSIS-'+String(usage.reports.length+1).padStart(2,'0');usage.selectedReportId=null;usage.currentAttemptId=null;usageNavigate('analysis');return;}
  if(action==='usage-run')return usageRun();
  if(action==='usage-read-more'||action==='usage-retry')return usageRun({resume:true});
  if(action==='usage-temporary')return openUsageDialog('temporary');
  if(action==='usage-confirm-temporary'){closeDialog();return usageRun({temporary:true});}
  if(action==='usage-select-report'){const report=usage.reports.find(row=>row.id===control.dataset.report&&row.enterprise===state.company);if(report){usage.selectedReportId=report.id;usage.currentAttemptId=null;render();}return;}
  const report=selectedUsageReport();
  if(action==='usage-details'&&report)return openUsageDialog('details',report);
  if(action==='usage-evidence'&&report)return openUsageDialog('evidence',report);
  if(action==='usage-attempt-evidence')return openUsageDialog('evidence',null,currentUsageAttempt());
  if(action==='usage-create-decision'&&report){if(!canCreateUsageDecision(report)){notify('当前任务未关联与报告相同的 Case；分析报告保留，未创建核查草稿。');return;}let decision=usage.decisions.find(row=>row.reportId===report.id);if(!decision){const store=report.result.shops.find(row=>row.id===report.result.ranked[0]);decision={id:'D'+String(usage.decisions.length+1).padStart(2,'0'),enterprise:state.company,caseId:report.caseId,reportId:report.id,metricVersion:report.metricVersion,taskId:report.taskId,title:'核查'+(store?.name||'门店范围')+'首购会员复购',reason:'依据报告'+report.id+'的可比队列结果，先核数据、退款与人群差异。',status:'核查建议草稿',note:''};usage.decisions.push(decision);}return usageNavigate('decision');}
  if(action==='usage-save-decision'||action==='usage-plan-decision'){const decision=usage.decisions.find(row=>row.id===control.dataset.decision&&row.enterprise===state.company);if(!canWriteUsageDecision(decision)){notify('当前任务未关联该 Case，只读保留原记录，未保存或回填。');return;}decision.note=document.getElementById('decision-note-'+decision.id)?.value??decision.note;delete decision.draft;if(action==='usage-plan-decision')decision.status='人工回填已安排 · 效果未知';render();notify('仅保存核查建议或人工事实回填，原型未派发业务动作；效果未知。');return;}
  if(action==='usage-decision-report'){const selected=usage.reports.find(row=>row.id===control.dataset.report&&row.enterprise===state.company);if(selected){usage.selectedReportId=selected.id;usageNavigate('analysis');}return;}
  if(action==='usage-contribute'&&report){let contribution=usage.contributions.find(row=>row.reportId===report.id);if(!contribution){contribution=immutableCopy({id:'UC'+String(usage.contributions.length+1).padStart(2,'0'),enterprise:report.enterprise,reportId:report.id,taskId:report.taskId,baseVersion:report.metricVersion,scope:'企业候选待核',problem:report.temporary?'本轮临时依据需要与企业正式规则核对':'全额退款资格影响首购顺序、分母和复购结果，需要回源核定',sourceRefs:report.sourceRefs,fixtureId:report.fixtureId});usage.contributions.push(contribution);}state.view='evolution';render();notify('已整理为带准确报告依据的待核贡献，未改变正式版本。');return;}
  if(action==='usage-link-contribution') {
    const contribution=usage.contributions.find(row=>row.id===control.dataset.contribution&&row.enterprise===state.company);
    if(!contribution)return;
    const report=usage.reports.find(row=>row.id===contribution.reportId);
    if(report?.temporary||contribution.baseVersion!==state.candidateBase||state.candidateBase!==state.metricVersion||state.publication||!canEditCandidate()){
      notify('贡献与当前候选基线或资格不一致，保留待核，未硬并或发布。');return;
    }
    if(!state.linkedUsageContributions.some(row=>row.id===contribution.id))state.linkedUsageContributions.push(immutableCopy(contribution));
    state.events.push('ordinary-contribution-linked');openDialog('candidate');notify('已按报告和基线核对关联到现有候选；正式版保持，发布预览将列出该依据。');return;
  }
  if(action==='reset'){usage=usageSeed();return;}
});
document.addEventListener('input',event=>{if(event.target.id==='usage-question')usage.drafts[state.company]=event.target.value; if(event.target.dataset?.decisionId){const decision=usage.decisions.find(row=>row.id===event.target.dataset.decisionId&&row.enterprise===state.company);if(canWriteUsageDecision(decision))decision.draft=event.target.value;}});
document.addEventListener('change',event=>{
  if(event.target.id==='usage-case-bound'){usage.caseId=event.target.checked?'C-MEM01':null;usage.selectedReportId=null;usage.currentAttemptId=null;render();return;}
  if(event.target.id==='usage-scenario'){usage.scenario=event.target.value;usage.selectedReportId=null;usage.currentAttemptId=null;render();return;}
  if(event.target.id==='company-select'){usage.selectedReportId=null;usage.currentAttemptId=null;usage.taskId=state.company==='A'?'T-ANALYSIS-01':'T-B-ANALYSIS-01';render();return;}
  if(event.target.id==='scenario-select'){usage=usageSeed();return;}
});

// Add ordinary-task contributions to the same management view without changing
// any formal asset. They remain separate from the pre-existing v0.2 candidate.
const originalEvolutionView = evolutionView;
evolutionView = function() {
  const original=originalEvolutionView();const contributions=usage.contributions.filter(row=>row.enterprise===state.company);
  if(!contributions.length)return original;
  return original+`<section class="panel section-gap"><div class="panel-head"><h2>普通分析形成的贡献</h2>${badge(contributions.length+' 项待核','warning')}</div>${contributions.map(row=>`<article class="work-card"><div class="work-title"><h3>${esc(row.problem)}</h3>${badge('待核候选','warning')}</div><p>来源报告 ${row.reportId} · ${row.taskId} · 基于 ${row.baseVersion}</p><p class="help">反馈已保存，不代表原资产已修订或问题已解决。与既有候选合并前需要核对范围、版本与新依据。</p><div class="actions">${button(state.linkedUsageContributions.some(link=>link.id===row.id)?'查看已关联候选':'核对并关联既有候选','usage-link-contribution','primary','usage-link-contribution',false,`data-contribution="${row.id}"`)}${button('回看原报告与证据','usage-decision-report','secondary','usage-contribution-report',false,`data-report="${row.reportId}"`)}</div></article>`).join('')}</section>`;
};
state.view='analysis';render();
