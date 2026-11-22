'use strict';
const $ = selector => document.querySelector(selector);
const screen = $('#screen');
const dialog = $('#dialog');
const initial = () => ({page:'start', started:false, selected:false, goal:broad, project:0,
  scope:'', published:0, oldTask:false, newTask:false, feedback:false, revised:false, check:false,
  role:'总部月报', issue:'', receipts:'ok', recovered:false, sourceFilter:'全部', search:'',
  extraUses:[], activeUse:'', reports:[], reportId:'', feedbackId:'', feedbackSources:[], hasPanorama:false, archive:false, currentTask:1, basisTab:0, addedEvidence:false});
let s = initial();
let returnFocus, toastTimer;
const esc = str => String(str).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const btn = (t,a,kind='',disabled=false) => '<button type="button" data-act="'+a+'" class="'+kind+'"'+(disabled?' disabled':'')+'>'+t+'</button>';
const label = (t,kind='') => '<span class="status '+kind+'">'+t+'</span>';
const row = (key,value) => '<dt>'+key+'</dt><dd>'+value+'</dd>';
const details = (title,body,open=false) => '<details'+(open?' open':'')+'><summary>'+title+'</summary><div>'+body+'</div></details>';
const tbl = (headers,rows) => '<div class="tablebox" role="region" aria-label="'+esc(headers.join('、'))+'" tabindex="0"><table><thead><tr>'+headers.map(h=>'<th scope="col">'+h+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+r.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const panel = (title,body) => '<section class="panel"><h3>'+title+'</h3>'+body+'</section>';
const pnames = ['会员资产建设','品牌经营复盘'];
const v = n => 'v1.'+(n-1);
const mapVer = n => n===1?'r3':'r4';
const result = n => (s.scope==='same'? (n===1?2:1):(n===1?3:2));
const pct = n => (result(n)*25)+'%';
const originalReady = () => s.receipts==='ok'||s.recovered;
const done = () => s.published===2||originalReady();
const reading = () => s.reports.find(r=>r.id===s.reportId);
function openReport(id){const rec=s.reports.find(r=>r.id===id);if(!rec)return;s.reportId=id;s.currentTask=rec.version;go('answer')}
const firstReport = ver => s.reports.find(r=>r.version===ver);
const isAnalysis = () => ['ask','answer'].includes(s.page);
const stageName = () => ({start:'覆盖与缺口',panorama:'覆盖与缺口',draft:'建设与演进',preview:'发布与使用',receipts:'发布与使用',revision:'建设与演进',history:'发布与使用',archive:'建设与演进',other:'建设与演进'}[s.page]||'');
const starter = () => s.activeUse?'other':s.selected?'draft':s.hasPanorama?'panorama':'start';
function toast(t){clearTimeout(toastTimer);$('#notice').textContent=t;$('#notice').className='toast';toastTimer=setTimeout(()=>{$('#notice').className='';$('#notice').textContent=''},2600)}
function go(page){if(s.archive&&s.project===0&&['draft','panorama','start','preview','revision','other'].includes(page))page='archive';s.page=page;$('.app').classList.remove('mobile-open');render();window.scrollTo(0,0);screen.focus({preventScroll:true})}
function sides(){
  const nav=(icon,name,action,active=false)=>action?btn('<span class="icon" aria-hidden="true">'+icon+'</span>'+name,action,'navitem '+(active?'active':'')):'<div class="navghost"><span class="icon" aria-hidden="true">'+icon+'</span>'+name+'</div>';
  $('#side').innerHTML='<div class="brand"><i class="brand-icon" aria-hidden="true"></i><div><strong>OptraCall</strong><small>持续做出更好的决策</small></div></div>'+
    '<div class="nav-label">主导航</div>'+nav('◇','战略选择')+nav('✓','目标管理')+nav('◫','决策星图')+nav('▱','项目地图')+nav('⬡','语义资产','studio',!isAnalysis()&&s.page!=='settings')+nav('⊞','分析资产')+
    '<div class="nav-label">项目空间 <span>2</span></div>'+pnames.map((p,i)=>btn('›　▱　'+p+(i===0&&s.archive?'（已归档）':''),'project'+i,'project')+(i===0&&s.started?btn('会员包建设事项','studio','taskitem'):'')+(i===1&&s.oldTask?btn('9 月门店复购','old','taskitem '+(isAnalysis()&&s.currentTask===1?'active':'')):'')+(i===1&&s.newTask?btn('复盘 · 独立新任务','newReport','taskitem '+(isAnalysis()&&s.currentTask===2?'active':'')):'' )).join('')+
    '<div class="side-bottom">'+nav('⚙','设置','settings',s.page==='settings')+'<div class="demo-note">交互演示 · 全部企业资料为虚构<br>操作仅在本页生效，刷新可重来。</div>'+btn('重新演示','reset','link side-reset')+'</div>';
  $('#toolbar').innerHTML=btn('◫','toggle','icon-btn')+'<span class="path">'+(s.page==='settings'?'设置':isAnalysis()?pnames[1]+' / '+(s.currentTask===1?'9 月门店复购':'复盘 · 独立新任务'):'语义资产 / 体系工作台')+'</span><div class="mode" aria-label="当前工作区"><span class="'+(isAnalysis()?'on':'')+'">分析</span><span>决策</span></div>'+btn('？','help','icon-btn');
  $('#toolbar button:first-child').setAttribute('aria-label','展开或收起侧栏');$('#toolbar button:last-child').setAttribute('aria-label','演示说明');
}
function studioChrome() {
  return '<div class="head"><div><h1>语义资产</h1><p>查业务口径、字段映射和原资料。</p></div><div class="context"><span>当前企业</span><b>织屿服饰（演示）</b></div></div>'+
    '<nav class="tabs" aria-label="语义资产工作视图"><span>业务语义</span><span>数据映射</span><span>企业资料</span><span class="sel">体系工作台</span></nav>'+
    '<div class="section-head"><div><h2>体系工作台</h2><p>同一企业的语义、指标和方法在这里一起建设和发布。</p></div>'+btn('查看参考目录','settings','link')+'</div>'+
    '<nav class="sections" aria-label="体系工作台视图">'+[['覆盖与缺口','coverage'],['建设与演进','build'],['发布与使用','publication']].map(([n,a])=>btn(n,a,stageName()===n?'sel':'')).join('')+'</nav>';
}
function render(){
  sides(); const pages={settings, start, panorama:overview, draft, preview, receipts, ask, answer, revision, history, archive,other:otherDraft};
  screen.innerHTML=(s.page==='settings'||isAnalysis()?'':studioChrome())+pages[s.page]();
}
function modal(title,sub,body,buttons,drawer=false){
  if(!dialog.open)returnFocus=document.activeElement;
  dialog.className=drawer?'drawer':'';
  dialog.innerHTML='<div class="dlg-head"><div><h2 id="dialog-title">'+title+'</h2><p>'+sub+'</p></div>'+btn('×','close')+'</div><div class="dlg-body">'+body+'</div><div class="dlg-foot">'+(buttons||btn('关闭','close'))+'</div>';
  dialog.querySelector('.dlg-head button').setAttribute('aria-label','关闭'+title);
  if(!dialog.open)dialog.showModal();
}
function dismiss(){if(dialog.open)dialog.close();if(returnFocus?.isConnected)returnFocus.focus()}
function mat(i){const x=materials[i];modal(x[0],x[1],'<p>'+x[2]+'</p>'+panel('能支持的判断','<p>'+x[3]+'</p>'))}
function settings(){
  return '<div class="head"><div><h1>设置</h1><p>管理资料、模型、连接与自动模式。</p></div>'+btn('← 返回企业 Studio','studio','link')+'</div><nav class="tabs" aria-label="设置分类"><span>使用用途</span><span>个人资料</span><span>模型设置</span><span>连接配置</span><span>业务模型包</span><span class="sel">领域资产包</span></nav>'+
    '<div class="box-head"><div><h2>领域资产包</h2><p>按来源和版本登记，企业建设可引用同一份参考。</p></div>'+btn('登记参考','register')+'</div>'+
    '<div class="panel"><label class="field"><span>查找参考</span><input id="refsearch" type="search" value="'+esc(s.search)+'" placeholder="名称、领域或版本"></label><div id="refrows">'+refRows()+'</div></div>'+btn('在织屿服饰继续建设','studio','primary');
}
function refRows(){
  const rows=references.map((r,i)=>({r,i})).filter(({r})=>r.join(' ').toLowerCase().includes(s.search.trim().toLowerCase()));
  return '<p class="eyebrow">已登记 '+references.length+' 份 · 当前显示 '+rows.length+' 份</p>'+tbl(['来源 / 版本','性质','本次用途',''],rows.map(({r,i})=>[r[0]+' <small>v'+r[1]+'</small>',r[2],r[4],btn('查看参考','ref'+i,'link')]));
}
const origText = {
  5:['03-nike-enterprise-public.md','已知公开事实与参考实例 · 第 20 行','NIKE Direct 包含自营零售及数字销售，另有批发经营'],
  6:['04-nike-membership-public.md','本体模板 · 第 58 行','区分定义与实际事件、报名与到场、访问与使用，不直接推断营销效果']
};
function ref(i){const x=references[i],o=origText[i];modal(x[0]+' · v'+x[1],x[2]+'　／　'+x[3],'<dl class="kv">'+row('来源位置',sourceIdentity[i][1]+'　／　'+x[5])+row('原文标识',sourceIdentity[i][0]+' / v'+x[1])+row('维护方','原资料维护人待核')+row('适用范围',x[4])+'</dl>'+(o?panel('准确原文摘录','<blockquote>'+o[2]+'</blockquote><p class="muted">'+o[1]+'</p><a href="../../reference-templates/v0.2/'+o[0]+'" target="_blank" rel="noopener">打开仓库内 v0.2 原文 ↗</a>'):'')+panel('本次取用及证据限制',x[6])+panel('企业引用',i===7?'同一来源同时供企业线和会员线引用。本包排除用集团活跃替代品牌有效复购。':'来源记录与织屿的正式决定分别保留。'),btn('返回','close')+btn('进入本企业建设事项','refBuild','primary'))}
function start(){
  return '<div class="box-head"><div><p class="eyebrow">'+pack+'</p><h2>建设会员运营资产包</h2></div>'+label('建设项目 · '+pnames[s.project],'purple')+'</div>'+
    '<section class="panel"><h3>本轮要支持什么经营问题？</h3><label class="field"><span>建设目标</span><textarea id="goal">'+esc(s.goal)+'</textarea></label>'+
    '<div class="row">'+btn('用宽目标起步','broad','link')+btn('直接建设门店复购','specific','link')+'</div>'+
    '<label class="field"><span>本轮获准资料 · 3 份</span></label><div class="docs">'+materials.map((m,i)=>btn('▤　'+m[0],'mat'+i,'doc')).join('')+'</div>'+
    '<p class="muted">来自本项目的演示附件，可点开查看。建设 Agent 还可查本企业已发布、且当前任务有权使用的资产。</p>'+
    '<div class="hero-actions">'+btn('开始本轮建设','begin','primary')+'</div></section>';
}
function overview(){
  return '<p class="eyebrow">'+pack+'　／　'+identity+'</p><div class="box-head"><div><h2>本企业会员运营全景与首批建设建议</h2><p>岚线品牌 · 直营门店 · 2026 年 9 月　｜　资料截止 10 月 31 日</p></div>'+label('企业建设草案','purple')+'</div>'+
    '<section class="summary"><div class="box-head"><h3>首批建议　先建门店复购</h3>'+label(s.selected?'已选定':'待选定',s.selected?'ok':'wait')+'</div><p>月报把比较各店首购队列是否再次购买列为下次复盘议题。已有成交汇总，但“回到同一家店”和“到任一直营店再购”会改变答案。</p><p><b>先核什么</b>　回查现有门店与退款映射、星桥和柳岸的历史起点。选定后，在同一预览处理跨店取舍。</p><p><b>完成条件</b>　说清九月各店可核的队列、分子、分母和限制；对历史较短的门店单独命名，只比较证据覆盖相同的范围。</p><div class="actions">'+btn(s.selected?'继续门店复购':'选择门店复购','choose','primary')+'</div></section>'+
    '<section class="panel"><div class="box-head"><div><h3>按经营问题查看依据</h3><p>业务开展情况和资料能支持的用途分别记录。</p></div></div>'+panorama.map((x,i)=>'<div class="item">'+details(x[0]+'　'+label(x[1],x[1]==='已开展'?'ok':'')+' '+label(x[2],x[2]==='本期无需建设'?'':'wait'),'<p>'+x[3]+'</p><p><b>出处</b>　'+x[5]+'</p><p><b>下一步</b>　'+x[4]+'</p>'+(['identity','','coupon','active','recall',''][i]?btn('从这个用途起步','use-'+['identity','','coupon','active','recall',''][i],'link'):'') )+'</div>').join('')+'</section>';
}
function draft(){
  return '<div class="box-head"><div><p class="eyebrow">'+pack+'　／　'+identity+'　／　用途 U-01</p><h2>门店复购 · 企业草案</h2><p>岚线直营 · 九月队列 · 截至 10 月 31 日</p></div>'+label(s.published?'首版发布前草案 · v1.0（只读）':'待确认发布','purple')+'</div>'+
    '<section class="summary"><h3>本次要回答的问题</h3><p>在各店完成品牌首购的会员，30 天内有多少再次有效购买？企业共享首购凭证覆盖星桥本批 4 个账号；柳岸本批账号缺少迁入前的品牌首购依据。</p><p>先交星桥真实首购用途和柳岸受限用途。两店口径不同，暂缓排名。</p></section>'+
    '<section class="panel"><div class="box-head"><div><h3>两条路线，共用一份企业草案</h3><p>点击来源查看段落位置与证据性质。</p></div></div><div class="item"><b>企业线</b>　运动鞋服行业 T01 → Nike 企业 T03 → 织屿共享底座<div class="docs">'+btn('Nike 企业 T03','ref5','link')+btn('江南布衣研究 v0.1','ref7','link')+'</div></div><div class="item"><b>会员线</b>　会员运营领域 T02、通用会员包 → 标杆会员运营 → 织屿会员部<div class="docs">'+btn('会员领域包 v0.1','ref0','link')+btn('Nike 会员 T04','ref6','link')+btn('江南布衣研究 v0.1','ref7','link')+'</div></div>'+
    tbl(['建议与标杆线索','本企业处理及其依据','准确维护位置'],[
      ['区分统计主体与触点','修改 · 按品牌账号去重。依据《会员制度》§2.1；集团同人另待核。','会员身份 r2 / 会员部'],
      ['分别记录队列店与发生店','采用 · 首购店用于队列，交易仍归发生店。见门店目录 r2 与成交样本。','共享门店 r2 / 原门店资产'],
      ['再次参与是否算复购','排除 · 活动签到不作为有效购买。制度 §4.2；不采用第三方活跃作为企业口径。','购买规则 r1 / 会员部'],
      ['全额退款与跨期原单','采用 · 按原单核销购买资格。已有销售退款映射 r3，9 月抽样当时通过。','销售退款映射 r3 / 原资产'],
      ['跨店复购归属','待定 · 有权负责人须在发布预览选定本次考核的业务含义。','SAP 复购指标候选 / 会员部决定']
    ])+'</section>'+
    panel('核过哪些资料？',details('查看获准材料与现有资产','<p>三份输入支持制度、列报和映射候选。Agent 继续查了该项目已获准使用的品牌账号表、共享门店 r2、交易退款 r3 和 SAP 样算回执。</p><p>跨店品牌首购凭证 r2 为星桥入组的 4 个账号逐一核过开业至首购日全渠道历史，并标明首购日期与门店。本组没有缺证账号；缺证者必须单列。柳岸本批只有 9 月 1 日起的交易，缺迁入前品牌凭证。两店均有完整后续 30 天。只用三份最初材料时，仅能提出这些核查项。</p>'))+
    '<div class="hero-actions">'+btn(s.published?'查看当前正式版 '+v(s.published)+' 与回执':'查看发布预览',s.published?'receipts':'preview','primary')+(s.hasPanorama?btn('返回全景','panorama','link'):'')+'</div>';
}
function preview(){
  if(!s.selected)return emptyState('暂无发布预览','先从本企业选择建设目标。');
  if(s.published)return receipts();
  return '<p class="eyebrow">'+pack+'　／　首版 v1.0</p><div class="box-head"><div><h2>确认发布预览</h2><p>岚线直营 · 事件自 2026-09-01 生效 · 资料截至 2026-10-31</p></div>'+label('1 项经营取舍','wait')+'</div>'+
    '<section class="summary"><h3>希望用哪种复购考核首购店？</h3><p>会员在星桥首购、20 天后在柳岸再次有效购买。交易归柳岸，下面的选择决定这名会员是否计入星桥队列的复购分子。</p>'+
    Object.entries(choices).map(([val,t])=>'<label class="choice"><input type="radio" name="scope" value="'+val+'" '+(s.scope===val?'checked':'')+'><span><b>'+t+'</b>　'+(val==='any'?'计入。看在首购店首次买过的账号是否继续在品牌内购买。':'不计入。看首购门店自身接回会员的能力。')+'</span></label>').join('')+'</section>'+
    panel('本次正式采用的用途',tbl(['用途','范围和发布资格','排除及仍待核'],[
      ['定义参考','门店首购后 30 日有效复购率。在岚线直营店按首购店归组。分母为身份可靠、已完整观察后续 30 日的去重品牌账号数，分子为其中在次日起 30 日内、按所选门店范围再次有效购买的去重品牌账号数。','明确未成熟、未知身份和未能连回原单的记录。'],
      ['正式计算','星桥 · 首购后 30 日有效复购率；本批 4 个账号的跨店品牌首购凭证 r2、后续窗和样算已核。','只限成熟队列以及合格的资料与权限。'],
      ['受限计算','柳岸 · 资料期内首次可见购买后 30 日复购率；资料自 9 月 1 日连续。','无法确认迁入前首购，暂停与星桥直接排名。']
    ]))+
    panel('谁能用到哪一层',tbl(['获准身份','范围与用途'],[['总部月报','引用岚线直营已发布的门店月度汇总，保留期间和粒度。'],['商品部','查阅定义，可解释跨店规则；没有品类汇总。'],['星桥店','核本店明细，同时可引用已授权星桥队列汇总。'],['两店数据核算岗','读取两店获准身份、交易和退款明细，复算本用途。']]))+
    panel('沿用的授权与原权威',details('查看批准人、依赖和例外','<p>织屿会员运营负责人确认经营范围与跨店取舍。企业资料原权责方已授权上述访问，范围扩大由该权责方核定。</p><p>引用共享门店 r2、品牌身份 r2、跨店品牌首购凭证 r2、销售退款 r3；SAP 维护指标与方法，Studio 固定用途和准确引用。本次无获准的换码试点例外。</p>'))+
    '<div class="hero-actions">'+btn('确认并按用途发布','publish','primary',!s.scope)+btn('返回草案','draft','link')+btn('演示发布异常','scenario','link right')+'</div>';
}
function receipts(){
  if(!s.published)return emptyState('暂无分项发布回执','先在原草案核对并确认用途。');
  const n=s.published, ready=done(), old=n===1;
  return '<p class="eyebrow">'+pack+'　／　'+identity+'　／　'+v(n)+'</p><div class="box-head"><div><h2>发布与使用 · 分项回执</h2><p>已确认的跨店口径为「'+choices[s.scope]+'」。</p></div>'+label(ready?'已发布 · 按用途':'部分用途挂起',ready?'ok':'wait')+'</div>'+
    tbl(['原维护方','准确资产 / 原结果','本包用途'],[
      ['共享资产','共享门店 r2、身份 r2、首购凭证 r2、退款映射 '+mapVer(n)+' · '+(old?'P-030':'P-041')+' '+label('成功','ok'),'引用原正式资产'],
      ['会员部','会员有效购买 r1 · P-031 '+label('成功','ok'),'定义已生效，按品牌账号'],
      ['SAP','复购指标 '+(old?'m5':'m6')+' · '+(old?(s.recovered&&s.receipts==='failed'?'P-032b':'P-032'):'P-043')+' '+label(ready?'成功':s.receipts==='unknown'?'结果未知':'失败',ready?'ok':'wait'),'星桥正式计算、柳岸受限计算'+(ready?'已具备所需依赖':'等待此依赖')],
      ['Studio','会员包 '+v(n)+' · P-'+(old?'033':'042')+' '+label('成功','ok'),'定义参考'+(ready?'、两种计算用途已列入企业目录':'已列入目录；挂起用途不能用于计算')]
    ])+((s.receipts!=='ok')?panel('原请求记录', 'P-032 首次'+(s.receipts==='unknown'?'结果未知。':'发布失败。')+(s.recovered?(s.receipts==='unknown'?'后来查询原请求证实成功。':'确认修正后的 m5，另发 P-032b 并成功。'):'待查。')+' 原请求状态按发生顺序留存。'):'')+(ready?'<p class="muted">已发布，首次企业真实使用待验证。以下操作演示虚构项目如何使用。</p>':panel('只核对这项依赖','<p>先查 SAP 原请求 P-032 与目标指纹。定义及历史回执保留。</p>'+btn(s.receipts==='unknown'?'查原回执':'查看失败与修订','recover','primary'))) +
    '<div class="hero-actions">'+btn(n===1?'到分析窗口提问':'在独立新任务核对新版',n===1?'ask1':'ask2','primary')+btn('查看版本与历史','history','link')+'</div>';
}
function emptyState(title,text){return '<div class="empty"><h3>'+title+'</h3><p>'+text+'</p>'+btn('返回本企业建设','studio','link')+'</div>'}
function analysisTop(n){const displayId=s.page==='answer'?reading().id:'尚未发送';
  return '<div class="head"><div><p class="eyebrow">'+pnames[1]+'　／　独立分析任务 '+displayId+'</p><h1>'+ (n===1?'9 月门店复购':'修订后再看 9 月门店复购')+'</h1><p>织屿服饰　·　截止 2026-10-31</p></div>'+label('虚构项目','purple')+'</div><div class="stages" aria-label="分析进度">'+['资料准备','需求梳理','分析对话','结果与审查'].map((x,i)=>'<div class="stage '+(i===(s.page==='ask'?2:3)?'here':'')+'">'+(i+1)+'　'+x+'</div>').join('')+'</div>';
}
function ask(){
  const n=s.currentTask;
  return '<div class="report">'+analysisTop(n)+panel('分析对话','<p>已进入同企业的「品牌经营复盘」项目。新任务只收到经营问题、资料截止和本项目获准资料。</p>'+
    '<label class="field"><span>经营问题</span><textarea id="question" readonly>'+question+'</textarea></label>'+
    '<label class="field"><span>演示角色及本项目的授权</span><select id="role">'+['总部月报','商品部','星桥店','两店数据核算岗'].map(x=>'<option '+(x===s.role?'selected':'')+'>'+x+'</option>').join('')+'</select></label>'+
    '<p class="muted">同一问题可从不同角色查看。本次访问随项目与角色确定。</p>'+
    '<div class="hero-actions">'+btn('发送经营问题','run','primary')+'</div>')+'</div>';
}
function reportBody(n,role,ready){
  if(role==='商品部'||!ready)return '<h3>可解释定义，数值待核</h3><p>队列按首购店归组，按品牌账号去重。依企业本次决定「'+choices[s.scope]+'」。合格的再购需落在次日起 30 日内，已全额退款的购买不计。</p><p>'+(role==='商品部'?'商品部只获准看定义。门店汇总不能推出各品类的复购分布。':'计算用途的必要依赖尚未成功。当前只能使用正式定义。')+'</p>';
  const count=result(n);
  const lead={'总部月报':'据获准的《岚线直营 · 9 月星桥队列月度汇总》','星桥店':'本店明细可核星桥发生的购买和后续交易；品牌首购资格及跨店结果引用已授权的星桥队列汇总','两店数据核算岗':'按获准的品牌首购凭证和两店身份、订单、退款明细复算'}[role];
  return '<h3>星桥首购队列的 30 日有效复购率为 '+pct(n)+'</h3><p>'+lead+'，4 个身份可靠且观察已满 30 天的品牌账号中，'+count+' 个在「'+choices[s.scope]+'」口径下再次有效购买。</p>'+
    tbl(['九月队列','复购分子','成熟分母','截止日'],[['星桥直营店',String(count),'4','2026-10-31']])+
    '<p>柳岸历史仅从 9 月 1 日开始，其独立用途为「资料期内首次可见购买后 30 日复购率」。此次不据此给两店排名。</p>'+
    (role==='总部月报'?'<p class="muted">引用门店月度汇总，未读取订单明细。</p>':role==='星桥店'?'<p class="muted">柳岸订单对当前任务不可读，未按零计入。门店未独立复算跨店范围。</p>':'<p class="muted">已核品牌身份 r2、跨店品牌首购凭证 r2、观察窗与去重。该组共 4 个成熟账号，无待核身份或缺失首购凭证；每位账号最多计一次。</p>');
}
function answer(){
  const r=reading(), n=r.version, role=r.role, ready=r.ready;
  return '<div class="report">'+analysisTop(n)+'<div class="bubble">'+question+'</div><article class="reply"><p class="eyebrow"><b>OptraCall</b>　·　原回复 '+(r.id+' / 01')+'</p>'+reportBody(n,role,ready)+
    (n===2&&ready&&role==='两店数据核算岗'?panel('两笔复查','<p>星桥再次购买的账号 C07 已于 10 月 2 日全退。新版把该次再购排除；账号 C13 在星桥的正常再购仍计入。两人的九月首次购买均有效，队列分母仍为 4。</p>'):'')+
    '<div class="reply-tools">'+btn('本次依据','basis','link')+(n===1?btn('反馈到资产体系','feedback','link'):btn('回看旧报告与 Case','history','link'))+'</div></article>'+
    (n===1&&s.feedbackSources.some(item=>item.reportId===r.id)?'<div class="subtle"><h3>问题已关联 F-08</h3><p>原回复、当时依据与截止日已关联到本企业会员包。</p>'+btn('回 Studio 查看修订','revision','primary')+'</div>':'')+
    '<div class="hero-actions">'+btn('另开任务换角色查看',s.revised?'ask2':'ask1')+btn('查看版本历史','history','link')+'</div>'+'</div>';
}
function basis(tab=0){
  s.basisTab=tab;const r=reading(),n=r.version,role=r.role,ready=r.ready;
  const affected=ready&&role!=='商品部';
  const use=role==='商品部'||!ready?'仅采用正式定义':role==='两店数据核算岗'?'采用准确指标和原明细复算':role==='总部月报'?'引用已发布的门店月度汇总':'本店明细核对＋获准队列汇总';
  const reads=role==='商品部'||!ready?'会员规则 r1、跨店定义；未读取汇总与明细':role==='总部月报'?'汇总 S-'+(n===1?'09a':'09b')+'（原表完整）、其定义；未读取明细':role==='星桥店'?'本店交易及退款明细、已授权队列月度汇总 S-'+(n===1?'09a':'09b')+'（获准范围内完整）；外店明细不可见':'身份 r2、交易及销售退款 '+mapVer(n)+'、跨店品牌首购凭证 r2、SAP 复购 '+(n===1?'m5':'m6')+'（均完整）';
  const original='<dl class="kv">'+row('原任务／回复',r.id+' / 01 · '+role)+row('目录供给',identity+' '+v(n)+' · '+(role==='商品部'||!ready?'仅定义参考':role==='总部月报'?'定义、获准的门店月度汇总':role==='星桥店'?'定义、本店资料、获准星桥队列汇总':'定义、合格的两店重算用途'))+row('实际读取',reads)+row('作者采用',use+' · '+choices[s.scope])+row('独立核验', '待验证。此离线演示未发生真实独立使用或复核。')+row('事件与截止','2026 年 9 月首购队列；数据截至 10 月 31 日。')+'</dl>';
  modal('本次依据与前提变化','原记录与现在回看分别展示；查看不启动模型。','<nav class="sections">'+btn('原稿与当时返回','basis0',tab===0?'sel':'')+btn('现在回看','basis1',tab===1?'sel':'')+'</nav>'+(tab===0?original:panel('当前与当时的差异',n===1&&s.revised?(affected?(role==='两店数据核算岗'?'本报告用 r3 重算，r3 后来修订为 r4，原数值受影响。':'本报告曾引用门店汇总 S-09a，其生产链使用 r3。r3 后来修订为 r4，汇总变更影响本报告数值。'+(role==='总部月报'?'原任务没有直接读取退款明细。':'原任务可回查本店明细，跨店部分来自已授权汇总。')):'本回复只采用正式定义。退款映射 r3 后来修订为 r4，定义及本回复的解释继续适用，本回复未采用受影响数值。'):'当前尚无影响该原回复的更新。')),btn('返回原分析','close'),true);
}
function feedback(){
  const n=s.currentTask;
  const existing=s.feedbackSources.flatMap(item=>item.notes.map(text=>({report:item.reportId,text})));
  if(n!==1)return;
  modal('反馈到原资产体系','先定位这条回复的问题，源资产缺陷或长期缺口再回原体系。','<div class="sections"><span class="pill active">记录问题反馈</span></div><dl class="kv">'+row('接收体系',pack+' · '+identity)+row('原分析任务',reading().id+' / 01 · v1.0 · 2026-10-31')+'</dl><label class="field"><span>反馈主题</span><input type="text" id="subject" readonly value="九月再购的跨月退款漏连"></label>'+(s.feedback?panel('F-08 已有证据（只读）','<ul>'+existing.map(note=>'<li>'+esc(note.report)+'　'+esc(note.text)+'</li>').join('')+'</ul>'):'')+'<label class="field"><span>'+(s.feedback?'新增证据（可选）':'问题、证据与当前处理')+'</span><textarea id="issue" placeholder="'+(s.feedback?'有新证据时填写；留空即可只关联本条原回复。':'填写问题与证据')+'">'+(s.feedback?'':'售后负责人指出一笔 9 月再次购买已于 10 月 2 日全额退款。请核当时映射是否连回原单。')+'</textarea></label><p class="muted">同一基础版、同一问题并入原事项。保存后由建设 Agent 核查当时可见的资料。</p>',btn('返回原分析','close')+btn(s.feedback?'补充到原事项':'保存反馈关联','saveFeedback','primary'));
}
function revision(){
  const impacted=s.reports.filter(r=>r.version===1&&r.ready&&r.role!=='商品部').map(r=>r.id);
  if(!s.feedback)return emptyState('暂无与会员包关联的反馈','先在分析任务的原回复旁反馈问题。');
  return '<div class="box-head"><div><p class="eyebrow">'+pack+'　／　建设与演进　／　F-08</p><h2>跨月全额退款漏连</h2><p>'+s.feedbackId+' 原回复 01　·　当时采用 v1.0　·　原数据截止 10 月 31 日</p></div>'+label(s.revised?'修订已发布':s.check?'已核查 · 待确认修订':'待核查',s.revised?'ok':'wait')+'</div>'+
    panel('来自原回复的反馈',s.feedbackSources.map(item=>'<div class="item"><b>'+item.reportId+' / 01</b>　'+btn('回看这条来源回复','record-'+item.reportId,'link')+(item.notes.length?'<ul>'+item.notes.map(text=>'<li>'+esc(text)+'</li>').join('')+'</ul>':'<p class="muted">已关联此来源，沿用原证据。</p>')+'</div>').join('')+'<p class="muted">'+(s.addedEvidence?'重复发起已定位到 F-08，新增不同证据才追加。':'同一问题归入 F-08。')+'</p>'+'<p class="muted">反馈来源与受影响的数值分别核对。首次线索 '+s.feedbackId+' '+(impacted.includes(s.feedbackId)?'采用了受影响的汇总或映射。':'只解释定义，未采用有误的映射或其数值结果。')+'</p>'+btn('查看原回复','feedbackOriginal','link'))+
    (s.check||s.revised?panel('原资产核查结果','<p>9 月再次购买 O-73 的退款 R-02 于 10 月 2 日发生，在原报告截止前可读。旧映射 r3 仅在同月查原单。共享销售退款负责人将跨月原单关联修正为 r4。</p>'+
      tbl(['逐笔核查','应有的结果'],[['C07 · 星桥再次购买 O-73','O-73 已全退，排除这次再购；保留九月另笔有效首购。'],['C13 · 星桥正常再购 O-81','无冲销，继续计一次复购；首购队列不变。']])+
      '<p><b>影响</b>　引用 r3 的九月复购、汇总。'+(impacted.length?'受影响的数值回复：'+impacted.join('、')+'。采用汇总的任务经汇总版本关联；直接复算的任务按它实际读取的映射关联。':'目前留存的回复只提供定义，没有使用受影响数值的报告。')+'门店身份、未退款交易和品牌统计单位仍适用。SAP 指标算法不变，更新所依赖的映射版本。</p>'):'')+
    '<div class="hero-actions">'+(s.revised?btn('在独立新任务核对新版','ask2','primary'):s.check?btn('查看修订发布预览','revPreview','primary'):btn('查看建设 Agent 核查','investigate','primary'))+btn('查看版本与历史','history','link')+'</div>';
}
function revPreview(){
  modal('修订发布预览 · v1.1','织屿服饰 · 同一会员运营包 '+identity,
    panel('只复核受影响的用途','<p>沿用原授权、适用范围和经营决定「'+choices[s.scope]+'」。修正的是原截止日前已可见的漏连，不追改旧报告。</p>'+
      tbl(['原权威','本次变化'],[['销售退款资产','r3 → r4；按原单跨月关联。'],['SAP 指标','m5 → m6；同一指标引用 r4，算法和观察窗沿用。'],['会员包','v1.0 → v1.1；门店、会员身份、原经营决定不变。']]))+
    '<p>星桥正式计算、柳岸受限计算重核后再入目录。保留原报告、原依据、原 Case 选择及行动。</p>',btn('返回','close')+btn('确认发布修订','approveRevision','primary'));
}
function history(){
  if(!s.published)return emptyState('暂无已发布版本','首版预览确认后，在这里回看准确版本。');
  return '<p class="eyebrow">'+pack+'　／　'+identity+'</p><h2>版本与历史</h2>'+
    tbl(['版本','依据与使用范围','记录'],[
      ...(s.revised?[['v1.1 · 当前','退款 r4、SAP m6；同一账号和观察规则。',s.newTask?btn('查看新任务','newReport','link'):btn('新任务核对','ask2','link')]]:[]),
      ['v1.0'+(s.revised?' · 历史':' · 当前'),(originalReady()?'退款 r3、SAP m5；保留起始范围和当时采用。':'退款 r3；SAP m5 首次'+(s.receipts==='unknown'?'结果未知':'失败')+'，原版仅具定义资格。'),s.oldTask?btn('原报告与当时依据','old','link'):'待首次使用']
    ])+panel('已留存的分析任务',s.reports.length?tbl(['任务及版本','任务角色','原结果'],s.reports.map(r=>[r.id+' / '+v(r.version),r.role,btn('回看本条原回复','record-'+r.id,'link')])):'尚无分析任务。')+panel('原 Case · 直营店秋季会员复盘','<p>已有独立经营会纪要 C-12（11 月 2 日）。会员负责人决定先核星桥回购归属，再决定下月活动投放；会后已安排门店核对。依据为 9 月月报复盘议题，经营效果待观察。</p><p class="muted">此决定及行动来自既有 Case。当前分析任务和退款修订均不自动更新决定或新增行动。</p>')+
    '<div class="hero-actions">'+btn('返回发布与使用','receipts')+(s.revised?btn('在独立新任务核对新版','ask2','primary'):'')+'</div>';
}
function archive(){return '<h2>原项目只读历史</h2>'+panel('会员资产建设 · 已归档','<p>本项目保留原建设会话与当时的包引用。接续项目「品牌经营复盘」拥有自己的资料授权。</p><p>企业资产仍为 '+identity+'，已有门店复购用途 U-01。私有附件不随接续自动开放。</p>')+btn('到获准项目接续同一包','continueProject','primary')}
function projectDialog(i){
  const listed=s.extraUses.map(k=>otherUses[k].id+' '+otherUses[k].name);
  if(s.selected)listed.unshift('U-01 门店复购');
  if(i===0&&s.archive){go('archive');return}
  modal(pnames[i], '织屿服饰 · 项目权限随当前身份核对',
    '<p>企业目录定位到「'+pack+'」（'+identity+'）。'+(s.started?'已找到原建设事项 M-01，重复发起会回到原事项。':'可由本项目发起第一份建设建议。')+'</p>'+
    (listed.length?'<p>原包已有用途：'+listed.join('、')+'。</p>':'')+(s.started&&i===1?'<p>原建设项目未共享的私有附件仍按原权限处理，已有正式资产可按本项目用途继续引用。</p>':''),
    btn('返回','close')+btn('在此项目接续','switchProject'+i,'primary')+(i===0&&s.published?btn('演示原项目归档','archiveProject','link'):''));
}
function begin(){
  s.goal=($('#goal')?.value||'').trim();
  if(!s.goal){toast('请写下建设目标');return}
  const key=Object.keys(otherUses).find(k=>otherUses[k].match.test(s.goal));
  if(key&&!/复购/.test(s.goal)){startOther(key);return}
  if(!/会员|复购/.test(s.goal)){toast('本演示支持会员运营宽目标和门店复购用途。');return}
  s.started=true;
  if(/复购/.test(s.goal)){s.selected=true;go('draft')}
  else{s.hasPanorama=true;go('panorama')}
}
function startOther(key){
  if(!otherUses[key])return;
  s.started=true;s.activeUse=key;
  if(!s.extraUses.includes(key))s.extraUses.push(key);
  go('other');
}
function otherDraft(){
  const u=otherUses[s.activeUse];
  if(!u)return emptyState('尚未指定用途','在本企业提出需要解决的问题。');
  return '<div class="box-head"><div><p class="eyebrow">'+pack+'　／　'+identity+'　／　用途 '+u.id+'</p><h2>'+u.name+' · 用途草案</h2><p>当前建设项目：'+pnames[s.project]+'　·　已定位同一企业包、同一用途事项</p></div>'+label('起步草案','purple')+'</div>'+
    panel('本次经营问题','<p>'+u.ask+'</p>')+panel('引用与待补证','<p>'+u.basis+'</p><p>'+u.gap+'</p>')+
    panel('约定的完成条件','<p>'+u.complete+'</p>')+
    '<p class="muted">此用途演示到建设起点。门店复购可继续操作发布、使用和修订。</p><div class="hero-actions">'+btn('继续本包的门店复购','namedStart','primary')+btn('提出其他建设目标','newGoal','link')+(s.hasPanorama?btn('返回全景','panorama','link'):'')+'</div>';
}
function register(){
  modal('登记参考','按来源、准确版本与原文内容识别重复。','<label class="field"><span>获准的示例来源</span><select id="importRef">'+references.map((r,i)=>'<option value="'+i+'">'+r[0]+' · v'+r[1]+'</option>').join('')+'</select></label><label class="field"><span>登记情形</span><select id="importType"><option value="same">同源同版原文再次提供</option><option value="conflict">同源同版、正文不同</option></select></label>',btn('返回','close')+btn('核对并登记','doRegister','primary'));
}
function startAsk(n){
  if(!s.published){go('preview');return}
  if(n===2&&!s.revised){go('revision');return}
  if(n===1&&s.revised)n=2;
  s.currentTask=n;s.project=1;s.role=n===2?'两店数据核算岗':'总部月报';go('ask');
}
function doRun(){
  const n=s.currentTask;s.role=$('#role').value;
  const previous=s.reports.filter(r=>r.version===n).length;
  const id=(n===1?'A-':'B-')+String((n===1?17:26)+previous);
  s.reports.push({id,version:n,role:s.role,ready:done()});
  s.reportId=id;
  if(n===1)s.oldTask=true;else s.newTask=true;
  go('answer')
}
const handlers={
  reset:()=>modal('重新开始演示？','仅清除这一页的虚构演示操作。','<p>从建设目标和三份演示附件重新开始。</p>',btn('继续当前演示','close')+btn('重新开始','resetYes','primary')),
  resetYes:()=>{dismiss();s=initial();go('start')},
  help:()=>modal('演示说明','织屿服饰为虚构企业，经营资料和回执均为演示样例。','<p>从体系工作台提出目标，选门店复购并确认一份发布预览，再到项目的分析窗口查看当时依据、反馈和修订。左栏和 Studio 页签可随时回看。</p><p>演示不连接产品、模型或任何企业资料。参考卡片说明来源和段落位置，内容为演示转述。</p>'),
  toggle:()=>{const app=$('.app');if(matchMedia('(max-width:720px)').matches){app.classList.toggle('mobile-open')}else{app.classList.toggle('collapsed')}},
  studio:()=>{go(s.archive&&s.project===0?'archive':starter())},
  coverage:()=>go(s.hasPanorama?'panorama':starter()),
  build:()=>go(s.archive&&s.project===0?'archive':s.feedback?'revision':starter()),
  publication:()=>go(s.published?'receipts':'preview'),
  settings:()=>go('settings'),
  close:dismiss, refBuild:()=>{dismiss();go(s.archive&&s.project===0?'archive':starter())},
  broad:()=>{s.goal=broad;$('#goal').value=s.goal;$('#goal').focus()},
  specific:()=>{s.goal=specific;$('#goal').value=s.goal;$('#goal').focus()},
  begin, namedStart:()=>{dismiss();s.activeUse='';s.started=true;s.selected=true;s.goal=specific;go('draft')},
  newGoal:()=>{s.activeUse='';s.goal=broad;go('start')},choose:()=>{s.activeUse='';s.selected=true;go('draft')}, draft:()=>go('draft'), panorama:()=>go('panorama'),
  preview:()=>go('preview'), receipts:()=>go('receipts'), history:()=>go('history'),
  scenario:()=>modal('演示发布异常','仅改变本次虚构 SAP 分项的回执情形。','<label class="field"><span>SAP 指标发布结果</span><select id="resultMode">'+[['ok','成功'],['unknown','结果未知'],['failed','发布失败']].map(([val,t])=>'<option value="'+val+'" '+(s.receipts===val?'selected':'')+'>'+t+'</option>').join('')+'</select></label><p>依赖异常时只挂起受影响的计算用途。</p>',btn('返回','close')+btn('采用此情形','setScenario','primary')),
  setScenario:()=>{s.receipts=$('#resultMode').value;dismiss();toast('已选择虚构发布回执情形')},
  publish:()=>{if(!s.scope||s.published)return;s.published=1;go('receipts')},
  recover:()=>{
    if(s.receipts==='unknown'){
      modal('查原发布回执','P-032 · 同一请求与同一目标指纹。','<p>原 SAP 记录显示该请求实际成功，目标版本 m5 与确认预览一致。查证后补记回执并恢复依赖用途。</p>',btn('返回','close')+btn('据原回执更新资格','recovered','primary'))
    }else{
      modal('修正受影响的 SAP 候选','P-032 失败 · 原因是经确认的指纹与 SAP 候选不一致。','<p>已回原指标查明为说明字段更新，准备了准确候选和新的发布请求 P-032b。范围、输入映射和其余已发布条目沿用。</p>',btn('返回','close')+btn('确认受影响项并发布','recovered','primary'))
    }
  },
  recovered:()=>{s.recovered=true;dismiss();go('receipts');toast(s.receipts==='failed'?'P-032b 已成功，P-032 原失败保留。':'P-032 原请求查证成功。')},
  ask1:()=>startAsk(1), ask2:()=>startAsk(2), run:doRun,
  old:()=>openReport(firstReport(1)?.id),newReport:()=>openReport(s.reports.filter(r=>r.version===2).at(-1)?.id),feedbackOriginal:()=>openReport(s.feedbackId),
  basis:()=>basis(0), basis0:()=>basis(0), basis1:()=>basis(1), feedback,
  saveFeedback:()=>{
    const body=$('#issue').value.trim(),subject=$('#subject').value.trim();
    if((!s.feedback&&!body)||!subject){toast('请保留反馈主题及问题证据。');return}
    let entry=s.feedbackSources.find(item=>item.reportId===s.reportId);
    if(!s.feedback)s.feedbackId=s.reportId;else s.addedEvidence=true;
    if(!entry){entry={reportId:s.reportId,notes:[]};s.feedbackSources.push(entry)}
    const allNotes=s.feedbackSources.flatMap(item=>item.notes);
    let addition=body;
    for(const known of allNotes){if(addition.startsWith(known))addition=addition.slice(known.length).trim()}
    if(addition&&!allNotes.includes(addition))entry.notes.push(addition);
    s.feedback=true;dismiss();go('answer');toast('已关联原事项 F-08')
  },
  revision:()=>go('revision'),investigate:()=>{s.check=true;go('revision')},revPreview,
  approveRevision:()=>{s.revised=true;s.published=2;dismiss();go('receipts')},
  register,doRegister:()=>{
    const i=Number($('#importRef').value), same=$('#importType').value==='same';
    modal(same?'已找到相同版本':'同版正文不同，待核来源',references[i][0]+' · v'+references[i][1],'<p>'+(same?'复用原登记记录。两条路线可共同引用该来源，登记数仍为 8。':'保留原版及其引用。本次不同正文未替换原记录，须由来源维护者核实。')+'</p>',btn('返回目录','close')+btn('查看原参考','ref'+i,'primary'))
  },
  project0:()=>projectDialog(0),project1:()=>projectDialog(1),
  switchProject0:()=>{s.project=0;dismiss();go(starter())},switchProject1:()=>{s.project=1;dismiss();go(starter())},
  archiveProject:()=>{s.archive=true;s.project=0;dismiss();go('archive')},
  continueProject:()=>{s.project=1;go(starter());toast('在本项目接续原包 '+identity)}
};
document.addEventListener('click', e=>{
  const b=e.target.closest('button[data-act]');if(!b||b.disabled)return;
  const a=b.dataset.act;
  if(a.startsWith('use-'))startOther(a.slice(4));
  else if(/^mat\d+$/.test(a))mat(Number(a.slice(3)));
  else if(/^ref\d+$/.test(a))ref(Number(a.slice(3)));
  else if(a.startsWith('record-'))openReport(a.slice(7));
  else if(handlers[a])handlers[a]();
});
document.addEventListener('input',e=>{
  if(e.target.id==='refsearch'){s.search=e.target.value;$('#refrows').innerHTML=refRows()}
  if(e.target.id==='goal')s.goal=e.target.value;
});
document.addEventListener('change',e=>{
  if(e.target.name==='scope'){s.scope=e.target.value;screen.querySelector('[data-act=publish]').disabled=false}
});
dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus()});
render();
