/* REVIEW PROTOTYPE — synthetic, memory-only. No product API, model, SDK or storage. */
(() => {
  'use strict';
  const app = document.getElementById('app');
  const overlay = document.getElementById('overlay');
  const announce = document.getElementById('announce');
  const fixture = globalThis.COVERAGE_FIXTURE;
  const columns = fixture.columns;
  const rows = fixture.rows.map(r=>r.name);
  const defaultFocus = fixture.focusCells.slice();
  const keyOf = record => record.id + '@' + record.version;
  const unique = values => Array.from(new Set(values));
  const sourcesByKey = new Map(fixture.sources.map(r=>[keyOf(r),r]));
  const assetsByKey = new Map(fixture.assets.map(r=>[keyOf(r),r]));
  const cells = fixture.rows.flatMap((row,r)=>columns.map((col,c)=>({coord:'R'+(r+1)+':'+col[0],row:r,column:col[0],title:row.titles[c]})));
  const cellByCode = new Map(cells.map(cell=>[cell.coord,cell]));
  const fragmentsFor = coord => fixture.fragments.filter(fragment=>fragment.cells.includes(coord));
  const sourceKeysFor = coord => unique(fragmentsFor(coord).map(fragment=>fragment.source));
  const assetKeysFor = coord => unique(fixture.cellAssets[coord] || []);
  const coordsForSource = key => unique(fixture.fragments.filter(fragment=>fragment.source===key).flatMap(fragment=>fragment.cells));
  const coordsForAsset = key => cells.filter(cell=>assetKeysFor(cell.coord).includes(key)).map(cell=>cell.coord);
  const allSourceKeys = () => unique(fixture.sources.map(keyOf));
  const allAssetKeys = () => unique(cells.flatMap(cell=>assetKeysFor(cell.coord)));
  const kindCount = kind => allAssetKeys().filter(key=>assetsByKey.get(key).kind===kind).length;
  const scenarios = [['normal','正常：正式与候选并存'],['none','没有盘点报告'],['candidate','仅有候选盘点报告'],['method','方法资料暂不可读'],['stale','依据已变化／历史查看'],['mapping','数据计算缺映射'],['dispute','同范围同期间有争议'],['emptySearch','资料搜索无结果'],['loading','读取中'],['error','读取失败'],['format','报告格式损坏'],['unsupported','未知报告版本'],['candidateInput','报告含候选输入']];
  const initial = () => ({
    tab:'coverage', inventoryTab:'sources', scenario:'normal', dark:false, query:'', selectedReport:1, formalReport:1, formalReadStatus:'ready', candidateReadStatus:'ready', candidateInputsEligible:true, methodReadStatus:'ready', historyStatus:'ready',
    workItem:false, viewFocus:defaultFocus.slice(),
    task:null, taskNumber:0, notice:'',
    question:'请说明会员资格与权益的适用边界，并列出当前需要核定的事项。'
  });
  let state = initial(), returnFocus = null, modal = '';
  const esc = x => String(x == null ? '' : x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const badge = (t, tone='') => '<span class="badge ' + tone + '">' + esc(t) + '</span>';
  const button = (action,label,cls='secondary',value='',disabled=false) => '<button type="button" class="' + cls + '" data-action="' + action + '" data-value="' + esc(value) + '"' + (disabled?' disabled':'') + '>' + label + '</button>';
  const notice = (text,tone='') => '<div class="notice ' + tone + '" role="status">' + text + '</div>';
  const table = (heads, data, cls='') => '<div class="table-wrap" tabindex="0" aria-label="可横向滚动的资料表格"><table class="' + cls + '"><thead><tr>' + heads.map(h=>'<th scope="col">' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + data.map(r=>'<tr>' + r.map((c,i)=>(i===0 && cls.includes('panorama')?'<th scope="row">':'<td>') + c + (i===0 && cls.includes('panorama')?'</th>':'</td>')).join('') + '</tr>').join('') + '</tbody></table></div>';
  const meta = data => '<dl class="meta-list">' + data.map(r=>'<dt>' + esc(r[0]) + '</dt><dd>' + r[1] + '</dd>').join('') + '</dl>';
  const noReport = () => state.selectedReport === null;
  const candidateOnly = () => state.formalReport === null && state.selectedReport !== null;
  const reportFormal = () => !candidateOnly() && state.formalReport === state.selectedReport;
  const usableCoverage = () => state.formalReport !== null && state.formalReadStatus === 'ready';
  const selectedReadStatus = () => state.selectedReport === state.formalReport ? state.formalReadStatus : state.candidateReadStatus;
  const canPublishCandidate = () => state.selectedReport === 2 && state.candidateReadStatus === 'ready' && state.candidateInputsEligible && state.methodReadStatus === 'ready';
  const canViewEvidence = () => selectedReadStatus()==='ready' && state.methodReadStatus==='ready' && (state.selectedReport===state.formalReport || state.candidateInputsEligible);
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
    return '<div class="method"><strong>本次建设方法</strong><p>资料盘点方法 v0.2 · 获准方法引用 method.survey@0.2（另计）<br>用途：范围检查与证据盘点，不是正式企业政策。</p>' + badge(fail?'暂不可读':'准确版本已指定',fail?'amber':'') + '<div class="actions section">' + button('method','查看来源与使用范围','ghost') + '</div></div>';
  }
  function summary() {
    const available=canViewEvidence();
    return '<div class="summary"><div><small>框架与首批范围</small><strong>'+cells.length+'格全景 · 首批参考'+unique(fixture.focusCells).length+'格</strong><p>14是首批关注建议；另22格保持可见。不是资料数量或完成进度。</p></div><div><small>本报告业务资料 · 方法另计</small><strong>'+(available?allSourceKeys().length+'个准确资料版本':'未知／尚不可展示')+'</strong><p>按资料身份＋版本去重，同名不同版本分开；一版多格只计一次。</p>'+button('inventory','查看资料版本清单','ghost','sources')+'</div><div><small>本报告三类关联资产 · 不与资料相加</small><strong>'+(available?allAssetKeys().length+'项准确资产修订':'未知／尚不可展示')+'</strong><p>'+(available?'主数据'+kindCount('主数据')+'／指标体系'+kindCount('指标体系')+'／本体'+kindCount('本体')+'；按资产身份＋版本去重。':'原资产和普通分析仍按原资格可用，不把不可读当作0。')+'</p>'+button('inventory','查看三类资产清单','ghost','assets')+'</div></div>';
  }
  function reportStateNotice() {
    if(noReport())return notice('没有当前盘点报告。下方36格仅是框架解释，企业证据、资产关联和报告数量均未知；首批14格只作预置参考建议。','amber');
    if(!canViewEvidence()){
      const status=selectedReadStatus();
      let actions='';
      if(state.methodReadStatus!=='ready')actions=button('method','查看不可读的方法资料','secondary')+button('repair-help','查看修复边界','ghost');
      else if(status==='error')actions=button('retry-read','重试读取（演示）','secondary');
      else if(status==='loading')actions=button('load-success','查看演示读取成功','secondary');
      else if(['corrupt','unsupported'].includes(status))actions=button('raw-report','查看报告原文（合成）','secondary')+button('repair-help','查看修复边界','ghost');
      else actions=button('repair-help','查看修复边界','secondary');
      return notice('当前查看 '+esc(reportLabel(state.selectedReport))+'，读取状态 '+esc(status)+'。未获得可展示的报告依据，格详情只解释框架含义，资料／资产数量显示未知。生成候选不恢复旧正式报告资格。','amber')+'<div class="actions section">'+actions+button('tab','继续普通任务','ghost','usage')+'</div>';
    }
    return notice('当前查看 '+esc(reportLabel(state.selectedReport))+' · '+(reportFormal()?'正式参考':'建设侧候选')+'。各格计数会重复引用同一资料或资产；全局合计按准确版本重新去重，不能逐格或逐列相加。');
  }
  function coverage() {
    const data=fixture.rows.map((row,r)=>['<strong>R'+(r+1)+' '+esc(row.name)+'</strong><small>'+esc(row.english)+'</small>'].concat(columns.map(col=>{
      const coord='R'+(r+1)+':'+col[0], cell=cellByCode.get(coord), first=fixture.focusCells.includes(coord), viewed=state.viewFocus.includes(coord);
      const counts=canViewEvidence()?sourceKeysFor(coord).length+'资料版本 · '+assetKeysFor(coord).length+'资产':'资料未知 · 资产未知';
      return '<button type="button" data-action="cell" data-value="'+coord+'" class="cell-button '+(first?'first-focus ':'')+(viewed?'view-focus':'')+'" aria-label="'+esc(coord+' '+cell.title)+'"><span class="cell-code">'+coord+'</span><strong>'+esc(cell.title)+'</strong><span class="cell-scope">'+(first?'首批参考关注':'本轮未重点建设')+'</span><span class="cell-count">'+counts+'</span></button>';
    })));
    return summary()+reportStateNotice()+'<section class="panel"><div class="panel-head"><div><h2>36格全景</h2><small>'+esc(fixture.scope)+'。每格可查看具体含义与本报告的逐格依据；框架解释不是企业事实。</small></div><div class="actions">'+button('focus','调整查看高亮','secondary')+button('report','报告身份与版本','ghost')+'</div></div><div class="panel-body"><div class="matrix-legend"><span>'+badge('首批参考关注 '+unique(fixture.focusCells).length+' 格','purple')+'</span><span>'+badge('当前查看高亮 '+unique(state.viewFocus).length+' 格')+'</span><span class="quiet">查看高亮不改首批范围；其余格未重点建设不代表不适用、缺资料或未完成。</span></div>'+table(['行视角'].concat(columns.map(c=>c[0]+' '+c[1])),data,'matrix panorama')+'<p class="quiet section">窄屏可在矩阵容器内横向滚动，保留完整6列。坐标解释依照不同具体化视角，R1／R2／R6同列不共用企业证据。</p><div class="actions">'+button('generate','生成盘点候选（演示）','primary')+button('contract','查看最小报告约定','ghost')+'</div></div></section>';
  }
  function sourceRows(keys) {
    return keys.map(key=>{const r=sourcesByKey.get(key), related=coordsForSource(key);return [button('material',esc(r.title),'row-link',key)+'<small>'+esc(key)+'</small>',esc(r.period),related.length?related.map(c=>badge(c)).join(' '):badge('未标注'),button('material','查看片段与反向坐标','ghost',key)];});
  }
  function assetRows(keys) {
    return keys.map(key=>{const r=assetsByKey.get(key);return [button('asset',esc(r.title),'row-link',key)+'<small>'+esc(key)+'</small>',esc(r.kind),coordsForAsset(key).map(c=>badge(c)).join(' '),button('asset','查看准确资产关联','ghost',key)];});
  }
  function inventory() {
    const available=canViewEvidence(), q=state.query.toLowerCase();
    const sourceMatches=allSourceKeys().filter(key=>{const r=sourcesByKey.get(key);return (key+r.title+r.period).toLowerCase().includes(q);});
    const assetMatches=allAssetKeys().filter(key=>{const r=assetsByKey.get(key);return (key+r.title+r.kind).toLowerCase().includes(q);});
    let content='';
    if(!available)content='<div class="empty"><h3>本报告的资料与资产清单未知</h3><p>当前不能展示其证据、片段或计数。静态36格含义可查看，普通分析仍可沿原资产资格继续。</p>'+button('tab','查看框架全貌','secondary','coverage')+button('tab','进入普通任务','ghost','usage')+'</div>';
    else if(state.inventoryTab==='sources')content='<p class="quiet">报告共'+allSourceKeys().length+'个资料准确版本；当前匹配'+sourceMatches.length+'个。资料多格复用不重复计入总数；建设方法 method.survey@0.2 另列，不算业务资料。</p>'+(sourceMatches.length?table(['资料准确版本','适用期间','已关联坐标','反向查看'],sourceRows(sourceMatches),'inventory-table'):'<div class="empty"><h3>没有匹配资料</h3><p>仅当前筛选为空，不代表报告没有资料。</p>'+button('clear-search','清除搜索','secondary')+'</div>');
    else if(state.inventoryTab==='assets')content='<p class="quiet">报告关联'+allAssetKeys().length+'项准确资产修订，三类各'+kindCount('主数据')+'项。资产与资料是不同集合，不能相加成总资料数；当前匹配'+assetMatches.length+'项。</p>'+(assetMatches.length?table(['资产准确修订','类别','已关联坐标','反向查看'],assetRows(assetMatches),'inventory-table'):'<div class="empty"><h3>没有匹配资产</h3>'+button('clear-search','清除搜索','secondary')+'</div>');
    else content='<p class="quiet">按六问汇总本报告的相关资料与资产。不同列会引用同一准确版本，各列计数不能相加为全局合计。</p>'+table(['关注问题','相关资料版本','相关资产修订','查看该列引用'],columns.map(col=>{const coords=cells.filter(c=>c.column===col[0]).map(c=>c.coord), sk=unique(coords.flatMap(sourceKeysFor)),ak=unique(coords.flatMap(assetKeysFor));return ['<strong>'+col[0]+' '+esc(col[1])+'</strong>',String(sk.length),String(ak.length),button('column','查看明确标注的引用','ghost',col[0])];}),'inventory-table');
    return summary()+reportStateNotice()+'<section class="panel"><div class="panel-head"><div><h2>资料与资产</h2><small>准确版本、片段和坐标之间的显式对应；不按名称推断关联。</small></div>'+button('method','建设方法（另计）','secondary')+'</div><div class="panel-body"><div class="subtabs" aria-label="资料与资产类别">'+[['sources','资料版本'],['assets','三类资产'],['columns','六问摘要']].map(t=>button('inventory-tab',t[1],'filter '+(state.inventoryTab===t[0]?'active':''),t[0])).join('')+'</div><div class="search-row"><label class="sr-only" for="search">搜索准确资料或资产</label><input id="search" type="search" value="'+esc(state.query)+'" placeholder="搜索名称、准确版本或类别…" autocomplete="off"></div>'+content+'</div></section>';
  }
  function coordButtons(coords) {
    return coords.length?'<div class="coordinate-links">'+coords.map(coord=>button('cell',esc(coord+' '+cellByCode.get(coord).title),'secondary',coord)).join('')+'</div>':badge('未标注；未自动补格');
  }
  function fragmentMarkup(fragments) {
    return fragments.length?fragments.map(f=>{const source=sourcesByKey.get(f.source);return '<article class="fragment-record"><strong>'+esc(f.id+' · '+source.title+' @'+source.version)+'</strong><small>'+esc(f.locator)+'</small><p>'+esc(f.text)+'</p><p class="quiet">标注依据：'+esc(f.reason)+'</p><div class="row-actions">'+button('material','反查此资料准确版本','ghost',f.source)+coordButtons(f.cells)+'</div></article>';}).join(''):'<p class="quiet">本报告未标注此格证据。是否已调查、是否需要补资料尚未核定，不能推断企业不存在相关内容。</p>';
  }
  function cellDetail(coord) {
    const cell=cellByCode.get(coord);if(!cell)return;
    const phase=['界定纳入的要素清单与范围。','用业务语言明确经营含义。','描述不依赖具体技术选型的逻辑模型。','描述受到实现技术约束的规格。','描述可配置的部件与映射定义。','关联实际存在或实际发生的实例证据。'][cell.row];
    let body=meta([['稳定坐标',esc(coord)],['具体含义',esc(cell.title)+'。'+phase],['本轮边界',fixture.focusCells.includes(coord)?'首批参考关注；不是单格完成或发布状态':'本轮未重点建设；仍可了解、登记或关联证据，不自动变不适用'],['当前查看',esc(reportLabel(state.selectedReport || '未知'))+'／'+esc(selectedReadStatus())]]);
    if(!canViewEvidence())body+=notice('当前报告不可展示：本格资料、资产和数量均未知。以下不加载上次成功的企业证据。','amber');
    else {
      const sk=sourceKeysFor(coord),ak=assetKeysFor(coord),fr=fragmentsFor(coord);
      body+='<h3>本格准确对应</h3><p class="quiet">'+sk.length+'个资料版本／'+fr.length+'个片段／'+ak.length+'项资产；都是本格显式标注，不按列名兜底。</p>'+fragmentMarkup(fr)+'<h3>三类关联资产</h3>'+(ak.length?table(['准确资产','类别','反查'],ak.map(key=>{const a=assetsByKey.get(key);return [esc(a.title)+'<small>'+esc(key)+'</small>',esc(a.kind),button('asset','查看此资产坐标','ghost',key)];})):'<p class="quiet">本报告未标注此格资产关联。</p>')+'<h3>并列观察与限制</h3><ul class="quiet">'+(fixture.observations[coord] || ['本报告未记录此格观察。调查状态和业务适用性仍未知。']).map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul><p class="quiet">本格不设资产四维状态。定义、映射、可计算与实际使用须按关联资产的准确修订回原记录核定；本演示未核验，不能用格子或证据数量推断成熟度。</p>';
    }
    show(coord+' · '+cell.title,body);
  }
  function materialDetail(key) {
    if(!canViewEvidence()){show('资料证据当前未知',notice('当前报告尚未可读，不展示缓存的资料、片段或数量。','amber'));return;}
    const r=sourcesByKey.get(key);if(!r)return;
    const fs=fixture.fragments.filter(f=>f.source===key),coords=coordsForSource(key),ak=allAssetKeys().filter(a=>assetsByKey.get(a).sources.includes(key));
    show('资料：'+r.title+' @'+r.version,meta([['准确身份',esc(key)],['适用期间',esc(r.period)],['证据性质',esc(r.nature)],['计数口径','此准确版本全局计1次；多片段、多格不重复计入'],['标注状态',coords.length?'有显式坐标关联':esc(r.unannotatedReason || '未标注')]])+'<h3>反向关联坐标</h3>'+coordButtons(coords)+'<h3>本版本片段</h3>'+fragmentMarkup(fs)+'<h3>关联原资产</h3>'+(ak.length?assetRows(ak).map(row=>'<p>'+row[0]+' '+row[1]+'</p>').join(''):'<p class="quiet">本资料版本尚未标注与这6项资产的关系。</p>'));
  }
  function assetDetail(key) {
    if(!canViewEvidence()){show('资产关联当前未知',notice('当前报告尚未可读，不展示缓存的资产或数量。','amber'));return;}
    const a=assetsByKey.get(key);if(!a)return;
    show('资产：'+a.title+' @'+a.version,meta([['准确身份',esc(key)],['三类归属',esc(a.kind)],['原权威',esc(a.meaning)],['治理身份','正式业务资产（合成；准确修订见上）；盘点候选不改变其资格'],['计数口径','同一资产修订关联多格，全局仍计1项']])+'<h3>反向关联坐标</h3>'+coordButtons(coordsForAsset(key))+'<h3>准确原资料</h3>'+table(['资料准确版本','适用期间','反查'],a.sources.map(sk=>{const r=sourcesByKey.get(sk);return [esc(r.title)+'<small>'+esc(sk)+'</small>',esc(r.period),button('material','查看片段与坐标','ghost',sk)];})));
  }
  function columnDetail(column) {
    if(!canViewEvidence()){show(column+'：依据未知',notice('框架问题可以解释，当前报告证据和数量不可展示。','amber'));return;}
    const coords=cells.filter(c=>c.column===column).map(c=>c.coord), sk=unique(coords.flatMap(sourceKeysFor)),ak=unique(coords.flatMap(assetKeysFor));
    show(column+'：六问摘要',notice('以下仅汇总这些坐标明确标注的记录；单格请回到完整全景查看，不同视角不合并成同一证据。')+coordButtons(coords)+'<h3>'+sk.length+'个准确资料版本</h3>'+table(['资料','期间','反查'],sk.map(key=>{const r=sourcesByKey.get(key);return [esc(r.title)+'<small>'+esc(key)+'</small>',esc(r.period),button('material','查看准确版本','ghost',key)];}))+'<h3>'+ak.length+'项资产修订</h3>'+table(['资产','类别','反查'],ak.map(key=>{const a=assetsByKey.get(key);return [esc(a.title)+'<small>'+esc(key)+'</small>',esc(a.kind),button('asset','查看资产坐标','ghost',key)];})));
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
    const tabNames=[['coverage','36格全景'],['data','资料与资产'],['checks','联合核查'],['usage','普通使用']];
    app.innerHTML = '<div class="shell"><aside class="sidebar"><div class="brand">OptraCall<small>分析与决策工作台</small></div><nav aria-label="主导航"><div class="nav-label">当前工作</div>' + button('tab','◈ <span>语义与分析资产</span>','nav active','coverage') + button('tab','▤ <span>项目与任务</span>','nav','usage') + button('method','▧ <span>资料与方法</span>','nav') + '</nav><div class="sidebar-foot">企业基础资产<br>现有 Studio 内的按需视图</div></aside><div class="workspace"><header class="topbar"><div class="breadcrumb">语义与分析资产 / 企业基础资产</div><div class="top-actions"><span class="enterprise-label">演示企业 A · 运动鞋服</span>' + button('theme',state.dark?'切换浅色':'切换深色','secondary') + '</div></header><div class="ribbon"><strong>合成资料 · 交互演示</strong>　全部状态仅在本页内存；未创建企业、调用模型、读取真实资料或发布产品资产。</div><main id="main-content" class="page" tabindex="-1"><div class="heading"><div><div class="eyebrow">企业基础资产 · 建设与演进</div><h1>企业语义与分析资产全景</h1><p>完整36格保持可见，首批重点与准确资料、三类资产各自有据；建设和普通使用沿原机制。</p></div><div class="actions">' + button('generate','生成盘点候选（演示）','primary') + '</div></div><div class="tabs" role="tablist" aria-label="业务覆盖工作区">' + tabNames.map(x=>'<button type="button" role="tab" id="tab-' + x[0] + '" class="tab ' + (state.tab===x[0]?'active':'') + '" aria-selected="' + (state.tab===x[0]) + '" data-action="tab" data-value="' + x[0] + '">' + x[1] + '</button>').join('') + '</div>' + (state.notice?notice(esc(state.notice),'green'):'') + (state.tab==='coverage'?coverage():state.tab==='data'?inventory():state.tab==='checks'?checks():usage()) + '<details class="review"><summary>评审情景（仅原型）</summary><label for="scenario">切换预置状态 <select id="scenario">' + scenarios.map(s=>'<option value="' + s[0] + '"' + (state.scenario===s[0]?' selected':'') + '>' + s[1] + '</option>').join('') + '</select></label><div class="actions">' + button('reset','重置本页演示','secondary') + '</div><p class="section">情景只初始化业务状态，动作在内存中演进。r1为预置正式参考，r2为候选；本版数字来自显式合成记录，未运行产品或模型。</p></details><footer class="footer"><span>审核候选 v0.2 · 配套方案 v0.3</span><span>当前未开发产品 · 企业基础层未启动</span></footer></main></div></div>';
  }
  function reportDetail() {
    show('盘点报告的身份与范围',notice('36格是固定框架，首批参考14是预置建议；报告资料、资产和关注数须在可读报告中核定。')+meta([['报告',noReport()?'尚无当前报告':reportLabel(state.selectedReport)+'／合成身份'],['治理身份',noReport()?'未知':reportFormal()?'正式参考':'建设侧候选'],['当前读取',esc(selectedReadStatus())],['企业范围',esc(fixture.scope)],['报告关注集',canViewEvidence()?unique(fixture.focusCells).length+'格（合成报告）':'未知；参考建议仍可查看'],['业务资料版本',canViewEvidence()?String(allSourceKeys().length):'未知'],['三类资产修订',canViewEvidence()?String(allAssetKeys().length):'未知'],['临时查看高亮',state.viewFocus.length+'格，仅影响当前查看'],['方法输入','method.survey@0.2，另计；不是一份业务资料'],['版本与资格','生成候选不恢复旧正式读取状态、来源资格或供给。']]),button('close','返回','secondary')+(state.formalReport!==null && state.selectedReport!==state.formalReport?button('view-formal','查看原正式报告r'+state.formalReport,'secondary'):''));
  }
  function methodDetail() {
    const missing=state.methodReadStatus!=='ready';
    show('建设方法资料与授权范围',notice(missing?'指定方法版本暂不可读。保留准确引用和失败信息，不能假称已读；其他原有分析可继续。':'方法作为获准建设输入提供准确版本与可读引用；不要求用户维护机器路径。',missing?'amber':'') + meta([['资料身份','method.survey@0.2／资料盘点方法（合成）'],['原稿','研究原稿保留原位置；本页不读取任何个人设备目录'],['受管引用','method.survey@0.2／预置只读内容'],['用途','辅助经营范围、证据与缺口盘点；不规定工具调用顺序'],['责任','Host提供可读输入与权限；Agent自主判定内容和必要依赖'],['当前读取',missing?'不可读；未运行读取工具':'本 Demo 仅显示预置片段，实际读取次数未测']]) + '<h3>方法片段（预置）</h3><p class="quiet">先按获准范围查已有资料。缺少证据保持待核，合法范围差异分开记录；必要业务决定集中交人。无需按固定格子顺序或凑条目配额。</p>');
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
      ['doc.member-policy@2025.1','2025有效期间／片段P12','与2026版本期间不同，合法并存'],
      ['doc.member-policy@2026.1','2026有效期间／片段P13','不因名称相同合并准确版本'],
      ['doc.channel@1','渠道归属／片段P05','渠道差异应先核范围']
    ].map(r=>r.map(esc)))+'<p class="quiet section">需同时核对象、地区／渠道、有效期间与断言含义；版本数量本身不产生 issue。</p>');
  }
  function dispute() {
    show('同范围断言：先核资料','<p>以下两份合成资料声称同一企业、同一渠道、同一生效期间采用不同资格条件，需回源核实效力与例外。</p>'+table(['资料','定位','断言（合成）'],[['doc.member-policy@2026.1','第2节／片段P13','状态正常才符合'],['doc.metrics@1','第3节／片段P21','包含宽限，待核是否旧稿或例外']].map(r=>r.map(esc)))+notice('此处只形成疑点候选。没有调用 mark-issue、撤回来源或替企业选择政策。','amber'),button('close','返回','secondary')+button('work-item','查看或记录工作项（演示）','primary'));
  }
  function workItem() {
    show(state.workItem?'演示工作项 W01':'记录核查工作项（演示）',meta([['种类','原工作项：待核问题／资料缺口'],['对象与范围','会员资格／演示企业A／同渠道同期间'],['依据','doc.member-policy@2026.1／P13、doc.metrics@1／P21'],['待核问题','操作表是否旧口径、是否属于合法例外？'],['影响','相关解释保留限制；原正式资产供给资格未自动改变'],['决定责任','由具备业务决定责任的人处理资料不能裁定的取舍'],['后续','若确认正式源有误，再沿原治理与修订机制处理']]),button('close','返回','secondary')+(state.workItem?'':button('save-work','保存演示工作项','primary')),'work');
  }
  function binding() {
    show('映射检查按声明用途展开',table(['内容／用途','映射要求','当前状态'],[
      ['会员计划关系：概念参考','无需把每个概念强制绑定数据字段','定义参考可独立使用'],
      ['交易关联指标：数据计算','需要对象键、事件粒度、数据覆盖及Binding','本情景映射待补，计算用途受限'],
      ['资格规则：规则执行','按原执行用途核准确规则、事实、Binding及真实回执','格坐标不赋予执行资格']
    ].map(r=>r.map(esc)))+'<p class="quiet section">是否需要映射与映射是否完成分别表达；不将“采用了参考项”推成“必须有字段Binding”。</p>');
  }
  function chain() {
    if(!canViewEvidence()){show('本报告的关联当前未知',notice('当前报告不可读，不展示其资产关联或数量。普通分析仍按原正式资产资格继续。','amber'));return;}
    show('原三类资产关联与来源',notice('以下只展示本报告显式关联的准确资产；含义、公式和来源仍归原权威。')+table(['准确资产修订','类别','已关联坐标','反查'],assetRows(allAssetKeys()),'inventory-table'));
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
    if(name==='column')return columnDetail(value);
    if(name==='material')return materialDetail(value);
    if(name==='asset')return assetDetail(value);
    if(name==='inventory'){state.tab='data';state.inventoryTab=value;render();return;}
    if(name==='inventory-tab'){state.inventoryTab=value;state.query='';render();return;}
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
    if(name==='focus-save'){state.viewFocus=Array.from(overlay.querySelectorAll('input[name="focus"]:checked')).map(e=>e.value);close();render();return;}
    if(name==='cell')return cellDetail(value);
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
      if(chosen==='emptySearch')state.tab='data';
      render();document.getElementById('scenario')?.focus();
    }
  });
  document.addEventListener('keydown',e=>{
    if(e.target.getAttribute('role')==='tab' && ['ArrowLeft','ArrowRight'].includes(e.key)){
      e.preventDefault();const tabs=['coverage','data','checks','usage'];let i=tabs.indexOf(state.tab);i=(i+(e.key==='ArrowRight'?1:-1)+4)%4;state.tab=tabs[i];render();document.getElementById('tab-'+state.tab).focus();
    }
  });
  overlay.addEventListener('cancel',e=>{e.preventDefault();close();});
  overlay.addEventListener('click',e=>{if(e.target===overlay){const r=overlay.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)close();}});
  render();
})();
