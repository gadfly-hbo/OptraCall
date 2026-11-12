'use strict';

// Standalone review prototype. All records below are synthetic and reset on reload.
const app = document.getElementById('app');
const overlay = document.getElementById('overlay');
const toastBox = document.getElementById('toast');
const categories = { all: '全部', source: '企业资料', semantic: '语义与主数据', binding: '数据映射', metric: '指标', method: '方法' };
const scenarioNames = { success: '正常发布', partial: '分项部分成功', unknown: '发布结果 UNKNOWN', conflict: '并行版本冲突', archived: '原建设项目已归档', unassigned: '旧资料归属待核', empty: '企业空库' };
const iconPaths = {
  assets: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><path d="M14 17.5h7m-3.5-3.5v7"/>',
  folder: '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  case: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m0-10h12"/>',
  book: '<path d="M3 4h7a3 3 0 0 1 3 3v14a4 4 0 0 0-4-2H3V4Zm18 0h-5a3 3 0 0 0-3 3v14a4 4 0 0 1 4-2h4V4Z"/>',
  source: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6M8 13h8m-8 4h5"/>',
  semantic: '<circle cx="12" cy="5" r="2"/><circle cx="5" cy="18" r="2"/><circle cx="19" cy="18" r="2"/><path d="m11 7-5 9m7-9 5 9M7 18h10"/>',
  binding: '<path d="m8 8 4-4 4 4m-4-4v13m-6-3-3 3 3 3m12-6 3 3-3 3H3"/>',
  metric: '<path d="M4 20V4m0 16h17M8 15l4-5 4 2 5-7"/>',
  method: '<path d="M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01"/>',
  arrow: '<path d="m9 5 7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  tools: '<path d="m14 6 4-4a6 6 0 0 1-7 8L4 18a2 2 0 0 0 3 3l8-8a6 6 0 0 0 8-7l-4 4-5-4Z"/>',
};
function icon(name, size = 18) { return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${iconPaths[name] || iconPaths.assets}</svg>`; }
function esc(value) { return String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char])); }
function badge(text, tone = '') { return `<span class="badge ${tone}">${esc(text)}</span>`; }
function button(label, act, cls = 'secondary', testId = '', disabled = false, extra = '') { return `<button type="button" class="${cls}" data-act="${act}" ${testId ? `data-testid="${testId}"` : ''} ${disabled ? 'disabled' : ''} ${extra}>${label}</button>`; }
function seed(scenario = 'success') {
  return { company: scenario === 'empty' ? 'B' : 'A', view: 'foundation', category: 'all', search: '', scenario, showReview: false,
    metricVersion: scenario === 'conflict' ? '1.2.1' : '1.2.0', metricSourceVersion: '2', methodVersion: '2', methodMetricVersion: '1.2.0', methodSourceVersion: '2', sourceVersion: '2', sourceEnabled: true, sourceDraft: null,
    candidateBase: '1.2.0', candidateSourceVersion: '2', candidateHistory: [], candidateScope: 'enterprise', candidateArchived: false, metricPublished: false, methodPublished: false,
    publication: null, originArchived: scenario === 'archived', maintenanceCreated: false, foundationWorks: { A: null, B: null }, activeWork: 'contribution',
    sourceHistory: [{ version: '2', body: '本企业会员身份以会员号及获准映射核定。首购与复购按本轮定义和观察截止统计。', enabled: true }],
    events: [], emptyTaskDrafts: { A: '', B: '' }, nextTask: null, oldCandidate: null, reviewRoute: null };
}
let state = seed();
let dialogState = null;
let returnFocus = null;
let suspendedEdit = null;
let toastTimer;
const oldReport = Object.freeze({ id: 'R01', metric: '1.2.0', method: '2', source: '2', task: 'T-A17', createdAt: '11 月 10 日 15:30' });
Object.defineProperty(window, 'demoState', { get: () => JSON.parse(JSON.stringify({ ...state, oldReport, runningTaskMetric: '1.2.0', assets: assets() })) });

function assets() {
  if (state.company === 'B') return [];
  return [
    { id: 'source', type: 'source', title: '会员运营制度与资料', subtitle: '原文、修订与适用范围', version: `修订 ${state.sourceVersion}`, status: state.sourceEnabled ? '已启用来源' : '已停用来源', tone: state.sourceEnabled ? 'success' : 'warning' },
    { id: 'identity', type: 'semantic', title: '会员身份与门店归属', subtitle: '会员、账号、门店及关系', version: 'r1', status: '已发布', tone: 'success' },
    { id: 'binding', type: 'binding', title: '会员与交易身份映射', subtitle: 'CRM 会员号 ↔ POS 交易会员号', version: 'r3', status: '已发布', tone: 'success' },
    { id: 'metric', type: 'metric', title: '首购会员 30 日复购率', subtitle: '首购队列 · 完整观察资格', version: state.metricVersion, status: '已发布', tone: 'success' },
    { id: 'net', type: 'metric', title: '门店销售退款净额', subtitle: '复用销售退款主题', version: '0.4.0', status: '已发布', tone: 'success' },
    { id: 'method', type: 'method', title: '门店首购会员复购核查', subtitle: '可比队列、样本量与核查顺序', version: `v${state.methodVersion}`, status: '已发布', tone: 'success' },
  ];
}
function workForCompany() { return state.foundationWorks[state.company]; }
function canReadNewTask() { return Boolean(state.nextTask && state.nextTask.company === state.company && state.company === 'A' && state.sourceEnabled && state.nextTask.version); }
function canEditCandidate() { return state.company === 'A' && (!state.originArchived || state.maintenanceCreated) && !state.candidateArchived && !state.publication?.unknown && !(state.metricPublished && state.methodPublished); }
function canRetryFailed() { return state.company === 'A' && state.sourceEnabled && state.candidateSourceVersion === state.sourceVersion && state.candidateScope === 'enterprise' && (!state.originArchived || state.maintenanceCreated); }
function canPublish() { return state.company === 'A' && state.sourceEnabled && state.candidateSourceVersion === state.sourceVersion && state.candidateScope === 'enterprise' && state.candidateBase === state.metricVersion && (!state.originArchived || state.maintenanceCreated) && !state.candidateArchived; }
function qualifiedMetric() { return state.company === 'A' && state.sourceEnabled ? state.metricVersion : null; }
function notify(text) { toastBox.textContent = text; toastBox.classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastBox.classList.remove('visible'), 4500); }
function heading(title, text, action = '') { return `<div class="heading"><div><div class="eyebrow">${icon('assets', 13)} ${esc(state.company)} 企业 · 共享业务资产</div><h1 tabindex="-1" id="page-title">${title}</h1><p>${text}</p></div>${action ? `<div class="actions">${action}</div>` : ''}</div>`; }
function tabs() { return `<div class="tabs" role="group" aria-label="Studio 视图">${[['foundation','企业基础资产'],['evolution','建设与演进'],['publication','发布与使用']].map(([key,label]) => button(`${label}${key === 'evolution' && state.company === 'A' ? '<span class="count">'+(state.metricPublished && state.methodPublished ? '0' : '1')+'</span>' : ''}`, 'view', `tab ${state.view === key ? 'active' : ''}`, `tab-${key}`, false, `data-view="${key}" aria-pressed="${state.view === key}"`)).join('')}</div>`; }
function render() {
  app.innerHTML = `<div class="shell"><aside class="sidebar" aria-label="工作台导航"><div class="brand"><div class="brand-mark">O</div><div><strong>OptraCall</strong><small>持续做出更好的决策</small></div></div><nav aria-label="主导航">${button(icon('case')+'<span>Case 看板</span>','open-task','nav-item', 'nav-cases',false,'aria-label="Case 看板"')}${button(icon('folder')+'<span>项目看板</span>','open-task','nav-item','nav-projects',false,'aria-label="项目看板"')}${button(icon('assets')+'<span>语义与分析资产</span>','home','nav-item active','nav-studio',false,'aria-label="语义与分析资产 Studio"')}${button(icon('tools')+'<span>工具与扩展</span>','tools','nav-item','nav-tools',false,'aria-label="工具与扩展"')}</nav><div class="nav-label">当前工作</div>${button(icon('folder',16)+'<span>门店会员运营</span>','open-task','nav-item','open-task',false,'aria-label="打开门店会员运营任务"')}<div class="sidebar-foot"><strong>企业资产 · 持续建设</strong>项目与任务保留执行及使用依据</div></aside><main class="main" id="main-content"><header class="topbar"><div class="breadcrumb">工作台 <span aria-hidden="true"> / </span> <b>语义与分析资产 Studio</b></div><div class="top-actions"><label class="sr-only" for="company-select">当前企业</label><select id="company-select" data-testid="company-select"><option value="A" ${state.company==='A'?'selected':''}>A企业（合成）</option><option value="B" ${state.company==='B'?'selected':''}>B企业（合成）</option></select>${button(icon('sun'), 'theme','icon-button','theme-toggle', false, 'aria-label="切换明暗主题" title="切换明暗主题"')}</div></header><div class="demo-ribbon"><span><i class="demo-dot"></i>交互原型 · 合成资料 · 不连接业务系统</span><span>刷新恢复演示初始状态</span></div><div class="page">${state.view==='foundation'?foundationView():state.view==='evolution'?evolutionView():publicationView()}${reviewTools()}<footer class="content-footer"><span>资料、语义、映射、指标与方法在同一企业体系中管理</span><span>原方案审核用 · v0.2</span></footer></div></main></div>`;
}
function foundationView() {
  const data = assets();
  const filtered = data.filter(a => (state.category==='all'||a.type===state.category) && `${a.title}${a.subtitle}${a.version}`.toLowerCase().includes(state.search.toLowerCase()));
  return heading('企业基础资产','查看已建立的业务依据与标准，按需建设、补充和维护。',button(icon('plus',15)+'建设基础资产','create','primary','create-foundation'))+tabs()+
    (state.company==='B'?emptyCompany():`<div class="summary"><div><span class="meta">可用正式资产</span><div class="value">${data.filter(a=>a.type!=='source').length}<small>覆盖销售退款与会员运营</small></div></div><div><span class="meta">企业资料</span><div class="value">${state.sourceEnabled?'1':'0'}<small>${state.sourceEnabled?'准确修订已启用':'来源停用，受影响用途需补依据'}</small></div></div><div><span class="meta">待完善贡献</span><div class="value">${state.metricPublished&&state.methodPublished?'0':'1'}<small>来自门店会员分析任务</small></div></div></div>${state.scenario==='unassigned'?`<div class="notice warning">${icon('info')}<div><strong>1 份旧资料尚未核定企业归属</strong><p>保持在待核区，未加入 A 企业的正式供给。${button('查看待核资料','unassigned','ghost','open-unassigned')}</p></div></div>`:''}${!state.sourceEnabled?`<div class="notice warning">${icon('info')}<div><strong>会员制度来源已停用</strong><p>旧报告依据仍可回看；依赖该来源的当前会员用途暂停供给，其他独立资产继续可用。</p></div></div>`:''}<div class="toolbar"><div class="filters" role="group" aria-label="资产分类">${Object.entries(categories).map(([key,label])=>button(label,'category',`filter ${state.category===key?'active':''}`,`category-${key}`,false,`data-category="${key}" aria-pressed="${state.category===key}"`)).join('')}</div><label class="search" for="asset-search">${icon('search',15)}<span class="sr-only">搜索企业资产</span><input id="asset-search" data-testid="asset-search" type="search" placeholder="搜索名称、口径或版本" value="${esc(state.search)}"></label></div><div class="panel asset-scroll"><div class="asset-list"><div class="asset-row asset-header"><span>资产与业务用途</span><span>分类</span><span>版本</span><span>当前状态</span><span></span></div>${filtered.length?filtered.map(asset=>`<button type="button" class="asset-row" data-act="asset" data-id="${asset.id}" data-testid="asset-${asset.id}"><span class="asset-name"><span class="asset-icon">${icon(asset.type,17)}</span><span><strong>${esc(asset.title)}</strong><small>${esc(asset.subtitle)}</small></span></span><span class="muted">${categories[asset.type]}</span><span>${esc(asset.version)}</span>${badge(asset.status,asset.tone)}${icon('arrow',15)}</button>`).join(''):`<div class="empty"><h2>没有找到匹配的资产</h2><p>可以换一个关键词，或查看全部分类。</p>${button('清除筛选','clear-search','secondary','clear-search')}</div>`}</div></div><div class="bottom-note"><span>${filtered.length} 项 · 企业资料作为依据，正式定义按适用范围使用</span>${button('查看任务如何使用','open-task','ghost','open-task-from-library')}</div>`);
}
function emptyCompany() { return `<div class="panel empty">${icon('assets',36)}<h2>本企业还没有基础资产</h2><p>A 企业的正式资产不会自动进入这里。可以先开展基础建设，也可以直接进行普通分析。</p><div class="actions" style="justify-content:center">${button('建设基础资产','create','primary','empty-create')}${button('去普通分析','open-task','secondary','empty-analysis')}</div></div>`; }
function evolutionView() {
  if (state.company === 'B' && workForCompany()) {
    return heading('建设与演进', '继续本企业已保存的建设工作。', button(icon('plus',15)+'发起基础建设','create','primary','evolution-create')) + tabs() + `<section class="panel"><div class="panel-head"><h2>当前建设工作</h2>${badge('1 项工作')}</div><article class="work-card"><div class="work-title"><h3>${esc(workForCompany().title)}</h3>${badge('等待资料','warning')}</div><p>本企业建设目标已保存，获准资料尚待补充。A 企业内容未加入本轮。</p><div class="work-meta">B企业（合成） · P-BASE-B / T-B02</div>${button('打开建设工作台','foundation-work','secondary','open-foundation-work')}</article></section>`;
  }
  const local = state.candidateScope==='case';
  return heading('建设与演进','提前建设企业标准，也接续来自业务任务的新资料和修订。',button(icon('plus',15)+'发起基础建设','create','primary','evolution-create'))+tabs()+
    (state.company==='B'?emptyCompany():`<div class="split"><section class="panel"><div class="panel-head"><h2>当前建设工作</h2>${badge(workForCompany()?'2 项工作':'1 项工作')}</div>${workForCompany()?`<article class="work-card"><div class="work-title"><h3>${esc(workForCompany().title)}</h3>${badge('等待资料','warning')}</div><p>已保存建设目标和已选资料，会员历史缺口待补充；其他独立建设可以继续。</p><div class="work-meta">企业基础建设 · P-BASE / T-B02 · 原生任务接续</div>${button('打开建设工作台','foundation-work','secondary','open-foundation-work')}</article>`:''}<article class="work-card"><div class="work-title"><h3>补齐退款后的有效购买规则</h3>${badge(local?'仅本案约定':state.metricPublished&&state.methodPublished?'已发布，待实际使用':state.originArchived&&!state.maintenanceCreated?'原项目已归档':'候选待核',local?'':'warning')}</div><p>门店会员分析发现首购资格与退款处理需要进一步明确。Agent 已形成候选并保留原任务依据。</p><div class="work-meta">${state.maintenanceCreated?'接续任务 P-BASE / T-M02 · 原贡献 P-MEMBER / T-A17':'任务贡献 · P-MEMBER / T-A17'} · 基于指标 ${esc(state.candidateBase)}</div><div class="actions">${button('查看候选与差异','candidate','primary','open-candidate')}${button('查看原分析任务','open-task','secondary','open-origin-task')}</div></article></section><aside><section class="panel"><div class="panel-head"><h2>沿同一套资产维护</h2></div><div class="panel-body"><ul class="mini-list"><li>企业基础层<small>正式资产、适用范围及准确版本</small></li><li>任务演进层<small>候选、差异、来源任务及待核问题</small></li><li>发布后再用<small>新任务按需发现，旧报告保留原依据</small></li></ul></div></section><div class="inline-note">行业、领域和标杆是建设参考。企业具体规则按获准资料核定。</div></aside></div>`);
}
function publicationView() {
  const publication = state.publication;
  return heading('发布与使用','分别查看正式版本、分项结果、当前供给与实际使用依据。')+tabs()+
  (state.company==='B'?emptyCompany():`<div class="split"><section><div class="panel"><div class="panel-head"><h2>最近发布</h2>${badge(publication?'本次候选':'暂无新发布')}</div><div class="panel-body">${publication?publicationSummary():`<div class="empty" style="padding:24px"><h3>新修订尚未发布</h3><p style="margin-top:8px">当前基础库继续使用准确正式版本。</p>${button('查看候选与差异','candidate','secondary','publication-candidate')}</div>`}</div></div><section class="panel section-gap"><div class="panel-head"><h2>使用与历史依据</h2></div><div class="table-wrap"><table><thead><tr><th>任务或报告</th><th>实际绑定指标</th><th>状态</th><th></th></tr></thead><tbody><tr><td>原分析报告 R01<p>P-MEMBER / T-A17</p></td><td data-testid="old-report-version">1.2.0</td><td>${badge('历史保持')}</td><td>${button('查看依据','report','ghost','open-old-report')}</td></tr><tr><td>运行中任务 T-A18<p>本次运行已固定</p></td><td data-testid="running-task-version">1.2.0</td><td>${badge('运行中','accent')}</td><td>${button('查看运行依据','running','ghost','open-running-task')}</td></tr>${state.nextTask?`<tr><td>新任务 T-A19<p>当前企业下新建</p></td><td>${esc(state.nextTask.version||'未取得合格版本')}</td><td>${badge(state.nextTask.used?'已模拟读取':'仅创建，尚未读取',state.nextTask.used?'success':'')}</td><td>${button('打开任务','new-task','ghost','open-new-task')}</td></tr>`:''}</tbody></table></div></section></section><aside><section class="panel"><div class="panel-head"><h2>当前供给</h2></div><div class="panel-body"><div class="check-line"><span>指标正式版本</span><strong data-testid="current-metric-version">${state.metricVersion}</strong></div><div class="check-line"><span>后续新任务</span>${badge(qualifiedMetric()?`可发现 ${qualifiedMetric()}`:'来源待补，用途受限',qualifiedMetric()?'accent':'warning')}</div><div class="check-line"><span>图表示</span>${badge('仍为原快照')}</div><div class="check-line"><span>新版本实际使用</span>${badge(state.nextTask?.used?'已模拟读取':'尚未发生',state.nextTask?.used?'success':'')}</div><p class="help" style="margin-top:14px">发布和新任务可发现不替代实际读取。图刷新沿自身资格与快照规则处理。</p>${button('创建后续普通任务','create-next-task','secondary','create-next-task')}</div></section></aside></div>`);
}
function publicationSummary() {
  const p=state.publication;
  return `<div class="flex-between"><h3>会员有效购买规则修订</h3>${badge(p.unknown?'结果待核':p.results.some(r=>r.status==='failed')?'部分成功':'分项已确认',p.unknown||p.results.some(r=>r.status==='failed')?'warning':'success')}</div><p class="meta" style="margin-top:5px">${esc(p.id)} · 固定候选预览 PV-01</p><div class="table-wrap"><table><thead><tr><th>模块</th><th>本次目标</th><th>实际结果</th></tr></thead><tbody>${p.results.map(r=>`<tr><td>${r.name}</td><td>${r.version}</td><td>${badge(r.status==='succeeded'?'成功':r.status==='failed'?'失败':'UNKNOWN',r.status==='succeeded'?'success':r.status==='failed'?'danger':'warning')}</td></tr>`).join('')}</tbody></table></div><div class="actions" style="margin-top:14px">${p.unknown?button('查回原请求回执','query-receipt','secondary','query-receipt'):p.results.some(r=>r.status==='failed')?button('仅重试已确认失败项','retry-failed','secondary','retry-failed',!canRetryFailed()):button('查看完整发布记录','publication-detail','ghost','publication-detail')}</div>${p.attempts.length>1?`<p class="help" style="margin-top:10px">已保留 ${p.attempts.length} 次原始结果；原 FAIL／UNKNOWN 未改写。</p>`:''}`;
}
function reviewTools() { return `<details class="review-tools" ${state.showReview?'open':''} id="review-tools"><summary data-testid="review-scenes">评审场景</summary><div class="review-controls"><label for="scenario-select">切换合成场景<select id="scenario-select" data-testid="scenario-select">${Object.entries(scenarioNames).map(([key,label])=>`<option value="${key}" ${state.scenario===key?'selected':''}>${label}</option>`).join('')}</select></label>${button('重置演示','reset','secondary','reset-demo')}</div><p>用于核对交互边界；切换场景会重置本页内存。这里的结果不代表产品执行、真实模型或业务验收。</p></details>`; }

function openDialog(kind, data={}) {
  if (overlay.open && dialogState?.dirty && kind !== dialogState.kind) { suspendEdit({kind,data}); return; }
  if (!overlay.open) returnFocus = { element: document.activeElement, testId: document.activeElement?.getAttribute('data-testid') };
  dialogState={kind,...data};
  renderDialog();
  if(!overlay.open) overlay.showModal();
  requestAnimationFrame(()=>overlay.querySelector('[autofocus], .dialog-head button, button')?.focus());
}
function closeDialog(force = false) {
  if (!force && dialogState?.kind === 'discard-confirm') { restoreEdit(); return; }
  if (!force && dialogState?.dirty) { suspendEdit({kind:'close'}); return; }
  overlay.close(); dialogState=null;
  const target=returnFocus?.element?.isConnected?returnFocus.element:returnFocus?.testId?document.querySelector(`[data-testid="${returnFocus.testId}"]`):null;
  (target||document.getElementById('page-title'))?.focus();
}
function suspendEdit(target) {
  suspendedEdit={dialog:{...dialogState},target,fields:[...overlay.querySelectorAll('textarea[id], input[id]')].map(input=>({id:input.id,value:input.value,checked:input.checked}))};
  dialogState={kind:'discard-confirm'};renderDialog();
  requestAnimationFrame(()=>overlay.querySelector('[data-testid="keep-editing"]')?.focus());
}
function restoreEdit() {
  if(!suspendedEdit)return;const saved=suspendedEdit;suspendedEdit=null;dialogState=saved.dialog;renderDialog();
  for(const field of saved.fields){const input=overlay.querySelector('#'+field.id);if(input){input.value=field.value;if(input.type==='checkbox')input.checked=field.checked;}}
  overlay.querySelector('textarea')?.focus();
}
overlay.addEventListener('cancel',e=>{e.preventDefault();closeDialog();});
function dialogFrame(title, subtitle, body, footer='', wide=false) {
  overlay.className=wide?'wide':'';
  overlay.innerHTML=`<div class="dialog-head"><div><h2 id="dialog-title">${title}</h2>${subtitle?`<p class="dialog-intro">${subtitle}</p>`:''}</div>${button(icon('close'),'close','icon-button','close-dialog',false,'aria-label="关闭面板"')}</div><div class="dialog-body">${body}</div>${footer?`<div class="dialog-actions">${footer}</div>`:''}`;
}
function renderDialog() {
  if(!dialogState)return;
  if(dialogState.kind==='discard-confirm')return dialogFrame('本轮内容尚未保存','已保存的工作稿与历史不受影响。','<p>可以继续编辑，或放弃本轮未保存的修改。</p>',button('放弃本轮修改','discard-changes','secondary','discard-changes')+button('继续编辑','keep-editing','primary','keep-editing'));
  if(dialogState.kind==='asset')return assetDialog();
  if(dialogState.kind==='create')return createDialog();
  if(dialogState.kind==='foundation-work')return foundationWorkDialog();
  if(dialogState.kind==='task')return taskDialog();
  if(dialogState.kind==='candidate')return candidateDialog();
  if(dialogState.kind==='preview')return previewDialog();
  if(dialogState.kind==='report')return reportDialog();
  if(dialogState.kind==='running')return dialogFrame('运行中任务的固定依据','P-MEMBER / T-A18',`<div class="notice">${icon('clock')}<div><strong>本次运行保持指标 1.2.0</strong><p>后续发布不会替换运行中的固定依据。来源资格变化仍需要核查。</p></div></div><dl class="detail-grid"><dt>指标</dt><dd>首购会员 30 日复购率 · 1.2.0</dd><dt>方法</dt><dd>门店首购会员复购核查 · v2</dd><dt>原来源</dt><dd>会员运营制度 · 修订 2</dd></dl>`,button('关闭','close','secondary'));
  if(dialogState.kind==='new-task')return newTaskDialog();
  if(dialogState.kind==='source-edit')return sourceEditDialog();
  if(dialogState.kind==='source-revision') { const revision=state.sourceHistory.find(r=>r.version===dialogState.version); return dialogFrame('企业资料准确修订 '+esc(dialogState.version), '历史原文 · 只读回看', `<div class="definition">${esc(revision?.body||'修订不存在')}</div><div class="inline-note">${state.sourceEnabled&&state.sourceVersion===dialogState.version?'本修订当前已启用。':'历史可查；当前供给资格另按启用状态核定。'} 此处回看不会改变当前来源或报告引用。</div>`,button('返回资料','asset-source','secondary')); }
  if(dialogState.kind==='unassigned')return unassignedDialog();
  if(dialogState.kind==='publication-detail')return publicationDetailDialog();
  if(dialogState.kind==='tools')return dialogFrame('工具与扩展','语义与分析资产已归入 Studio 统一管理',`<div class="panel"><div class="panel-body"><h3>现有分析能力</h3><p class="meta" style="margin-top:8px">连接器、分析 Skill 与其他业务能力仍沿原入口管理。企业业务资料与 SAP 的独立卡片已从本原型移除。</p></div></div>`,button('返回 Studio','home','primary'));
}
function assetDialog() {
  const asset=assets().find(a=>a.id===dialogState.id);
  if(!asset)return dialogFrame('资产不可用','本企业当前没有此资产。','',button('关闭','close','secondary'));
  const tab=dialogState.tab||'definition';
  const linkedSourceVersion=asset.id==='metric'?state.metricSourceVersion:asset.id==='method'?state.methodSourceVersion:'2';
  const tabsHtml=`<div class="dialog-tabs" role="group" aria-label="资产详情">${[['definition','定义与口径'],['sources','来源与映射'],['history','版本与使用']].map(([key,label])=>button(label,'asset-tab',tab===key?'active':'',`asset-tab-${key}`,false,`data-tab="${key}"`)).join('')}</div>`;
  let body='';
  if(tab==='history') {
    body=`<div class="version-strip"><span class="meta">当前版本</span><span class="version-number">${esc(asset.version)}</span>${badge(asset.status,asset.tone)}</div><div class="panel"><div class="panel-body"><h3>准确使用记录</h3><ul class="mini-list"><li>${button('原报告 R01 · 指标 1.2.0 / 方法 v2','report','ghost','asset-open-report')}<small>历史版本及原输入保持，后续修订另存。</small></li><li>${button('运行中任务 T-A18 · 固定指标 1.2.0','running','ghost','asset-open-running')}</li>${state.sourceDraft?`<li>资料工作稿 · 修订 ${state.sourceDraft.version}<small>尚未启用，原修订 ${state.sourceVersion} 仍为当前来源。</small></li>`:''}</ul></div></div>${asset.id==='source'?`<div class="inline-note">原文历史修订均保留，停用不删除原字节。<div class="actions">${state.sourceHistory.map(h=>button('查看修订 '+h.version,'source-revision','ghost','source-revision-'+h.version,false,'data-version="'+h.version+'"')).join('')}</div></div>`:''}`;
  } else if(tab==='sources') {
    body=`<p class="meta">从指标含义追溯到企业制度、实际字段和分析用途。</p>${[['source','source','会员运营制度与资料','企业原文 · 修订 '+linkedSourceVersion],['binding','binding','会员与交易身份映射','CRM member_id ↔ POS member_no · r3'],['identity','semantic','会员身份与门店归属','企业语义 · r1'],['method','method','门店首购会员复购核查','SAP 方法 · v'+state.methodVersion+' · 引用指标 '+state.methodMetricVersion]].filter(([id])=>id!==asset.id).map(([id,type,title,note])=>`<button type="button" class="relation" data-act="${id==='source'?'source-revision':'asset'}" data-id="${id}" data-version="${linkedSourceVersion}" data-testid="relation-${id}">${icon(type,18)}<span><strong>${title}</strong><small>${note}</small></span>${icon('arrow',15)}</button>`).join('')}<div class="inline-note">通用行业、会员领域与标杆公开实践为参考候选。具体企业口径来自本企业获准资料。</div>`;
  } else if(asset.id==='source') {
    body=`<div class="flex-between">${badge(asset.status,asset.tone)}<span class="meta">来源修订 ${state.sourceVersion}</span></div><div class="definition" style="margin-top:16px">${esc(state.sourceHistory.find(h=>h.version===state.sourceVersion)?.body||'会员制度原文')}</div><dl class="detail-grid"><dt>企业归属</dt><dd>A企业（合成）</dd><dt>来源</dt><dd>会员运营制度（合成节选）</dd><dt>用途</dt><dd>作为身份与购买规则的资料依据；启用不代表内容已经核实。</dd></dl>${state.sourceDraft?`<div class="notice warning section-gap">${icon('source')}<div><strong>有未启用的新工作稿 · 修订 ${state.sourceDraft.version}</strong><p>${esc(state.sourceDraft.body)}</p></div></div>`:''}`;
  } else if(asset.id==='metric') {
    body=`<div class="flex-between">${badge('正式指标','success')}<span class="meta">SAP · ${state.metricVersion}</span></div><div class="definition" style="margin-top:16px">符合完整观察条件的首购会员中，首购后 30 日内再次完成有效购买的去重会员数 ÷ 符合该观察条件的首购会员数。</div><dl class="detail-grid"><dt>观察条件</dt><dd>首购后 30 日；数据截止 2026-10-31。均为合成示例，企业实际观察窗尚待核定。</dd><dt>有效购买</dt><dd>${state.metricPublished?'排除全额退款订单，首购顺延至下一笔有效购买；部分退款保留有效购买资格。':'按成功支付识别；退款后的购买资格仍有待补齐的边界。'}</dd><dt>适用范围</dt><dd>A 企业门店会员主题。历史不足时仅描述首次可观察购买。</dd><dt>当前资格</dt><dd>${state.sourceEnabled?'来源修订可读，正式定义可供任务按需核用。':'制度来源已停用，当前受影响用途暂停；历史依据仍可查看。'}</dd></dl>`;
  } else if(asset.id==='identity')body=`<div class="definition">会员账号关联企业会员身份，购买事件关联会员与门店。跨系统身份由准确映射核定；同名、同手机号线索不自动等同为同一人。</div><dl class="detail-grid"><dt>主要对象</dt><dd>会员身份、会员账号、门店、购买事件</dd><dt>关系</dt><dd>账号对应身份；购买发生于门店；交易关联有效会员身份。</dd><dt>来源</dt><dd>企业制度修订 2、数据映射 r3。</dd></dl>`;
  else if(asset.id==='binding')body=`<div class="definition">按获准会员映射表，将交易中的 POS 会员号关联至 CRM 会员标识。无法核定的记录保留未识别状态。</div><div class="table-wrap section-gap"><table><thead><tr><th>业务含义</th><th>来源字段</th><th>约束</th></tr></thead><tbody><tr><td>会员身份</td><td>CRM.member_id</td><td>稳定标识，合并记录保留出处</td></tr><tr><td>交易会员</td><td>POS.member_no</td><td>通过授权映射表关联</td></tr><tr><td>购买门店</td><td>POS.store_id</td><td>关联门店主数据</td></tr></tbody></table></div>`;
  else if(asset.id==='method')body=`<div class="definition">先核对会员身份、首购历史和完整观察资格，再按可比首购队列比较门店。结合样本量、退款与跨店规则安排核查，区分筛查线索和运营原因。</div><ul class="mini-list section-gap"><li>输入条件<small>获准会员、交易、退款、门店映射及足够历史。</small></li><li>检查与限制<small>观察不足不按零复购计算；低复购率不直接证明门店运营失误。</small></li><li>指标引用<small>首购会员 30 日复购率 · ${state.methodMetricVersion}</small></li></ul>`;
  else body=`<div class="definition">门店成功支付金额与符合定义的退款事件形成净额，按相同范围比较两个期间。继续沿用销售退款主题的正式口径与数据映射。</div><p class="help section-gap">会员主题修订不覆盖这项独立销售退款资产。</p>`;
  let footer=button('关闭','close','secondary');
  if(asset.id==='source')footer=`<div class="actions">${button('编辑新工作稿','edit-source','secondary','edit-source')}${button(state.sourceEnabled?'停用当前来源':'启用原修订','toggle-source','secondary','toggle-source')}</div>${state.sourceDraft?button('启用新修订','enable-source-draft','primary','enable-source-draft'):''}`;
  else if(asset.id==='metric'||asset.id==='method')footer=button('查看相关修订候选','candidate','primary','asset-open-candidate');
  dialogFrame(esc(asset.title),`${categories[asset.type]} · A企业（合成） · ${esc(asset.version)}`,tabsHtml+body,footer);
}
function createDialog() {
  dialogFrame('建设企业基础资产',`${state.company}企业（合成） · 沿项目任务承接建设`, `<label class="field" for="build-goal"><span>希望建立哪些业务资产？</span><textarea id="build-goal" data-testid="build-goal" placeholder="描述你要支持的问题和当前资料">建立会员运营基础资产，支持门店首购会员复购核查。</textarea></label><div class="field"><span>获准资料</span><div class="checks">${state.company==='A'?'<label for="material-source"><input type="checkbox" id="material-source" checked>会员运营制度 · 修订 '+state.sourceVersion+'</label><label for="material-binding"><input type="checkbox" id="material-binding" checked>已有门店、交易与退款资产</label>':'<p class="meta">本企业尚无登记资料。可以先保存建设目标，后续补充获准来源。</p>'}</div></div><details><summary class="link-text" style="font-size:12px;cursor:pointer">按需使用行业、领域和标杆参考</summary><div class="checks" style="margin-top:12px"><label for="reference-industry"><input type="checkbox" id="reference-industry" checked>运动鞋服行业参考</label><label for="reference-domain"><input type="checkbox" id="reference-domain" checked>会员运营领域参考</label><label for="reference-benchmark"><input type="checkbox" id="reference-benchmark">标杆公开实践（可选）</label></div><p class="help" style="margin-top:10px">参考内容先作为候选，具体企业事实另依据本企业资料核定。</p></details><div class="inline-note">Agent 自主盘点、取材和核查。仅将资料无法决定的实质取舍集中交给你。</div>`, `${button('取消','close','secondary')}${button('开始建设','start-build','primary','start-build')}`);
}
function foundationWorkDialog() {
  const selectedMaterials = state.company === 'A' ? workForCompany()?.materials || [] : [];
  const hasMaterials = selectedMaterials.length > 0;
  const canReuseStoreAssets = selectedMaterials.includes('已有门店、交易与退款资产');
  const introduction = !hasMaterials
    ? '已保存建设目标与参考范围。本轮尚未选取本企业业务资料，需要补充本企业资料后再核定具体身份、交易和购买规则。'
    : canReuseStoreAssets
      ? '已保存建设目标与本轮选材范围。已选的门店、交易与退款资产可作为复用起点；判断企业首次购买还需核对更早历史。'
      : '已保存建设目标并登记本轮所选企业资料。可先核对制度中的身份与购买规则，门店、交易及历史覆盖仍待补充。';
  const continuation = hasMaterials
    ? '已保留身份、映射和指标候选的建设范围。首购历史缺口等待补充，其他有充分依据的独立内容可以继续完善。'
    : '参考内容保持候选，待本企业资料核对后再内化为企业资产。已保存的工作可以在资料补齐后接续。';
  const materialGap = canReuseStoreAssets
    ? '会员交易历史起点及覆盖说明。该缺口影响真实首购识别。'
    : '本企业会员制度、身份映射、门店交易及历史覆盖说明。资料未补齐前，相关具体规则保持待核。';
  dialogFrame('会员运营基础建设','企业归属与任务执行归属分别保留',`<div class="split"><section><div class="agent-message"><span class="agent-avatar">O</span><div><strong>建设 Agent ${badge('已保存接续位置')}</strong><p>${esc(introduction)}</p><p>${esc(continuation)}</p></div></div><div class="notice warning">${icon('info')}<div><strong>待补资料</strong><p>${esc(materialGap)}</p></div></div></section><aside class="panel"><div class="panel-head"><h3>本轮资源与归属</h3></div><div class="panel-body"><div class="resource-item"><strong>企业基础建设</strong><p>${esc(state.company)}企业（合成）</p></div><div class="resource-item"><strong>${state.company==='B'?'P-BASE-B':'P-BASE'} / T-B02</strong><p>真实产品中沿已有项目任务；此处为内存演示。</p></div><div class="resource-item"><strong>已选材料</strong><p>${workForCompany()?.materials?.length?esc(workForCompany().materials.join('、')):'尚未选取企业资料'}</p></div><div class="resource-item"><strong>参考候选</strong><p>${esc(workForCompany()?.references?.join('、')||'无')}</p></div></div></aside></div><label class="field" for="build-followup"><span>继续补充建设意见</span><textarea id="build-followup" data-testid="build-followup" placeholder="可以补充背景；演示不会发送模型">${esc(workForCompany()?.draft||'')}</textarea></label>`,`${button('返回工作列表','close','secondary')}${button('保存补充草稿','save-build-draft','primary','save-build-draft')}`,true);
}
function taskDialog() {
  if(state.company==='B')return dialogFrame('普通分析任务','B企业（合成） · 企业基础库为空',`<div class="agent-message"><span class="agent-avatar">O</span><div><strong>普通分析</strong><p>可以先依据本次获准资料开展分析，明确缺少的企业口径；无需先将 Studio 建齐。</p><p>A 企业资产不会自动进入 B 企业。本任务尚未读取企业正式资产。</p></div></div><label class="field" for="empty-question"><span>本次问题</span><textarea id="empty-question" placeholder="直接提出分析问题">${esc(state.emptyTaskDrafts[state.company])}</textarea></label>`,`${button('关闭','close','secondary')}${button('保存任务草稿','save-empty-draft','primary','save-empty-draft')}`);
  dialogFrame('哪些门店的首购会员复购偏低？','门店会员运营 / T-A17 · 原分析任务',`<div class="flex-between"><span class="report-id">历史报告 R01 · 指标 1.2.0 / 方法 v2</span>${state.originArchived?badge('原项目已归档','warning'):badge('原分析已完成')}</div><div class="task-report"><p>在同一首购队列与完整观察资格下，青鹭站值得优先核查。雁汀站部分会员尚未满观察窗，暂不列入同一排序。</p><small>预置演示内容，未执行真实计算或专业验收。</small></div><div class="agent-message"><span class="agent-avatar">O</span><div><strong>Agent 已整理资产补充 ${badge('候选','warning')}</strong><p>退款后是否仍算有效购买会影响首购顺序。已基于指标 1.2.0 形成修订候选，关联原报告、制度来源与受影响方法。</p></div></div><div class="notice">${icon('source')}<div><strong>准确依据保留</strong><p>报告仍绑定原版本。查看候选不会改变企业正式口径。</p></div></div>`,`${button('查看原报告依据','report','secondary','task-report')}${button('查看 Agent 贡献候选','candidate','primary','task-candidate')}`);
}
function candidateDialog() {
  const conflict=state.candidateBase!==state.metricVersion&&!state.metricPublished;
  const archived=state.originArchived&&!state.maintenanceCreated;
  const local=state.candidateScope==='case';
  const complete=state.metricPublished&&state.methodPublished;
  const sourceChanged=state.candidateSourceVersion!==state.sourceVersion;
  let warnings='';
  if(conflict)warnings+=`<div class="notice danger">${icon('info')}<div><strong>基础版本发生变化</strong><p>此候选基于 ${state.candidateBase}，当前正式版为 ${state.metricVersion}。需要核对差异并准备新候选。</p>${button('基于现版重新核对','rebase','ghost','rebase-candidate',!canEditCandidate())}</div></div>`;
  if(archived)warnings+=`<div class="notice warning">${icon('lock')}<div><strong>原建设项目已归档，只读保留</strong><p>企业基础资产可由新获准任务接续维护，无需解档或复制原体系。</p>${button('新建接续维护任务','new-maintenance','ghost','new-maintenance-task')}</div></div>`;
  if(!state.sourceEnabled)warnings+=`<div class="notice warning">${icon('info')}<div><strong>资料来源已停用</strong><p>当前不能以该来源准备正式发布；原候选和报告依据保留。</p></div></div>`;
  if(sourceChanged)warnings+=`<div class="notice warning">${icon('info')}<div><strong>候选来源需要重新核对</strong><p>此候选基于制度修订 ${state.candidateSourceVersion}，当前已启用修订 ${state.sourceVersion}。原候选和来源保持；新稿不会自动证明口径仍成立。</p>${button('模拟 Agent 核对新来源','recheck-source','ghost','recheck-source',!canEditCandidate()||!state.sourceEnabled)}</div></div>`;
  if(local)warnings+=`<div class="notice">${icon('case')}<div><strong>仅保留为本案约定</strong><p>不会进入企业基础库，也不会改其他任务的默认口径。</p></div></div>`;
  if(complete)warnings+=`<div class="notice success">${icon('check')}<div><strong>本次分项成果已发布</strong><p>指标 ${state.metricVersion}、方法 v${state.methodVersion}；后续实际使用单独记录。</p></div></div>`;
  dialogFrame('有效购买与首购规则修订','企业资产 MET-MEMBER-01 · 来源任务 P-MEMBER / T-A17',`${warnings}<div class="version-strip"><span class="meta">基于</span><strong>${esc(state.candidateBase)}</strong><span aria-hidden="true">→</span><strong>候选 1.3.0</strong>${badge('待发布候选','warning')}</div><div class="diff"><div><h3>原指标 ${esc(state.candidateBase)}</h3><p>按成功支付识别购买；退款后资格与首购顺序仍需明确。</p></div><div class="after"><h3>候选补充</h3><p>全额退款不计有效购买，首购顺延至下一笔有效购买；部分退款保留购买资格。关联方法补充退款检查。</p></div></div><p class="help">30 日观察窗和上述规则均为合成演示，不代表 A 企业实际口径已经确认。</p><div class="divider"></div><h3 style="margin-bottom:10px">适用范围</h3><div class="inline-options"><label><input type="radio" name="candidate-scope" value="enterprise" ${!local?'checked':''} ${complete||archived||state.publication?'disabled':''}>企业共享候选</label><label><input type="radio" name="candidate-scope" value="case" ${local?'checked':''} ${complete||archived||state.publication?'disabled':''}>仅本案约定</label></div><dl class="detail-grid"><dt>来源</dt><dd>原报告 R01、会员制度修订 ${state.candidateSourceVersion}、身份映射 r3</dd><dt>执行归属</dt><dd>${state.maintenanceCreated?'P-BASE / T-M02（新接续任务）':'P-MEMBER / T-A17（原贡献任务）'}</dd><dt>受影响内容</dt><dd>本指标与“门店首购会员复购核查”方法；销售退款净额保持独立。</dd></dl>${state.oldCandidate?'<p class="help section-gap">旧候选基于 '+esc(state.oldCandidate)+' 的内容和冲突记录已保留。</p>':''}`,`${button('返回','close','secondary')}${complete?button('查看发布与使用','publication-view','primary','candidate-publication'):button(local?'保存本案约定':'准备发布预览',local?'save-local':'prepare-preview','primary','prepare-preview',archived||(!local&&!canPublish()))}`,true);
}
function previewCurrent() {const basis=dialogState?.basis;return Boolean(basis&&basis.company===state.company&&basis.base===state.candidateBase&&basis.source===state.candidateSourceVersion&&basis.current===state.metricVersion&&basis.sourceCurrent===state.sourceVersion);}
function previewDialog() {
  const blocked=!canPublish()||!previewCurrent();
  dialogFrame('确认本次正式发布','预览 PV-01 · 企业 A · 固定候选及范围',`<p style="font-size:13px">将核对后的两项企业共享候选纳入基础资产。保留原版本、来源任务和历史报告。</p><div class="table-wrap"><table><thead><tr><th>专业模块</th><th>准确目标版本</th><th>影响</th></tr></thead><tbody>${!state.metricPublished?'<tr><td>SAP 指标</td><td>首购会员 30 日复购率 · 1.3.0</td><td>有效购买与首购顺延</td></tr>':''}${!state.methodPublished?'<tr><td>SAP 方法</td><td>门店首购会员复购核查 · v3</td><td>增加退款资格检查</td></tr>':''}</tbody></table></div><div class="inline-note">新任务可发现已成功发布的合格版本；原报告 R01 和运行中任务继续绑定原版本。图刷新及实际使用分别核定。</div>${blocked?'<div class="notice danger">当前候选或来源资格已变化，请返回核对。</div>':''}`,`${button('取消，保留候选','close','secondary','cancel-preview')}${button('确认发布','confirm-publish','primary','confirm-publish',blocked)}`);
}
function reportDialog() {
  dialogFrame('原报告 R01 的依据','原版本与原报告保留，后续修订另行记录',`<div class="task-report"><span class="report-id">${oldReport.createdAt} · P-MEMBER / ${oldReport.task}</span><p>门店首购会员复购核查报告</p><small>预置合成报告，仅演示版本与来源关系。</small></div><dl class="detail-grid"><dt>指标</dt><dd data-testid="report-bound-version">首购会员 30 日复购率 · ${oldReport.metric}</dd><dt>方法</dt><dd>门店首购会员复购核查 · v${oldReport.method}</dd><dt>企业资料</dt><dd>会员运营制度 · 修订 ${oldReport.source}（原文历史可回看）</dd><dt>映射</dt><dd>会员与交易身份映射 · r3</dd><dt>当前提示</dt><dd>${state.sourceEnabled?'新发布不改写本报告的依据。':'原资料当前已停用；该历史记录不代表来源仍具当前供给资格。'}</dd></dl>`,button('关闭','close','secondary'));
}
function newTaskDialog() {
  const task=state.nextTask;
  dialogFrame('后续普通分析任务','P-MEMBER / T-A19 · 按企业范围发现正式资产',`<div class="agent-message"><span class="agent-avatar">O</span><div><strong>企业资产目录 ${badge(task?.used?'已模拟读取':'可按需读取',task?.used?'success':'accent')}</strong><p>${task?.version?'本任务可发现指标 '+esc(task.version)+'。Agent 根据问题选择定义与方法，不要求逐个手工启用。':'当前会员来源受限，暂未取得合格版本；仍可分析其他获准内容并说明限制。'}</p></div></div><dl class="detail-grid"><dt>新任务版本</dt><dd data-testid="new-task-version">${esc(task?.version||'待补依据')}</dd><dt>原报告 R01</dt><dd>继续保留指标 1.2.0</dd><dt>运行中 T-A18</dt><dd>继续固定指标 1.2.0</dd><dt>当前资格</dt><dd>${canReadNewTask()?'当前来源可核读':'当前来源或企业资格不符，停止读取'}</dd><dt>实际使用</dt><dd>${task?.used?'已在原型中模拟读取准确版本；没有真实工具调用或计算。':'尚未读取，目录可见不等于实际使用。'}</dd></dl>`,`${button('关闭','close','secondary')}${button('模拟按需读取','read-new-task','primary','read-new-task',!canReadNewTask()||task?.used)}`);
}
function sourceEditDialog() { dialogFrame('编辑企业资料工作稿','保存工作稿与启用修订分别处理',`<label class="field" for="source-body"><span>资料正文</span><textarea id="source-body" data-testid="source-body">${esc(state.sourceDraft?.body||state.sourceHistory.find(h=>h.version===state.sourceVersion)?.body||'')}</textarea></label><p class="help">保存后保留为新工作稿，当前启用修订和历史报告依据保持。</p>`,`${button('取消','asset-source','secondary')}${button('保存工作稿','save-source','primary','save-source-draft')}`); }
function unassignedDialog() { dialogFrame('旧资料的企业归属待核','未归属资料 · 不进入企业默认供给',`<div class="notice warning">${icon('info')}<div><strong>门店会员制度旧稿</strong><p>原资料仅有文本范围说明，尚无可靠企业归属。Agent 可整理依据与建议，待核定后建立关联。</p></div></div><dl class="detail-grid"><dt>当前归属</dt><dd>未核定</dd><dt>A 企业基础库</dt><dd>未纳入</dd><dt>原始资料</dt><dd>旧字节与修订继续保留</dd></dl>`,button('保留待核状态','close','secondary')); }
function publicationDetailDialog() { const p=state.publication; dialogFrame('准确发布记录',p?.id||'',`${publicationSummary()}<div class="divider"></div><h3>原始结果保留</h3>${p?.attempts.map((attempt,index)=>`<div class="resource-item"><strong>记录 ${index+1} · ${esc(attempt.label)}</strong><p>${attempt.results.map(r=>`${r.name} ${r.version}：${r.status}`).join('；')}</p></div>`).join('')||''}<p class="help section-gap">来源任务与候选引用保留。图仍为原快照，业务问题解决须经实际再用验证。</p>`,button('关闭','close','secondary')); }

function performPublication() {
  if(!canPublish()||!previewCurrent()||state.publication)return;
  const outcome=state.scenario;
  const results=[{key:'metric',name:'SAP 指标',version:'1.3.0',status:outcome==='unknown'?'unknown':'succeeded'}, {key:'method',name:'SAP 方法',version:'v3',status:outcome==='partial'?'failed':'succeeded'}];
  state.publication={id:'PUB-01',basis:{source:state.candidateSourceVersion,base:state.candidateBase},results,unknown:outcome==='unknown',attempts:[{label:'原确认请求 PUB-01',results:structuredClone(results)}]};
  applySuccess(results); state.view='publication'; state.events.push('publish-confirmed'); closeDialog();render();notify(outcome==='unknown'?'已保留 UNKNOWN；先查回原请求回执。':outcome==='partial'?'指标发布成功，方法失败；候选与失败记录保留。':'两项分项发布成功，实际使用仍需单独记录。');
}
function applySuccess(results,basis=state.publication?.basis||{source:state.candidateSourceVersion}) { for(const result of results){if(result.status!=='succeeded')continue;if(result.key==='metric'){state.metricVersion='1.3.0';state.metricSourceVersion=basis.source;state.metricPublished=true;}if(result.key==='method'){state.methodVersion='3';state.methodMetricVersion='1.3.0';state.methodSourceVersion=basis.source;state.methodPublished=true;}} }
function startBuild() {
  const goal=overlay.querySelector('#build-goal')?.value.trim();
  if(!goal){notify('请先描述建设目标。');overlay.querySelector('#build-goal')?.focus();return;}
  const materials=[]; const references=[];
  if(state.sourceEnabled&&overlay.querySelector('#material-source')?.checked)materials.push('会员运营制度修订 '+state.sourceVersion);
  if(overlay.querySelector('#material-binding')?.checked)materials.push('已有门店、交易与退款资产');
  if(overlay.querySelector('#reference-industry')?.checked)references.push('运动鞋服行业');
  if(overlay.querySelector('#reference-domain')?.checked)references.push('会员运营领域');
  if(overlay.querySelector('#reference-benchmark')?.checked)references.push('标杆公开实践（候选）');
  state.foundationWorks[state.company]={title:goal,materials,references,company:state.company,task:'T-B02',draft:''};state.view='evolution';state.events.push('foundation-work-created');
  dialogState.dirty=false;closeDialog();render();openDialog('foundation-work');
}
document.addEventListener('click', event => {
  const control=event.target.closest('[data-act]');if(!control||control.disabled)return;
  const act=control.dataset.act;
  if(act==='close')return closeDialog();
  if(act==='keep-editing')return restoreEdit();
  if(act==='discard-changes'){const target=suspendedEdit?.target;suspendedEdit=null;if(dialogState)dialogState.dirty=false;if(target?.kind==='close')closeDialog(true);else if(target)openDialog(target.kind,target.data);return;}
  if(act==='theme'){document.body.classList.toggle('dark');return;}
  if(act==='view'){if(overlay.open)closeDialog();state.view=control.dataset.view;render();return;}
  if(act==='home'){if(overlay.open)closeDialog();state.view='foundation';render();return;}
  if(act==='category'){state.category=control.dataset.category;render();return;}
  if(act==='clear-search'){state.category='all';state.search='';render();document.getElementById('asset-search')?.focus();return;}
  if(act==='reset'){const review=state.showReview;state=seed(state.scenario);state.showReview=review;render();notify('已重置此合成场景。');return;}
  if(act==='asset')return openDialog('asset',{id:control.dataset.id});
  if(act==='asset-source')return openDialog('asset',{id:'source'});
  if(act==='asset-tab'){dialogState.tab=control.dataset.tab;renderDialog();overlay.querySelector(`[data-tab="${dialogState.tab}"]`)?.focus();return;}
  if(act==='create')return openDialog('create');
  if(act==='start-build')return startBuild();
  if(act==='foundation-work')return openDialog('foundation-work');
  if(act==='save-build-draft'){workForCompany().draft=overlay.querySelector('#build-followup')?.value||'';dialogState.dirty=false;closeDialog();notify('补充已保留在建设任务草稿中，未发送模型。');return;}
  if(act==='open-task')return openDialog('task');
  if(act==='save-empty-draft'){state.emptyTaskDrafts[state.company]=overlay.querySelector('#empty-question')?.value||'';state.events.push('empty-task-draft-saved');dialogState.dirty=false;closeDialog();notify('普通分析草稿已保留在本次演示内存。');return;}
  if(act==='candidate')return openDialog('candidate');
  if(act==='save-local'){if(state.originArchived&&!state.maintenanceCreated){notify('原任务已归档，先由新获准任务接续。');return;}state.candidateScope='case';state.events.push('case-only-saved');closeDialog();render();notify('已保留为本案约定，未进入企业基础库。');return;}
  if(act==='prepare-preview'){if(canPublish())openDialog('preview',{basis:{company:state.company,base:state.candidateBase,source:state.candidateSourceVersion,current:state.metricVersion,sourceCurrent:state.sourceVersion}});return;}
  if(act==='confirm-publish')return performPublication();
  if(act==='publication-view'){closeDialog();state.view='publication';render();return;}
  if(act==='query-receipt'){
    const p=state.publication;if(!p?.unknown)return;
    p.results=p.results.map(r=>({...r,status:'succeeded'}));p.unknown=false;p.attempts.push({label:'查回原请求 PUB-01：结果已确认',results:structuredClone(p.results)});applySuccess(p.results);state.events.push('receipt-queried');render();notify('原请求回执已确认；仅现在纳入成功版本，原 UNKNOWN 保留。');return;
  }
  if(act==='retry-failed'){
    const p=state.publication;if(!p||p.unknown||!canRetryFailed())return;
    const failed=p.results.filter(r=>r.status==='failed').map(r=>({...r,status:'succeeded'}));
    if(!failed.length)return;p.results=p.results.map(r=>r.status==='failed'?({...r,status:'succeeded'}):r);p.attempts.push({label:'新请求 PUB-02：仅重试已确认失败项',results:structuredClone(failed)});applySuccess(failed,{source:state.candidateSourceVersion});render();notify('仅方法失败项重试成功；原失败回执保留，指标没有重复发布。');return;
  }
  if(act==='rebase'){if(!canEditCandidate())return;state.oldCandidate=state.candidateBase;state.candidateBase=state.metricVersion;state.events.push('candidate-rebased');render();openDialog('candidate');notify('已演示核对差异并形成基于现版的新候选，旧候选保留。');return;}
  if(act==='recheck-source'){if(!canEditCandidate()||!state.sourceEnabled)return;state.candidateHistory.push({base:state.candidateBase,source:state.candidateSourceVersion,reason:'source-revision-changed'});state.candidateSourceVersion=state.sourceVersion;state.events.push('candidate-source-rechecked');render();renderDialog();notify('已模拟 Agent 回源核对并准备新候选；原候选及来源仍保留。');return;}
  if(act==='new-maintenance'){state.maintenanceCreated=true;state.events.push('maintenance-task-created');render();openDialog('candidate');notify('新任务 T-M02 接续同一企业资产，原归档项目保持只读。');return;}
  if(act==='report')return openDialog('report');
  if(act==='running')return openDialog('running');
  if(act==='create-next-task'){state.nextTask={company:state.company,version:qualifiedMetric(),sourceVersion:state.metricSourceVersion,used:false};render();openDialog('new-task');return;}
  if(act==='new-task')return openDialog('new-task');
  if(act==='read-new-task'){if(!canReadNewTask()){if(state.nextTask)state.nextTask.error='当前来源或企业资格已变化，未读取。';renderDialog();notify('来源或企业资格已变化，保留任务版本并停止本次读取。');return;}if(state.nextTask.used)return;state.nextTask.used=true;state.events.push('new-task-read');render();renderDialog();notify('已模拟读取准确版本；未执行真实分析。');return;}
  if(act==='edit-source')return openDialog('source-edit');
  if(act==='source-revision')return openDialog('source-revision',{version:control.dataset.version});
  if(act==='save-source'){
    const body=overlay.querySelector('#source-body')?.value.trim();if(!body){notify('资料正文不能为空。');return;}
    state.sourceDraft={version:String(Number(state.sourceVersion)+1),body};dialogState.dirty=false;openDialog('asset',{id:'source'});render();notify('新工作稿已保存，尚未启用。');return;
  }
  if(act==='toggle-source'){state.sourceEnabled=!state.sourceEnabled;render();renderDialog();notify(state.sourceEnabled?'原准确修订已重新启用。':'资料已停用；历史依据保留，受影响用途暂停当前供给。');return;}
  if(act==='enable-source-draft'){
    if(!state.sourceDraft)return;state.sourceHistory.push({...state.sourceDraft,enabled:true});state.sourceVersion=state.sourceDraft.version;state.sourceDraft=null;state.sourceEnabled=true;render();renderDialog();notify('新修订已启用；旧修订和报告引用保持。');return;
  }
  if(act==='unassigned')return openDialog('unassigned');
  if(act==='publication-detail')return openDialog('publication-detail');
  if(act==='tools')return openDialog('tools');
});
document.addEventListener('input',event=>{
  if(dialogState&&['source-body','build-goal','build-followup','empty-question'].includes(event.target.id))dialogState.dirty=true;
  if(event.target.id==='asset-search'){
    const position=event.target.selectionStart;state.search=event.target.value;render();const input=document.getElementById('asset-search');input?.focus();if(input?.type!=='search')input?.setSelectionRange(position,position);
  }
});
document.addEventListener('change',event=>{
  if(event.target.id==='company-select'){if(overlay.open)closeDialog();state.company=event.target.value;state.category='all';state.search='';render();return;}
  if(event.target.id==='scenario-select'){if(overlay.open)closeDialog();state=seed(event.target.value);state.showReview=true;render();notify('已切换至合成场景：'+scenarioNames[state.scenario]);return;}
  if(event.target.name==='candidate-scope'){if(!canEditCandidate())return;state.candidateScope=event.target.value;render();renderDialog();return;}
});
document.addEventListener('toggle',event=>{if(event.target.id==='review-tools')state.showReview=event.target.open;},true);
render();
