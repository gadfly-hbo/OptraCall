'use strict';
(() => {
  const F = window.FOUNDATION_DEMO;
  const CONTROLLED_BODY='仅正常状态属于本版本有效资格。引用虚构政策修订 r2；宽限状态不再计入，历史 r1 与原报告保留。';
  const CONTROLLED_SCOPE='示例企业 A · 生效日之后的新任务；历史报告按原版本';
  const app = document.querySelector('#app');
  const dialog = document.querySelector('#overlay');
  let trigger;
  let dialogState = null;
  let queuedNavigation;
  const state = {
    enterprise: 'a', view: 'foundation', sub: 'overview', scenario: 'normal', dark: false,
    candidateRevision: 2, candidateBody: CONTROLLED_BODY, candidateScope: CONTROLLED_SCOPE, candidateMetricVersion: '1.1.0', customEdited: false, candidateHistory: [], reviewed: true, preview: null, publication: null,
    taskCreated: false, taskCreatedB: false, maintenance: false, useVersion: '1.0.0', useSourceRevision: 1, taskNumber: 1,
    contribution: null, linked: false, partialComplete: false, notice: '',
  };
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  const readOnly = () => state.scenario === 'readonly' && !state.maintenance;
  const missing = () => state.scenario === 'missing';
  const conflict = () => state.scenario === 'conflict';
  const empty = () => state.enterprise === 'b' || state.scenario === 'empty';
  const partial = () => state.scenario === 'partial' && !state.partialComplete;
  const latestMetricVersion = () => state.publication && !state.publication.unknown && !state.publication.failed && !state.publication.partial ? state.publication.metricVersion : '1.0.0';
  const readFailure = () => state.scenario === 'read-fail';
  const nextMetricRef = () => `demo-member-foundation@${state.candidateMetricVersion}::active_memberships`;
  const currentRevision = asset => latestMetricVersion()!=='1.0.0' ? 'r'+state.publication.revision : asset.version;
  const label = (text, tone='') => `<span class="badge ${tone}">${esc(text)}</span>`;
  const button = (action, text, id='', kind='secondary', disabled=false) => `<button type="button" class="${kind}" data-action="${action}"${action==='nav-studio'?' aria-label="语义与分析资产"':action==='nav-task'?' aria-label="普通分析任务"':''}${kind.includes('nav-item')&&kind.includes('active')?' aria-current="page"':''}${kind.includes('filter')||kind.includes('tab ')?` aria-pressed="${kind.includes('active')}"`:''}${id ? ` data-id="${esc(id)}"` : ''}${disabled ? ' disabled' : ''}>${text}</button>`;
  const table = (headers, rows) => `<div class="table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(row=>`<tr>${row.map(cell=>`<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  const notice = (text, tone='') => `<div class="notice ${tone}">${text}</div>`;
  function announce(text) { document.querySelector('#announce').textContent = text; }
  function readiness() {
    return `<div class="readiness" aria-label="四项独立状态"><div><small>定义核定</small><strong>${!state.reviewed ? '新候选待核，旧正式保留' : conflict() ? '会员资格待核' : '本版已核定（演示）'}</strong></div><div><small>数据映射</small><strong>${missing() ? '资格截止字段缺失' : '演示样本已映射'}</strong></div><div><small>当前可计算</small><strong>${!state.reviewed || missing() || conflict() ? '受影响候选用途待核' : '仅样例条件支持'}</strong></div><div><small>实际使用验证</small><strong>未做真实模型验证</strong></div></div>`;
  }
  function shell() {
    const title = state.view === 'task' ? '普通分析任务' : state.view === 'foundation' ? '企业基础资产' : state.view === 'evolution' ? '建设与演进' : '发布与使用';
    app.innerHTML = `<div class="shell"><aside class="sidebar"><div class="brand"><span class="brand-mark">O</span><div><strong>OptraCall</strong><small>持续做出更好的决策</small></div></div><div class="nav-label">工作空间</div>${button('nav-studio', '◈ <span>语义与分析资产</span>', '', `nav-item ${state.view !== 'task' ? 'active' : ''}`)}${button('nav-task', '▤ <span>普通分析任务</span>', '', `nav-item ${state.view === 'task' ? 'active' : ''}`)}<div class="sidebar-foot"><strong>企业基础层 v0.2</strong>审核原型 · 暂不开发</div></aside><div class="main"><header class="topbar"><div class="breadcrumb">工作空间 / <b>${title}</b></div><div class="top-actions"><label class="enterprise-label"><span>企业</span><select aria-label="当前企业" id="enterprise-select"><option value="a" ${state.enterprise === 'a' ? 'selected' : ''}>示例企业 A（虚构）</option><option value="b" ${state.enterprise === 'b' ? 'selected' : ''}>示例企业 B（空白）</option></select></label>${button('theme', state.dark ? '浅色模式' : '深色模式', '', 'secondary')}</div></header><div class="demo-ribbon"><span><b>交互原型</b> · 虚构资料 · 仅内存 · 不调用模型、正式发布或产品 API</span><span>刷新页面恢复初始样例</span></div><main class="page" id="main-content" tabindex="-1"><div class="heading"><div><div class="eyebrow">${esc(state.enterprise === 'a' ? F.enterprise : '示例企业 B（空白）')} ${label('审核候选 v0.2')}</div><h1 tabindex="-1">${title}</h1><p>${state.view === 'task' ? '直接提出分析任务，Agent 自主发现并读取企业正式依据。此处只展示预置轨迹。' : '主数据、指标体系与本体同步建设，沿准确来源与版本连接。'}</p></div><div class="actions">${state.view === 'task' ? button('new-task', '新建独立任务（演示）', '', 'primary') : button('create', '建设基础资产', '', 'primary', readOnly())}</div></div>${state.notice ? notice(esc(state.notice)) : ''}${readOnly() ? notice('原建设项目已归档，当前任务只读。企业资产与历史保留；可在新的获准项目任务接续维护。', 'warning') : ''}${state.view !== 'task' ? `<nav class="tabs" aria-label="Studio 工作视图">${[['foundation','企业基础资产'],['evolution','建设与演进'],['publication','发布与使用']].map(([v,t])=>button('view',t,v,`tab ${state.view === v?'active':''}`)).join('')}</nav>` : ''}${state.view === 'task' ? taskView() : state.view === 'foundation' ? foundationView() : state.view === 'evolution' ? evolutionView() : publicationView()}${reviewTools()}<footer class="content-footer"><span>参考输入 → 企业内化 → 企业基础层 ⇄ 任务演进层</span><span>发布、图表示与实际使用分别记实</span></footer></main></div></div>`;
    document.body.classList.toggle('dark', state.dark);
  }
  function foundationView() {
    if (empty()) return `<div class="empty"><h2>尚未建立本企业基础资产</h2><p>参考模板可帮助起草。先表达企业建设目标与获准资料范围，由 Agent 自主整理；创建企业范围不会自动认领其他企业资料。</p>${button('create','开始基础建设（演示）','','primary',readOnly())}${button('show-reference','查看参考模板','T02','ghost')}</div>`;
    return `<nav class="subtabs" aria-label="基础资产内容">${[['overview','体系总览'],['assets','三类资产'],['reference','参考与内化'],['checks','关联核验']].map(([id,t])=>button('sub',t,id,`filter ${state.sub===id?'active':''}`)).join('')}</nav>${state.sub==='overview'?overview():state.sub==='assets'?assetsView():state.sub==='reference'?referencesView():checksView()}`;
  }
  function overview() {
    return `<div class="summary foundation-summary"><div><small>主数据模型</small><div class="value">对象与身份</div><small>主体、账号、会员关系、计划、门店及商品</small>${button('asset','查看会员关系','md.program_membership','ghost')}</div><div><small>数据分析指标体系</small><div class="value">主题与度量</div><small>规模、参与、权益、交易及服务；引用原 SAP</small>${button('asset','查看体系与准确指标','sys.membership','ghost')}</div><div><small>本体</small><div class="value">关系与规则</div><small>对象、事件、状态资格和业务时间</small>${button('asset','查看语义关系','ont.membership','ghost')}</div></div>${readiness()}<section class="panel"><div class="panel-head"><div><h2>三类资产如何连起来</h2><small>一个参考片段；共享身份，避免三套孤立定义</small></div>${button('sub','查看完整关联核验','checks','ghost')}</div><div class="panel-body"><div class="chain">${button('asset',`会员关系<br><small>md.program_membership · ${currentRevision(F.assets[0])}</small>`,'md.program_membership','chain-node')}<span aria-hidden="true">→</span>${button('sap',`有效会员关系数<br><small>原 SAP ${latestMetricVersion()}</small>`,'','chain-node')}<span aria-hidden="true">→</span>${button('asset',`资格与时间规则<br><small>ont.membership · ${currentRevision(F.assets[2])}</small>`,'ont.membership','chain-node')}<span aria-hidden="true">→</span>${button('asset',`实际数据映射<br><small>binding.crm · ${currentRevision(F.assets[3])}</small>`,'binding.crm','chain-node')}</div><p class="help">统计对象为会员关系，账号数和自然人数是不同度量。体系索引引用公式；本体关联业务规则；Binding 对照实际字段。</p></div></section><section class="section-gap"><div class="flex-between"><h2>正在演进的基础资产</h2>${button('view','进入建设与演进','evolution','ghost')}</div><div class="work-card"><div><strong>会员资格政策更新</strong> ${label(state.publication && !state.publication.unknown && state.publication.revision===state.candidateRevision ? '本轮已留演示发布结果' : '候选 r'+state.candidateRevision,'warning')}</div><p>受控虚构变化：从“正常＋宽限”调整为“仅正常”，关联指标候选 ${state.candidateMetricVersion}、资格规则及数据映射。原版和历史报告保留。</p><div class="actions">${button('candidate','查看候选与影响')}${button('history','查看原报告依据')}</div></div></section>`;
  }
  function assetsView() {
    return `<div class="toolbar"><p class="help">同一资产、原权威和准确版本。可查看源稿及逐项关联。</p>${button('sap','在原 SAP 专业区查看指标','','secondary')}</div><section class="panel">${table(['资产','类型','准确版本','当前身份','查看'], F.assets.map(a=>[ `<strong>${esc(a.title)}</strong><p>${esc(a.id)}</p>`,esc(a.kind),currentRevision(a),label('合格源组合（演示）','success'),button('asset','查看',a.id,'ghost')]))}</section><p class="bottom-note">候选 r${state.candidateRevision} 与正式源分开。若新版存在 UNKNOWN，依赖用途继续引用原合格组合；分项事实见发布记录。</p>`;
  }
  function referencesView() {
    const route = (title, ids) => `<section class="panel"><div class="panel-head"><h2>${title}</h2></div><div class="panel-body route">${ids.map((id,i)=>{const r=F.references.find(r=>r.id===id);return `${i?'<span aria-hidden="true">→</span>':''}${button('show-reference',`${r.title}<small>主数据＋指标体系＋本体</small>`,r.id,'route-step')}`;}).join('')}<span aria-hidden="true">→</span><div class="route-step target">目标企业<small>依据获准资料独立核定</small></div></div></section>`;
    return `<p class="section-intro">行业与领域提供相互交叉的知识输入，标杆提供有出处的参考。目标企业的事实与权限由自身资料决定。</p><div class="route-stack">${route('行业 → 标杆企业 → 目标企业',['T01','T03'])}${route('领域 → 标杆业务域 → 目标部门',['T02','T04'])}</div><section class="section-gap"><div class="flex-between"><h2>Agent 整理的逐项内化差异（预置演示）</h2>${button('adaptation','查看采用依据')}</div>${table(['参考项','动作','企业候选内容','依据'], F.adaptation.map(r=>r.map(esc)))}</section><p class="help">这些是演示中的待核候选，不是对目标企业的实际结论；未知项不补成 Nike 或目标企业事实。</p>`;
  }
  function checksView() {
    const rows = [
      ['统计对象与标识','会员关系 ↔ 有效会员关系数',!state.reviewed?label('变更后待核','warning'):label('已对应（演示）','success'),'主体／账号／会员关系分开'],
      ['业务规则与时间','资格状态、有效起止与观察时点',!state.reviewed?label('新候选待核','warning'):conflict()?label('规则来源冲突','danger'):label('候选已核定（演示）','success'),conflict()?'制度 r1 与补充说明范围矛盾，会员资格相关项暂停发布':'候选 r2 引用虚构政策修订；原 r1 保留'],
      ['数据 Binding','membership_key / state_code / end_at',missing()?label('待补截止字段','warning'):label('样本对应（演示）','success'),missing()?'可限定发布定义，当前计数不可计算，不以缺失填零':'字段存在、键及状态映射有预置样本检查'],
      ['指标与维度','原 SAP 包版本＋指标名',!state.reviewed?label('本候选引用待核','warning'):label('引用准确（演示）','success'),'计划与门店维度需与模型身份一致'],
      ['独立使用验证','普通新任务实际正确使用',label('尚未真实执行','warning'),'Demo 点击和作者声明不升级为真实模型验收'],
    ];
    return `${readiness()}${conflict()?notice('只有受冲突影响的会员资格候选受限，独立门店定义仍可单独预览发布。','warning'):''}${missing()?notice('数据缺口不等于定义错误。可以限定发布已核定定义；当前计数用途继续待补资料。','warning'):''}<section class="panel"><div class="panel-head"><h2>联合关联核验</h2>${button('check-receipt','查看本版检查记录','','secondary',readOnly())}</div>${table(['核验方面','关联内容','状态','依据与限制'],rows)}</section><div class="actions section-gap">${button('preview',conflict()?'预览独立可用部分':'查看准确发布预览','','primary',readOnly() || !state.reviewed)}${button('asset','查看数据映射','binding.crm','secondary')}${conflict()?button('conflict','查看冲突依据'):''}</div><p class="help section-gap">Host 核结构、身份、版本与权限；Agent 自主核对业务与样本。当前是预置检查记录，未执行产品校验。</p>`;
  }
  function evolutionView() {
    if(state.enterprise==='b'&&state.taskCreatedB)return `<section class="panel"><div class="panel-head"><h2>示例企业 B · 基础建设目标</h2>${label('等待企业资料','warning')}</div><div class="panel-body"><p>演示目标已记录：同步建设主数据、指标体系与本体，先核定本企业材料。</p><p>当前无获准企业资料、无候选、无发布预览。没有复制企业 A 的模型、结果或执行归属。</p>${button('show-reference','查看通用参考输入','T02')}${button('create','补充建设目标','','secondary')}</div></section>`;
    if(empty()) return foundationView();
    return `<div class="owner-strip"><div><strong>${state.maintenance?'接续维护任务 M-02':'基础建设任务 B-01'}（演示）</strong><small>${state.maintenance?'新获准维护项目；原归档任务只读保留':F.project} · 未运行真实模型</small></div>${button('maintenance','接续维护方式')}</div><div class="split"><section class="panel"><div class="panel-head"><h2>建设工作台</h2>${label(readOnly()?'当前只读':'候选待正式决定',readOnly()?'warning':'accent')}</div><div class="panel-body"><div class="agent-message"><span class="agent-avatar">Pi</span><div><strong>Agent 整理记录 · 预置演示</strong><p>我将主数据、指标体系、本体放在同一范围核对。三者引用准确版本，指标定义仍在原 SAP；本轮受控政策变化影响会员资格规则和相关度量。</p><p>${missing()?'资格截止字段尚缺，定义和计算资格分别记录。':conflict()?'会员资格来源存在冲突，相关候选待补证；独立门店定义可继续。':'候选的来源、关联和限制已整理。正式决定前，请查看准确发布预览。'}</p></div></div>${!state.reviewed?notice('候选内容已变更，原检查和旧预览失效。需核查当前候选后再准备新预览。','warning'):''}<div class="actions">${button('candidate','查看／编辑候选','','secondary',readOnly())}${button('sub-checks','查看联合核验')}${button('candidate-history','查看本页候选历史')}${button('question','查看必要业务问题')}</div></div></section><aside class="panel"><div class="panel-head"><h2>本轮资源与影响</h2></div><div class="panel-body"><ul class="mini-list"><li><strong>主数据与资格规则</strong><small>会员关系 r1 → 候选 r${state.candidateRevision}</small></li><li><strong>原 SAP 指标准确引用</strong><small>${esc(nextMetricRef())}</small></li><li><strong>企业资料</strong><small>虚构政策 r2 · 受控变更情境</small></li><li><strong>影响范围</strong><small>会员资格计数及其规则；不静默改历史报告或正在运行任务</small></li></ul></div></aside></div>${state.contribution?`<section class="panel section-gap"><div class="panel-head"><h2>普通任务贡献</h2>${label(state.contribution.scope==='task'?'仅本案约定':state.linked?'已关联候选，待发布':'企业候选待核','warning')}</div><div class="panel-body"><p>${esc(state.contribution.body)}</p><p class="meta">来源：分析任务 ${state.contribution.sourceTask} · 报告 ${state.contribution.report} · 基于 SAP ${state.contribution.version}</p>${button('contribution-detail','查看贡献与准确基础')}${button('link-contribution','核对并关联候选','','secondary',state.contribution.scope==='task' || state.linked || readOnly())}</div></section>`:''}<div class="actions section-gap">${button('preview',conflict()?'预览独立可用部分':'准备准确发布预览','','primary',readOnly() || !state.reviewed)}${button('history','查看原任务与历史报告')}</div>`;
  }
  function publicationView() {
    if(state.enterprise==='b')return `<div class="empty"><h2>本企业尚无发布记录</h2><p>没有借用企业 A 的发布回执或正式资格。可先建设本企业基础资产。</p>${button('create','建设本企业基础资产','','primary')}</div>`;
    const r=state.publication;
    return `<div class="toolbar"><div><h2>准确版本与分项结果</h2><p class="help">正式发布、图刷新、当前可计算和实际使用分别记录。</p></div>${button('preview','查看准确发布预览','','primary',readOnly() || !state.reviewed)}</div>${r?`<section class="panel"><div class="panel-head"><div><h2>${r.partial?'独立门店定义的限定发布':'会员基础资产候选 r'+r.revision}</h2><small>演示请求 ${r.requestId} · 只关联本次准确候选</small></div>${label(r.unknown?'存在 UNKNOWN，未整体成功':r.failed?'SAP 分项失败，未整体成功':'演示分项结果已记录',r.unknown||r.failed?'warning':'success')}</div>${table(['模块','结果','准确范围'],r.results.map(x=>[x.name,label(x.status,x.status==='UNKNOWN'?'warning':x.status==='失败（演示）'?'danger':'success'),x.ref]))}<div class="panel-body">${r.unknown?notice('SAP 请求结果 UNKNOWN。保留同一请求身份；查询原回执不等于重新发送，也不因目标存在而推断原请求成功。','warning'):r.failed?notice('SAP 分项明确失败：预置发布冲突。依赖该新版的用途仍受限；原合格组合与独立门店定义继续。失败记录保留，未改为整体成功。','warning'):''}<div class="actions">${r.unknown?button('receipt','查询原请求回执（演示）','','secondary'):''}${button('history','查看旧报告依据')}${button('nav-task','进入普通分析任务')}</div></div></section>`:notice('尚未作本轮演示发布决定。候选、准确预览和原正式源分别保留。')}<section class="panel section-gap"><div class="panel-head"><h2>供给与实际使用</h2></div><div class="panel-body"><dl class="detail-grid"><dt>当前任务固定版本</dt><dd>SAP ${state.useVersion} · 发布后不静默换版</dd><dt>后续任务可发现</dt><dd>${r && !r.unknown && !r.failed && !r.partial ? 'SAP '+r.metricVersion+'（仅演示）' : 'SAP 1.0.0；未知或受限新版不进入对应正式供给'}</dd><dt>图表示</dt><dd>尚未刷新；只限制依赖图的用途，已合格源资产可独立读取</dd><dt>实际使用核验</dt><dd>本原型未运行真实模型，尚未业务验收</dd></dl><div class="actions section-gap">${button('new-task','创建新独立任务（演示）')}${button('graph-info','查看图用途与限制','', 'ghost')}</div></div></section>`;
  }
  function taskView() {
    if(state.enterprise==='b')return `<div class="empty"><h2>本企业尚无正式资产依据</h2><p>普通任务仍可在获准资料范围内开展分析。当前演示没有企业 B 的资料或回答，不跨企业借用 A 的预置报告。</p>${button('view','返回企业 B 基础资产','foundation','primary')}</div>`;
    const version=state.useVersion;
    return `<div class="owner-strip"><div><strong>分析任务 A-${state.taskNumber}（虚构）</strong><small>所属企业 A · 固定 SAP ${version} · 主数据与本体按对应规则版本读取</small></div>${button('history','历史报告 R-01')}</div><section class="task-report"><span class="report-id">预置回答示例，不是模型生成或真实计算</span><h2>会员基础资料是否足以开展分析？</h2><p>我需要区分会员关系、账号和自然人，读取准确指标定义及资格规则，再核查数据是否支持。${readFailure()?'本任务指标准确正文读取失败，保留该版本待核，不以目录或其他版本代替已读。':missing()?'当前缺少资格截止字段，因此不输出有效会员关系数。':version!=='1.0.0'?'本任务示例采用候选正式化后的“仅正常”规则；原报告仍按“正常＋宽限”。':'本任务仍保持 1.0.0 的“正常＋宽限”规则，不随后续发布静默改版。'}</p><p class="help">此处不预置真实企业数值，不执行经营动作，也不把查看来源当成业务正确。</p></section><details class="evidence-panel" open><summary>本次依据 · 目录、正文、声明和核验分开</summary>${table(['事实','演示记录','解释'],[
      ['目录供给',label('已提供准确条目（预置）'),'主数据／指标／本体／Binding 的可发现线索'],
      ['正文读取',label(readFailure()?'准确正文读取失败':partial()?'部分正文，待续读':'相关正文已返回（预置）',readFailure()?'danger':partial()?'warning':'success'),readFailure()?'原指标版本保留，不换 latest；该项没有已读记录':partial()?'资格定义仅第1片段；不能声称已读完整规则':'查看模拟轨迹和准确版本，不代表真实调用'],
      ['作者采用声明',label(partial()||readFailure()?'采用待核':'预置声明，非独立证明','warning'),'声明关联当前报告及准确来源'],
      ['计算与专业核验',label('真实运行未执行','warning'),'本原型没有模型、计算或独立业务验收'],
    ])}<div class="actions panel-body">${button('read-trace','查看模拟读取轨迹')}${readFailure()?button('retry-source','只读重查准确来源（演示）'):''}${partial()?button('continuation','查看后续片段（演示）','','secondary'):''}${button('sap','查看本任务准确 SAP 定义',version,'ghost')}</div></details><div class="actions section-gap">${button('contribute','反馈到资产体系','','secondary',readOnly())}${button('view','查看企业基础资产','foundation','ghost')}</div><p class="help section-gap">普通任务只形成自身候选与证据。修改企业正式源，仍由获准建设任务核定与发布。</p>`;
  }
  function reviewTools() {
    return `<details class="review-tools"><summary>评审情景（仅供审核）</summary><div class="review-controls"><label>情景<select id="scenario-select" aria-label="评审情景">${[['normal','正常建设与发布'],['empty','空白企业'],['missing','资料缺失／限定发布'],['conflict','来源冲突／独立部分继续'],['readonly','归档任务只读'],['unknown','发布结果 UNKNOWN'],['publish-fail','发布分项失败'],['partial','普通任务部分读取'],['read-fail','准确来源读取失败'],['task-only','仅本案贡献']].map(([id,t])=>`<option value="${id}" ${state.scenario===id?'selected':''}>${t}</option>`).join('')}</select></label>${button('reset','重置全部演示')}</div><p>切换情景会重置为对应受控样例、清除本页自定义候选及预览结果；不连接真实服务，不构成产品或专业验收。原报告始终保留 1.0.0 依据。</p></details>`;
  }
  function openModal(title, body, footer='', options={}) {
    if(!dialog.open) trigger=document.activeElement;
    dialog.className=options.wide?'wide':'';
    dialog.innerHTML=`<header class="dialog-head"><div><h2 id="dialog-title">${esc(title)}</h2><p class="dialog-intro">${options.subtitle || '仅为本地交互演示，未写入产品或正式资产。'}</p></div>${button('close','关闭','','secondary')}</header><div class="dialog-body">${body}</div><footer class="dialog-actions">${footer || button('close','返回')}</footer>`;
    dialogState={ dirty:false, ...options };
    if(!dialog.open) dialog.showModal();
    const focus=dialog.querySelector('input:not([type=checkbox]),textarea,select,button');
    if(focus) focus.focus();
  }
  function closeModal(force=false) {
    if(dialogState?.savedState && !force) { restoreEditing(); return; }
    if(dialogState?.dirty && !force) { confirmLeave(()=>closeModal(true)); return; }
    dialog.close(); dialogState=null;
    if(trigger?.isConnected) trigger.focus(); else document.querySelector('h1')?.focus();
  }
  function confirmLeave(next) {
    const savedHTML=dialog.innerHTML, savedState=dialogState;
    const savedValues=[...dialog.querySelectorAll('input,textarea,select')].map(el=>({value:el.value,checked:el.checked}));
    queuedNavigation=next;
    openModal('保留未保存的修改？','<p>本次未保存的候选／目标仍保留在原面板。已保存版本和旧报告不会改变。</p>',button('keep-editing','继续编辑','','primary')+button('discard-edit','放弃本次未保存修改'),{ savedHTML, savedState, savedValues });
  }
  function restoreEditing(){const prev=dialogState;dialog.innerHTML=prev.savedHTML;dialogState=prev.savedState;[...dialog.querySelectorAll('input,textarea,select')].forEach((el,i)=>{el.value=prev.savedValues[i].value;if(el.type==='checkbox')el.checked=prev.savedValues[i].checked;});queuedNavigation=undefined;dialog.querySelector('textarea,input,button')?.focus();}
  function navigate(fn) { if(dialog.open && dialogState?.dirty) confirmLeave(()=>{closeModal(true);fn();}); else {if(dialog.open)closeModal(true);fn();} }
  function assetModal(id) {
    if(state.enterprise==='b')return;
    const a=F.assets.find(x=>x.id===id) || F.assets[0];
    const rows=a.fields.map(r=>[...r]);
    let exactSources=a.sources;
    if(latestMetricVersion()!=='1.0.0'){
      if(a.id==='sys.membership')exactSources=`T02 会员领域参考 v0.2；SAP 演示包 ${latestMetricVersion()}`;
      if(a.id==='ont.membership')exactSources=`企业会员制度（虚构）r1 · §2；政策修订（受控虚构情境）r2 · §3；md.program_membership ${currentRevision(a)}`;
    }
    if(a.id==='sys.membership')rows[1][1]=`demo-member-foundation@${latestMetricVersion()}::active_memberships`;
    if(a.id==='binding.crm'&&missing()){rows[2][1]='start_at；end_at 缺失';rows[2][2]='资格截止字段未获准提供；当前计数不可计算';}
    openModal(a.title,`<div class="version-strip">${label(a.kind)}<strong>${esc(a.id)} · ${currentRevision(a)}</strong>${label('合格源组合（演示）','success')}</div><p>${esc(a.summary)}</p>${table(['字段／关系','类型／引用','语义与条件'],rows.map(r=>r.map(esc)))}<dl class="detail-grid"><dt>准确来源</dt><dd>${esc(exactSources)}</dd><dt>关联</dt><dd>${esc(a.relation)}</dd><dt>原文与检查</dt><dd>仅展示预置资料；没有运行结构或业务校验。</dd></dl>`,button('close','返回原位置')+(id==='sys.membership'?button('sap','查看原 SAP 定义','','primary'):button('candidate','查看企业候选','','primary',readOnly())),{wide:true});
  }
  function sapModal(version) {
    if(state.enterprise==='b')return;
    const v=version || latestMetricVersion();
    openModal('原 SAP 指标准确详情',`<div class="version-strip">${label('SAP 原权威')}<strong>demo-member-foundation@${esc(v)}::active_memberships</strong></div><dl class="detail-grid"><dt>名称</dt><dd>有效会员关系数</dd><dt>统计对象</dt><dd>md.program_membership；对资格关系标识去重，不等同自然人数。</dd><dt>定义</dt><dd>指定业务时点，符合当时生效会员资格规则的会员关系数。</dd><dt>资格</dt><dd>${v!=='1.0.0'?'正常；排除宽限、暂停、退出':'正常＋宽限；排除暂停、退出'}，并满足有效起止期间。</dd><dt>维度</dt><dd>计划；门店维度按服务归属映射，不能自行推定入会门店。</dd><dt>单位／时间</dt><dd>会员关系个数；按日观察时点，业务有效时间与记录时间分别保留。</dd><dt>计算说明</dt><dd><code>COUNT_DISTINCT(membership_id)</code>，资格筛选与边界规则见本准确 SAP 版本（虚构说明）。</dd><dt>限制</dt><dd>这是原 SAP 专业详情的只读演示。体系索引没有另一份公式编辑入口。</dd></dl>`,button('close','返回')+button('sap-edit-info','原 SAP 专业编辑方式','','secondary'),{wide:true});
  }
  function referenceModal(id) {
    const r=F.references.find(x=>x.id===id) || F.references[0];
    const nike=r.type.startsWith('标杆');
    openModal(r.title,`<div class="version-strip">${label(r.type)}<strong>${r.id} · v0.2</strong>${label('参考候选','warning')}</div><p>${esc(r.summary)}</p>${table(['内容类别','主数据','指标体系','本体'],[['覆盖','对象、粒度、标识与字段','指标主题、准确引用与测量条件','对象、事件、关系与规则']])}${nike?table(['证据类型','示例与边界'],[['公开事实',r.id==='T03'?'官方年报披露品牌、经营渠道与报告范围。':'地区会员页公开体验和权益，适用条件有地区差异。'],['建模建议','以共享身份和业务含义组织模型；不是 Nike 内部实现。'],['未知','内部表结构、会员部门、身份算法、内部 KPI 公式与阈值。']]):notice('标准词汇与本包建模建议分列；不能凭候选词汇补造企业制度。')}<p class="help">${esc(r.evidence)}。目标企业内化仍须获准资料；参考读取不授予正式供给资格。</p>`,`<a class="secondary" href="../../reference-templates/v0.2/${r.file}" target="_blank" rel="noopener">打开完整模板文稿</a>${button('adaptation','查看逐项内化依据','','primary')}`,{wide:true});
  }
  function candidateModal() {
    if(state.enterprise==='b')return;
    if(readOnly()) { openModal('当前任务只读','<p>归档任务不能修改候选或发布；历史源仍可查看。</p>',button('close','返回')+button('maintenance','查看接续维护方式')); return; }
    const formalVersion=latestMetricVersion(), formalRevision=formalVersion==='1.0.0'?1:state.publication.revision;
    openModal('企业候选与修订影响',`<div class="version-strip"><strong>候选 r${state.candidateRevision}</strong>${label(state.reviewed?'核查记录已整理（演示）':'修改后待核查','warning')}</div><div class="diff"><div><h3>当前正式 r${formalRevision}／SAP ${formalVersion}</h3><p>${formalVersion==='1.0.0'?'资格包含正常＋宽限。':esc(state.publication.body)}历史报告 R-01 始终保留原始 r1／SAP 1.0.0 依据。</p></div><div class="after"><h3>候选 r${state.candidateRevision}／SAP ${state.candidateMetricVersion}</h3><p>${state.customEdited?'自定义正文或范围，尚未业务核验；下方保存内容为准。':'受控政策更新：仅正常状态计入。不是为测试故意发布错误规则。'}</p></div></div><label class="field"><span>候选规则与内化理由</span><textarea id="candidate-body" rows="5">${esc(state.candidateBody)}</textarea></label><label class="field"><span>适用范围</span><input id="candidate-scope" type="text" value="${esc(state.candidateScope)}" required></label><p class="help">指标定义与公式在原 SAP 中修订。此处维护本体规则、体系关联和内化依据，不复制公式编辑器。</p>`,button('close','取消编辑')+button('save-candidate','保存新候选（演示）','','primary'),{wide:true,editable:true});
  }
  function previewModal() {
    if(state.enterprise==='b')return;
    if(readOnly() || !state.reviewed) return;
    if(state.publication?.unknown) { receiptModal(); return; }
    if(state.publication?.revision===state.candidateRevision){const r=state.publication;openModal('本版演示发布结果已记录',`<p>同一候选 r${r.revision} 已有固定请求 ${esc(r.requestId)}。这里只读回看，不重复确认或创建另一条发布请求。</p>${table(['模块','结果','准确范围'],r.results.map(x=>[x.name,x.status,x.ref]))}`,button('close','返回原结果'),{wide:true});return;}
    const partialScope=conflict();
    state.preview={revision:state.candidateRevision,enterprise:state.enterprise,scenario:state.scenario,partial:partialScope,body:partialScope?'独立门店服务定义：记录门店服务资格范围，依据虚构门店服务说明 r1；不定义或修改会员资格状态。':state.candidateBody,scope:partialScope?'示例企业 A · 仅门店服务定义参考；排除有冲突的会员资格指标及其计数用途':state.candidateScope,metricVersion:state.candidateMetricVersion};
    openModal('准确发布预览',`<div class="version-strip"><strong>示例企业 A · 候选 r${state.candidateRevision}</strong>${label(partialScope?'限定独立可用部分':'待必要正式决定','warning')}</div>${partialScope?notice('会员资格来源冲突仍保留。本预览仅包含不依赖该冲突的门店服务定义，不发布会员资格指标。','warning'):missing()?notice('发布范围仅为已核定的定义、体系关联及限制；缺资格截止字段，计数用途不可计算。','warning'):notice('定义、关联和演示检查已整理；不从发布推断实际使用已正确。')}${table(['原权威','准确候选','范围'],partialScope?[['Studio 源','md.store.membership_service · r'+state.candidateRevision,'独立门店服务定义；不依赖会员资格争议']]:[['Studio 主数据／体系','md.program_membership / sys.membership · r'+state.candidateRevision,'准确来源、关联与内化差异'],['原 SAP',nextMetricRef(),'公式仅由原 SAP 保存'],['Studio 本体／映射','ont.membership / binding.crm · r'+state.candidateRevision,'业务规则、数据缺口与适用范围']])}<dl class="detail-grid"><dt>本次准确正文</dt><dd>${esc(state.preview.body)}</dd><dt>适用范围</dt><dd>${esc(state.preview.scope)}</dd></dl><p class="help">预览固定企业、候选修订及适用范围。修改候选后旧预览不能确认；分模块结果可能成功、失败或 UNKNOWN。</p>`,button('close','取消预览')+button('stale-preview','模拟候选在预览后变化')+button('confirm-publication','确认演示发布决定','','primary'),{wide:true});
  }
  function receiptModal() {
    const r=state.publication;
    if(!r?.unknown) return;
    openModal('原请求回执查询',`<div class="version-strip"><strong>请求 ${esc(r.requestId)}</strong>${label('UNKNOWN 保留','warning')}</div><p>本次只读查询的预置回执仍未能核定 SAP 发布是否成功。</p><p>未重发原请求，也未因为原主库目标可能存在而将原请求改成成功。</p>${table(['模块','当前事实'],r.results.map(x=>[x.name,x.status]))}<p class="help">依赖未知 SAP 新版的用途保持待核；原合格版本及其他独立成果继续可用。</p>`,button('close','保留未知并返回')+button('history','查看原合格版本'),{wide:true});
  }
  function historyModal() {
    openModal('历史报告 R-01 · 只读保留',`<div class="version-strip"><strong>原分析任务 A-01 / 报告 R-01</strong>${label('历史依据未变','success')}</div>${table(['依据','准确身份'],[['主数据','md.program_membership r1'],['指标','demo-member-foundation@1.0.0::active_memberships'],['本体规则','ont.membership r1：正常＋宽限'],['输入','demo-snapshot-01（虚构）'],['验证','原型未执行真实模型或专业验收']])}<p class="section-gap">后续发布和新任务采用新版，不覆盖本报告原规则、数据与引用。旧资格与当前可用资格分别核查。</p>`,button('close','返回当前工作')+button('sap','查看历史 SAP 正文','1.0.0'),{wide:true});
  }
  function contributionModal() {
    if(readOnly()) return;
    openModal('反馈到资产体系',`<p>来源任务 A-${state.taskNumber}、报告与实际演示引用由当前上下文带入。保存只形成候选，不修改正式源。</p><label class="field"><span>共享范围</span><select id="contribution-scope"><option value="enterprise" ${state.scenario==='task-only'?'':'selected'}>企业共享候选</option><option value="task" ${state.scenario==='task-only'?'selected':''}>仅本案约定</option></select></label><label class="field"><span>发现与依据</span><textarea id="contribution-body">建议核对宽限状态在新政策中的资格范围，引用本任务准确读取版本，说明后续影响。</textarea></label><p class="help">当前来源 SAP ${state.useVersion}。本次结果有错应先在原任务修正；可共享的变化再交获准建设任务处理。</p>`,button('close','取消')+button('save-contribution','保存演示贡献候选','','primary'),{editable:true});
  }
  function doAction(action,id) {
    if(action==='close'){closeModal();return;}
    if(action==='keep-editing'){restoreEditing();return;}
    if(action==='discard-edit'){const next=queuedNavigation;queuedNavigation=undefined;dialogState.dirty=false;if(next)next();return;}
    if(action==='theme'){state.dark=!state.dark;shell();return;}
    if(action==='reset'){navigate(()=>{Object.assign(state,{enterprise:'a',view:'foundation',sub:'overview',scenario:'normal',candidateRevision:2,candidateBody:CONTROLLED_BODY,candidateScope:CONTROLLED_SCOPE,candidateMetricVersion:'1.1.0',customEdited:false,candidateHistory:[],reviewed:true,preview:null,publication:null,taskCreated:false,taskCreatedB:false,maintenance:false,useVersion:'1.0.0',taskNumber:1,contribution:null,linked:false,partialComplete:false,useSourceRevision:1,notice:''});shell();});return;}
    if(action==='view' || action==='nav-studio' || action==='nav-task' || action==='sub' || action==='sub-checks'){navigate(()=>{if(action==='view')state.view=id;else if(action==='nav-task')state.view='task';else if(action==='nav-studio')state.view='foundation';else{state.view='foundation';state.sub=action==='sub-checks'?'checks':id;}state.notice='';shell();});return;}
    if(action==='asset'){assetModal(id);return;}
    if(action==='sap'){sapModal(id);return;}
    if(action==='show-reference'){referenceModal(id);return;}
    if(action==='history'){historyModal();return;}
    if(action==='candidate'){candidateModal();return;}
    if(action==='save-candidate'){
      const body=dialog.querySelector('#candidate-body')?.value.trim(),scope=dialog.querySelector('#candidate-scope')?.value.trim();
      if(!body||!scope){announce('请填写候选内容与适用范围。');return;}
      state.candidateHistory.push({revision:state.candidateRevision,body:state.candidateBody,scope:state.candidateScope});state.candidateBody=body;state.candidateScope=scope;state.customEdited=body!==CONTROLLED_BODY||scope!==CONTROLLED_SCOPE;if(state.publication&&!state.publication.unknown&&!state.publication.failed&&!state.publication.partial){state.candidateMetricVersion='1.'+(Number(state.publication.metricVersion.split('.')[1])+1)+'.0';}state.candidateRevision++;state.reviewed=false;state.preview=null;state.notice='已保存演示新候选；原检查和预览失效，正式版与历史未变。';closeModal(true);shell();return;
    }
    if(action==='preview'){previewModal();return;}
    if(action==='stale-preview'){state.candidateRevision++;state.reviewed=false;openModal('旧预览已失效',`<p>预览基于 r${state.preview.revision}，候选现为 r${state.candidateRevision}。旧预览保持历史，不可用于确认新版。</p><p>需重新核对当前候选并生成新预览。此处仅模拟并发变化，不写产品。</p>`,button('sub-checks','返回建设核查'));return;}
    if(action==='confirm-publication'){
      if(readOnly()||!state.preview||state.preview.revision!==state.candidateRevision||state.preview.enterprise!==state.enterprise||state.preview.scenario!==state.scenario||!state.reviewed)return;
      const unknown=state.scenario==='unknown',failed=state.scenario==='publish-fail',limited=state.preview.partial;
      state.publication={revision:state.candidateRevision,requestId:`demo-publish-${state.candidateRevision}-001`,unknown,failed,partial:limited,body:state.preview.body,scope:state.preview.scope,metricVersion:state.preview.metricVersion,results:limited?[{name:'Studio 门店定义',status:'成功（演示）',ref:'md.store.membership_service r'+state.candidateRevision}]:[{name:'Studio 主数据与体系',status:'成功（演示）',ref:'md.program_membership / sys.membership r'+state.candidateRevision},{name:'原 SAP',status:unknown?'UNKNOWN':failed?'失败（演示）':'成功（演示）',ref:nextMetricRef()},{name:'Studio 本体与映射',status:'成功（演示）',ref:'ont.membership / binding.crm r'+state.candidateRevision}]};
      state.view='publication';state.notice='仅记录预置分项结果；可计算与实际验证状态没有因发布而升级。';closeModal(true);shell();return;
    }
    if(action==='receipt'){receiptModal();return;}
    if(action==='create'){
      if(readOnly())return;
      const projectLabel=state.enterprise==='b'?'企业 B 建设项目（虚构可写）':F.project;
      const materialChoices=state.enterprise==='b'?'<p>当前尚未登记企业 B 的获准资料，先保留缺口。</p><label><input type="checkbox" checked>四组公开参考模板 v0.2（仅参考）</label>':'<label><input type="checkbox" checked>会员制度与政策修订</label><label><input type="checkbox" checked>系统字典与已授权样本</label><label><input type="checkbox" checked>四组参考模板 v0.2</label>';
      openModal('建设企业基础资产',`<label class="field"><span>建设目标</span><textarea id="build-goal">建设本企业共享主数据、会员运营指标体系与本体，核定三类关联及企业内化差异。</textarea></label><label class="field"><span>执行归属项目</span><select id="build-project"><option>${esc(projectLabel)}</option></select></label><fieldset class="checks"><legend>本轮获准资料（虚构）</legend>${materialChoices}</fieldset><p class="help section-gap">合理默认已有可写项目；这是建设目标，不要求先指定某道分析题。参考资料不会自动成为企业正式资产。</p>`,button('close','取消，保留原位置')+button('create-task','创建并进入建设（演示）','','primary'),{editable:true});return;
    }
    if(action==='create-task'){
      if(!dialog.querySelector('#build-goal')?.value.trim()){announce('请输入建设目标。');return;}
      if(state.enterprise==='b'){state.taskCreatedB=true;state.view='evolution';state.notice='企业 B 的演示建设目标已保存；尚无本企业获准资料或候选，没有复制企业 A 资产。';closeModal(true);shell();return;}
      state.taskCreated=true;state.enterprise='a';if(state.scenario==='empty')state.scenario='normal';state.view='evolution';state.notice='已展示预置建设任务和整理结果；没有创建产品任务或调用模型。';closeModal(true);shell();return;
    }
    if(action==='check-receipt'){
      if(readOnly())return;
      if(state.customEdited){openModal('自定义候选待业务核验',`<p>候选 r${state.candidateRevision} 的正文或范围已超出预置受控样例。现有演示检查不能证明该稿正确，发布准备继续受限。</p><dl class="detail-grid"><dt>准确正文</dt><dd>${esc(state.candidateBody)}</dd><dt>适用范围</dt><dd>${esc(state.candidateScope)}</dd></dl><p class="help">可以保留该稿待 Agent 核查，也可显式另存受控样例；当前自定义稿保留在本页候选历史。</p>`,button('close','保留自定义稿待核')+button('restore-controlled','另存受控样例候选','','primary'));return;}
      state.reviewed=true;
      openModal('本版预置检查记录',`<p>候选 r${state.candidateRevision} 的演示检查记录已关联：来源、对象身份、准确指标引用与范围。</p>${missing()?notice('资格截止字段仍缺失。已核定定义可以限定发布，计数用途不可计算。','warning'):''}${conflict()?notice('会员资格冲突仍保留，相关候选不可发布；独立门店定义可继续。','warning'):''}<p class="help">这是查看预置核查回执，不是真实执行校验或模型，不构成业务正确证明。</p>`,button('close','返回核验列表'));shell();return;
    }
    if(action==='restore-controlled'){state.candidateHistory.push({revision:state.candidateRevision,body:state.candidateBody,scope:state.candidateScope});state.candidateRevision++;state.candidateBody=CONTROLLED_BODY;state.candidateScope=CONTROLLED_SCOPE;state.customEdited=false;state.reviewed=false;state.preview=null;state.notice='已另存明确的受控样例，前一自定义稿留在本页历史；可查看此样例预置检查，非真实业务校验。';closeModal(true);shell();return;}
    if(action==='question'){openModal('必要业务问题',conflict()?'<p><strong>会员资格范围存在资料冲突：</strong>原制度含宽限，补充说明未明确其生效企业与期间。Agent 应回源核查；仅证据不能裁定的业务选择集中交人。</p>':'<p>本正常情境的虚构政策已明确资格变化，目前没有需要用户逐项审批的问题。其他字段核查由 Agent 自主完成。</p>',button('close','保留现状并返回')+(conflict()?button('conflict','查看两份冲突依据'):''));return;}
    if(action==='conflict'){openModal('来源冲突与受影响范围',table(['来源','内容','资格'],[['制度 r1（虚构）','正常＋宽限','旧版依据保留'],['补充说明 r2（虚构）','仅正常，生效范围缺失','待核，不能覆盖原版']])+'<p class="section-gap">仅会员资格相关候选受限。独立门店定义可限定发布；不自动替业务方裁定冲突。</p>',button('close','保留冲突')+button('preview','预览独立可用部分'));return;}
    if(action==='candidate-history'){openModal('本页候选历史（演示）',state.candidateHistory.length?table(['准确修订','保存的正文','适用范围'],state.candidateHistory.map(r=>['r'+r.revision,esc(r.body),esc(r.scope)])):'<p>尚未另存候选历史；原正式 r1 与原报告始终可查。</p>',button('close','返回'),{wide:true});return;}
    if(action==='adaptation'){openModal('参考内化差异与依据',table(['参考项','动作','企业候选','依据'],F.adaptation.map(r=>r.map(esc)))+'<p class="help section-gap">参考项与目标项均有稳定身份及准确版本。采用动作不直接赋予企业正式资格，仍需核查和发布。</p>',button('close','返回')+button('candidate','查看企业候选','','primary',readOnly()),{wide:true});return;}
    if(action==='new-task'){
      if(state.enterprise==='b'){state.view='task';state.notice='当前为企业 B，没有借用企业 A 的正式资产、原报告或预置回答。';shell();return;}
      navigate(()=>{state.taskNumber++;state.useVersion=latestMetricVersion();state.useSourceRevision=state.useVersion!=='1.0.0'?state.publication.revision:1;state.view='task';state.partialComplete=false;state.notice=`新演示任务 A-${state.taskNumber} 固定 SAP ${state.useVersion}；原任务和报告版本保持。尚未真实运行。`;shell();});return;
    }
    if(action==='read-trace'){openModal('模拟读取轨迹',table(['阶段','准确目标','返回状态'],[['目录供给','主数据／SAP／本体／Binding 条目','只是线索'],['读主数据','md.program_membership r'+state.useSourceRevision,'预置完整返回'],['读指标',`demo-member-foundation@${state.useVersion}::active_memberships`,readFailure()?'读取失败：没有已读记录':'预置完整返回'],['读资格规则',`ont.membership r${state.useSourceRevision}`,partial()?'预置仅1/2片段；continuation待继续':'预置相关正文返回'],['作者声明','报告 A-'+state.taskNumber,'预置声明，未独立核验']])+'<p class="help section-gap">只有演示轨迹，没有真实工具调用；不要把该表作为产品使用收据。</p>',button('close','返回')+(partial()?button('continuation','查看后续片段（演示）'):''),{wide:true});return;}
    if(action==='retry-source'){openModal('准确来源只读重查',`<div class="version-strip"><strong>demo-member-foundation@${state.useVersion}::active_memberships</strong>${label('仍读取失败','warning')}</div><p>预置重查结果仍不可读，原准确版本保持，未替换为 latest 或其他版本，未产生已读／采用记录。</p><p>相关指标结论待核，其他已有充分依据的独立分析可以继续。这是本地失败情景，不是真实工具调用。</p>`,button('close','保留失败并返回'));return;}
    if(action==='continuation'){state.partialComplete=true;openModal('后续正文片段（预置）',`<p>第二片段：有效资格还需满足业务生效起止时间；账号存在、入会关系和自然人身份不可互代。</p><p>本次演示已展示剩余相关正文。作者采用声明和独立核验仍分别留状态。</p>`,button('close','返回任务'));shell();return;}
    if(action==='contribute'){contributionModal();return;}
    if(action==='save-contribution'){
      const body=dialog.querySelector('#contribution-body')?.value.trim();if(!body){announce('请填写发现与依据。');return;}
      state.contribution={scope:dialog.querySelector('#contribution-scope').value,body,version:state.useVersion,sourceTask:'A-'+state.taskNumber,sourceRevision:state.useSourceRevision,report:'demo-report-A-'+state.taskNumber};state.linked=false;state.view='evolution';state.notice='演示贡献候选已保留；正式源未变。仅本案内容不直接并入基础层。';closeModal(true);shell();return;
    }
    if(action==='contribution-detail'){
      const c=state.contribution;if(!c)return;
      openModal('贡献候选与准确基础',`<div class="version-strip">${label(c.scope==='task'?'仅本案约定':'企业共享候选','warning')}<strong>${esc(c.report)}</strong></div><p>${esc(c.body)}</p><dl class="detail-grid"><dt>来源任务</dt><dd>${esc(c.sourceTask)} · 源修订 r${c.sourceRevision}</dd><dt>原报告</dt><dd>${esc(c.report)}</dd><dt>基于指标</dt><dd>demo-member-foundation@${esc(c.version)}::active_memberships</dd><dt>处理</dt><dd>${c.scope==='task'?'仅本案保留；企业范围及依据未核定，不可直接并入。':'须关联确切候选并核对差异，再走准确发布。'}</dd></dl>`,button('close','返回')+button('link-contribution','核对并关联候选','','primary',c.scope==='task'||state.linked||readOnly()));return;
    }
    if(action==='link-contribution'){
      if(!state.contribution || state.contribution.scope==='task'||readOnly()||state.linked)return;
      state.linked=true;state.reviewed=false;state.candidateRevision++;state.preview=null;state.notice='贡献已关联到准确新候选；待核查、发布及新版使用。问题尚未标为解决。';if(dialog.open)closeModal(true);shell();return;
    }
    if(action==='maintenance'){
      openModal('以新获准任务接续维护','<p>原归档项目和原会话继续只读，企业资产身份不复制。新的维护任务使用自己的执行归属和会话。</p><label class="field"><span>维护执行项目（虚构）</span><select><option>企业基础维护项目（可写）</option></select></label><p class="help">不会自动解档、移走运行资源或继承旧会话写权限。</p>',button('close','取消')+button('start-maintenance','创建接续维护任务（演示）','','primary'));return;
    }
    if(action==='start-maintenance'){state.maintenance=true;state.view='evolution';state.preview=null;state.notice='当前转到新的演示维护任务 M-02，原任务仍归档只读，未启动模型。';closeModal(true);shell();return;}
    if(action==='graph-info'){openModal('图表示的用途与限制','<p>正式图是准确源的可选读模型，支持按需查询定义、关系、依赖和来源。图未刷新不阻断独立可用的 SAP 与语义源。</p><p>图就绪、普通读取、实际采用和专业正确分别记录。本原型不执行图构建。</p>',button('close','返回'));return;}
    if(action==='sap-edit-info'){openModal('原 SAP 专业编辑（范围演示）','<p>正式产品继续在原 SAP 专业区编辑准确指标包、定义、场景和方法引用，保存后再发布。</p><p>本 Demo 只读呈现入口与权威边界，没有第二套公式编辑器，不写文件或原主库。</p>',button('close','返回 Studio'));return;}
  }
  document.addEventListener('click',event=>{const el=event.target.closest('[data-action]');if(el&&!el.disabled)doAction(el.dataset.action,el.dataset.id||'');});
  document.addEventListener('change',event=>{
    if(event.target.id==='enterprise-select'){
      const value=event.target.value;
      navigate(()=>{state.enterprise=value;if(state.scenario==='empty'&&value==='a')state.scenario='normal';state.preview=null;state.view='foundation';state.sub='overview';state.notice='企业范围已切换；原企业的已留结果保留，没有自动认领其他企业资料或沿用旧预览。';shell();});
    }
    if(event.target.id==='scenario-select'){
      const value=event.target.value;
      navigate(()=>{Object.assign(state,{scenario:value,enterprise:value==='empty'?'b':'a',candidateRevision:2,candidateBody:CONTROLLED_BODY,candidateScope:CONTROLLED_SCOPE,candidateMetricVersion:'1.1.0',customEdited:false,candidateHistory:[],useVersion:'1.0.0',useSourceRevision:1,taskNumber:1,taskCreated:false,taskCreatedB:false,preview:null,publication:null,reviewed:true,maintenance:false,partialComplete:false,contribution:null,linked:false,notice:'已切换到对应受控样例，演示候选、预览与分项结果均已重置；不处理真实稿件。'});if(value==='partial'||value==='read-fail'||value==='task-only')state.view='task';else if(value==='readonly')state.view='evolution';else if(value==='unknown'||value==='publish-fail')state.view='publication';else{state.view='foundation';state.sub=value==='missing'||value==='conflict'?'checks':'overview';}shell();});
    }
  });
  dialog.addEventListener('input',()=>{if(dialogState?.editable)dialogState.dirty=true;});
  dialog.addEventListener('change',()=>{if(dialogState?.editable)dialogState.dirty=true;});
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeModal();});
  dialog.addEventListener('keydown',event=>{
    if(event.key!=='Tab')return;
    const list=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]')].filter(el=>el.getClientRects().length);
    if(!list.length)return;
    const first=list[0],last=list.at(-1);
    if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
    else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
  });
  shell();
})();
