import { useCallback, useEffect, useRef, useState } from 'react';
import { HostRequestError, createTask as createDiskTask, listProjects } from '../../../../src/host/ui/runtime-client.ts';
import type { ClientProject, ClientTask } from '../../../../src/host/ui/project-types.ts';

type Scene = 'daily' | 'topic' | 'recurring';
type ClarificationItem = { id: string; category: string; priority: string; question: string; rationale: string; status: string; answer?: string; linkedHypothesisId?: string };
type HypothesisItem = { id: string; statement: string; evidence: string; validationCondition: string; status: string };
type Framework = {
  metrics: { name: string; definition: string; dimensions: string[]; source: string }[];
  dataNeeds: { table: string; fields: string[]; priority: string; purpose: string }[];
  analysisPaths: { question: string; hypothesis: string; method: string; requiredData: string[]; expectedOutput: string }[];
  reportFramework: { section: string; purpose: string; keyQuestions: string[]; evidence: string[]; zeroHallucinationCheck: string }[];
  openQuestions: string[];
  risks: string[];
};
type RequirementInstance = {
  instance: { version: '0.1'; id: string; scene: Scene; title: string; createdAt: string; updatedAt: string };
  context: { background: string; goal: string; decisionScenario: string };
  clarifications: ClarificationItem[];
  facts: string[];
  hypotheses: HypothesisItem[];
  framework?: Framework;
  snapshot?: { fingerprint: string; confirmedAt: string; upstreamDigest: string; confirmedBy: string };
};
type GateItem = { id: string; level: 'hard' | 'warn' | 'info'; status: string; title: string; detail: string };
type GateReport = { hard: GateItem[]; warn: GateItem[]; info: GateItem[]; publishBlocked: boolean };
type ReleaseEntry = { id: string; version: string; scene: string; title: string; packageFingerprint: string; contentFingerprint: string; releasedAt: string; releasedBy: string; openQuestionCount: number; metricCount: number };
type InstanceView = { id: string; title: string; scene: Scene; createdAt: string; updatedAt: string; status: 'draft' | 'confirmed' | 'stale'; mustConfirmPending: number; releasedCount: number };
type InstanceDetail = { instance: RequirementInstance; gates: GateReport; releases: ReleaseEntry[] };
type ProposalSource = { fingerprint: string; confirmation: 'unconfirmed' | 'confirmed' | 'stale' };
type Proposal = { instanceId: string; source: ProposalSource; repairAttempts: 0 | 1; noChangeReason?: string } & (
  | { call: 'elicit'; clarifications: ClarificationItem[]; facts: string[]; hypotheses: HypothesisItem[]; dropped: number }
  | { call: 'hypotheses'; hypotheses: HypothesisItem[]; dropped: number }
  | { call: 'framework'; framework: Framework; dropped: number });

async function requirementRequest<T>(path: string, method: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/requirement-instances${path}`, { method, mode: 'same-origin', credentials: 'omit', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
  const value = await response.json();
  if (!response.ok) throw new HostRequestError(value.message ?? '需求梳理请求未完成，请重试。', {}, value.code ?? 'requirement_request_failed');
  return value as T;
}

const statusLabel: Record<InstanceView['status'], string> = { draft: '草稿', confirmed: '已确认', stale: '快照已失效' };
const statusClass: Record<InstanceView['status'], string> = { draft: 're-pill draft', confirmed: 're-pill ok', stale: 're-pill warn' };
const priorityClass: Record<string, string> = { must_confirm: 're-prio must', should_confirm: 're-prio should', can_defer: 're-prio defer' };
const priorityLabel: Record<string, string> = { must_confirm: '必须确认', should_confirm: '建议确认', can_defer: '可后置' };
const clarificationStatus: Record<string, string> = { pending: '待回答', answered: '已回答', assumed: '按假设推进', skipped: '已跳过', deferred: '已后置' };
const stages = ['诉求与澄清', '事实与假设', '分析与报告框架', '检查与交付'] as const;

export function RequirementPage({ projects, onOpenTask, onProjectsChanged, onBack, onSendToTask }: {
  projects: ClientProject[];
  onOpenTask: (project: ClientProject, task: ClientTask) => void;
  onProjectsChanged: () => void;
  onBack: () => void;
  onSendToTask: (project: ClientProject, task: ClientTask, requirement: { instanceId: string; version?: string; title: string }) => void;
}) {
  const [instances, setInstances] = useState<InstanceView[]>([]);
  const [detail, setDetail] = useState<InstanceDetail | null>(null);
  const [stage, setStage] = useState(1);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [generating, setGenerating] = useState(false);
  const [adopting, setAdopting] = useState(false);
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [actor, setActor] = useState('本地用户');
  const [version, setVersion] = useState('1.0.0');
  const [release, setRelease] = useState<{ entry: ReleaseEntry; rap: Record<string, unknown> } | null>(null);
  const [sendVersion, setSendVersion] = useState<string | null>(null);
  const [answerEdit, setAnswerEdit] = useState<{ id: string; text: string } | null>(null);
  const [answerSaving, setAnswerSaving] = useState(false);
  const [answerError, setAnswerError] = useState('');
  const [draft, setDraft] = useState({ title: '', scene: 'topic' as Scene });
  const activeProjects = projects.filter(project => project.archivedAt === null);
  const watchRef = useRef<AbortController | null>(null);

  const reloadList = useCallback(async () => { try { const value = await requirementRequest<{ instances: InstanceView[] }>('', 'GET'); setInstances(value.instances); } catch (fault) { setError(fault instanceof Error ? fault.message : '需求实例列表读取失败。'); } }, []);
  const reloadDetail = useCallback(async (id: string) => {
    try {
      const value = await requirementRequest<InstanceDetail>(`/${id}`, 'GET');
      setDetail(value);
      const latest = [...value.releases].sort((a, b) => a.version.localeCompare(b.version, 'en', { numeric: true })).at(-1);
      if (latest) { const [major, minor] = latest.version.split('.').map(Number); setVersion(`${major}.${minor! + 1}.0`); }
      return value;
    } catch (fault) { setError(fault instanceof Error ? fault.message : '需求实例读取失败。'); return null; }
  }, []);
  useEffect(() => { void reloadList(); return () => watchRef.current?.abort(); }, [reloadList]);

  const patch = async (instance: RequirementInstance, proposalSourceFingerprint?: string) => {
    const value = await requirementRequest<InstanceDetail>(`/${instance.instance.id}`, 'PATCH', { instance, ...(proposalSourceFingerprint ? { proposalSourceFingerprint } : {}) });
    setDetail(value);
    void reloadList();
    return value;
  };
  const watchStream = (id: string) => {
    watchRef.current?.abort();
    const controller = new AbortController(); watchRef.current = controller; setStreamText('');
    void (async () => {
      const response = await fetch(`/api/requirement-instances/${id}/events`, { credentials: 'omit', cache: 'no-store', headers: { 'x-optracall-client': '1' }, signal: controller.signal });
      if (!response.ok || !response.body) return;
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let pending = '';
      try {
        while (!controller.signal.aborted) {
          const item = await reader.read(); if (item.done) break;
          pending += decoder.decode(item.value, { stream: true });
          let boundary;
          while ((boundary = pending.indexOf('\n\n')) >= 0) {
            const block = pending.slice(0, boundary); pending = pending.slice(boundary + 2);
            const data = block.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
            if (!data) continue;
            const event = JSON.parse(data) as { type?: string; text?: string; instanceId?: string };
            if (event.type === 'text.delta' && event.instanceId === id) setStreamText(previous => (previous + (event.text ?? '')).slice(-4000));
            if (event.type === 'run.settled') setStreamText('');
          }
        }
      } catch { /* stream closes with the run */ }
    })().catch(() => {});
  };
  const generate = async (call: 'elicit' | 'hypotheses' | 'framework') => {
    if (!detail) return;
    const instanceId = detail.instance.instance.id;
    setGenerating(true); setError(''); setProposal(null); watchStream(detail.instance.instance.id);
    try {
      const value = await requirementRequest<{ call: Proposal['call']; proposal: Record<string, unknown>; source: ProposalSource; repairAttempts: 0 | 1 }>(`/${instanceId}/generate`, 'POST', { call });
      setProposal({ call: value.call, ...value.proposal, instanceId, source: value.source, repairAttempts: value.repairAttempts } as Proposal);
    } catch (fault) { setError(fault instanceof Error ? fault.message : '模型调用未完成，请重试。'); }
    finally { setGenerating(false); watchRef.current?.abort(); }
  };
  const stopGeneration = async () => { if (!detail) return; try { await requirementRequest(`/${detail.instance.instance.id}/stop`, 'POST', {}); } catch { /* stopped run settles anyway */ } };
  const adopt = async () => {
    if (!detail || !proposal || adopting || proposal.instanceId !== detail.instance.instance.id) return;
    setAdopting(true); setError('');
    try {
      const current = await requirementRequest<InstanceDetail>(`/${proposal.instanceId}`, 'GET');
      const instance = structuredClone(current.instance);
      if (proposal.call === 'elicit') { instance.clarifications.push(...proposal.clarifications); instance.facts.push(...proposal.facts); instance.hypotheses.push(...proposal.hypotheses); }
      if (proposal.call === 'hypotheses') instance.hypotheses.push(...proposal.hypotheses);
      if (proposal.call === 'framework') instance.framework = proposal.framework;
      await patch(instance, proposal.source.fingerprint); setProposal(null);
    }
    catch (fault) { setError(fault instanceof Error ? fault.message : '建议未采纳，原提案已保留，请核对当前工作稿。'); }
    finally { setAdopting(false); }
  };
  const dismiss = () => setProposal(null);
  const updateClarification = async (id: string, status: string) => {
    if (!detail) return;
    const instance = structuredClone(detail.instance);
    const item = instance.clarifications.find(entry => entry.id === id);
    if (!item) return;
    item.status = status;
    if (status === 'assumed') { const first = instance.hypotheses[0]; if (first) item.linkedHypothesisId = first.id; }
    try { await patch(instance); }
    catch (fault) { setError(fault instanceof Error ? fault.message : '澄清状态未保存，请重试。'); }
  };
  const closeAnswerEditor = (id: string) => {
    setAnswerEdit(null); setAnswerError('');
    requestAnimationFrame(() => document.getElementById(`re-answer-trigger-${id}`)?.focus());
  };
  const saveAnswer = async () => {
    if (!detail || !answerEdit || answerSaving) return;
    const text = answerEdit.text.trim();
    if (!text) { setAnswerError('请填写实际回答；也可以取消后选择跳过或后置。'); return; }
    const instance = structuredClone(detail.instance);
    const item = instance.clarifications.find(entry => entry.id === answerEdit.id);
    if (!item) return;
    item.answer = text; item.status = 'answered';
    setAnswerSaving(true); setAnswerError('');
    try { await patch(instance); closeAnswerEditor(item.id); }
    catch (fault) { setAnswerError(fault instanceof Error ? fault.message : '回答未保存，请保留内容并重试。'); }
    finally { setAnswerSaving(false); }
  };
  const setHypothesisStatus = async (id: string, status: string) => {
    if (!detail) return;
    const instance = structuredClone(detail.instance);
    const item = instance.hypotheses.find(entry => entry.id === id);
    if (!item) return;
    item.status = status;
    await patch(instance);
  };
  const confirm = async () => {
    if (!detail) return;
    try { await requirementRequest(`/${detail.instance.instance.id}/confirm`, 'POST', { confirmedBy: actor }); await reloadDetail(detail.instance.instance.id); void reloadList(); setNotice('已生成不可变确认快照，正式发布与送入前请核对框架及未决项。'); }
    catch (fault) { setError(fault instanceof Error ? fault.message : '确认未完成。'); }
  };
  const publish = async () => {
    if (!detail) return;
    try { const value = await requirementRequest<{ entry: ReleaseEntry; releases: ReleaseEntry[] }>(`/${detail.instance.instance.id}/publish`, 'POST', { version, releasedBy: actor }); setNotice(`RAP ${value.entry.version} 已发布且不可变。`); await reloadDetail(detail.instance.instance.id); const read = await requirementRequest<{ entry: ReleaseEntry; rap: Record<string, unknown> }>(`/${detail.instance.instance.id}/releases/${value.entry.version}`, 'GET'); setRelease(read); void reloadList(); }
    catch (fault) { setError(fault instanceof Error ? fault.message : '发布未完成。'); }
  };
  const create = async () => {
    try { const value = await requirementRequest<{ instance: InstanceView }>('', 'POST', { title: draft.title, scene: draft.scene }); setDraft({ title: '', scene: 'topic' }); await reloadList(); await open(value.instance.id); }
    catch (fault) { setError(fault instanceof Error ? fault.message : '创建未完成。'); }
  };
  const open = async (id: string) => { setRelease(null); setSendVersion(null); setAnswerEdit(null); setAnswerError(''); setProposal(null); setStage(1); await reloadDetail(id); };
  const saveContext = async () => { if (!detail) return; const instance = structuredClone(detail.instance); instance.instance.title = draft.title || instance.instance.title; await patch(instance); };

  if (!detail) return <div className="re-page" data-build="requirements-elaboration">
    <div className="page-heading"><div><p className="eyebrow">REQUIREMENT ELABORATION · 业务插件</p><h1>需求梳理</h1><p>把模糊业务诉求结构化为已确认需求与分析框架（RAP 0.2），再显式送入 Case、项目或任务。设计态前置，不指挥分析步骤。</p></div><span className="re-store">本机存储 · ~/.optracall/requirement-instances/</span></div>
    {error && <div className="error-notice" role="alert"><div><strong>需求梳理提示</strong><p>{error}</p></div><button className="text-button" onClick={() => { setError(''); void reloadList(); }}>重试</button></div>}
    {notice && <p className="project-notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>知道了</button></p>}
    <div className="re-create panel">
      <h2>新建需求实例</h2>
      <div className="re-create-row">
        <input value={draft.title} placeholder="一句话描述业务诉求，如：看一下双11之后会员复购率为什么掉了" onChange={event => setDraft(previous => ({ ...previous, title: event.target.value }))} />
        <select value={draft.scene} aria-label="场景" onChange={event => setDraft(previous => ({ ...previous, scene: event.target.value as Scene }))}>
          <option value="topic">topic 专题归因</option><option value="daily">daily 轻量快查</option><option value="recurring">recurring 周期复盘</option>
        </select>
        <button className="primary-button" disabled={!draft.title.trim()} onClick={() => void create()}>创建并进入工作台</button>
      </div>
      <p className="re-help">四阶段自由跳转、随时编辑；模型输出先提案卡，不直接覆写工作稿。</p>
    </div>
    <div className="re-instance-grid">
      {instances.map(item => <article key={item.id} className="re-instance-card">
        <div className="re-card-top"><span className={statusClass[item.status]}>{statusLabel[item.status]}{item.releasedCount ? ` · 已发布 ×${item.releasedCount}` : ''}</span><span className="re-meta">{item.updatedAt.slice(0, 10)}</span></div>
        <h3>{item.title}</h3>
        <p className="re-id">{item.id}</p>
        <div className="re-chips"><span className="re-chip">{item.scene}</span>{item.mustConfirmPending > 0 && <span className="re-chip warn">must_confirm 待处理 ×{item.mustConfirmPending}</span>}{item.status === 'stale' && <span className="re-chip warn">一致性警告</span>}</div>
        <div className="re-card-bottom"><span>四阶段工作台</span><button className="text-button" onClick={() => void open(item.id)}>打开 →</button></div>
      </article>)}
      {!instances.length && <p className="re-empty">还没有需求实例；从上方一句话开始。</p>}
    </div>
    <p className="re-footer">实例独立实体 · 确认/发布/送入均为用户显式动作 · 提示与现有产品一致（勿放敏感数据）</p>
  </div>;

  const instance = detail.instance, gates = detail.gates;
  const activeProposal = proposal?.instanceId === instance.instance.id ? proposal : null;
  const proposalHasChanges = activeProposal && (activeProposal.call === 'framework' || activeProposal.hypotheses.length > 0 || activeProposal.call === 'elicit' && (activeProposal.clarifications.length > 0 || activeProposal.facts.length > 0));
  return <div className="re-page" data-build="requirements-elaboration">
    <button className="text-button re-back" onClick={() => { setDetail(null); void reloadList(); }}>← 返回实例列表</button>
    <div className="page-heading"><div><p className="eyebrow">INSTANCE · {instance.instance.id}</p><h1>{instance.instance.title}</h1><p>四阶段自由跳转、随时编辑；快照失效仅提示再确认，不锁死编辑。</p></div><span className={statusClass[instances.find(item => item.id === instance.instance.id)?.status ?? 'draft']}>{statusLabel[instances.find(item => item.id === instance.instance.id)?.status ?? 'draft']}</span></div>
    {error && <div className="error-notice" role="alert"><div><strong>需求梳理提示</strong><p>{error}</p></div><button className="text-button" onClick={() => setError('')}>关闭</button></div>}
    {notice && <p className="project-notice" role="status">{notice}<button className="text-button" onClick={() => setNotice('')}>知道了</button></p>}
    {gates.warn.some(item => item.status === 'warn') && <div className="re-stale-banner" role="status"><strong>一致性警告（stale）</strong><span>{gates.warn.find(item => item.status === 'warn')!.detail}</span></div>}
    <nav className="re-stage-stepper" role="group" aria-label="阶段（自由跳转）">
      {stages.map((label, index) => <button key={label} className={stage === index + 1 ? 'active' : ''} aria-pressed={stage === index + 1} onClick={() => setStage(index + 1)}><small>STAGE 0{index + 1}</small><strong>{label}</strong></button>)}
    </nav>
    <div className={proposal ? 're-work-grid with-proposal' : 're-work-grid'}>
      <div className="re-stage-body">
        {stage === 1 && <section aria-label="诉求与澄清">
          <div className="panel">
            <h2>核心四要素</h2>
            <div className="re-field"><label>需求名称</label><input value={instance.instance.title} onChange={event => { const value = event.target.value; setDetail(previous => previous ? { ...previous, instance: { ...previous.instance, instance: { ...previous.instance.instance, title: value } } } : previous); }} /></div>
            <div className="re-field"><label>业务背景</label><textarea rows={2} value={instance.context.background} onChange={event => { const value = event.target.value; setDetail(previous => previous ? { ...previous, instance: { ...previous.instance, context: { ...previous.instance.context, background: value } } } : previous); }} /></div>
            <div className="re-field"><label>核心目标</label><textarea rows={2} value={instance.context.goal} onChange={event => { const value = event.target.value; setDetail(previous => previous ? { ...previous, instance: { ...previous.instance, context: { ...previous.instance.context, goal: value } } } : previous); }} /></div>
            <div className="re-field"><label>决策场景</label><textarea rows={2} value={instance.context.decisionScenario} onChange={event => { const value = event.target.value; setDetail(previous => previous ? { ...previous, instance: { ...previous.instance, context: { ...previous.instance.context, decisionScenario: value } } } : previous); }} /></div>
            <div className="re-actions"><button className="secondary-button" onClick={() => void saveContext()}>保存四要素</button><button className="primary-button" disabled={generating} onClick={() => void generate('elicit')}>{generating ? 'AI 首轮推断中…' : 'AI 首轮推断'}</button>{generating && <button className="secondary-button" onClick={() => void stopGeneration()}>停止</button>}</div>
            {generating && streamText && <pre className="re-stream">{streamText}</pre>}
            <p className="re-help">插件会话经统一 Runtime 调用（凭据由 Host 注入），结构化 JSON 输出；会话不配置数据目录访问工具。</p>
          </div>
          {instance.clarifications.length > 0 && <div className="panel">
            <h2>澄清清单</h2>
            <p className="re-help">七维分类 × 三级优先；未收敛仅提示，不阻断确认、发布与跳转。</p>
            {instance.clarifications.map(item => <div key={item.id} className="re-clr-row">
              <div className="re-clr-top"><span className={priorityClass[item.priority] ?? 're-prio defer'}>{priorityLabel[item.priority] ?? item.priority}</span><span className="re-dim">{item.category}</span><span className="re-pill draft">{clarificationStatus[item.status] ?? item.status}</span></div>
              <p id={`re-question-${item.id}`} className="re-clr-q">{item.question}</p>
              {item.rationale && <p className="re-clr-rationale">{item.rationale}</p>}
              {item.answer && <p className="re-clr-answer">答：{item.answer}</p>}
              {answerEdit?.id === item.id ? <form className="re-field" onSubmit={event => { event.preventDefault(); void saveAnswer(); }}>
                <label htmlFor="re-clarification-answer">澄清回答</label>
                <textarea id="re-clarification-answer" autoFocus rows={3} required disabled={answerSaving} value={answerEdit.text} aria-describedby={`re-question-${item.id} re-answer-help${answerError ? ' re-answer-error' : ''}`} onChange={event => { setAnswerEdit({ id: item.id, text: event.target.value }); setAnswerError(''); }} />
                <p id="re-answer-help" className="re-help">填写实际回答后保存；空白不能保存，取消不会改变原记录。保存或取消后可编辑其他回答。</p>
                {answerError && <p id="re-answer-error" className="field-error" role="alert">{answerError}</p>}
                <div className="re-actions"><button type="submit" className="secondary-button" disabled={answerSaving || !answerEdit.text.trim()}>{answerSaving ? '保存中…' : '保存回答'}</button><button type="button" className="text-button" disabled={answerSaving} onClick={() => closeAnswerEditor(item.id)}>取消编辑</button></div>
              </form> : <button id={`re-answer-trigger-${item.id}`} className="text-button" disabled={answerSaving || Boolean(answerEdit)} aria-describedby={`re-question-${item.id}`} onClick={() => { setAnswerEdit({ id: item.id, text: item.answer ?? '' }); setAnswerError(''); }}>{item.answer ? '编辑回答' : '直接回答'}</button>}
              <div className="re-clr-actions">
                <button className="text-button" disabled={answerSaving} onClick={() => void updateClarification(item.id, 'assumed')}>按假设推进</button>
                <button className="text-button" disabled={answerSaving} onClick={() => void updateClarification(item.id, 'skipped')}>跳过</button>
                <button className="text-button" disabled={answerSaving} onClick={() => void updateClarification(item.id, 'deferred')}>后置</button>
              </div>
            </div>)}
          </div>}
        </section>}
        {stage === 2 && <section aria-label="事实与假设">
          <div className="panel"><h2>已确认事实</h2>{instance.facts.length ? <ul className="re-facts">{instance.facts.map((fact, index) => <li key={index}>{fact}</li>)}</ul> : <p className="re-help">暂无事实；采纳首轮推断提案可补齐。</p>}</div>
          <div className="panel">
            <div className="re-panel-head"><h2>推断假设矩阵</h2><span className="re-actions"><button className="secondary-button" disabled={generating} onClick={() => void generate('hypotheses')}>{generating ? '生成中…' : 'AI 辅助生成假设'}</button>{generating && <button className="secondary-button" onClick={() => void stopGeneration()}>停止</button>}</span></div>
            <p className="re-help">陈述 + 证据 + 证伪条件；proposed / deferred 仅作待验证项，严禁混入事实。</p>
            {instance.hypotheses.map(item => <div key={item.id} className="re-hypo">
              <div className="re-hypo-head"><strong>{item.id}</strong><span className={item.status === 'confirmed' ? 're-pill ok' : item.status === 'proposed' ? 're-pill warn' : 're-pill draft'}>{item.status}</span></div>
              <p className="re-hypo-statement">{item.statement}</p>
              {item.evidence && <p className="re-hypo-meta">证据：{item.evidence}</p>}
              {item.validationCondition && <p className="re-hypo-meta">证伪：{item.validationCondition}</p>}
              <div className="re-clr-actions"><button className="text-button" onClick={() => void setHypothesisStatus(item.id, 'confirmed')}>采纳</button><button className="text-button" onClick={() => void setHypothesisStatus(item.id, 'rejected')}>拒绝</button><button className="text-button" onClick={() => void setHypothesisStatus(item.id, 'deferred')}>后置</button><button className="text-button" onClick={() => void setHypothesisStatus(item.id, 'proposed')}>重新提出</button></div>
            </div>)}
            {!instance.hypotheses.length && <p className="re-help">暂无假设。</p>}
          </div>
          <div className="panel">
            <h2>确认成正式需求</h2>
            <p className="re-help">用户主动的快照动作，不是探索框架的前置条件；生成带指纹的不可变快照，供正式发布与送入核对。{instance.snapshot ? `当前快照 ${instance.snapshot.fingerprint.slice(0, 19)}… · 确认人 ${instance.snapshot.confirmedBy}` : ''}</p>
            <div className="re-actions"><input className="re-actor" value={actor} aria-label="确认人" onChange={event => setActor(event.target.value)} /><button className="primary-button" onClick={() => void confirm()}>{instance.snapshot ? '重新确认（生成新快照）' : '确认成正式需求'}</button></div>
          </div>
        </section>}
        {stage === 3 && <section aria-label="分析与报告框架">
          <div className="panel">
            <div className="re-panel-head"><h2>分析与报告框架</h2><span className="re-actions"><button className="primary-button" disabled={generating} onClick={() => void generate('framework')}>{generating ? '生成中…' : '生成框架'}</button>{generating && <button className="secondary-button" onClick={() => void stopGeneration()}>停止</button>}</span></div>
            <p className="re-help">未确认也可先生成框架草稿；正式发布与送入仍需有效确认。</p>
            {generating && streamText && <pre className="re-stream">{streamText}</pre>}
          </div>
          {instance.framework && <div className="panel"><h2>① 指标体系与口径</h2><table className="re-table"><thead><tr><th>指标</th><th>口径</th><th>维度</th><th>来源</th></tr></thead><tbody>{instance.framework.metrics.map((metric, index) => <tr key={index}><td><strong>{metric.name}</strong></td><td>{metric.definition}</td><td>{metric.dimensions.join(' · ')}</td><td>{metric.source}</td></tr>)}</tbody></table></div>}
          {instance.framework && <div className="panel"><h2>② 数据需求清单</h2><table className="re-table"><thead><tr><th>优先级</th><th>表 / 主题</th><th>字段</th><th>用途</th></tr></thead><tbody>{instance.framework.dataNeeds.map((need, index) => <tr key={index}><td><span className={need.priority === 'P0' ? 're-pill warn' : need.priority === 'P1' ? 're-pill draft' : 're-pill draft'}>{need.priority}</span></td><td><code>{need.table}</code></td><td>{need.fields.join(' · ')}</td><td>{need.purpose}</td></tr>)}</tbody></table></div>}
          {instance.framework && <div className="panel"><h2>③ 分析路径与方法矩阵</h2><table className="re-table"><thead><tr><th>子问题</th><th>假设</th><th>方法</th><th>数据</th><th>预期产物</th></tr></thead><tbody>{instance.framework.analysisPaths.map((path, index) => <tr key={index}><td>{path.question}</td><td>{path.hypothesis || '描述性分析（无需假设）'}</td><td>{path.method}</td><td>{path.requiredData.join(' · ')}</td><td>{path.expectedOutput}</td></tr>)}</tbody></table></div>}
          {instance.framework && <div className="panel"><h2>④ 报告框架与结构树</h2>{instance.framework.reportFramework.map((section, index) => <div key={index} className="re-report-node"><strong>{section.section}</strong><span> — {section.purpose}</span>{section.keyQuestions.length > 0 && <p>关键问题：{section.keyQuestions.join('；')}</p>}<p className="re-zero-hallu">零幻觉检查点：{section.zeroHallucinationCheck}</p></div>)}</div>}
          {instance.framework && <div className="panel"><h2>零幻觉区（自动归集）</h2><p className="re-help">后置 / 未决项强制流入，严禁伪造成事实。</p>{instance.framework.openQuestions.length > 0 && <><p><strong>open_questions</strong></p><ul className="re-facts">{instance.framework.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul></>}{instance.framework.risks.length > 0 && <><p><strong>risks</strong></p><ul className="re-facts">{instance.framework.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul></>}</div>}
          {!instance.framework && <p className="re-help">尚未生成框架。</p>}
        </section>}
        {stage === 4 && <section aria-label="检查与交付">
          <div className="panel">
            <h2>三级检查清单</h2>
            <p className="re-help">仅结构完整性在发布时硬阻断；一致性为警告、业务完备性为提示，均不阻断编辑与跳转。</p>
            {(['hard', 'warn', 'info'] as const).map(level => <div key={level}>
              <p className={`re-gate-tier ${level}`}>{level === 'hard' ? '结构完整性 · 发布时硬校验' : level === 'warn' ? '一致性 · 警告，不阻断' : '业务完备性 · 提示，不阻断'}</p>
              {gates[level].map(item => <div key={item.id} className="re-gate-item"><span className={`re-gate-mark ${item.status}`}>{item.status === 'pass' ? '✓' : item.status === 'fail' ? '✕' : item.status === 'warn' ? '!' : 'i'}</span><div><strong>{item.title}</strong><p>{item.detail}</p></div></div>)}
            </div>)}
            <div className="re-actions">
              <input className="re-actor" value={actor} aria-label="发布人" onChange={event => setActor(event.target.value)} />
              <input className="re-actor" value={version} aria-label="版本号" onChange={event => setVersion(event.target.value)} />
              <button className="primary-button" disabled={gates.publishBlocked} onClick={() => void publish()}>{gates.publishBlocked ? '发布被结构完整性阻断' : `发布 RAP 0.2 · ${version}`}</button>
            </div>
          </div>
          {detail.releases.length > 0 && <div className="panel"><h2>已发布版本</h2><table className="re-table"><thead><tr><th>版本</th><th>指纹</th><th>发布时间 / 人</th><th>送入</th></tr></thead><tbody>{detail.releases.map(entry => <tr key={entry.version}><td><code>{entry.version}</code></td><td><code>{entry.packageFingerprint.slice(0, 19)}…</code></td><td>{entry.releasedAt.slice(0, 16).replace('T', ' ')} · {entry.releasedBy}</td><td><button className="text-button" onClick={() => setSendVersion(entry.version)}>送入分析 →</button></td></tr>)}</tbody></table></div>}
          {release && <div className="panel"><h2>发布物预览 · {release.entry.id}@{release.entry.version}</h2><pre className="re-stream">{JSON.stringify(release.rap, null, 2).slice(0, 4000)}</pre></div>}
        </section>}
      </div>
      {activeProposal && proposal && <aside className="re-proposal" aria-label="AI 提案卡">
        <h3>{proposal.call === 'framework' ? '未确认框架草稿' : 'AI 提案卡'}</h3>
        <p className="re-help">{proposal.call === 'elicit' ? '首轮推断建议' : proposal.call === 'hypotheses' ? '辅助生成假设' : '框架生成'} · 放弃后工作稿零改动</p>
        <p className="re-help re-proposal-source">输入来源：{proposal.source.confirmation === 'confirmed' ? '已确认的当前工作稿；本提案仍为草稿' : proposal.source.confirmation === 'stale' ? '当前工作稿（原确认快照已失效）' : '当前工作稿（尚未确认）'} · 输入指纹 {proposal.source.fingerprint.slice(0, 19)}…</p>
        {proposal.repairAttempts === 1 && <p className="re-help" role="status">已在同一会话追加 1 次格式修正；首次输出保留在会话记录中。</p>}
        <div className="re-proposal-body">
          {proposal.noChangeReason && <p>{proposal.noChangeReason}</p>}
          {proposal.call === 'elicit' && <>{proposal.clarifications.map(item => <p key={item.id}>· [{priorityLabel[item.priority]}] {item.category}：{item.question}</p>)}{proposal.facts.map((fact, index) => <p key={`f${index}`}>事实 · {fact}</p>)}{proposal.hypotheses.map(item => <p key={item.id}>假设 · {item.statement}</p>)}</>}
          {proposal.call === 'hypotheses' && proposal.hypotheses.map(item => <p key={item.id}>假设 · {item.statement}（证伪：{item.validationCondition || '待补充'}）</p>)}
          {proposal.call === 'framework' && <p>指标 ×{proposal.framework.metrics.length} · 数据需求 ×{proposal.framework.dataNeeds.length} · 分析路径 ×{proposal.framework.analysisPaths.length} · 报告树 ×{proposal.framework.reportFramework.length} · open_questions ×{proposal.framework.openQuestions.length}</p>}
          {proposal.call === 'framework' && proposal.framework.openQuestions.length > 0 && <><p><strong>待确认问题</strong></p><ul className="re-facts">{proposal.framework.openQuestions.map((question, index) => <li key={index}>{question}</li>)}</ul></>}
          {proposal.call === 'framework' && proposal.framework.risks.length > 0 && <><p><strong>风险</strong></p><ul className="re-facts">{proposal.framework.risks.map((risk, index) => <li key={index}>{risk}</li>)}</ul></>}
          {proposal.dropped > 0 && <p className="re-dropped">已丢弃无效条目 ×{proposal.dropped}</p>}
        </div>
        <div className="re-actions">{proposalHasChanges ? <><button className="primary-button" disabled={adopting} onClick={() => void adopt()}>{adopting ? '采纳中…' : '采纳建议'}</button><button className="secondary-button" disabled={adopting} onClick={dismiss}>放弃</button></> : <button className="primary-button" onClick={dismiss}>知道了</button>}</div>
        <p className="re-help">{proposalHasChanges ? '模型输出不直接覆写工作稿；采纳只更新草稿，不代替正式确认或发布。' : '本次无需新增内容；知道了只关闭提案，不改写工作稿。'}</p>
      </aside>}
    </div>
    {sendVersion && <SendDialog projects={activeProjects} instanceTitle={instance.instance.title} version={sendVersion} onProjectsChanged={onProjectsChanged} onClose={() => setSendVersion(null)} onSend={(project, task) => { onSendToTask(project, task, { instanceId: instance.instance.id, version: sendVersion, title: instance.instance.title }); setSendVersion(null); }} />}
  </div>;
}

function SendDialog({ projects, instanceTitle, version, onProjectsChanged, onClose, onSend }: { projects: ClientProject[]; onProjectsChanged: () => void; onClose: () => void; onSend: (project: ClientProject, task: ClientTask) => void; instanceTitle: string; version: string }) {
  const dialog = useRef<HTMLDialogElement>(null), projectSelect = useRef<HTMLSelectElement>(null);
  const [refreshed, setRefreshed] = useState<ClientProject[] | null>(null);
  const [projectId, setProjectId] = useState(''), [taskId, setTaskId] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { void listProjects().then(value => setRefreshed(value.filter(item => item.archivedAt === null))).catch(() => setRefreshed(projects.length ? projects : [])); }, []);
  useEffect(() => {
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialog.current?.showModal(); projectSelect.current?.focus();
    return () => { if (trigger?.isConnected) trigger.focus(); };
  }, []);
  const list = refreshed ?? projects;
  const project = list.find(item => item.id === projectId);
  const task = project?.tasks.find(item => item.id === taskId);
  const createTask = async () => {
    if (!project || creating) return;
    const candidate = project;
    setCreating(true); setError('');
    try {
      const created = await createDiskTask(candidate.id, `需求分析：${instanceTitle}`);
      setRefreshed(list.map(item => item.id === candidate.id ? { ...item, tasks: [...item.tasks, created] } : item));
      setTaskId(created.id);
      onProjectsChanged();
      try { setRefreshed((await listProjects()).filter(item => item.archivedAt === null)); }
      catch { setError('任务已在所选项目创建并选中；列表刷新失败，请核对工作台，不要重复创建。'); }
    }
    catch (fault) { setError(fault instanceof HostRequestError ? fault.message : '创建结果未确认，请先核对所选项目的任务列表，避免重复创建。'); }
    finally { setCreating(false); }
  };
  return <dialog ref={dialog} className="re-dialog" aria-labelledby="re-send-title" onClose={onClose} onCancel={event => { if (creating) event.preventDefault(); }} onClick={event => { if (creating || event.target !== event.currentTarget) return; const bounds = event.currentTarget.getBoundingClientRect(); if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) event.currentTarget.close(); }}>
    <div>
      <h2 id="re-send-title">送入分析</h2>
      <p className="re-help"><strong>RAP {version}</strong> · {instanceTitle}</p>
      <p className="re-help">选择目标任务；发送消息时将附带该需求契约的结构化摘要（目标、口径、数据需求、分析路径、报告树、open questions）。用户显式选择，无自动注入；实例后续变更不回写已发送任务。</p>
      <div className="re-field"><label htmlFor="re-send-project">项目</label><select ref={projectSelect} id="re-send-project" value={projectId} disabled={creating} aria-describedby="re-send-project-help" onChange={event => { const value = event.target.value; setProjectId(value); setTaskId(list.find(item => item.id === value)?.tasks.at(-1)?.id ?? ''); setError(''); }}>
        <option value="">选择项目…</option>
        {list.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></div>
      <p id="re-send-project-help" className="re-help">先选择目标项目；新任务只会创建在该项目内，零任务项目也可选择。</p>
      {project && <div className="re-field"><label htmlFor="re-send-task">任务</label><select id="re-send-task" value={taskId} disabled={creating || !project.tasks.length} onChange={event => setTaskId(event.target.value)}>
        {!project.tasks.length && <option value="">暂无任务，请新建任务</option>}
        {project.tasks.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
      </select></div>}
      {error && <p className="field-error" role="alert">{error}</p>}
      <div className="re-actions">
        <button className="secondary-button" disabled={!project || creating} onClick={() => void createTask()}>{creating ? '创建中…' : '新建任务并选中'}</button>
        <button className="primary-button" disabled={!project || !task || creating} onClick={() => project && task && onSend(project, task)}>前往发送 →</button>
        <button className="secondary-button" disabled={creating} onClick={() => dialog.current?.close()}>取消</button>
      </div>
      <p className="re-help">需求梳理不指挥后续分析步骤；摘要以资料形式注入，Agent 自主决定分析方法。</p>
    </div>
  </dialog>;
}
