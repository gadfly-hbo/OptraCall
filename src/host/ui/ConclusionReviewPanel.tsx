import { useEffect, useId, useRef, useState } from 'react';
import type { ConclusionReviewClaim, ConclusionReviewContextEvidence, ConclusionReviewMaterial, ConclusionReviewMetadata } from '../conclusion-review-contract.ts';
import type { ConclusionReviewReportCandidate } from '../conclusion-review-materials.ts';
import type { ClientProject, ClientTask, PublicModelConfiguration } from './project-types.ts';
import type { RequirementContextSelection } from './requirement-types.ts';
import type { EnterpriseMaterialSelection } from '../enterprise-materials-types.ts';
import { PersonalDialog } from './PersonalDialog.tsx';
import { VerificationPanel } from './VerificationPanel.tsx';
import {
  ConclusionReviewError, conclusionCandidates, conclusionTransition, listConclusionReviews,
  previewConclusionReview, readConclusionReport, readConclusionReview, startConclusionReview, stopConclusionReview,
  readBoardHandoffCandidate, confirmBoardHandoff, readBoardHandoffOperation,
  type BoardHandoffCandidate, type BoardHandoffInput, type BoardHandoffReceipt,
  type ConclusionCandidates, type ConclusionReviewRecord, type ConclusionReviewSelection, type ConclusionTransition,
} from './conclusion-review-client.ts';
import './conclusion-review.css';

type Props = {
  project: ClientProject; task: ClientTask; configurations: PublicModelConfiguration[]; taskBusy: boolean; filesRevision: number;
  requirementContext?: RequirementContextSelection;
  caseContext?: { id: string; title: string; description: string; revision: number };
  enterpriseMaterials?: EnterpriseMaterialSelection[];
  semanticContext?: unknown;
  onClose: () => void;
  onOpenBoard: (target: { projectId: string; relativePath: string; reportSha256: string }) => void;
  onCarry: (reviewId: string) => Promise<boolean>;
};
const verdict = { supported: '证据支持', conditional: '有条件支持', insufficient: '证据不足', conflicting: '与证据冲突' } as const;
const status = { preparing: '正在固定材料', ready: '等待审查', running: '审查中', completed: '已返回审查意见', failed: '审查未完成', cancelled: '审查已停止', interrupted: '审查已中断', unknown: '审查状态未知' } as const;
const activeReview = (record?: ConclusionReviewRecord) => Boolean(record && ['preparing', 'ready', 'running'].includes(record.state));
const reportKey = (report: { relativePath: string; sha256?: string }) => `${report.relativePath}#${report.sha256 ?? ''}`;
const faultText = (fault: unknown) => fault instanceof Error ? fault.message : '审查记录暂时无法读取，请只读刷新。';
const timestamp = (value: string) => Number.isNaN(Date.parse(value)) ? value : new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });

function SourceIdentity({ material, rangeLabel, label = '固定来源' }: { material: ConclusionReviewMaterial; rangeLabel?: string; label?: string }) {
  return <div className="cnr-source-identity">
    <p className="cnr-caption">{label}：{material.locator}</p>
    {material.sha256 && <p className="cnr-caption">来源 SHA-256：<code>{material.sha256}</code></p>}
    {rangeLabel && material.rangeUtf16 && <p className="cnr-caption">{rangeLabel} [{material.rangeUtf16.start}, {material.rangeUtf16.end}) / {material.rangeUtf16.total} UTF-16</p>}
    {material.limitations?.map((note, index) => <p className="cnr-caption" key={index}>{note}</p>)}
  </div>;
}

function Materials({ review, evidence }: { review: ConclusionReviewMetadata; evidence?: ConclusionReviewContextEvidence }) {
  const provided = evidence?.provided, fixed = evidence?.prepared.status === 'fixed';
  return <details className="cnr-evidence"><summary>固定依据与提供记录 · {review.materials.length} 项</summary>
    <details className="cnr-material-group"><summary>{fixed ? '已固定的材料与拟提供范围' : '材料准备记录与拟提供范围'}</summary>
      <p className="cnr-caption">{evidence?.prepared.note ?? '材料准备完成情况尚未核对，不能据此确认已固定或已交给模型。'}</p>
      {review.materials.map(item => <div key={item.id}>
        <p><strong>{item.kind === 'report' ? '报告' : item.id}</strong> · {item.state === 'provided' ? fixed ? '已准备正文' : '拟提供正文' : item.state === 'truncated' ? fixed ? '已准备部分正文' : '拟部分提供正文' : '未准备正文'}</p>
        <SourceIdentity material={item} label={fixed ? '固定来源' : '拟选来源'} rangeLabel={fixed ? '固定包正文范围' : '拟提供正文范围'} />
      </div>)}
    </details>
    <section aria-label="实际提供记录" className="cnr-actual-materials"><h4>实际提供记录</h4>
      {provided?.status === 'recorded' ? <>
        <p><strong>原生请求已核对</strong></p><p className="cnr-caption">{provided.note}</p>
        <details className="cnr-material-group"><summary>请求与版本身份</summary>
          {provided.requestId && <p className="cnr-caption">请求：{provided.requestId}</p>}
          {provided.sessionId && <p className="cnr-caption">原生会话：{provided.sessionId}</p>}
          {provided.messageId && <p className="cnr-caption">消息：{provided.messageId}</p>}
          {provided.requestTextSha256 && <p className="cnr-caption">请求正文 SHA-256：<code>{provided.requestTextSha256}</code></p>}
        </details>
        {provided.fragments.map(item => <details className="cnr-material-group cnr-supplied-fragment" key={item.id}>
          <summary>{item.kind === 'report' ? '固定报告' : item.id} · {item.state === 'truncated' ? '部分提供' : item.text ? '已提供正文' : '未提供正文'}</summary>
          <SourceIdentity material={item} rangeLabel="实际提供正文范围" />
          {item.text ? <pre tabIndex={0} role="region" aria-label={`实际提供正文 · ${item.id}`}>{item.text}</pre> : <p className="cnr-caption">此项没有实际提供的正文。</p>}
        </details>)}
      </> : <><p role="status">实际提供范围未记录／未知</p><p className="cnr-caption">{provided?.note ?? '尚无可核对的原生请求提供记录，不能用准备好的材料补填实际交付。'}</p></>}
      <p className="cnr-caption">提供记录不证明模型已阅读、理解或采用。{evidence?.reads.note}</p>
    </section>
  </details>;
}

function Claim({ claim, first, materials }: { claim: ConclusionReviewClaim; first: boolean; materials: ConclusionReviewMetadata['materials'] }) {
  return <details className="cnr-claim" open={first}>
    <summary><span className={`cnr-verdict ${claim.verdict}`}>{verdict[claim.verdict]}</span><span>{claim.quote}</span></summary>
    <div className="cnr-claim-body">
      <blockquote>{claim.quote}</blockquote>
      <dl><dt>原文位置</dt><dd>{claim.location}</dd>
        <dt>依据</dt><dd>{claim.evidence.length ? claim.evidence.map((item, index) => {
          const source = materials.find(material => material.id === item.materialId);
          return <div key={index}><p>{item.materialId} · Agent 引用位置：{item.locator}</p>{source ? <SourceIdentity material={source} /> : <p className="cnr-caption">固定来源身份未能核对。</p>}{item.quote && <blockquote>{item.quote}</blockquote>}</div>;
        }) : '本条未列出可定位依据。'}</dd>
        {claim.evidenceGaps.length > 0 && <><dt>证据缺口</dt><dd><ul>{claim.evidenceGaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul></dd></>}
        <dt>适用条件</dt><dd>{claim.conditions.length ? <ul>{claim.conditions.map((condition, index) => <li key={index}>{condition}</li>)}</ul> : '本条未另列适用条件。'}</dd>
        <dt>判断理由</dt><dd>{claim.reason}</dd><dt>可能影响</dt><dd>{claim.impact}</dd>
      </dl>
    </div>
  </details>;
}

type HandoffIntent = { input: BoardHandoffInput; state: 'unknown' | 'retryable' | 'committed'; receipt?: BoardHandoffReceipt };
function BoardHandoff({ projectId, taskId, review, archived, refreshToken, onOpenBoard }: {
  projectId: string; taskId: string; review: ConclusionReviewRecord; archived: boolean; refreshToken: number;
  onOpenBoard: Props['onOpenBoard'];
}) {
  const [candidate, setCandidate] = useState<BoardHandoffCandidate>();
  const [claimIds, setClaimIds] = useState<string[]>([]), [recommendationIds, setRecommendationIds] = useState<string[]>([]);
  const [intent, setIntent] = useState<HandoffIntent>(), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const alive = useRef(true), storageKey = `optracall.board-handoff:${projectId}/${taskId}/${review.verificationId}`;
  const remember = (next?: HandoffIntent) => {
    setIntent(next);
    try {
      if (next && next.state !== 'committed') sessionStorage.setItem(storageKey, JSON.stringify(next));
      else sessionStorage.removeItem(storageKey);
    } catch { /* The original request identity remains available in memory. */ }
  };
  useEffect(() => {
    alive.current = true;
    try {
      const saved = JSON.parse(sessionStorage.getItem(storageKey) ?? 'null') as HandoffIntent | null;
      if (saved && ['unknown', 'retryable'].includes(saved.state) && typeof saved.input?.operationId === 'string'
        && saved.input.reportSha256 === review.review.report.sha256 && Array.isArray(saved.input.claimIds) && Array.isArray(saved.input.recommendationIds)) {
        setIntent(saved); setClaimIds(saved.input.claimIds); setRecommendationIds(saved.input.recommendationIds);
      }
    } catch { /* Invalid browser cache cannot authorize a write. */ }
    return () => { alive.current = false; };
  }, [storageKey]);
  useEffect(() => {
    const controller = new AbortController(); setCandidate(undefined);
    void readBoardHandoffCandidate(projectId, taskId, review.verificationId, controller.signal)
      .then(value => { if (value.report.sha256 !== review.review.report.sha256) throw new Error('确认候选与所示报告版本不一致，请只读刷新原审查。'); if (!controller.signal.aborted) { setCandidate(value); setError(''); } })
      .catch(fault => { if (!controller.signal.aborted) { setCandidate(undefined); setError(faultText(fault)); } });
    return () => controller.abort();
  }, [projectId, taskId, review.verificationId, review.sourceStatus, refreshToken]);
  const waiting = intent?.state === 'unknown' && !busy, locked = busy || waiting || archived || candidate?.canConfirm !== true;
  const available = (claim: ConclusionReviewClaim) => ['supported', 'conditional'].includes(claim.verdict);
  const related = (claim: ConclusionReviewClaim) => Boolean(claim.relatedClaimIds?.length && claim.relatedClaimIds.every(id => claimIds.includes(id)));
  const changeClaims = (id: string, checked: boolean) => {
    const next = checked ? [...claimIds, id] : claimIds.filter(value => value !== id);
    setClaimIds(next); setRecommendationIds(old => old.filter(value => candidate?.recommendations.find(item => item.id === value)?.relatedClaimIds?.every(id => next.includes(id))));
    remember(undefined); setError('');
  };
  const submit = async () => {
    if (locked || !claimIds.length || !candidate || intent?.state === 'committed') return;
    const input = intent?.state === 'retryable' ? intent.input : { operationId: crypto.randomUUID(), reportSha256: candidate.report.sha256, claimIds: [...claimIds], recommendationIds: [...recommendationIds] };
    setBusy(true); setError(''); remember({ input, state: 'unknown' });
    try {
      const receipt = await confirmBoardHandoff(projectId, taskId, review.verificationId, input);
      if (alive.current) remember({ input, state: 'committed', receipt });
    } catch (fault) { if (alive.current) setError(`${faultText(fault)} 请先查询原提交状态，选择已保留。`); }
    finally { if (alive.current) setBusy(false); }
  };
  const query = async () => {
    if (!intent || busy) return;
    setBusy(true); setError('');
    try {
      const result = await readBoardHandoffOperation(projectId, taskId, review.verificationId, intent.input.operationId, intent.input);
      if (alive.current) remember(result.state === 'committed' ? { ...intent, state: 'committed', receipt: result.receipt } : { ...intent, state: 'retryable' });
    } catch (fault) { if (alive.current) setError(faultText(fault)); }
    finally { if (alive.current) setBusy(false); }
  };
  return <section className="cnr-handoff" aria-label="带入决策看板" aria-busy={busy}>
    <h3>带入决策看板</h3><p className="cnr-caption">选择本次决策要引用的结论；行动建议可一并带入看板。</p>
    {candidate && !candidate.canConfirm && <p className="cnr-notice" role="status">{candidate.reason ?? '本版当前不可确认，请保留历史并核对报告与权限。'}</p>}
    {candidate?.report.currentSha256 && candidate.report.currentSha256 !== candidate.report.sha256 && <p className="cnr-caption">所审版本：<code>{candidate.report.sha256}</code><br />当前版本：<code>{candidate.report.currentSha256}</code>。新版须先完成对应审查。</p>}
    {candidate && <>
      <fieldset disabled={locked}><legend>作为决策依据的结论</legend>
        {candidate.claims.map(claim => <label className="cnr-handoff-pick" key={claim.id}><input type="checkbox" checked={claimIds.includes(claim.id)} disabled={locked || !available(claim)} onChange={event => changeClaims(claim.id, event.target.checked)} /><span>{claim.quote}<small>{verdict[claim.verdict]}{claim.conditions.length ? ` · ${claim.conditions.join('；')}` : ''}</small></span></label>)}
        {!candidate.claims.length && <p className="cnr-caption">本版没有可确认的结论，仍可通过「带回分析」补证。</p>}
      </fieldset>
      {candidate.recommendations.length > 0 && <fieldset disabled={locked}><legend>一并带入行动建议 · 可选</legend>
        {candidate.recommendations.map(claim => <label className="cnr-handoff-pick" key={claim.id}><input type="checkbox" checked={recommendationIds.includes(claim.id)} disabled={locked || !available(claim) || !related(claim)} onChange={event => { setRecommendationIds(old => event.target.checked ? [...old, claim.id] : old.filter(id => id !== claim.id)); remember(undefined); setError(''); }} /><span>{claim.quote}<small>{verdict[claim.verdict]}{!available(claim) ? ' · 本版证据尚不足以带入建议' : !related(claim) ? ' · 先选择全部关联结论' : ' · 采纳与行动沿看板操作'}{claim.conditions.length ? ` · ${claim.conditions.join('；')}` : ''}</small></span></label>)}
      </fieldset>}
    </>}
    {error && <p className="cnr-notice error" role="alert">{error}</p>}
    <p className="cnr-caption" aria-live="polite">已选 {claimIds.length} 条结论{recommendationIds.length ? `、${recommendationIds.length} 条建议` : ''}。</p>
    {waiting && <p className="cnr-notice" role="status">确认结果未知，操作编号 <code>{intent.input.operationId}</code>。先只读查询原提交。</p>}
    {intent?.state === 'retryable' && <p className="cnr-notice" role="status">已核实原提交未写入，当前选择保留。可明确重试同一提交。</p>}
    {intent?.state === 'committed' && <p className="cnr-handoff-success" role="status">已确认并带入看板：{intent.receipt?.conclusionIds.length ?? claimIds.length} 条结论，{intent.receipt?.boardItemIds.length ?? recommendationIds.length} 条关联建议。</p>}
    <div className="cnr-actions">
      {waiting ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void query()}>查询原提交状态</button>
        : <button type="button" className="primary-button" disabled={locked || !claimIds.length || intent?.state === 'committed'} onClick={() => void submit()}>{busy ? '正在确认…' : intent?.state === 'retryable' ? '重试同一提交' : '确认并带入看板'}</button>}
      {intent?.state === 'committed' && <button type="button" className="secondary-button" onClick={() => onOpenBoard({ projectId, relativePath: review.review.report.relativePath, reportSha256: review.review.report.sha256 })}>查看看板详情</button>}
    </div>
    {!claimIds.length && <p className="cnr-caption">先选择至少一条获支持的结论。</p>}
  </section>;
}

export function ConclusionReviewPanel({ project, task, configurations, taskBusy, filesRevision, requirementContext, caseContext, enterpriseMaterials = [], semanticContext, onClose, onOpenBoard, onCarry }: Props) {
  const uid = useId(), heading = useRef<HTMLHeadingElement>(null), alive = useRef(true), reportRequest = useRef(0);
  const pendingKey = `optracall.conclusion-review:${project.id}/${task.id}`;
  const [tab, setTab] = useState<'review' | 'history'>('review');
  const [candidates, setCandidates] = useState<ConclusionCandidates>({ reports: [], basisFiles: [] });
  const [transition, setTransition] = useState<ConclusionTransition>();
  const [chosen, setChosen] = useState<ConclusionReviewReportCandidate>();
  const [basis, setBasis] = useState<string[]>([]), [useRequirement, setUseRequirement] = useState(Boolean(requirementContext));
  const [useCase, setUseCase] = useState(Boolean(caseContext)), [useSap, setUseSap] = useState(false), [useEnterprise, setUseEnterprise] = useState(enterpriseMaterials.length > 0);
  const [reviews, setReviews] = useState<ConclusionReviewRecord[]>([]), [current, setCurrent] = useState<ConclusionReviewRecord>();
  const [pending, setPending] = useState<string>();
  const [form, setForm] = useState(true), [loading, setLoading] = useState(true), [posting, setPosting] = useState(false), [carrying, setCarrying] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [observe, setObserve] = useState(0);
  const [reportView, setReportView] = useState<{ title: string; text: string; sha256: string }>();
  const savePending = (id?: string) => {
    try { if (id) sessionStorage.setItem(pendingKey, id); else sessionStorage.removeItem(pendingKey); } catch { /* The in-memory operation identity remains available. */ }
    if (alive.current) setPending(id);
  };
  const apply = (review: ConclusionReviewRecord) => {
    if (!alive.current) return;
    setCurrent(review); setReviews(previous => [review, ...previous.filter(item => item.verificationId !== review.verificationId)]);
    setForm(false); savePending(undefined);
  };
  useEffect(() => {
    alive.current = true; heading.current?.focus();
    const controller = new AbortController();
    void Promise.all([conclusionCandidates(project.id, task.id, controller.signal), conclusionTransition(project.id, task.id, controller.signal), listConclusionReviews(project.id, task.id, controller.signal)])
      .then(async ([choices, gate, history]) => {
        if (controller.signal.aborted) return;
        setCandidates(choices); setTransition(gate); setReviews(history);
        if (choices.preselected) setChosen(choices.reports.find(item => reportKey(item) === reportKey(choices.preselected!)));
        let previous: string | null = null;
        try { previous = sessionStorage.getItem(pendingKey); } catch { /* This browser can still show persisted review history. */ }
        const selected = previous ?? history.find(activeReview)?.verificationId ?? history[0]?.verificationId;
        if (selected) {
          setPending(previous ?? undefined);
          const record = await readConclusionReview(project.id, task.id, selected, controller.signal);
          if (!controller.signal.aborted) apply(record);
        }
      }).catch(fault => { if (!controller.signal.aborted) setError(faultText(fault)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { alive.current = false; controller.abort(); };
  }, [project.id, task.id]);
  useEffect(() => {
    if (!current || !activeReview(current)) return;
    const id = current.verificationId, controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>, failures = 0;
    const read = async () => {
      try {
        const review = await readConclusionReview(project.id, task.id, id, controller.signal);
        if (controller.signal.aborted) return;
        failures = 0; apply(review);
        if (!activeReview(review)) return;
      } catch (fault) {
        if (controller.signal.aborted) return;
        if (++failures >= 3) { setError(faultText(fault)); return; }
      }
      timer = setTimeout(read, 1000);
    };
    timer = setTimeout(read, 800);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [project.id, task.id, current?.verificationId, current?.state, observe]);
  useEffect(() => { reportRequest.current++; setReportView(undefined); }, [current?.verificationId, current?.sourceStatus]);

  const refresh = async (id = pending ?? current?.verificationId) => {
    setLoading(true); setError(''); reportRequest.current++; setReportView(undefined);
    try {
      const [choices, gate, history] = await Promise.all([conclusionCandidates(project.id, task.id), conclusionTransition(project.id, task.id), listConclusionReviews(project.id, task.id)]);
      if (!alive.current) return;
      setCandidates(choices); setTransition(gate); setReviews(history);
      if (id) apply(await readConclusionReview(project.id, task.id, id));
      setObserve(value => value + 1);
    } catch (fault) { if (alive.current) setError(faultText(fault)); }
    finally { if (alive.current) setLoading(false); }
  };
  const selection = (verificationId: string): ConclusionReviewSelection => ({
    verificationId, report: { relativePath: chosen!.relativePath, sha256: chosen!.sha256 }, basisFiles: basis,
    ...(useRequirement && requirementContext ? { requirementContext: { instanceId: requirementContext.instanceId, ...(requirementContext.version ? { version: requirementContext.version } : {}), ...(requirementContext.frameworkVersion ? { frameworkVersion: requirementContext.frameworkVersion } : {}) } } : {}),
    ...(useCase && caseContext ? { caseId: caseContext.id, caseRevision: caseContext.revision } : {}),
    ...(useSap ? { useCurrentSap: true } : {}), ...(useEnterprise ? { enterpriseMaterials } : {}),
  });
  const archived = Boolean(project.archivedAt), inProgress = activeReview(current), locked = loading || posting || inProgress || Boolean(pending);
  const begin = async () => {
    if (!chosen?.reviewable || !chosen.sha256 || locked || archived || taskBusy || transition?.state !== 'ready') return;
    const input = selection(crypto.randomUUID());
    setPosting(true); setError(''); setNotice('');
    let dispatched = false;
    try {
      const preview = await previewConclusionReview(project.id, task.id, input);
      if (!alive.current) return;
      savePending(input.verificationId); dispatched = true;
      apply(await startConclusionReview(project.id, task.id, input, preview.etag));
    } catch (fault) {
      if (alive.current) {
        setError(faultText(fault));
        if (!dispatched || fault instanceof ConclusionReviewError && fault.status >= 400 && fault.status < 500) savePending(undefined);
      }
    } finally { if (alive.current) setPosting(false); }
  };
  const stop = async () => {
    if (!current || posting || archived) return;
    setPosting(true); setError('');
    try { apply(await stopConclusionReview(project.id, task.id, current.verificationId)); }
    catch (fault) { if (alive.current) setError(faultText(fault)); }
    finally { if (alive.current) setPosting(false); }
  };
  const viewReport = async () => {
    const serial = ++reportRequest.current;
    setError(''); setReportView(undefined);
    try {
      if (form && chosen) {
        const preview = await previewConclusionReview(project.id, task.id, selection(crypto.randomUUID()));
        const packet = JSON.parse(preview.review.providedText) as { content: { id: string; text: string }[] };
        const report = packet.content.find(item => item.id === 'report');
        if (!report) throw new Error('本版报告正文未能读取。');
        if (alive.current && serial === reportRequest.current) setReportView({ title: preview.report.relativePath, text: report.text, sha256: preview.report.sha256 });
      } else if (current) {
        const report = await readConclusionReport(project.id, task.id, current.verificationId);
        if (report.sha256 !== current.review.report.sha256 || report.reviewId !== current.verificationId || typeof report.text !== 'string'
          || report.rangeUtf16.start !== 0 || report.rangeUtf16.end !== report.text.length || report.rangeUtf16.total !== report.text.length) throw new Error('固定报告身份未能核对。');
        if (alive.current && serial === reportRequest.current) setReportView({ title: report.relativePath ?? current.review.report.relativePath, text: report.text, sha256: report.sha256 });
      }
    } catch (fault) { if (alive.current && serial === reportRequest.current) setError(faultText(fault)); }
  };
  const carry = async () => {
    if (!current || archived || taskBusy || carrying) return;
    setCarrying(true); setError(''); setNotice('');
    try { const appended = await onCarry(current.verificationId); if (alive.current) setNotice(appended ? '意见已带回原任务草稿，请核对后发送。' : '此审查意见已带回原任务草稿。'); }
    catch (fault) { if (alive.current) setError(faultText(fault)); }
    finally { if (alive.current) setCarrying(false); }
  };
  const output = current?.sourceStatus === 'unavailable' ? undefined : current?.reviewResult?.output;
  const updated = current?.reportChanged === true;
  const choiceMissing = chosen && !candidates.reports.some(item => reportKey(item) === reportKey(chosen));
  return <aside className="conclusion-panel" aria-labelledby={uid + '-title'} onKeyDown={event => { if (event.key === 'Escape' && !reportView) { event.stopPropagation(); onClose(); } }}>
    <header className="cnr-heading"><div><h2 id={uid + '-title'} ref={heading} tabIndex={-1}>审查结论与建议</h2><p>针对一版报告，核对重要主张的依据与适用条件。</p></div><button type="button" className="text-button" aria-label="收起审查面板" onClick={onClose}>收起</button></header>
    <nav className="cnr-tabs" aria-label="审查面板"><button type="button" aria-pressed={tab === 'review'} onClick={() => setTab('review')}>结论审查</button><button type="button" aria-pressed={tab === 'history'} onClick={() => setTab('history')}>历史记录</button></nav>
    <div className="cnr-body">
      {archived && <p className="cnr-notice">项目已归档，仅可回看审查与历史记录。</p>}
      {error && <p className="cnr-notice error" role="alert">{error}</p>}
      {notice && <p className="cnr-caption" role="status">{notice}</p>}
      <div className="cnr-actions"><button type="button" className="text-button" disabled={posting || loading} onClick={() => void refresh()}>只读刷新</button>{loading && <span className="cnr-caption" role="status">正在读取记录…</span>}</div>
      {tab === 'history' ? <>
        <h3>结论与建议审查记录</h3>
        {reviews.length ? <ul className="cnr-history-list">{reviews.map(review => <li key={review.verificationId}><button type="button" disabled={posting || loading || inProgress} onClick={() => { setTab('review'); void refresh(review.verificationId); }}><strong>{review.review.report.relativePath}</strong><small>{status[review.state]} · {timestamp(review.createdAt)}</small><small>{review.review.report.sha256}</small></button></li>)}</ul> : <p className="cnr-caption">尚无结论审查记录。</p>}
        <VerificationPanel readOnly project={project} task={task} configurations={configurations} taskBusy={taskBusy} filesRevision={filesRevision} requirementContext={requirementContext} caseContext={caseContext} semanticContext={semanticContext} />
      </> : <>
        {transition && transition.state !== 'ready' && <p className="cnr-notice" role="status"><strong>待确认旧流程已收尾</strong><br />{transition.reason ?? '原记录仍可回看，旧流程收尾后可开始新审查。'}</p>}
        {pending && <p className="cnr-notice" role="status">本次启动结果尚未确认，操作编号 {pending}。请只读刷新原请求。</p>}
        {form ? <>
          <div className="cnr-field"><label htmlFor={uid + '-report'}>报告版本</label><select id={uid + '-report'} value={chosen ? reportKey(chosen) : ''} disabled={locked || archived} onChange={event => { setChosen(candidates.reports.find(item => reportKey(item) === event.target.value)); setError(''); reportRequest.current++; setReportView(undefined); }}>
            <option value="">选择已保存的报告版本</option>
            {choiceMissing && <option value={reportKey(chosen)}>先前选择 · {chosen.relativePath} · {chosen.sha256?.slice(0, 12)}</option>}
            {candidates.reports.map(item => <option key={reportKey(item)} value={reportKey(item)} disabled={!item.reviewable}>{item.relativePath} · {item.sha256?.slice(0, 12) ?? '版本不可核对'}{item.current ? ' · 当前交付' : ''}{item.reviewable ? '' : ' · 当前不可审'}</option>)}
          </select></div>
          {chosen && <div className="cnr-version"><strong>{chosen.relativePath}</strong><code>{chosen.sha256 ?? '版本未核对'}</code><small>{chosen.current ? '本任务可证的当前报告' : '本任务获准查看的已保存报告'}</small></div>}
          {!candidates.reports.length && !loading && <p className="cnr-caption">当前没有可审报告。请在原任务保存可定位的报告后重新读取。</p>}
          {candidates.reports.some(item => !item.reviewable) && <details className="cnr-evidence"><summary>当前不可审的候选</summary>
            {candidates.reports.filter(item => !item.reviewable).map(item => <p key={reportKey(item)}>{item.relativePath} · {item.reason?.includes('too_large') ? '超过完整报告审查的技术限额。' : item.textStatus === 'not-utf8' ? '无法完整解码为 UTF-8 正文。' : '当前归属、授权或文件版本未能核对。'}</p>)}
          </details>}
          {candidates.limitations?.map((note, index) => <p className="cnr-caption" key={index}>{note}</p>)}
          {chosen && <button type="button" className="text-button" disabled={posting || loading} onClick={() => void viewReport()}>查看本版报告</button>}
          <details className="cnr-evidence"><summary>审查依据 · 可选</summary>
            <p className="cnr-caption">所选报告全文将固定，以下为本次可选依据。</p>
            {candidates.basisFiles.map(file => <label key={file.relativePath}><input type="checkbox" checked={basis.includes(file.relativePath)} disabled={locked || archived} onChange={event => setBasis(previous => event.target.checked ? [...previous, file.relativePath] : previous.filter(path => path !== file.relativePath))} /><span>{file.relativePath}</span></label>)}
            {requirementContext && <label><input type="checkbox" checked={useRequirement} disabled={locked || archived} onChange={event => setUseRequirement(event.target.checked)} /><span>附带已选需求 · {requirementContext.title}</span></label>}
            {caseContext && <label><input type="checkbox" checked={useCase} disabled={locked || archived} onChange={event => setUseCase(event.target.checked)} /><span>附带 Case · {caseContext.title} · 修订 {caseContext.revision}</span></label>}
            <label><input type="checkbox" checked={useSap} disabled={locked || archived} onChange={event => setUseSap(event.target.checked)} /><span>本次使用项目启用的 SAP</span></label>
            {enterpriseMaterials.length > 0 && <label><input type="checkbox" checked={useEnterprise} disabled={locked || archived} onChange={event => setUseEnterprise(event.target.checked)} /><span>附带本次已选企业资料 · {enterpriseMaterials.length} 项</span></label>}
          </details>
          {!archived && <div className="cnr-actions"><button type="button" className="primary-button" disabled={locked || !chosen?.reviewable || !chosen.sha256 || taskBusy || transition?.state !== 'ready'} onClick={() => void begin()}>{posting ? '正在开始…' : '开始审查'}</button></div>}
          {taskBusy && <p className="cnr-caption">原分析任务正在运行，空闲后可开始审查。</p>}
        </> : current && <>
          <div className="cnr-version"><strong>{current.review.report.relativePath}</strong><code>{current.review.report.sha256}</code><small>{status[current.state]} · {timestamp(current.createdAt)}</small></div>
          {updated && <p className="cnr-notice"><strong>有更新版本</strong><br />以下意见仍对应所示 SHA 版本。新版须明确选择并开始审查。</p>}
          <div className="cnr-actions">
            {current.sourceStatus !== 'unavailable' && <button type="button" className="text-button" disabled={posting} onClick={() => void viewReport()}>查看本版报告</button>}
            {inProgress && !archived && <button type="button" className="secondary-button" disabled={posting} onClick={() => void stop()}>停止审查</button>}
          </div>
          {current.sourceStatus === 'unavailable' ? <p className="cnr-notice">来源当前不可读取，此版意见和正文已隐藏。</p> : <>
            {current.diagnostic?.message && <p className="cnr-notice">{current.diagnostic.message}</p>}
            {output && <><BoardHandoff key={current.verificationId} projectId={project.id} taskId={task.id} review={current} archived={archived} refreshToken={observe} onOpenBoard={onOpenBoard} /><h3>逐条意见</h3>{output.claims.map((claim, index) => <Claim claim={claim} first={index === 0} materials={current.review.materials} key={claim.id} />)}
              <details className="cnr-evidence"><summary>实际审查范围</summary><p>{output.scope.reviewed}</p>{[...output.scope.unreviewed, ...output.scope.limitations].map((note, index) => <p key={index}>{note}</p>)}</details>
            </>}
            <Materials review={current.review} evidence={current.contextEvidence} />
          </>}
          <div className="cnr-actions">
            {output && !archived && <button type="button" className="primary-button" disabled={carrying || posting || taskBusy || current.canCarry !== true} onClick={() => void carry()}>{carrying ? '正在带回…' : '带回分析'}</button>}
            {!inProgress && !pending && !archived && <button type="button" className="secondary-button" onClick={() => { setForm(true); setError(''); setNotice(''); }}>{updated ? '选择新版报告' : '另选报告版本'}</button>}
          </div>
          {output && <p className="cnr-caption">意见追加到原任务草稿，由你核对后使用原发送入口。</p>}
        </>}
      </>}
    </div>
    {reportView && <PersonalDialog title="本版报告" subtitle={reportView.title + ' · ' + reportView.sha256} onClose={() => setReportView(undefined)}><pre className="cnr-report-text">{reportView.text}</pre></PersonalDialog>}
  </aside>;
}
