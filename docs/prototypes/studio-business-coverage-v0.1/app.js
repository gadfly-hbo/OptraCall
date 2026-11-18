/* REVIEW PROTOTYPE — synthetic, memory-only. No product API, model, SDK or storage. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const overlay = document.getElementById('overlay');
  const announce = document.getElementById('announce');
  const columns = [['What','业务对象'],['How','业务运作'],['Where','业务分布'],['Who','职责与决定'],['When','业务时间'],['Why','经营目标与规则']];
  const rows = ['范围识别','业务定义','逻辑表示','技术规格','具体配置','运行实例'];
  const defaultFocus = columns.flatMap(c => ['R1:' + c[0], 'R2:' + c[0]]).concat(['R3:What','R3:Why']);
  const scenarios = [['normal','正常：正式与候选并存'],['none','没有盘点报告'],['candidate','仅有候选盘点报告'],['method','方法资料暂不可读'],['stale','依据已变化／历史查看'],['mapping','数据计算缺映射'],['dispute','同范围同期间有争议'],['emptySearch','搜索无结果'],['loading','读取中'],['error','读取失败'],['format','报告格式损坏'],['unsupported','未知报告版本'],['candidateInput','报告含候选输入']];
  const questionRows = [
    {key:'What',title:'对象、身份与统计粒度',about:'门店、商品SKU、会员与交易；对象身份需要准确来源。',evidence:'3 份资料',states:[['已见证据','green'],['仍有未调查项',''],['储值账户：不适用','']],source:'会员与账户模型 r1',locator:'items.member / items.account',coordinates:['R2:What','R2:Who'],quote:'会员、账户和会员计划关系分别保留身份；同名不自动判为同一对象。'},
    {key:'How',title:'业务过程与完成条件',about:'入会、交易、权益使用、退换退款的过程边界。',evidence:'2 份资料',states:[['已见证据','green'],['需补取消边界','amber']],source:'交易业务说明 v1',locator:'第 3 节 交易与取消',coordinates:['R2:How','R2:When'],quote:'交易完成、取消与退款应分别记录；本资料尚未说明跨日取消的统计归属。'},
    {key:'Where',title:'门店、渠道与归属',about:'不同渠道与市场的适用规则允许合法并存。',evidence:'2 份资料',states:[['范围差异已说明','green']],source:'渠道政策 v1',locator:'第 2 节 市场与门店',coordinates:['R2:Where','R2:Why'],quote:'直营渠道与加盟渠道分别按各自制度适用；不能把渠道差异直接判为矛盾。'},
    {key:'Who',title:'维护责任与业务决定',about:'谁解释口径、维护规则，哪些事项需要业务裁定。',evidence:'1 份资料',states:[['部分已见证据','green'],['例外审批责任待核','amber']],source:'业务职责说明 v1',locator:'第 4 节 制度维护责任',coordinates:[],quote:'会员制度由运营团队维护；特殊渠道的例外决定责任尚未给出。'},
    {key:'When',title:'业务日历与有效时间',about:'发生、记录、生效时间分开；观察期按用途核定。',evidence:'2 份资料',states:[['时间含义已说明','green'],['历史覆盖待补','amber']],source:'时间口径说明 v1',locator:'第 1 节 三类时间',coordinates:['R2:When','R3:What'],quote:'制度生效日不等于交易发生日；实际历史数据覆盖仍需核定。'},
    {key:'Why',title:'经营目标、指标与规则',about:'指标用途和资格规则关联原 SAP 与正式规则来源。',evidence:'3 份资料',states:[['目标与用途有据','green'],['1 项待核问题','amber']],source:'会员资格制度 v1',locator:'第 2 节 适用资格',coordinates:['R1:Why','R2:Why','R3:Why'],quote:'本样例资格依据制度明确的状态与生效条件；指标公式仍由原 SAP 管理。'}
  ];
  const initial = () => ({
    tab:'coverage', scenario:'normal', dark:false, query:'', selectedReport:1, formalReport:1, formalReadStatus:'ready', candidateReadStatus:'ready', candidateInputsEligible:true, methodReadStatus:'ready', historyStatus:'ready',
    workItem:false, viewFocus:defaultFocus.slice(),
    task:null, taskNumber:0, notice:'',
    question:'请说明会员资格与权益的适用边界，并列出当前需要核定的事项。'
  });
  let state = initial(), returnFocus = null, modal = '';
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const badge = (t, tone='') => '<span class="badge ' + tone + '">' + esc(t) + '</span>';
  const button = (action,label,cls='secondary',value='',disabled=false) => '<button type="button" class="' + cls + '" data-action="' + action + '" data-value="' + esc(value) + '"' + (disabled?' disabled':'') + '>' + label + '</button>';
  const notice = (text,tone='') => '<div class="notice ' + tone + '" role="status">' + text + '</div>';
  const table = (heads, data, cls='') => '<div class="table-wrap" tabindex="0" aria-label="可横向滚动的资料表格"><table class="' + cls + '"><thead><tr>' + heads.map(h=>'<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + data.map(r=>'<tr>' + r.map(c=>'<td>' + c + '</td>').join('') + '</tr>').join('') + '</tbody></table></div>';
  const meta = data => '<dl class="meta-list">' + data.map(r=>'<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>';
  const noReport = () => state.selectedReport === null;
  const candidateOnly = () => state.formalReport === null && state.selectedReport !== null;
  const reportFormal = () => !candidateOnly() && state.formalReport === state.selectedReport;
  const usableCoverage = () => state.formalReport !== null && state.formalReadStatus === 'ready';
  const selectedReadStatus = () => state.selectedReport === state.formalReport ? state.formalReadStatus : state.candidateReadStatus;
  const canPublishCandidate = () => state.selectedReport === 2 && state.candidateReadStatus === 'ready' && state.candidateInputsEligible && state.methodReadStatus === 'ready';
  const reportLabel = n => '盘点报告 r' + n;
  const toast = text => { state.notice = text; announce.textContent = text; };
  function capture(el) {
    if (!el) return null;
    if (el.id) return {id:el.id};
    return {action:el.dataset.action,value:el.dataset.value || ''};
  }
  function restore(ref) {
    if (!ref) return;
    let el = ref.id ? document.getElementById(ref.id) : Array.from(document.querySelectorAll('[data-action]')).find(e=>e.dataset.action===ref.action && (e.dataset.value || '')===ref.value);
    if (el) el.focus();
  }
  function show(title,body,actions,kind='') {
    if (!overlay.open) returnFocus = capture(document.activeElement);
    modal = kind;
    overlay.innerHTML = '<div class="dialog-head"><h2 id="dialog-title">' + esc(title) + '</h2><button class="close" type="button" data-action="close" aria-label="关闭对话框">×</button></div><div class="dialog-body">' + body + '</div><div class="dialog-actions">' + (actions || button('close','返回','secondary')) + '</div>';
    if (!overlay.open) overlay.showModal();
  }
  function close() {
    const ref = returnFocus;
    overlay.close();
    modal = '';
    requestAnimationFrame(()=>restore(ref));
  }
  function methodPanel() {
    const fail = state.methodReadStatus !== 'ready';
    return '<div class="method"><strong>本次建设方法</strong><p>资料盘点方法 v0.2 · 获准资料引用 M01<br>用途：范围检查与证据盘点，不是正式企业政策。</p>' + badge(fail?'暂不可读':'准确版本已指定',fail?'amber':'') + '<div class="actions section">' + button('method','查看来源与使用范围','ghost') + '</div></div>';
  }
  function summary() {
    return '<div class="summary"><div><small>本轮业务范围</small><strong>共享经营骨架＋会员运营</strong><p>对象、指标和本体同步建设；不绑定某一道分析题。</p></div><div><small>报告与原资产</small><strong>' + (noReport()?'尚无盘点报告':reportLabel(state.selectedReport)) + '</strong><p>' + (noReport()?'已有正式资产和普通分析仍可使用。':reportFormal()?'报告为正式定义参考用途；其中各资产的四项状态另列。':'候选报告仅供建设核查，不自动进入普通任务供给。') + '</p></div><div><small>需要人的事项</small><strong>实质业务决定</strong><p>资料不能裁定的范围和政策问题集中提出，归类由 Agent 起草。</p></div></div>';
  }
  function rowStates(row) {
    if (state.scenario === 'mapping' && row.key === 'What') return [badge('定义参考可用','green'),badge('计算所需映射待补','amber')].join(' ');
    if (state.scenario === 'dispute' && row.key === 'Why') return badge('同范围断言待核','amber') + ' ' + badge('正式资格未自动改变');
    return row.states.map(x=>badge(x[0],x[1])).join(' ');
  }
  function coverage() {
    let content = '';
    if (['loading','error','corrupt','unsupported'].includes(selectedReadStatus())) {
      const readStatus=selectedReadStatus();
      const t = readStatus==='loading'?'正在读取指定报告版本（预置）':readStatus==='error'?'读取报告失败':readStatus==='corrupt'?'报告格式未通过':'当前报告版本不支持结构视图';
      const body = readStatus==='loading'?'当前尚未得到覆盖结论；页面不以空格或零条记录替代未知。':readStatus==='error'?'保留准确来源与失败信息，未显示结构化覆盖。独立可用的原资产和普通分析继续。':readStatus==='corrupt'?'声明了盘点报告格式，但字段或引用结构损坏。只显示格式问题，不推断业务覆盖。':'未知版本保留原文阅读入口，不伪装成已支持的结构化覆盖。';
      content = '<section class="panel"><div class="empty" aria-busy="'+(readStatus==='loading')+'"><h2>'+t+'</h2><p>'+body+'</p><div class="actions" style="justify-content:center">'+button(readStatus==='loading'?'load-success':readStatus==='error'?'retry-read':'repair-help',readStatus==='loading'?'查看演示读取成功':readStatus==='error'?'重试读取（演示）':'查看修复边界','secondary')+button('raw-report','查看报告原文（合成）','ghost')+button('tab','继续普通任务','secondary','usage')+'</div></div></section>';
    } else if (noReport()) {
      content = '<div class="panel"><div class="empty"><h2>尚无范围盘点报告</h2><p>可以让建设 Agent 按获准资料整理范围与缺口。现有正式定义、原工具和普通任务不依赖这份报告。</p><div class="actions" style="justify-content:center">' + button('generate','生成盘点候选（演示）','primary') + button('tab','直接进入普通任务','secondary','usage') + '</div></div></div>';
    } else {
      const filtered = questionRows.filter(r=>(r.title+r.about+r.key).toLowerCase().includes(state.query.toLowerCase()));
      content = '<section class="panel"><div class="panel-head"><div><h2>范围与资料覆盖</h2><small>以下是派生盘点记录；多种状态可以同时存在，不生成覆盖率分数。</small></div>' + badge(reportFormal()?'报告：正式参考':'报告：候选',reportFormal()?'green':'amber') + '</div><div class="panel-body"><div class="search-row"><label class="sr-only" for="search">搜索业务视角</label><input id="search" type="search" value="' + esc(state.query) + '" placeholder="搜索对象、时间、职责…" autocomplete="off"><div class="actions">' + button('report','报告版本与出处','ghost') + (state.selectedReport === 2 && !reportFormal()?button('publication','查看原发布入口（演示）','secondary'):'') + '</div></div>' + (filtered.length ? table(['业务视角','已见资料','并列观察','查看依据'], filtered.map(row=>['<strong>' + esc(row.title) + '</strong><span class="question-code">' + row.key + '</span><p>' + esc(row.about) + '</p>',esc(row.evidence),rowStates(row),button('row','查看片段','ghost',row.key)]),'coverage-table') : '<div class="empty"><h3>没有匹配的视角</h3><p>搜索只影响当前列表，不改动报告内容或来源状态。</p>' + button('clear-search','清除搜索','secondary') + '</div>') + advanced() + '</div></section>';
    }
    const warnings = (state.methodReadStatus !== 'ready' ? notice('方法资料 M01 的指定版本暂不可读。当前没有生成新盘点结果；可以查看既有报告的原记录，或继续使用独立可用的正式资产。','amber') : state.formalReadStatus === 'stale' ? notice('原正式盘点报告的依据已发生变化，当前不能供给。当前查看 '+esc(reportLabel(state.selectedReport))+'；生成候选不会恢复旧r1资格，历史按原权限保留。','amber') : candidateOnly() ? notice('当前只有候选盘点报告。普通任务不会默认读取它；未标坐标的正式业务资产仍可照常使用。','amber') : '');
    return warnings + summary() + '<div class="split"><div>' + content + '</div><aside class="panel aside-small"><div class="panel-head"><h2>依据与待决事项</h2></div><div class="panel-body">' + methodPanel() + '<div class="route"><strong>两条参考路线</strong><p>行业 → 标杆公开参考 → 企业<br>领域 → 标杆公开参考 → 企业业务域</p></div><div class="route"><strong>企业基础层 ↔ 任务演进</strong><p>盘点用于共享建设，任务发现沿原贡献机制回源。</p></div><div class="route"><strong>2 项优先核查</strong><p>渠道例外决定责任<br>历史资料覆盖与截止</p>' + button('tab','查看联合核查','ghost','checks') + '</div><p class="quiet">格坐标是查看视角；它不赋予来源、工具或发布权限。</p></div></aside></div>';
  }
  function advanced() {
    const data = rows.map((name,i)=>['<strong>R' + (i+1) + '</strong><small>' + name + '</small>'].concat(columns.map(c=>{
      const cell='R'+(i+1)+':'+c[0], focus=state.viewFocus.includes(cell);
      return '<button type="button" data-action="cell" data-value="' + cell + '" class="' + (focus?'focus':'') + '">' + esc(cell) + '<span>' + (focus?'当前关注':'本次未关注') + '</span></button>';
    })));
    return '<details class="advanced"><summary>高级查看：企业描述坐标</summary><p class="quiet section">当前关注 ' + state.viewFocus.length + ' 格。默认 14 格只是本次关注集；其余格未纳入查看，不等于不适用或企业没有相关内容。第 6 行可关联真实运行证据。</p><div class="actions">' + button('focus','调整查看关注集','secondary') + button('contract','查看派生报告约定','ghost') + '</div>' + table(['视角'].concat(columns.map(c=>c[0])),data,'matrix') + '</details>';
  }
  function checks() {
    const same = state.scenario === 'dispute';
    return notice('先核对依据和适用范围，再处理业务差异。资料疑点不会直接改变正式资产；人只处理资料无法裁定的实质决定。') + '<div class="split"><section class="panel"><div class="panel-head"><div><h2>联合核查</h2><small>沿现有工作项记录疑点，不自动改变正式源资格。</small></div>' + button('run-checks','查看预置核查（演示）','primary') + '</div><div class="panel-body"><article class="check-card"><div class="inline-title"><h3>渠道与期间差异</h3>' + badge('合法并存','green') + '</div><p>直营政策 A 和加盟政策 B 适用渠道不同；2025 与 2026 制度生效期间不同。各自准确来源和版本保持。</p><div class="actions">' + button('legal','对照适用范围与版本','secondary') + '</div></article><article class="check-card"><div class="inline-title"><h3>资格条件的两份断言</h3>' + badge(same?'同范围同期间待核':'1 项疑点待核','amber') + '</div><p>核定对象、渠道、生效期间和来源性质后，才判断是否真正矛盾。资料疑点先保留为核查事项。</p><div class="actions">' + button('dispute','查看两份原始依据','secondary') + button('work-item',state.workItem?'查看已记录工作项':'记录核查工作项（演示）','ghost') + '</div></article><article class="check-card"><div class="inline-title"><h3>概念定义与数据映射</h3>' + badge('按用途核','') + '</div><p>“会员计划关系”定义可作为参考；需要计算交易关联指标时，再核数据键、事件覆盖和 Binding。</p><div class="actions">' + button('binding','查看用途与缺口','secondary') + '</div></article><article class="check-card"><h3>来源与版本依赖</h3><p>本体项、SAP 指标和 Binding 沿原精确引用核对。资料缺失、版本已变与业务争议分别呈现。</p><div class="actions">' + button('source-chain','查看关联与依据','secondary') + '</div></article></div></section><aside class="panel aside-small"><div class="panel-head"><h2>当前处理</h2></div><div class="panel-body"><p>' + (state.workItem?badge('已记录演示工作项','green'):badge('疑点候选')) + '</p><p class="quiet">疑点记录不会自动调用 mark-issue，不撤回原正式资产，不产生企业政策决定。</p><div class="route"><strong>现有四项状态</strong><p>定义、映射、当前可计算、实际使用分别记录；候选／正式身份另列。</p></div><div class="actions">' + button('tab','查看普通任务如何使用','ghost','usage') + '</div></div></aside></div>';
  }
  function usage() {
    const current = usableCoverage() ? '可选盘点参考：正式 r' + state.formalReport : '本次不供给盘点报告';
    const t = state.task;
    return '<section class="panel task-body"><div class="panel-head"><div><h2>普通分析任务</h2><small>沿原企业目录发现、准确读取与工具使用；无需先选格子或填完整表。</small></div>' + badge('普通只读消费') + '</div><div class="panel-body">' + notice('当前情景：' + current + '。正式模型、SAP 和规则继续按原资格可用。') + '<label class="form-label" for="question">业务问题</label><textarea id="question">' + esc(state.question) + '</textarea><div class="actions section">' + button('send','发送演示问题','primary') + button('history','查看原报告 R01','secondary') + '</div>' + (t ? '<div class="chat-message"><strong>预置答复 · 任务 T' + t.number + '</strong><p class="section">' + (t.scenario==='mapping'?'当前可解释正式概念和规则；交易关联数据尚未映射，本次不输出完整指标数值。':t.scenario==='dispute'?'两份同范围断言尚待核定。本次保留争议限制，不替企业选择政策，也不把疑点当作正式源已被撤回。':'可以按正式制度说明会员资格与权益的适用边界。渠道例外决定责任和历史覆盖仍需核定；本情景不推断尚无资料支持的业务事实。') + '</p><p class="result-note">这是一份合成预置答复，没有实际计算或模型输出，不代表专业或用户验收。</p></div><div class="readiness"><div><small>盘点报告</small>' + (t.coverage ? 'r' + t.coverage + ' · 正式参考' : '未读取') + '</div><div><small>正式业务规则</small>资格规则 r1</div><div><small>原 SAP</small>会员定义 1.0.0</div><div><small>使用证据</small>预置轨迹／未实跑</div></div><div class="actions">' + button('use-detail','查看本次来源与工具轨迹','secondary') + button('contribution','沿原任务贡献回补（演示）','ghost') + '</div>' : '<div class="step-note">发送后展示一个可能的 Agent 使用轨迹。其工具选择与顺序不是 Host 固定流水线。</div>') + '<div class="history-current"><h3>新版与历史</h3><p class="quiet">原报告 R01 始终引用盘点 r1／规则 r1／SAP1.0.0。生成新盘点或发布 r2 不回写旧报告。</p><div class="actions">' + button('generate','生成新盘点候选（演示）','secondary') + button('publication','查看原发布入口（演示）','secondary','',noReport()||candidateOnly()||state.selectedReport!==2||!canPublishCandidate()) + '</div></div></div></section>';
  }
  function render() {
    document.body.classList.toggle('dark',state.dark);
    const tabNames=[['coverage','范围与资料'],['checks','联合核查'],['usage','普通任务']];
    app.innerHTML = '<div class="shell"><aside class="sidebar"><div class="brand">OptraCall<small>分析与决策工作台</small></div><nav aria-label="主导航"><div class="nav-label">当前工作</div>' + button('tab','◈ <span>语义与分析资产</span>','nav active','coverage') + button('tab','▤ <span>项目与任务</span>','nav','usage') + button('method','▧ <span>资料与方法</span>','nav') + '</nav><div class="sidebar-foot">企业基础资产<br>现有 Studio 内的按需视图</div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">语义与分析资产 / 企业基础资产</div><div class="top-actions"><span class="enterprise-label">演示企业 A · 运动鞋服</span>' + button('theme',state.dark?'切换浅色':'切换深色','secondary') + '</div></header><div class="ribbon"><strong>合成资料 · 交互演示</strong>　全部状态仅在本页内存；未创建企业、调用模型、读取真实资料或发布产品资产。</div><main id="main-content" class="page" tabindex="-1"><div class="heading"><div><div class="eyebrow">企业基础资产 · 建设与演进</div><h1>业务范围与资料覆盖</h1><p>把经营视角、准确依据和未决事项接到原三类资产，支持建设与后续实际使用。</p></div><div class="actions">' + button('generate','生成盘点候选（演示）','primary') + '</div></div><div class="tabs" role="tablist" aria-label="业务覆盖工作区">' + tabNames.map(x=>'<button type="button" role="tab" id="tab-' + x[0] + '" class="tab ' + (state.tab===x[0]?'active':'') + '" aria-selected="' + (state.tab===x[0]) + '" data-action="tab" data-value="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' + (state.notice?notice(esc(state.notice),'green'):'') + (state.tab==='coverage'?coverage():state.tab==='checks'?checks():usage()) + '<details class="review"><summary>评审情景（仅原型）</summary><label for="scenario">切换预置状态 <select id="scenario">' + scenarios.map(s=>'<option value="' + s[0] + '"' + (state.scenario===s[0]?' selected':'') + '>' + s[1] + '</option>').join('') + '</select></label><div class="actions">' + button('reset','重置本页演示','secondary') + '</div><p class="section">报告 r1 为预置正式参考，r2 为可生成的候选；来源、指纹和业务结果均为合成。情景切换会清除本轮普通任务轨迹。</p></details><footer class="footer"><span>审核候选 v0.1 · 配套方案 v0.2</span><span>当前未开发产品 · 企业基础层未启动</span></footer></main></div></div>';
  }
  function reportDetail() {
    show('盘点报告的身份与用途',notice('报告只保存派生观察与准确引用，不成为第二份业务定义、指标公式或权限规则。') + meta([['报告','DEMO-COVERAGE · r' + state.selectedReport + ' · 合成指纹'],['治理身份',reportFormal()?'正式定义参考用途（预置）':'候选；普通任务不默认供给'],['企业与范围','演示企业 A／运动鞋服共享经营骨架＋会员运营核心'],['依据版本','资料 v1／模型r1／资格规则r1／SAP1.0.0／Bindingr1'],['多种状态','治理身份、资料观察、四项作者状态和独立使用证据分别保留'],['坐标','一个片段可有多个坐标，也可以未标注；当前关注集为14格'],['当前读取',esc(selectedReadStatus())+'；报告治理身份与读取/供给资格分开'],['当前性',state.formalReadStatus==='stale'?'旧正式报告依据已变化，生成候选不会恢复它':'当前合成情景；不代表真实已核'],['原权威','准确原文与公式沿原来源读取，不在报告内复制为可编辑主库']]),button('close','返回','secondary')+(state.formalReport!==null && state.selectedReport!==state.formalReport?button('view-formal','查看原正式报告r'+state.formalReport,'secondary'):''));
  }
  function rowDetail(key) {
    const row=questionRows.find(r=>r.key===key) || questionRows[0];
    show(row.title + '：片段与状态',notice('同一片段可支持多个视角；以下四项是作者记录，独立核验另列。') + '<div class="tag-example">' + (row.coordinates.length?row.coordinates.map(c=>badge(c,'purple')).join(''):badge('未标注 · 依据待核')) + '</div>' + meta([['原始依据',esc(row.source)],['准确定位',esc(row.locator)],['引用版本','DEMO-SOURCE@v1／合成指纹'],['证据性质','合成企业资料，不是标杆政策自动内化'],['范围与期间','演示企业A，指定渠道，2026年度；缺项保持待核']]) + '<h3>原文片段（合成）</h3><blockquote class="quiet cell-meaning">' + esc(row.quote) + '</blockquote><div class="readiness"><div><small>定义</small>作者记录：待核</div><div><small>映射</small>' + (key==='What'?'按计算用途部分待补':'本项按用途核定') + '</div><div><small>当前可计算</small>作者记录：受限</div><div><small>实际使用</small>独立核验：未执行</div></div>' + '<p class="quiet">'+(key==='What'?'本样例计划明确不经营储值业务，储值账户不适用；该结论不是由缺少资料推断。':'')+'候选与正式可并存。没有资料只说明本次未见，不能推断企业不存在该内容；不适用必须说明范围理由。</p>',button('close','返回范围','secondary') + button('source-chain','查看原关联','primary'));
  }
  function methodDetail() {
    const missing=state.methodReadStatus!=='ready';
    show('建设方法资料与授权范围',notice(missing?'指定方法版本暂不可读。保留准确引用和失败信息，不能假称已读；其他原有分析可继续。':'方法作为获准建设输入提供准确版本与可读引用；不要求用户维护机器路径。',missing?'amber':'') + meta([['资料身份','M01／资料盘点方法 v0.2（合成）'],['原稿','研究原稿保留原位置；本页不读取任何个人设备目录'],['受管引用','DEMO-METHOD-M01@0.2／预置只读内容'],['用途','辅助经营范围、证据与缺口盘点；不规定工具调用顺序'],['责任','Host提供可读输入与权限；Agent自主判定内容和必要依赖'],['当前读取',missing?'不可读；未运行读取工具':'本 Demo 仅显示预置片段，实际读取次数未测']]) + '<h3>方法片段（预置）</h3><p class="quiet">先按获准范围查已有资料。缺少证据保持待核，合法范围差异分开记录；必要业务决定集中交人。无需按固定格子顺序或凑条目配额。</p>');
  }
  function generate() {
    if (state.methodReadStatus!=='ready') {
      show('方法输入暂不可读',notice('本情景没有生成盘点结果。先核方法准确版本与授权；Agent也可选择其他获准方法，普通分析仍可继续。','amber'),button('close','返回','secondary')+button('to-usage','继续普通任务','primary'));
      return;
    }
    show('生成盘点候选（演示）','<p>沿原建设任务处理获准资料。Agent 自主盘点和查证；Host 不强制八步流程或逐格填写。</p><label class="form-label section" for="goal">建设目标</label><textarea id="goal">以运动鞋服共享经营骨架＋会员运营核心为范围，核清已有资料、三类资产关联和必要业务决定；无证据保持未知。</textarea><p class="quiet section">此操作只加载合成候选 r2。不会创建真实任务、读企业资料、调用模型或改正式资产。</p>',button('close','取消','secondary')+button('generate-confirm','查看演示候选','primary'),'generate');
  }
  function publication() {
    if (state.selectedReport!==2 || noReport()) {
      show('沿原发布机制核定','<p>先形成可核查的候选报告，再沿既有精确预览与必要发布决定。报告不产生业务资产的自动批准；没有报告也不阻断原分析。</p>');
      return;
    }
    show('原发布预览入口（演示）',notice('本次只模拟盘点报告的定义参考用途；规则r1、SAP1.0.0和模型r1均不变。','amber')+meta([['候选','DEMO-COVERAGE r2'],['用途','范围及证据盘点参考；不赋予规则执行权'],['发布机制','复用原预览、来源资格和准确修订机制；未新增逐格审批'],['引用资格',!canPublishCandidate()?'输入/方法/候选读取状态尚未满足资格，不能借发布报告绕过':'本情景只引用合格模型r1、业务规则r1、SAP1.0.0；不借旧盘点报告作为输入，准确资格按原机制核'],['检查','本 Demo 为预置状态，未做真实业务核验'],['历史','原报告R01仍固定盘点r1，发布不改写其依据']]),button('close','取消','secondary')+button('publish-confirm','确认演示发布此报告','primary','',!canPublishCandidate()),'publication');
  }
  function legal() {
    show('合法范围与历史版本并存',table(['依据','适用条件','本次判断'],[
      ['渠道政策A v1','直营／中国市场／2026有效','与加盟制度适用范围不同'],
      ['渠道政策B v1','加盟／中国市场／2026有效','合法并存；不自动判冲突'],
      ['历史政策 v1','2025期间','作为历史依据保留，不覆盖2026当前制度']
    ].map(r=>r.map(esc)))+'<p class="quiet section">需同时核对象、地区／渠道、有效期间与断言含义；版本数量本身不产生 issue。</p>');
  }
  function dispute() {
    show('同范围断言：先核资料','<p>以下两份合成资料声称同一企业、同一渠道、同一生效期间采用不同资格条件，需回源核实效力与例外。</p>'+table(['资料','定位','断言（合成）'],[['正式制度v1','第2节','状态正常才符合'],['操作表v1','第8行','正常与宽限均符合']].map(r=>r.map(esc)))+notice('此处只形成疑点候选。没有调用 mark-issue、撤回来源或替企业选择政策。','amber'),button('close','返回','secondary')+button('work-item','查看或记录工作项（演示）','primary'));
  }
  function workItem() {
    show(state.workItem?'演示工作项 W01':'记录核查工作项（演示）',meta([['种类','原工作项：待核问题／资料缺口'],['对象与范围','会员资格／演示企业A／同渠道同期间'],['依据','制度v1第2节、操作表v1第8行'],['待核问题','操作表是否旧口径、是否属于合法例外？'],['影响','相关解释保留限制；原正式资产供给资格未自动改变'],['决定责任','由具备业务决定责任的人处理资料不能裁定的取舍'],['后续','若确认正式源有误，再沿原治理与修订机制处理']]),button('close','返回','secondary')+(state.workItem?'':button('save-work','保存演示工作项','primary')),'work');
  }
  function binding() {
    show('映射检查按声明用途展开',table(['内容／用途','映射要求','当前状态'],[
      ['会员计划关系：概念参考','无需把每个概念强制绑定数据字段','定义参考可独立使用'],
      ['交易关联指标：数据计算','需要对象键、事件粒度、数据覆盖及Binding','本情景映射待补，计算用途受限'],
      ['资格规则：规则执行','按原执行用途核准确规则、事实、Binding及真实回执','格坐标不赋予执行资格']
    ].map(r=>r.map(esc)))+'<p class="quiet section">是否需要映射与映射是否完成分别表达；不将“采用了参考项”推成“必须有字段Binding”。</p>');
  }
  function chain() {
    show('原三类资产关联与来源',notice('报告仅引用原权威，当前 UI 展示是合成快照。')+meta([['模型','DEMO-MODEL r1 → item.member / item.store'],['原指标','DEMO-SAP@1.0.0::member_scope；公式留原SAP'],['本体与规则','DEMO-RULE r1；资格与适用条件'],['数据映射','DEMO-BINDING r1；实际计算用途另核'],['普通使用','原catalog/read-source/reason及准确使用记录'],['任务演进','新的疑点沿work-item／contribute回源，不直接改基础层']]));
  }
  function history() {
    show('原报告 R01：历史依据固定',notice('R01是预置历史。新盘点、新发布或当前来源变化均不回写原报告。')+meta([['报告身份','R01／合成历史'],['当时盘点','DEMO-COVERAGE r1／当时准确版本'],['业务依据','规则r1／模型r1／SAP1.0.0／Bindingr1'],['当时限制','例外责任与历史覆盖尚待核'],['当前盘点',(state.formalReport===null?'无当前正式报告':'正式r'+state.formalReport)+'；当前查看r'+(state.selectedReport || '无')],['r1当前读取边界',esc(state.formalReport===1?state.formalReadStatus:state.historyStatus)+'；历史元信息不是当前可读正文或供给证明'],['当前资格','按当前来源核新调用，不能借历史引用恢复失权资料'],['实际核验','未进行真实模型或专业验收']]));
  }
  function useDetail() {
    const t=state.task;if(!t)return;
    show('本次使用依据与预置轨迹',notice('以下是一个可能的 Agent 自主轨迹，不是真实调用记录或固定执行顺序。','amber')+meta([['任务','DEMO-T'+t.number+'／演示企业A／普通只读'],['问题',esc(t.question)],['盘点参考',t.coverage?'准确正式r'+t.coverage:'未读取；未发布／缺失／受限时不默认供给'],['业务源','模型r1／正式资格规则r1／原SAP1.0.0'],['格坐标','没有预先选格；未标注不会限制查读或规则调用'],['执行权','仍按原企业、owner、准确版本及执行用途准入']])+'<h3>预置轨迹</h3><ol class="trace"><li><strong>catalog：发现可用正式源</strong><small>候选报告不混入默认供给。</small></li><li><strong>read-source：读取准确业务定义</strong><small>资料与SAP仍由原权威提供；可选盘点参考只作为范围提示。</small></li><li><strong>reason：按需要核资格规则</strong><small>此Demo没有引擎调用；计算需要时仍由原获准工具完成。</small></li><li><strong>保存答复与限制</strong><small>准确版本固定，业务解释与独立核验分别表达。</small></li></ol>');
  }
  function action(name,value) {
    if(name==='close')return close();
    if(name==='tab'){state.tab=value;state.notice='';render();document.getElementById('tab-'+state.tab)?.focus();return;}
    if(name==='theme'){const ref=capture(document.activeElement);state.dark=!state.dark;render();restore(ref);return;}
    if(name==='clear-search'){state.query='';render();document.getElementById('search')?.focus();return;}
    if(name==='row')return rowDetail(value);
    if(name==='report')return reportDetail();
    if(name==='view-formal'){if(state.formalReport===null)return;state.selectedReport=state.formalReport;close();render();return;}
    if(name==='raw-report')return show('报告原文（合成）',notice('仅原文查看，不意味着格式核验或当前覆盖有效。')+'<pre>'+esc(selectedReadStatus()==='unsupported'?'{"reportProfile":"studio-coverage/9","note":"未知版本原文保留"}':'{"reportProfile":"studio-coverage/1","observations":"损坏示例：这里应为有界数组"}')+'</pre>');
    if(name==='retry-read'){
      if(selectedReadStatus()!=='error')return;
      if(state.selectedReport===state.formalReport)state.formalReadStatus='loading';else state.candidateReadStatus='loading';
      render();return;
    }
    if(name==='load-success'){
      if(!['error','loading'].includes(selectedReadStatus()) || state.methodReadStatus!=='ready')return;
      if(state.selectedReport===state.formalReport){state.formalReadStatus='ready';if(state.formalReport===1)state.historyStatus='ready';}
      else state.candidateReadStatus='ready';
      toast('仅模拟本次读取成功；没有实际读取服务，不更改其他报告或失效来源资格。');render();return;
    }
    if(name==='repair-help')return show('格式与资格的恢复边界','<p>损坏、未知版本或依据失效不会因生成候选、重试或“读取成功”恢复。应由Agent核定适当修复、新受支持修订与准确输入；需要共享时沿原机制发布新合格版本。旧报告与失败依据保留。</p>');
    if(name==='method')return methodDetail();
    if(name==='generate')return generate();
    if(name==='generate-confirm'){if(state.methodReadStatus!=='ready')return;state.selectedReport=2;state.candidateReadStatus='ready';state.query='';close();toast('已加载演示盘点候选r2；旧正式报告的存在性、读取状态和供给资格均未改变。');render();return;}
    if(name==='publication')return publication();
    if(name==='publish-confirm'){if(!canPublishCandidate())return;if(state.formalReport===1)state.historyStatus=state.formalReadStatus;state.formalReport=2;state.formalReadStatus='ready';close();toast('仅模拟发布盘点报告r2；原报告R01和业务规则/SAP版本未改变。');render();return;}
    if(name==='legal')return legal();
    if(name==='dispute')return dispute();
    if(name==='work-item')return workItem();
    if(name==='save-work'){state.workItem=true;close();toast('已记录演示工作项W01；没有标记正式源issue、撤回或业务写回。');render();return;}
    if(name==='binding')return binding();
    if(name==='source-chain')return chain();
    if(name==='run-checks')return show('预置联合核查',table(['检查','本情景观察','实际验证'],[['结构与准确引用','复用现有检查；无坐标也可读','未运行产品校验器'],['范围与时间','合法并存与同范围争议分开','Agent回源判断未实跑'],['用途依赖','按计算/执行用途核必要Mapping','未读取真实数据'],['治理副作用','疑点未自动mark-issue','无任何API调用']].map(r=>r.map(esc))));
    if(name==='focus')return show('调整当前查看关注集','<p>这是本页的查看筛选，不修改已保存报告、原坐标、正式版本或发布资格。所有36个坐标均可选择。</p><div class="scope-filters">'+rows.flatMap((r,i)=>columns.map(c=>{const cell='R'+(i+1)+':'+c[0];return '<label><input type="checkbox" name="focus" value="'+cell+'"'+(state.viewFocus.includes(cell)?' checked':'')+'>'+cell+'</label>';})).join('')+'</div>',button('close','取消','secondary')+button('focus-save','应用查看筛选','primary'),'focus');
    if(name==='focus-save'){state.viewFocus=Array.from(overlay.querySelectorAll('input[name="focus"]:checked')).map(e=>e.value);close();render();document.querySelector('.advanced')?.setAttribute('open','');return;}
    if(name==='cell')return show('坐标 '+value,'<p>视角：'+rows[Number(value[1])-1]+'；关注问题：'+esc(columns.find(c=>c[0]===value.split(':')[1])[1])+'。</p><p class="quiet">坐标说明看什么，不表示资产成熟度、实施步骤或发布资格。未纳入本次关注集不等于不适用。运行实例可作为准确来源证据关联。</p>'+button('row','查看相关片段（合成）','secondary',value.split(':')[1]));
    if(name==='contract')return show('派生盘点报告：待审最小约定',notice('此结构是拟议增量，当前产品尚未实现。')+meta([['保存位置','复用现有business类Studio资产body及准确修订'],['报告格式','可选 reportProfile: studio-coverage/1'],['内容','范围、关注集、片段准确引用、观察、问题及独立状态'],['保持原样','FoundationItem、studio-foundation/1与/2、SAP0.2及原SourceRef权威'],['非目标','不建全局坐标库，不在报告里另存可编辑业务定义或公式'],['兼容','没有报告、没有坐标的原资产与普通任务照常使用']]));
    if(name==='to-usage'){close();state.tab='usage';render();return;}
    if(name==='send'){state.question=document.getElementById('question').value;state.taskNumber+=1;state.task={number:state.taskNumber,question:state.question,coverage:usableCoverage()?state.formalReport:null,scenario:state.scenario};render();announce.textContent='已展示预置答复与来源轨迹；没有模型调用。';return;}
    if(name==='history')return history();
    if(name==='use-detail')return useDetail();
    if(name==='contribution')return show('沿原任务贡献回补（演示）','<p>把本次问题、准确报告和来源作为贡献候选。沿原contribute及建设任务核定，不直接修改基础层正式定义。</p><p class="quiet">本原型未保存贡献、运行维护任务或改变企业政策。</p>');
    if(name==='reset'){state=initial();close();render();return;}
  }
  document.addEventListener('click',e=>{const el=e.target.closest('[data-action]');if(el && !el.disabled)action(el.dataset.action,el.dataset.value || '');});
  document.addEventListener('input',e=>{
    if(e.target.id==='question')state.question=e.target.value;
    if(e.target.id==='search'){
      const pos=e.target.selectionStart;state.query=e.target.value;render();
      const input=document.getElementById('search');if(input){input.focus();input.setSelectionRange(pos,pos);}
    }
  });
  document.addEventListener('change',e=>{
    if(e.target.id==='scenario'){
      const dark=state.dark, chosen=e.target.value;state=initial();state.dark=dark;state.scenario=chosen;
      const presets={
        normal:{},
        none:{selectedReport:null,formalReport:null,formalReadStatus:'missing',historyStatus:'missing'},
        candidate:{selectedReport:2,formalReport:null,formalReadStatus:'missing',historyStatus:'missing'},
        stale:{formalReadStatus:'stale',candidateInputsEligible:false,historyStatus:'stale'},
        method:{formalReadStatus:'error',methodReadStatus:'error',candidateInputsEligible:false,historyStatus:'error'},
        loading:{formalReadStatus:'loading',historyStatus:'loading'},
        error:{formalReadStatus:'error',historyStatus:'error'},
        format:{formalReadStatus:'corrupt',candidateInputsEligible:false,historyStatus:'corrupt'},
        unsupported:{formalReadStatus:'unsupported',candidateInputsEligible:false,historyStatus:'unsupported'},
        candidateInput:{selectedReport:2,candidateInputsEligible:false},
        emptySearch:{query:'无匹配的合成视角'}
      };
      Object.assign(state,presets[chosen] || {});
      render();document.getElementById('scenario')?.focus();
    }
  });
  document.addEventListener('keydown',e=>{
    if(e.target.getAttribute('role')==='tab' && ['ArrowLeft','ArrowRight'].includes(e.key)){
      e.preventDefault();const tabs=['coverage','checks','usage'];let i=tabs.indexOf(state.tab);i=(i+(e.key==='ArrowRight'?1:-1)+3)%3;state.tab=tabs[i];render();document.getElementById('tab-'+state.tab).focus();
    }
  });
  overlay.addEventListener('cancel',e=>{e.preventDefault();close();});
  overlay.addEventListener('click',e=>{if(e.target===overlay){const r=overlay.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
  render();
})();
