'use strict';
// Standalone design prototype. All agents, sources and writes are simulated in memory.
const scopeNames = { stores: '华东零售事业部', ecommerce: '华东电商业务' };
const gateNames = ['因果检验 · TOC/TP', '逻辑检验 · 战略假设'];
const tabs = ['create', 'check', 'release', 'history'];
const reports = [
  ['诊断摘要', '华东门店客流已企稳，增长缺口集中在新客首购后二次到店。先用已有门店和会员触点验证增长，再决定是否扩大投入。'],
  ['核心战略命题', '01　复购提升能否驱动存量门店增长？\n02　导购触达能否用可控工时实现规模化？\n03　会员投入与门店效率投入如何分配？'],
  ['依据与待核项', '上期经营复盘显示首购会员 90 天二购率约 9%。行业资料提示分层触达机会。需补证门店工时、自然复购和触达授权。']
];
const samplePlans = {
  '会员复购优先': ['深耕现有门店，以首购后分层回访带动二次到店。先验证成熟店，再推广到相似门店。', '2027 三店试点。2028 按门店类型推广。2029 将新客 90 天二购率从 9% 提至 12%。', '试点优先配置会员运营和导购工时，暂缓大规模开店与普发券。', '90 天二购率达到 12%', '试点门店触达率达到 80%'],
  '门店效率优先': ['深耕现有门店，先改善陈列、排班和转化，再把有效做法推广到同类门店。', '2027 核对三店效率基线。2028 推广高转化门店做法。2029 提升同店转化率。', '试点优先配置一线培训及陈列优化，暂停全域改造和新增重资产门店。', '试点门店转化率提升 2 个百分点', '同店人效提升 8%']
};
const baseFiles = {
  '010_draw': [['上期经营复盘.pdf', '原件 · PDF', '合成经营复盘显示首购会员 90 天二购率约 9%，成熟门店间差异明显。'], ['行业与竞对资料.pdf', '原件 · PDF', '合成公开资料摘要，覆盖到店触点、会员运营与行业趋势。']],
  '020_clean': [['行业研究摘要.md', '深度研究 · Markdown', '演示研究摘要。比较了行业增长、主要竞对及会员运营方式，列出来源和待核项。'], ['门店与会员口径.csv', '分析材料 · CSV', '门店类型、首购时间、二次交易窗口和触达授权定义。']],
  '060_reports': []
};
const work = document.querySelector('#work-panel');
const filePanel = document.querySelector('#files');
const dialog = document.querySelector('#dialog');
const scopeSelect = document.querySelector('#scope-select');
const toastNode = document.querySelector('#toast');
let state;
let submitDialog;
let dialogTrigger;
let toastTimer;

function initialState() {
  return {
    tab: 'create', phase: 'kickoff', scope: 'stores', reportNo: 1, anchors: {},
    get anchor() { return this.anchors[this.scope] ?? null; },
    set anchor(value) { this.anchors[this.scope] = value; },
    reportVersions: [{ no: 1, blocks: structuredClone(reports), locked: false }],
    candidates: [], selected: {}, events: [], imported: [], files: structuredClone(baseFiles), addedFiles: { stores: [], ecommerce: [] },
    messages: [
      { role: '顾问', text: '门店客流回来了，但增长还是慢。我们该先提复购，还是先提高门店效率？' },
      { role: 'OptraCall', text: '我把问题收敛为三项核心命题，并把经营复盘、行业研究和待补证事项放进开题报告。建议先确认试点边界。' }
    ], messagesByScope: { stores: [], ecommerce: [] }, drafts: {}, perspective: '树形地图', next: 0
  };
}

const safe = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
const attr = (name, value) => ` data-${name}="${safe(value)}"`;
const button = (label, action, style = '', attributes = '') => `<button type="button" class="button ${style}" data-action="${action}"${attributes}>${safe(label)}</button>`;
const badge = (label, style = 'neutral') => `<span class="badge ${style}">${safe(label)}</span>`;
const notice = (text, tone = '') => `<p class="notice ${tone}">${safe(text)}</p>`;
const report = () => state.reportVersions.find(item => item.no === state.reportNo);
const inScope = () => state.candidates.filter(item => item.scope === state.scope);
const current = () => inScope().find(item => item.id === state.selected[state.scope]) || inScope().at(-1);
const active = (scope = state.scope) => state.candidates.find(item => item.scope === scope && item.publication?.status === 'active');
const version = item => `${item.title} · v${item.no}`;
const eligible = item => item?.locked && item.gates.every(result => result?.status === 'pass') && !item.publication && !item.returned;
const getCandidate = id => state.candidates.find(item => item.id === id);
const sourceLines = blocks => blocks.map(([label, text]) => `<div class="content-block"><h3>${safe(label)}</h3><p>${safe(text).replaceAll('\n', '<br>')}</p></div>`).join('');
const pending = item => item?.gates.some(result => result?.status === 'running');
const comparable = () => {
  const rows = inScope().filter(item => !item.running && item.anchor === state.anchor);
  return rows.filter(item => !rows.some(newer => newer.family === item.family && newer.no > item.no));
};

function log(title, detail, candidate = undefined, reportNo = undefined) {
  state.events.unshift({ title, detail, id: candidate?.id, scope: candidate?.scope, reportNo });
}

function toast(text) {
  toastNode.textContent = text;
  toastNode.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastNode.hidden = true; }, 3600);
}

function go(tab, {focus = false} = {}) {
  state.tab = tab;
  render();
  if (focus) document.querySelector(`#tab-${tab}`).focus();
  if (focus && window.scrollY > 110) document.querySelector('.workspace-tabs').scrollIntoView({ block: 'start' });
}

function reportStatus(item) {
  if (state.anchor === item.no) return badge('已应用为方案输入', 'positive');
  return item.locked ? badge('已锁定', 'accent') : badge('草稿', 'neutral');
}

function versionStatus(item) {
  if (item.publication?.status === 'active') return badge('当前发布', 'positive');
  if (item.publication?.status === 'replaced') return badge('已被替代', 'neutral');
  if (item.publication?.status === 'withdrawn') return badge('已撤销 · 锁定稿保留', 'warning');
  if (item.returned) return badge('检验退回', 'error');
  if (item.running) return badge('会话生成中', 'accent');
  if (eligible(item)) return badge('待发布', 'positive');
  if (item.locked) return badge(pending(item) ? '检验中' : '已锁定 · 待检验', 'accent');
  return badge('候选', 'neutral');
}

function picker() {
  const selected = current();
  const options = inScope().slice().reverse().map(item => `<option value="${item.id}" ${selected?.id === item.id ? 'selected' : ''}>${safe(version(item))}</option>`).join('');
  return options ? `<label class="form-field inline-picker">所见版本<select aria-label="所见版本" data-select="candidate">${options}</select></label>` : '';
}

function render() {
  scopeSelect.value = state.scope;
  for (const tab of document.querySelectorAll('[data-tab]')) {
    tab.setAttribute('aria-selected', String(tab.dataset.tab === state.tab));
    tab.tabIndex = tab.dataset.tab === state.tab ? 0 : -1;
  }
  work.setAttribute('aria-labelledby', `tab-${state.tab}`);
  work.innerHTML = { create: renderCreate, check: renderCheck, release: renderRelease, history: renderHistory }[state.tab]();
  renderFiles();
}

function renderCreate() {
  const isKickoff = state.phase === 'kickoff';
  return `<div class="section-bar"><div class="phase-tabs" aria-label="共创阶段">
    <button class="phase-btn" data-action="phase" data-phase="kickoff" aria-pressed="${isKickoff}">启动 · 开题报告</button>
    <button class="phase-btn" data-action="phase" data-phase="plans" aria-pressed="${!isKickoff}">方案成型 · 战略候选</button>
    </div></div>${isKickoff ? renderKickoff() : renderPlans()}`;
}

function renderKickoff() {
  const item = report();
  const reportPicker = state.reportVersions.length > 1 ? `<label class="form-field inline-picker">报告版本<select aria-label="报告版本" data-select="report">${state.reportVersions.slice().reverse().map(v => `<option value="${v.no}" ${v.no === item.no ? 'selected' : ''}>开题报告 v${v.no}</option>`).join('')}</select></label>` : '';
  return `<section class="panel kickoff-panel">
    <div class="panel-heading"><div><div class="eyebrow">战略启动 · 诊断锚定</div><h2 class="section-title">开题报告 <span class="version-mark">v${item.no}</span></h2></div>${reportStatus(item)}</div>
    ${reportPicker}<div class="report-body">${sourceLines(item.blocks)}</div>
    <p class="validation-line"><span aria-hidden="true">✓</span> Schema 校验通过 <span>·</span> ${item.locked ? '已完成报告审核' : '待人工审核'}</p>
    <div class="inline-actions">
      ${!item.locked ? button('核对并锁定', 'lock-report', 'primary') : ''}
      ${item.locked && state.anchor !== item.no ? button('用作方案输入', 'apply-report', 'primary') : ''}
      ${state.anchor === item.no ? button('进入方案成型', 'phase', 'primary', ' data-phase="plans"') : ''}
      ${button('限定修改', 'revise-report', 'ghost')}
    </div>
  </section>
  <section class="panel discussion-panel" aria-labelledby="kickoff-chat"><div class="panel-heading"><div><h2 class="section-title" id="kickoff-chat">访谈与研究</h2><p class="muted small">围绕战略命题继续追问，或补充依据。</p></div>${badge('主会话', 'accent')}</div>
    <div class="transcript">${[...state.messages, ...state.messagesByScope[state.scope]].map(message => `<div class="message ${message.role === '顾问' ? 'message-user' : 'message-agent'}"><div class="message-author">${safe(message.role)}</div><p>${safe(message.text)}</p></div>`).join('')}</div>
    <form id="interview-form" class="composer"><label class="sr-only" for="interview">战略讨论问题</label><textarea id="interview" rows="2" maxlength="300" placeholder="补充一个事实，或继续追问一个战略命题…">${safe(state.drafts[state.scope])}</textarea><div class="inline-actions">${button('＋ 添加资料', 'add-file', 'ghost small')}<button type="submit" class="button primary small">发送讨论</button></div></form>
  </section>`;
}

function renderPlans() {
  if (!state.anchor) return `<section class="panel empty-state"><h2>先确定开题报告</h2><p>锁定开题报告并用作方案输入，即可开始形成候选。</p>${button('回到开题报告', 'phase', 'primary', ' data-phase="kickoff"')}</section>`;
  const item = current();
  const ready = comparable();
  return `<section class="panel candidate-list-panel"><div class="panel-heading"><div><div class="eyebrow">战略规划 · 方案成型</div><h2 class="section-title">战略候选</h2><p class="muted small">方案输入 <strong>开题报告 v${state.anchor}</strong> · ${safe(scopeNames[state.scope])}</p></div>${button('＋ 新建候选', 'new-candidate', 'primary')}</div>
    ${inScope().length ? `<div class="candidate-grid">${inScope().slice().reverse().map(candidate => `<button class="candidate-card${item?.id === candidate.id ? ' is-selected' : ''}" data-action="candidate" data-id="${candidate.id}" aria-pressed="${item?.id === candidate.id}"><strong>${safe(version(candidate))}</strong><span class="muted small">候选会话 ${candidate.session} · 开题 v${candidate.anchor}</span>${versionStatus(candidate)}</button>`).join('')}</div>
      ${ready.length > 1 ? `<div class="inline-actions">${button('在主窗口比较', 'compare', 'ghost small')}</div>` : ''}` : '<div class="empty-state compact"><p>为一个备选方向创建独立会话。完成后，候选将回到这里供核对。</p></div>'}
    </section>
    ${item ? renderCandidateDetail(item) : ''}
    ${ready.length > 1 ? `<section class="panel"><div class="panel-heading"><div><h2 class="section-title">主会话</h2><p class="muted small">围绕开题报告 v${state.anchor}，比较 ${ready.length} 个候选方向。</p></div>${badge('汇总与分析', 'accent')}</div>
      ${state.comparison ? `<div class="transcript"><div class="message message-user"><div class="message-author">顾问</div><p>${safe(state.comparison.question)}</p></div><div class="message message-agent"><div class="message-author">OptraCall</div><p>${safe(state.comparison.reply)}</p></div></div>` : ''}
      <form id="compare-form" class="composer"><label class="sr-only" for="comparison">向主 Agent 提问</label><textarea id="comparison" name="question" rows="2" maxlength="220" required placeholder="例如：预算固定时，两种方案的主要取舍是什么？"></textarea><div class="inline-actions"><button class="button primary small" type="submit">询问主 Agent</button></div></form>
      </section>` : ''}`;
}

function renderCandidateDetail(item) {
  if (item.running) return `<section class="panel empty-state" aria-live="polite"><h2>${safe(version(item))}</h2><p>候选会话 ${item.session} 正在整理获准资料和方案。可继续查看其他候选。</p></section>`;
  const actions = item.publication ? button('查看发布记录', 'tab', 'ghost', ' data-target="release"') + button('从此版修订', 'revise-candidate', 'ghost', attr('id', item.id))
    : item.returned ? button('按检验意见修订', 'revise-candidate', 'primary', attr('id', item.id))
    : item.locked ? button('前往战略检验', 'tab', 'primary', ' data-target="check"') + (!pending(item) ? button('解锁修订', 'revise-candidate', 'ghost', attr('id', item.id)) : '')
    : button('审核并锁定', 'lock-candidate', 'primary', attr('id', item.id)) + button('限定修改', 'revise-candidate', 'ghost', attr('id', item.id));
  return `<section class="panel candidate-detail"><div class="panel-heading"><div><div class="eyebrow">方案正文</div><h2 class="section-title">${safe(version(item))}</h2><p class="muted small">候选会话 ${item.session} · 锚定开题报告 v${item.anchor}${item.parent ? ` · 修订自 v${getCandidate(item.parent).no}` : ''}</p></div>${versionStatus(item)}</div>
    ${item.returned ? notice('检验意见已留档。修订会生成新候选，并从因果检验重走。', 'warning') : ''}
    <div class="report-body">${sourceLines(item.blocks)}</div><div class="inline-actions">${actions}${button('查看候选会话', 'candidate-session', 'ghost', attr('id', item.id))}${button('查看候选地图', 'map-preview', 'ghost', attr('id', item.id))}</div></section>`;
}

function renderCheck() {
  const item = current();
  return `<section class="panel"><div class="panel-heading"><div><div class="eyebrow">锁定版本 · 独立检验</div><h2 class="section-title">战略检验</h2></div>${picker()}</div>
    ${!item?.locked ? `<div class="empty-state compact"><p>先在战略共创中审核并锁定候选，再启动因果检验。</p>${button('回到战略共创', 'plans', 'primary')}</div>` : `
    <div class="section-lead"><strong>${safe(version(item))}</strong>${versionStatus(item)}<span class="muted small">开题 v${item.anchor} · ${item.session}</span></div>
    <ol class="gate-list">${gateNames.map((name, turn) => renderGate(item, name, turn)).join('')}</ol>
    ${item.returned ? `<div class="inline-actions">${button('按检验意见修订', 'revise-candidate', 'primary', attr('id', item.id))}</div>` : ''}
    ${eligible(item) ? `${notice('两份结论已绑定同一锁定版。可以提交决策者审核。', 'positive')}<div class="inline-actions">${button('前往战略发布', 'tab', 'primary', ' data-target="release"')}</div>` : ''}
    `}</section>`;
}

function renderGate(item, name, turn) {
  const result = item.gates[turn];
  const canRun = !item.publication && !item.returned && (!turn || item.gates[0]?.status === 'pass') && (!result || result.status === 'unknown');
  const statuses = { running: ['检验中', 'accent'], unknown: ['结果未知', 'warning'], insufficient: ['依据不足', 'warning'], fail: ['不通过', 'error'], pass: ['通过', 'positive'] };
  const status = statuses[result?.status] || ['未开始', 'neutral'];
  return `<li class="gate-card"><span class="gate-index" aria-hidden="true">${turn + 1}</span><div class="gate-body"><div class="panel-heading"><div><h3>${safe(name)}</h3><p class="muted small">${turn ? '战略假设 Agent · 核对假设、取舍和验证方法' : '因果检验 Agent · 核对因果链、前提和反例'}</p></div>${badge(...status)}</div>
    ${result?.evidence ? `<p>${safe(result.evidence)}</p><p class="muted small">${safe(result.ref)} · 绑定 ${safe(version(item))} · 开题 v${item.anchor}</p>` : ''}
    ${turn && item.gates[0]?.status !== 'pass' ? '<p class="muted small">因果检验通过后可以开始。</p>' : ''}
    ${canRun ? `<div class="inline-actions">${button(result ? '核对或重试原检验' : `运行${turn ? '逻辑' : '因果'}检验`, 'gate', result ? 'ghost small' : 'primary small', attr('id', item.id) + attr('turn', turn))}</div>` : ''}
    </div></li>`;
}

function renderMap(item, template = state.perspective) {
  if (template === '条目表') return `<div class="release-map list-map"><div class="map-node"><span>战略选择</span><strong>${safe(item.title)}</strong></div><div class="map-node goal"><span>G1 · 核心结果</span><strong>${safe(item.goals[0])}</strong></div><div class="map-node goal"><span>G2 · 配套指标</span><strong>${safe(item.goals[1])}</strong></div></div>`;
  return `<div class="release-map"><div class="map-node"><span>战略选择</span><strong>${safe(item.title)}</strong></div><div class="map-arrow" aria-hidden="true">↓</div><div class="grid-2"><div class="map-node goal"><span>G1 · 核心结果</span><strong>${safe(item.goals[0])}</strong></div><div class="map-node goal"><span>G2 · 配套指标</span><strong>${safe(item.goals[1])}</strong></div></div></div>`;
}

function renderRelease() {
  const item = current();
  const published = active();
  const imports = item ? state.imported.filter(row => row.id === item.id) : [];
  const canPublish = eligible(item);
  return `<section class="panel"><div class="panel-heading"><div><div class="eyebrow">决策者复核</div><h2 class="section-title">战略发布</h2></div>${picker()}</div>
    <div class="section-lead"><span class="muted small">${safe(scopeNames[state.scope])} · 当前发布</span><strong>${published ? safe(version(published)) : '暂无'}</strong></div>
    ${!item?.locked ? `<div class="empty-state compact"><p>通过两道检验的锁定版将在此等待审核。</p>${button('查看战略检验', 'tab', 'primary', ' data-target="check"')}</div>` : `
    <div class="panel-heading release-heading"><div><h3>${safe(version(item))}</h3><p class="muted small">${safe(item.lockId)} · 开题 v${item.anchor}${item.publication?.template ? ' · 发布时展示 ' + safe(item.publication.template) : ''}</p></div>${versionStatus(item)}</div>
    ${(canPublish || item.publication) ? `<div class="release-template"><label class="form-field inline-picker">展示模板<select aria-label="展示模板" data-select="template"><option${state.perspective === '树形地图' ? ' selected' : ''}>树形地图</option><option${state.perspective === '条目表' ? ' selected' : ''}>条目表</option></select></label><span class="muted small">仅调整呈现，沿用同一锁定版及检验报告。</span></div>
      ${renderMap(item)}
      <details class="review-details"><summary>查看完整方案与取舍</summary>${sourceLines(item.blocks)}</details>
      <details class="review-details"><summary>查看两道检验结论</summary>${item.gates.map((result, index) => `<div class="content-block"><h3>${gateNames[index]} · 通过</h3><p>${safe(result.evidence)}</p><p class="muted small">${safe(result.ref)}</p></div>`).join('')}</details>` : notice('此版本尚未取得发布资格。请核对两道检验的结果。', 'warning')}
    ${item.publication?.status === 'withdrawn' ? notice('此版已撤销，保留原稿、检验结论和承接历史。同版不能重新发布。', 'warning') : ''}
    ${item.publication?.status === 'replaced' ? notice('此版已被同范围的新版替代，可继续查看原有回执。') : ''}
    ${imports.length ? `<p class="receipt-count">${imports.length} 批目标候选已导入 · 采用由目标管理另行确认</p>` : ''}
    <div class="inline-actions">${canPublish ? button('核对并正式发布', 'publish', 'primary', attr('id', item.id)) : ''}
      ${item.publication?.status === 'active' ? button('带入目标管理', 'import', 'primary', attr('id', item.id)) + button('撤销发布', 'withdraw', 'danger', attr('id', item.id)) : ''}
      ${!eligible(item) && !item.publication ? button('查看战略检验', 'tab', 'ghost', ' data-target="check"') : ''}</div>`}
    </section>`;
}

function renderHistory() {
  const allEvents = state.events.filter(event => !event.scope || event.scope === state.scope);
  const publications = inScope().filter(item => item.publication).reverse();
  return `<section class="panel"><div class="panel-heading"><div><div class="eyebrow">准确版本与回执</div><h2 class="section-title">版本管理</h2><p class="muted small">${safe(scopeNames[state.scope])} · 含事项共用开题报告</p></div></div>
    <div class="ledger"><h3>开题报告</h3>${state.reportVersions.slice().reverse().map(item => `<div class="ledger-row"><button class="text-action" data-action="history-report" data-no="${item.no}">开题报告 · v${item.no}</button>${reportStatus(item)}</div>`).join('')}
    <h3>战略候选与发布</h3>${inScope().length ? inScope().slice().reverse().map(item => `<div class="ledger-row"><button class="text-action" data-action="history-candidate" data-id="${item.id}">${safe(version(item))}</button><div class="inline-actions">${versionStatus(item)}${state.imported.some(row => row.id === item.id) ? badge(`${state.imported.filter(row => row.id === item.id).length} 批已导入`) : ''}</div></div>`).join('') : '<p class="muted small">此范围尚无候选。</p>'}
    ${publications.length ? `<p class="muted small">${publications.length} 份发布记录 · ${active() ? '当前有效 1 份' : '当前无有效版'}</p>` : ''}</div>
    <div class="timeline"><h3>操作记录</h3>${allEvents.length ? allEvents.map(event => `<div class="event"><span class="event-dot" aria-hidden="true"></span><div class="event-detail"><strong>${safe(event.title)}</strong><p>${safe(event.detail)}</p>${event.id ? `<button class="text-action small" data-action="history-candidate" data-id="${event.id}">查看此版</button>` : event.reportNo ? `<button class="text-action small" data-action="history-report" data-no="${event.reportNo}">查看开题版本</button>` : ''}</div></div>`).join('') : '<p class="muted small">锁定、检验和发布后可在此查看操作回执。</p>'}</div></section>`;
}

function renderFiles() {
  const items = structuredClone(state.files);
  items['010_draw'].push(...state.addedFiles[state.scope]);
  items['060_reports'] = state.reportVersions.filter(item => item.locked).map(item => [`开题报告 · v${item.no}.md`, '锁定报告', item.blocks.map(([label, text]) => `${label}\n${text}`).join('\n\n')]);
  for (const item of inScope().filter(candidate => !candidate.running)) {
    items['060_reports'].push([`${version(item)}.md`, '战略候选', item.blocks.map(([label, text]) => `${label}\n${text}`).join('\n\n')]);
    for (const [turn, result] of item.gates.entries()) {
      if (result?.status === 'pass' || result?.status === 'fail') items['060_reports'].push([`${result.ref} · ${turn ? '逻辑' : '因果'}检验.md`, version(item), result.evidence]);
    }
  }
  filePanel.innerHTML = `<div class="file-head"><div><h2 id="file-heading">事项文件</h2><p class="muted small">共用资料及当前范围</p></div>${button('＋', 'add-file', 'ghost small file-add', ' aria-label="添加资料"')}</div>
    ${Object.entries(items).map(([directory, files]) => `<details class="folder" ${directory !== '020_clean' || state.phase === 'kickoff' ? 'open' : ''}><summary><span class="folder-icon" aria-hidden="true">▱</span><strong>${directory}</strong><span class="file-count">${files.length}</span></summary><div class="folder-entries">${files.length ? files.map(([name, kind, content]) => `<button class="file-entry" data-action="file"${attr('title', name)}${attr('content', content)}><span class="file-icon" aria-hidden="true">▤</span><span><strong>${safe(name)}</strong><small>${safe(kind)}</small></span></button>`).join('') : '<p class="muted small">暂无成果</p>'}</div></details>`).join('')}`;
}

function showDialog(title, body, primaryLabel, callback, options = {}) {
  dialogTrigger = document.activeElement;
  submitDialog = callback;
  dialog.innerHTML = `<form id="dialog-form"><div class="dialog-head"><h2 id="dialog-title">${safe(title)}</h2>${button('×', 'close', 'ghost small close-button', ' aria-label="关闭"')}</div>
    <div class="dialog-body">${body}</div><div class="dialog-actions">${button(primaryLabel ? '取消' : '关闭', 'close', 'ghost')}${primaryLabel ? `<button type="submit" class="button ${options.danger ? 'danger' : 'primary'}">${safe(primaryLabel)}</button>` : ''}</div></form>`;
  if (!dialog.open) dialog.showModal();
  (dialog.querySelector('[data-autofocus]') || dialog.querySelector('[data-action="close"]')).focus();
}

function createCandidate(title, parent = undefined, replacement = undefined) {
  const sourcePlan = samplePlans[title] || samplePlans['会员复购优先'];
  const no = parent ? 1 + Math.max(...state.candidates.filter(item => item.family === parent.family).map(item => item.no)) : 1;
  const sequence = ++state.next;
  const id = `C${String(sequence).padStart(2, '0')}`;
  const blocks = parent ? structuredClone(parent.blocks) : [['战略定位与增长路径', sourcePlan[0]], ['三年目标与里程碑', sourcePlan[1]], ['资源分配与明确不做', sourcePlan[2]]];
  if (replacement) blocks[replacement.index][1] = replacement.text;
  const item = {
    id, family: parent?.family || id, title, no, session: id, parent: parent?.id,
    anchor: parent?.anchor || state.anchor, scope: parent?.scope || state.scope,
    blocks, goals: parent ? structuredClone(parent.goals) : sourcePlan.slice(3),
    gates: [null, null], locked: false, running: true, returned: false, patch: replacement
  };
  state.candidates.push(item);
  state.selected[item.scope] = item.id;
  state.phase = 'plans';
  state.tab = 'create';
  log('候选会话已启动', `${version(item)} · 独立会话 ${id} · 开题报告 v${item.anchor}`, item);
  render();
  const before = state;
  setTimeout(() => {
    if (state !== before) return;
    item.running = false;
    log(replacement ? '限定修订已回传' : '候选已回传主窗口', `${version(item)} · ${replacement ? `仅更新「${blocks[replacement.index][0]}」` : `独立会话 ${id}`}`, item);
    render();
    if (state.scope === item.scope) toast(`${version(item)} 已回到主窗口`);
  }, 650);
}

function revise(isReport, item) {
  const blocks = item.blocks;
  const old = isReport ? `开题报告 · v${item.no}` : version(item);
  showDialog('与 Agent 限定修改', `<p>基于 <strong>${safe(old)}</strong>。选定一处，描述希望怎样修改。</p>
    <label class="form-field">修改位置<select name="block" data-autofocus>${blocks.map(([label], index) => `<option value="${index}">${safe(label)}</option>`).join('')}</select></label>
    <label class="form-field">修改要求<textarea name="instruction" maxlength="220" rows="3" required placeholder="例如：将三店试点调整为两店，先核对导购工时。"></textarea></label>`, '查看修改差异', data => {
    const index = Number(data.get('block'));
    const instruction = String(data.get('instruction')).trim();
    if (!instruction) { toast('请输入修改要求。'); return; }
    const text = instruction;
    const patch = { index, instruction, text, original: blocks[index][1] };
    const sideEffect = !isReport && index === 1 ? notice('若此修改涉及正式目标值，请另行核对地图目标和衡量口径。此次保留原地图目标。', 'warning') : '';
    showDialog('核对本次差异', `<p>${safe(old)} · 仅修改「${safe(blocks[index][0])}」。其他章节保留原文。</p>${sideEffect}<div class="diff"><div class="before"><strong>原文</strong><p>${safe(patch.original)}</p></div><div class="after"><strong>原型模拟替换</strong><p>${safe(patch.text)}</p></div></div>`, isReport ? '另存开题草稿' : '另存新候选', () => {
      if (isReport) {
        const no = state.reportVersions.at(-1).no + 1;
        const newBlocks = structuredClone(blocks);
        newBlocks[index][1] = text;
        state.reportVersions.push({ no, blocks: newBlocks, locked: false });
        state.reportNo = no;
        state.phase = 'kickoff';
        state.tab = 'create';
        log('开题报告限定修订', `v${item.no} → v${no} · 仅更新「${blocks[index][0]}」`, undefined, no);
        render();
      } else createCandidate(item.title, item, patch);
    });
  });
}

function runGate(item, turn, outcome, continuation = undefined) {
  const previous = item.gates[turn];
  const ref = previous?.ref || `检验 ${item.id}-${turn + 1}`;
  item.gates[turn] = { ref, status: 'running' };
  log(previous ? '检验已重试' : '检验已发起', `${ref} · ${version(item)} · ${gateNames[turn]}`, item);
  render();
  const before = state;
  setTimeout(() => {
    if (state !== before) return;
    const evidence = outcome === 'unknown' ? '原检验尚无可核对的回执。锁定保留，可用原检验编号重试。'
      : outcome === 'insufficient' ? '当前固定资料缺少同类门店的自然复购对照，须补证形成新候选后复验。'
      : outcome === 'fail' ? (turn ? '现有口径显示试点投入超过明确的上限，方案仍以原预算推算三年目标。' : '试点材料中的对照门店出现同等增长，现有证据反驳「回访是增长的主要原因」这一主张。')
      : (turn ? '关键假设可用同店同期对照检验。方案写明了扩大投入与停止试点的条件。证据见准确候选的资源条款及《门店与会员口径.csv》。' : item.title === '门店效率优先' ? '「排班与陈列→有效接待→同店转化」的关键前提和反例已记录。依据为《上期经营复盘.pdf》第 3 页和开题报告诊断摘要。' : '「触达→再到店→二购」的关键前提和反例已记录。依据为《上期经营复盘.pdf》第 3 页及《门店与会员口径.csv》，工时、授权和自然复购纳入对照。');
    item.gates[turn] = { ref, status: outcome, evidence };
    if (outcome === 'fail' || outcome === 'insufficient') item.returned = true;
    const resultLabel = { pass: '通过', fail: '不通过', insufficient: '依据不足', unknown: '结果未知' }[outcome];
    log(`${gateNames[turn]} ${resultLabel}`, `${ref} · ${evidence}`, item);
    if (!turn && outcome === 'pass' && continuation) runGate(item, 1, continuation);
    else render();
  }, 480);
}

function pickGate(item, turn) {
  if (!item.locked || item.returned || item.publication || pending(item) || (turn && item.gates[0]?.status !== 'pass')) return;
  const choices = '<option value="pass">通过</option><option value="fail">不通过</option><option value="insufficient">依据不足</option><option value="unknown">结果未知</option>';
  const next = turn ? '' : `<label class="form-field">逻辑检验模拟结果<select name="next">${choices}</select></label><p class="muted small">因果通过后自动发起逻辑检验。</p>`;
  showDialog(item.gates[turn] ? '核对或重试原检验' : '预设原型的检验结果', `<p>${safe(version(item))} · ${safe(item.lockId)}。此处选择仅用于演示分支。</p><label class="form-field">${turn ? '逻辑' : '因果'}检验模拟结果<select name="outcome" data-autofocus>${choices}</select></label>${next}`, item.gates[turn] ? '重试原检验' : '启动检验', data => runGate(item, turn, String(data.get('outcome')), turn ? undefined : String(data.get('next'))));
}

function seedSample() {
  const prior = state.scope;
  const source = state.reportVersions[0];
  source.locked = true;
  state.reportNo = source.no;
  state.anchors = { stores: source.no, ecommerce: source.no };
  log('应用开题报告', `开题报告 v${source.no} 已作为方案输入`, undefined, source.no);
  for (const [scope, title] of [['stores', '会员复购优先'], ['ecommerce', '门店效率优先']]) {
    const row = samplePlans[title];
    const id = `C${String(++state.next).padStart(2, '0')}`;
    const item = {
      id, family: id, title, no: 1, session: id, anchor: source.no, scope,
      blocks: [['战略定位与增长路径', row[0]], ['三年目标与里程碑', row[1]], ['资源分配与明确不做', row[2]]], goals: row.slice(3), locked: true, lockId: `锁定稿 ${id}`,
      gates: [0, 1].map(index => ({ status: 'pass', ref: `检验 ${id}-${index + 1}`, evidence: index ? '已核对方案的资源约束、关键假设与对照标准。' : '已对照开题材料，记录关键前提、反例和试点观测办法。' })),
      publication: { id: `发布 ${id}`, status: 'active', template: '树形地图' }
    };
    state.candidates.push(item);
    state.selected[scope] = id;
    log('演示样例已发布', `${version(item)} · ${scopeNames[scope]} · ${item.publication.id}`, item);
  }
  state.scope = prior;
  state.phase = 'plans';
  go('release', { focus: true });
  toast('已载入两个范围的当前发布样例');
}

const actions = {
  close: () => dialog.close(),
  guide: () => showDialog('演示路径', `<ol class="guide-list"><li>在战略共创核对并锁定开题报告，选择「用作方案输入」。</li><li>新建两个候选，查看不同会话及主窗口比较。选择一个候选，尝试限定修改后锁定。</li><li>在战略检验启动因果检验，模拟通过、不通过或结果未知。因果通过后，逻辑检验自动开始。</li><li>在战略发布核对地图和两份检验结论，确认发布。选择目标带入目标管理，再撤销并到版本管理回看。</li></ol><p class="muted small">资料、会话、结论均为虚构示意。刷新会重置进度。</p><div class="inline-actions">${button('载入双范围发布样例','seed','ghost')}${button('重置演示','reset','ghost')}</div>`),
  reset: () => { state = initialState(); dialog.close(); go('create', { focus: true }); toast('已重置演示'); },
  seed: () => { state = initialState(); dialog.close(); seedSample(); },
  tab: node => go(node.dataset.target, { focus: true }),
  plans: () => { state.phase = 'plans'; go('create', { focus: true }); },
  phase: node => { state.phase = node.dataset.phase; render(); work.querySelector(`[data-phase="${state.phase}"]`)?.focus(); },
  placeholder: node => showDialog(node.dataset.module, '<p>此入口保留在战略生命周期中。本次原型覆盖启动和规划。</p>'),
  candidate: node => { state.selected[state.scope] = node.dataset.id; render(); work.querySelector(`[data-action="candidate"][data-id="${node.dataset.id}"]`)?.focus(); },
  'lock-report': () => {
    const item = report();
    showDialog('锁定开题报告', `<p>确认开题报告 v${item.no} 的战略命题、资料依据和待核项。锁定后可将此准确版本用作方案输入。</p>${sourceLines(item.blocks)}`, '确认锁定', () => {
      item.locked = true;
      log('锁定开题报告', `开题报告 v${item.no} · 人工审核完成`, undefined, item.no);
      render();
      toast(`已锁定开题报告 v${item.no}`);
    });
  },
  'apply-report': () => {
    const item = report();
    if (!item.locked) return;
    state.anchor = item.no;
    state.comparison = null;
    log('应用开题报告', `开题报告 v${item.no} 已作为新战略候选的资料输入`, undefined, item.no);
    state.phase = 'plans';
    render();
    toast(`已应用开题报告 v${item.no}`);
  },
  'revise-report': () => revise(true, report()),
  'new-candidate': () => {
    showDialog('新建候选会话', `<p>沿用 <strong>开题报告 v${state.anchor}</strong> 和当前范围的获准资料。</p><label class="form-field">候选方向<select name="direction" data-autofocus>${Object.keys(samplePlans).map(title => `<option>${safe(title)}</option>`).join('')}</select></label>`, '启动独立会话', data => createCandidate(String(data.get('direction'))));
  },
  'revise-candidate': node => {
    const item = getCandidate(node.dataset.id);
    if (item && !item.running && !pending(item)) revise(false, item);
  },
  'lock-candidate': node => {
    const item = getCandidate(node.dataset.id);
    if (item.locked || item.running) return;
    showDialog('锁定战略候选', `<p>确认 <strong>${safe(version(item))}</strong> 的完整方案及开题报告 v${item.anchor}。锁定后可以开始战略检验。</p>${sourceLines(item.blocks)}`, '确认锁定', () => {
      item.locked = true;
      item.lockId = `锁定稿 ${item.id}`;
      log('锁定战略候选', `${item.lockId} · ${version(item)} · 开题报告 v${item.anchor}`, item);
      go('check', { focus: true });
      toast('已锁定，可以开始因果检验');
    });
  },
  'candidate-session': node => {
    const item = getCandidate(node.dataset.id);
    showDialog(`候选会话 ${item.session}`, `<p>${safe(version(item))} · 开题报告 v${item.anchor}</p><div class="transcript"><div class="message message-user"><div class="message-author">顾问</div><p>${safe(item.patch?.instruction || `基于已锁定的开题报告，形成「${item.title}」的完整备选方案。`)}</p></div><div class="message message-agent"><div class="message-author">OptraCall</div><p>${safe(item.patch ? `仅修改「${item.blocks[item.patch.index][0]}」，其余章节沿用原稿。` : item.blocks[0][1])}</p></div></div><p class="muted small">候选及其依据已回传主窗口。</p>`);
  },
  'map-preview': node => {
    const item = getCandidate(node.dataset.id);
    showDialog(`${version(item)} · 候选地图`, renderMap(item, '树形地图'));
  },
  compare: () => {
    const rows = comparable().reverse();
    showDialog('主窗口比较候选', `<p>同一开题报告 v${state.anchor} · 各方向最新候选。</p>${rows.map(item => `<div class="compare-row"><h3>${safe(version(item))}</h3>${versionStatus(item)}<p>${safe(item.blocks[0][1])}</p><p class="muted small">会话 ${item.session} · 开题 v${item.anchor}</p></div>`).join('')}`);
  },
  gate: node => pickGate(getCandidate(node.dataset.id), Number(node.dataset.turn)),
  publish: node => {
    const item = getCandidate(node.dataset.id);
    if (!eligible(item)) return;
    const prior = active(item.scope);
    showDialog('确认正式发布', `<p><strong>${safe(version(item))}</strong> · ${safe(scopeNames[item.scope])} · ${safe(item.lockId)}</p>
    ${prior ? notice(`确认后将替代当前发布「${version(prior)}」。已有目标与回执保留。`, 'warning') : ''}
    ${renderMap(item)}<div class="review-lines">${item.gates.map((result, turn) => `<p><strong>${safe(gateNames[turn])} · 通过</strong><br>${safe(result.evidence)}</p>`).join('')}</div>
    <label class="check-row"><input type="checkbox" required>我已核对准确版地图及两份带依据的检验结论。</label>`, '确认发布', () => {
      if (!eligible(item)) return;
      const original = active(item.scope);
      if (original) {
        original.publication.status = 'replaced';
        log('原发布已被替代', `${version(original)} → ${version(item)} · 同一事项及范围`, original);
      }
      item.publication = { id: `发布 ${item.id}`, status: 'active', template: state.perspective };
      log('决策者确认正式发布', `${item.publication.id} · ${version(item)} · ${scopeNames[item.scope]} · ${state.perspective}`, item);
      render();
      toast(`已正式发布 ${version(item)}`);
    });
  },
  withdraw: node => {
    const item = getCandidate(node.dataset.id);
    showDialog('撤销当前发布', `<p><strong>${safe(version(item))}</strong> · ${safe(item.publication.id)}</p><p>撤销后停止新导入。原锁定稿、检验结论、已导入目标和下游引用均保留。同版不能重新发布。</p>`, '确认撤销发布', () => {
      if (item.publication.status !== 'active') return;
      item.publication.status = 'withdrawn';
      log('发布已撤销', `${item.publication.id} · ${version(item)} · 同版不能重发`, item);
      render();
      toast('已撤销发布');
    }, { danger: true });
  },
  import: node => {
    const item = getCandidate(node.dataset.id);
    const publication = item.publication;
    showDialog('核对承接的目标与策略', `<p>${safe(version(item))} · ${safe(publication.id)}</p><label class="form-field">目标归属<select name="owner" data-autofocus><option>${safe(scopeNames[item.scope])}</option><option>${safe(scopeNames[item.scope])} · 项目团队</option></select></label>
    ${item.goals.map((goal, index) => `<label class="check-row"><input type="checkbox" name="goal" value="${index}" checked><span><strong>G${index + 1} · ${safe(goal)}</strong><br><span class="muted small">关联策略 · ${safe(item.title)}</span></span></label>`).join('')}<p class="muted small">保存后进入目标管理，等待单独采用。</p>`, '保存目标候选', data => {
      if (item.publication?.id !== publication.id || publication.status !== 'active') return;
      const goals = data.getAll('goal').map(index => item.goals[Number(index)]);
      if (!goals.length) { toast('请至少选择一个目标。'); return false; }
      const receipt = `承接 ${String(state.imported.length + 1).padStart(2, '0')}`;
      const owner = String(data.get('owner'));
      state.imported.push({ id: item.id, publication: publication.id, scope: item.scope, owner, goals, receipt });
      log('已保存目标候选', `${receipt} · ${publication.id} · ${goals.length} 个目标 · ${owner}`, item);
      render();
      toast('目标候选已保存，等待在目标管理采用');
    });
  },
  destination: () => showDialog('目标管理 · 承接预览', state.imported.length ? state.imported.map(row => `<div class="compare-row"><h3>${safe(row.receipt)} · ${safe(row.owner)}</h3>${badge('待采用', 'accent')}<p class="muted small">${safe(row.publication)} · ${safe(version(getCandidate(row.id)))}</p><ul>${row.goals.map(goal => `<li>${safe(goal)}</li>`).join('')}</ul></div>`).join('') : '<p>暂无承接候选。从战略发布选中当前有效版后，可将目标带入这里。</p>'),
  'history-candidate': node => {
    const item = getCandidate(node.dataset.id);
    if (!item) return;
    const rows = state.imported.filter(row => row.id === item.id);
    showDialog(`查看准确版本 · ${version(item)}`, `<p>候选会话 ${item.session} · 开题报告 v${item.anchor}</p>${versionStatus(item)}${sourceLines(item.blocks)}<div class="key-values"><span>${safe(item.lockId || '尚未锁定')}</span>${item.gates.filter(Boolean).map(result => `<span>${safe(result.ref)} · ${safe(result.evidence || '')}</span>`).join('')}${rows.map(row => `<span>${safe(row.receipt)} · ${safe(row.goals.join('、'))}</span>`).join('')}</div><div class="inline-actions">${button('查看候选会话', 'candidate-session', 'ghost small', attr('id', item.id))}${button('查看原开题报告', 'history-report', 'ghost small', attr('no', item.anchor))}</div>`);
  },
  'history-report': node => {
    const item = state.reportVersions.find(row => row.no === Number(node.dataset.no));
    showDialog(`开题报告 · v${item.no}`, `${reportStatus(item)}${sourceLines(item.blocks)}`);
  },
  'add-file': () => showDialog('添加资料', '<p>选择一份示例资料加入当前事项。</p><label class="form-field">演示材料<select name="file" data-autofocus><option>高管访谈纪要.md</option><option>试点门店补充说明.md</option></select></label>', '添加到原件', data => {
    const name = String(data.get('file'));
    if (state.addedFiles[state.scope].some(row => row[0] === name)) { toast('此资料已在当前范围。'); return; }
    state.addedFiles[state.scope].push([name, '原件 · 当前范围', '演示材料。管理层希望在两个月内完成对照试点，期间保持既定预算。']);
    state.messagesByScope[state.scope].push({ role: 'OptraCall', text: `已把「${name}」加入当前范围。可以指定要用它核对的战略命题。` });
    render();
    toast('资料已加入当前事项');
  }),
  file: node => showDialog(node.dataset.title, `<p class="file-preview">${safe(node.dataset.content).replaceAll('\n', '<br>')}</p><p class="muted small">演示文件预览</p>`)
};

document.addEventListener('click', event => {
  const node = event.target.closest('[data-action], [data-tab]');
  if (!node) return;
  if (node.dataset.tab) go(node.dataset.tab, { focus: true });
  else actions[node.dataset.action]?.(node);
});

document.addEventListener('change', event => {
  const node = event.target;
  if (node === scopeSelect) {
    state.scope = node.value;
    state.comparison = null;
    render();
  } else if (node.dataset.select === 'candidate') {
    state.selected[state.scope] = node.value;
    render();
    work.querySelector('[data-select="candidate"]')?.focus();
  } else if (node.dataset.select === 'report') {
    state.reportNo = Number(node.value);
    render();
    work.querySelector('[data-select="report"]')?.focus();
  } else if (node.dataset.select === 'template') {
    state.perspective = node.value;
    render();
    work.querySelector('[data-select="template"]')?.focus();
  }
});

document.addEventListener('input', event => {
  if (event.target.id === 'interview') state.drafts[state.scope] = event.target.value;
});

document.addEventListener('submit', event => {
  if (event.target.id === 'interview-form') {
    event.preventDefault();
    const text = (state.drafts[state.scope] || '').trim();
    if (!text) { document.querySelector('#interview').focus(); return; }
    const thread = state.messagesByScope[state.scope];
    const followups = ['这条信息会影响哪一个战略命题？哪些门店或业务应排除在诊断范围外？', '与上期的差距中，哪一项可以用现有数据核对？如果没有历史报告，谁能提供基线？', '如果试点结果和预期相反，什么信号会让你改选另一条路径？'];
    const turn = thread.filter(message => message.role === '顾问').length % followups.length;
    thread.push({ role: '顾问', text }, { role: 'OptraCall', text: followups[turn] });
    state.drafts[state.scope] = '';
    render();
    document.querySelector('#interview').focus({ preventScroll: true });
  } else if (event.target.id === 'compare-form') {
    event.preventDefault();
    const question = String(new FormData(event.target).get('question')).trim();
    if (!question) return;
    state.comparison = { question, reply: '两份方案使用同一个开题基线。复购优先把人力投向会员回访，取胜条件是稳定触达和可验证的二购提升。效率优先先改善现有门店运作，取胜条件是转化改善能够跨店复用。预算固定时，可用三店小规模对照判断哪条路径值得继续投入。' };
    render();
    work.querySelector('#comparison')?.focus({ preventScroll: true });
  } else if (event.target.id === 'dialog-form') {
    event.preventDefault();
    const previous = document.querySelector('#dialog-form');
    const result = submitDialog?.(new FormData(event.target));
    if (result !== false && previous === document.querySelector('#dialog-form') && dialog.open) dialog.close();
  }
});

document.querySelector('.workspace-tabs').addEventListener('keydown', event => {
  const keys = { ArrowLeft: -1, ArrowRight: 1 };
  if (event.key in keys || event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const from = event.target.closest('[data-tab]')?.dataset.tab || state.tab;
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (tabs.indexOf(from) + keys[event.key] + tabs.length) % tabs.length;
    go(tabs[index], { focus: true });
  }
});

dialog.addEventListener('close', () => {
  const target = dialogTrigger?.isConnected && !dialog.contains(dialogTrigger) ? dialogTrigger : document.querySelector(`#tab-${state.tab}`);
  target?.focus({ preventScroll: true });
});

state = initialState();
render();
