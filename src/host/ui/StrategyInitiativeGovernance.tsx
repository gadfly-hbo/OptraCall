import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { CaseDialog, CaseFormError, useOperationId } from './CaseDialogs.tsx';
import { StrategyDiscussionPanel } from './StrategyDiscussionPanel.tsx';
import type { LegacyStrategyStage, ManagementStage } from './ManagementTabs.tsx';
import type { GoalScope, GoalRef, GoalVersion, GoalDiscussionSourceRef } from '../strategy-goals-types.ts';
import type { ClientProject, PublicModelConfiguration } from './project-types.ts';
import type { CandidateVersion, KickoffAnchor, KickoffReportVersion, VerificationBatch } from '../strategy-initiative-types.ts';
import { initiativeScopeKey } from '../strategy-initiative-types.ts';
import * as api from './strategy-initiative-client.ts';
import type { InitiativeHistory, InitiativePublication } from './strategy-initiative-client.ts';
import { Badge, CandidateBody, KickoffBody, ReleaseMap, candidateLabel, candidateStatus, formatTime, gateMissions, gateNames, gateStatus, latestBatch, passedBatchFor, publicationFor } from './strategy-initiative-view.tsx';

export type CandidateRef = { candidateId: string; no: number };
const sameRef = (candidate: CandidateVersion, ref: CandidateRef | null) => Boolean(ref && candidate.candidateId === ref.candidateId && candidate.no === ref.no);
const lockedCandidates = (candidates: CandidateVersion[]) => candidates.filter(candidate => candidate.lock);

function CandidatePicker({ candidates, current, onSelect, label }: { candidates: CandidateVersion[]; current?: CandidateVersion; onSelect: (ref: CandidateRef) => void; label: string }) {
  if (!candidates.length) return null;
  return <label className="si-inline-picker">{label}<select aria-label={label} value={current ? `${current.candidateId}:${current.no}` : ''} onChange={event => { const [candidateId, no] = event.target.value.split(':'); if (candidateId && no) onSelect({ candidateId, no: Number(no) }); }}>
    {!current && <option value="">请选择版本</option>}
    {candidates.slice().reverse().map(candidate => <option key={`${candidate.candidateId}:${candidate.no}`} value={`${candidate.candidateId}:${candidate.no}`}>{candidateLabel(candidate)}</option>)}
  </select></label>;
}

export function StrategyCheckPanel({ initiativeId, candidates, batches, selected, onSelect, onStage, onRevise, onRefresh }: {
  initiativeId: string; candidates: CandidateVersion[]; batches: VerificationBatch[]; selected: CandidateRef | null;
  onSelect: (ref: CandidateRef) => void; onStage: (stage: ManagementStage) => void; onRevise: (candidate: CandidateVersion) => void; onRefresh: () => Promise<void>;
}) {
  const options = lockedCandidates(candidates);
  const current = options.find(candidate => sameRef(candidate, selected)) ?? options.at(-1);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const batch = current ? latestBatch(batches, current) : undefined;
  const passed = current ? passedBatchFor(batches, current) : undefined;
  const act = async (action: () => Promise<unknown>) => { if (busy) return; setBusy(true); setError(''); try { await action(); await onRefresh(); } catch (fault) { setError(api.errorText(fault)); } finally { setBusy(false); } };
  return <section className="sg-panel si-panel" aria-label="战略检验">
    <div className="si-panel-head"><div><p className="si-eyebrow">锁定版本 · 独立检验</p><h2>战略检验</h2></div><CandidatePicker candidates={options} current={current} onSelect={onSelect} label="所见版本" /></div>
    <CaseFormError error={error} />
    {!current ? <div className="si-empty"><p>先在战略共创中审核并锁定候选，再启动因果检验。</p><button type="button" className="primary-button" onClick={() => onStage('co-create')}>回到战略共创</button></div> : <>
      <div className="si-section-lead"><strong>{candidateLabel(current)}</strong><Badge tone={candidateStatus(current, { batch, publication: undefined }).tone}>{candidateStatus(current, { batch }).label}</Badge><span className="si-muted">开题 v{current.anchor.reportNo} · 指纹 {current.contentSha256.slice(0, 12)}…</span></div>
      <ol className="si-gate-list">{gateNames.map((name, turn) => {
        const gate = batch?.gates[turn];
        const status = gateStatus(gate);
        const canRetry = Boolean(batch && gate && ['failed', 'cancelled', 'unknown'].includes(gate.status) && batch.state !== 'running' && (turn === 0 || batch.gates[0].verdict === 'pass'));
        return <li className="si-gate-card" key={turn}>
          <span className="si-gate-index" aria-hidden="true">{turn + 1}</span>
          <div className="si-gate-body">
            <div className="si-panel-head"><div><h3>{name}</h3><p className="si-muted">{gateMissions[turn]}</p></div><Badge tone={status.tone}>{status.label}</Badge></div>
            {gate?.evidence && <p>{gate.evidence}</p>}
            {gate && <p className="si-muted">{gate.ref} · 绑定 {candidateLabel(current)} · 开题 v{current.anchor.reportNo}{gate.finishedAt ? ` · ${formatTime(gate.finishedAt)}` : ''}</p>}
            {gate?.sources?.length ? <ul className="si-muted">{gate.sources.map((source, index) => <li key={index}>{source.kind} · {source.ref}{source.sha256 ? ` · ${source.sha256.slice(0, 12)}…` : ''}</li>)}</ul> : null}
            {turn === 1 && batch && batch.gates[0].verdict !== 'pass' && <p className="si-muted">因果检验通过后可以开始。</p>}
            {canRetry && <div className="si-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { void act(() => api.retryVerificationGate(initiativeId, current.candidateId, current.no, turn as 0 | 1, { operationId: crypto.randomUUID() })); }}>核对或重试原检验</button></div>}
          </div>
        </li>;
      })}</ol>
      {current.returned && <><p className="si-notice si-notice-warning" role="status">检验意见已留档，业务退回停止后续检验与发布。修订会生成新候选版本，并从因果检验重走。</p><div className="si-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => onRevise(current)}>按检验意见修订</button></div></>}
      {!batch && <div className="si-actions"><button type="button" className="primary-button" disabled={busy} onClick={() => { void act(() => api.startVerification(initiativeId, current.candidateId, current.no, { operationId: crypto.randomUUID() })); }}>{busy ? '正在启动…' : '启动检验'}</button></div>}
      {batch?.state === 'running' && <div className="si-actions"><button type="button" className="secondary-button" disabled={busy} onClick={() => { void act(() => api.stopVerification(initiativeId, batch.batchId)); }}>停止本批检验</button><span className="si-muted" role="status">串行检验运行中；因果通过后自动启动逻辑检验。</span></div>}
      {passed && <><p className="si-notice si-notice-positive" role="status">两份结论已绑定同一锁定版。可以提交决策者审核。</p><div className="si-actions"><button type="button" className="primary-button" onClick={() => onStage('strategy-release')}>前往战略发布</button></div></>}
    </>}
  </section>;
}

export function PublishConfirmDialog({ initiativeId, candidate, batch, prior, template, onPublished, onClose }: {
  initiativeId: string; candidate: CandidateVersion; batch: VerificationBatch; prior?: InitiativePublication; template: string;
  onPublished: () => Promise<void>; onClose: () => void;
}) {
  const [confirmed, setConfirmed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed || busy || !candidate.lock) return;
    const id = operationId({ candidateId: candidate.candidateId, no: candidate.no, sha256: candidate.lock.fingerprint, batchId: batch.batchId, template, expectedActive: prior?.publicationId ?? null });
    setBusy(true); setError('');
    void api.publishInitiative(initiativeId, { operationId: id, candidateId: candidate.candidateId, no: candidate.no, sha256: candidate.lock.fingerprint, batchId: batch.batchId, template, confirmed: true, expectedActive: prior?.publicationId ?? null })
      .then(async () => { await onPublished(); onClose(); })
      .catch(fault => setError(api.errorText(fault)))
      .finally(() => setBusy(false));
  };
  return <CaseDialog title="确认正式发布" subtitle={`${candidateLabel(candidate)} · 锁定指纹 ${candidate.contentSha256.slice(0, 12)}…`} busy={busy} onClose={onClose} className="si-version-dialog">
    <form onSubmit={submit}>
      {prior && <p className="si-notice si-notice-warning" role="status">确认后将替代当前发布「{prior.candidateId.slice(0, 8)} · v{prior.no}」。同一事项同一范围仅一条有效发布；已有目标与回执保留。</p>}
      <ReleaseMap candidate={candidate} template={template} />
      <div className="si-review-lines">{batch.gates.map((gate, turn) => <p key={turn}><strong>{gateNames[turn]} · 通过</strong><br />{gate.evidence || '证据暂不可读。'}<br /><span className="si-muted">{gate.ref}</span></p>)}</div>
      <label className="si-check-row"><input type="checkbox" required checked={confirmed} disabled={busy} onChange={event => setConfirmed(event.target.checked)} />我已核对准确版方案及两份带依据的检验结论。</label>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !confirmed}>{busy ? '正在发布…' : '确认发布'}</button></div>
    </form>
  </CaseDialog>;
}

export function WithdrawConfirmDialog({ initiativeId, publication, label, onWithdrawn, onClose }: { initiativeId: string; publication: InitiativePublication; label: string; onWithdrawn: () => Promise<void>; onClose: () => void }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  return <CaseDialog title="撤销当前发布" subtitle={`${label} · 发布 ${publication.publicationId.slice(0, 8)}`} busy={busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault(); if (busy) return;
      const id = operationId({ publicationId: publication.publicationId });
      setBusy(true); setError('');
      void api.withdrawPublication(initiativeId, publication.publicationId, { operationId: id }).then(async () => { await onWithdrawn(); onClose(); }).catch(fault => setError(api.errorText(fault))).finally(() => setBusy(false));
    }}>
      <p>撤销后停止新增承接。原锁定稿、检验结论、已导入目标和下游引用均保留；同一锁定版不能重新发布。恢复发布需取新候选版本并重新锁定、检验及审查。</p>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="danger-button" disabled={busy}>{busy ? '正在撤销…' : '确认撤销发布'}</button></div>
    </form>
  </CaseDialog>;
}

export function HandoffDialog({ initiativeId, publication, candidate, scope, scopes, onDone, onClose }: { initiativeId: string; publication: InitiativePublication; candidate: CandidateVersion; scope: GoalScope; scopes: GoalScope[]; onDone: () => Promise<void>; onClose: () => void }) {
  const options = scopes.length ? [...new Map(scopes.map(item => [initiativeScopeKey(item), item])).values()] : [scope];
  const [scopeKey, setScopeKey] = useState(options.some(item => initiativeScopeKey(item) === initiativeScopeKey(scope)) ? initiativeScopeKey(scope) : initiativeScopeKey(options[0]!));
  const [selected, setSelected] = useState<number[]>(candidate.goals.map((_, index) => index));
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const operationId = useOperationId();
  const destination = options.find(item => initiativeScopeKey(item) === scopeKey) ?? scope;
  return <CaseDialog title="核对承接的目标与策略" subtitle={`${candidateLabel(candidate)} · 发布 ${publication.publicationId.slice(0, 8)}`} busy={busy} onClose={onClose}>
    <form onSubmit={event => {
      event.preventDefault(); if (busy || !selected.length) return;
      const id = operationId({ publicationId: publication.publicationId, scopeKey, selected });
      setBusy(true); setError('');
      void api.handoffPublication(initiativeId, publication.publicationId, { operationId: id, scope: destination, selected }).then(async () => { await onDone(); onClose(); }).catch(fault => setError(api.errorText(fault))).finally(() => setBusy(false));
    }}>
      <div className="case-field"><label htmlFor="si-handoff-scope">目标归属范围</label><select id="si-handoff-scope" value={scopeKey} disabled={busy} onChange={event => setScopeKey(event.target.value)}>{options.map(item => <option key={initiativeScopeKey(item)} value={initiativeScopeKey(item)}>{item.name}</option>)}</select></div>
      {candidate.goals.length ? candidate.goals.map((goal, index) => <label className="si-check-row" key={index}><input type="checkbox" checked={selected.includes(index)} disabled={busy} onChange={event => setSelected(old => event.target.checked ? [...old, index] : old.filter(item => item !== index))} /><span><strong>G{index + 1} · {goal}</strong><br /><span className="si-muted">关联策略 · {candidate.title}</span></span></label>) : <p className="si-muted">此锁定版未列出可承接目标；仍可保留发布记录。</p>}
      <p className="si-muted">保存后进入目标管理成为候选，等待单独采用；发布本身不创建目标，也不启动执行。</p>
      <CaseFormError error={error} />
      <div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>取消</button><button type="submit" className="primary-button" disabled={busy || !selected.length}>{busy ? '正在保存…' : '保存目标候选'}</button></div>
    </form>
  </CaseDialog>;
}

export function StrategyReleaseReview({ initiativeId, scope, scopes, candidates, batches, publications, selected, onSelect, onStage, onRefresh, onGoalsChanged }: {
  initiativeId: string; scope: GoalScope; scopes: GoalScope[]; candidates: CandidateVersion[]; batches: VerificationBatch[]; publications: InitiativePublication[];
  selected: CandidateRef | null; onSelect: (ref: CandidateRef) => void; onStage: (stage: ManagementStage) => void; onRefresh: () => Promise<void>; onGoalsChanged: () => Promise<void>;
}) {
  const options = lockedCandidates(candidates);
  const current = options.find(candidate => sameRef(candidate, selected)) ?? options.at(-1);
  const [template, setTemplate] = useState('树形地图');
  const [dialog, setDialog] = useState<'publish' | 'withdraw' | 'handoff' | null>(null);
  const scopeKey = initiativeScopeKey(scope);
  const active = publications.find(item => item.scopeKey === scopeKey && item.state === 'active');
  const publication = current ? publicationFor(publications, current) : undefined;
  const passed = current ? passedBatchFor(batches, current) : undefined;
  const eligible = Boolean(current?.lock && passed && !publication && !current?.returned);
  const refresh = async () => { await onRefresh(); };
  const published = async () => { await onRefresh(); };
  return <section className="sg-panel si-panel" aria-label="战略发布">
    <div className="si-panel-head"><div><p className="si-eyebrow">决策者复核</p><h2>战略发布</h2></div><CandidatePicker candidates={options} current={current} onSelect={onSelect} label="所见版本" /></div>
    <div className="si-section-lead"><span className="si-muted">{scope.name} · 当前发布</span><strong>{active ? `${active.candidateId.slice(0, 8)} · v${active.no}` : '暂无'}</strong></div>
    {!current ? <div className="si-empty"><p>通过两道检验的锁定版将在此等待审核。</p><button type="button" className="primary-button" onClick={() => onStage('strategy-check')}>查看战略检验</button></div> : <>
      <div className="si-panel-head"><div><h3>{candidateLabel(current)}</h3><p className="si-muted">锁定 {current.lock!.operationId.slice(0, 8)} · 开题 v{current.anchor.reportNo}{publication ? ` · 发布时展示 ${publication.template}` : ''}</p></div><Badge tone={candidateStatus(current, { batch: latestBatch(batches, current), publication }).tone}>{candidateStatus(current, { batch: latestBatch(batches, current), publication }).label}</Badge></div>
      {(eligible || publication) && passed ? <>
        <div className="si-template"><label className="si-inline-picker">展示模板<select aria-label="展示模板" value={template} onChange={event => setTemplate(event.target.value)}><option>树形地图</option><option>条目表</option></select></label><span className="si-muted">仅调整呈现，沿用同一锁定版及检验报告。</span></div>
        <ReleaseMap candidate={current} template={template} />
        <details className="si-review-details"><summary>查看完整方案与取舍</summary><CandidateBody candidate={current} /></details>
        <details className="si-review-details"><summary>查看两道检验结论</summary>{passed.gates.map((gate, turn) => <div className="si-content-block" key={turn}><h4>{gateNames[turn]} · 通过</h4><p>{gate.evidence || '证据暂不可读。'}</p><p className="si-muted">{gate.ref} · 批次 {passed.batchId.slice(0, 8)}</p></div>)}</details>
      </> : !publication && <p className="si-notice si-notice-warning" role="status">此版本尚未取得发布资格。请核对两道检验的结果。</p>}
      {publication?.state === 'withdrawn' && <p className="si-notice si-notice-warning" role="status">此版已撤销，保留原稿、检验结论和承接历史。同版不能重新发布。</p>}
      {publication?.state === 'replaced' && <p className="si-notice" role="status">此版已被同范围的新版替代，可继续查看原有回执。</p>}
      {publication && publication.handoffs.length > 0 && <p className="si-muted">{publication.handoffs.length} 批目标候选已导入 · 采用由目标管理另行确认</p>}
      <div className="si-actions">
        {eligible && passed && <button type="button" className="primary-button" onClick={() => setDialog('publish')}>核对并正式发布</button>}
        {publication?.state === 'active' && <><button type="button" className="primary-button" onClick={() => setDialog('handoff')}>带入目标管理</button><button type="button" className="danger-button" onClick={() => setDialog('withdraw')}>撤销发布</button></>}
        {!eligible && !publication && <button type="button" className="secondary-button" onClick={() => onStage('strategy-check')}>查看战略检验</button>}
      </div>
    </>}
    {dialog === 'publish' && current && passed && <PublishConfirmDialog initiativeId={initiativeId} candidate={current} batch={passed} prior={active} template={template} onPublished={published} onClose={() => setDialog(null)} />}
    {dialog === 'withdraw' && publication && <WithdrawConfirmDialog initiativeId={initiativeId} publication={publication} label={current ? candidateLabel(current) : ''} onWithdrawn={refresh} onClose={() => setDialog(null)} />}
    {dialog === 'handoff' && publication && current && <HandoffDialog initiativeId={initiativeId} publication={publication} candidate={current} scope={scope} scopes={scopes} onDone={async () => { await refresh(); await onGoalsChanged(); }} onClose={() => setDialog(null)} />}
  </section>;
}

export function ReportVersionDialog({ version, anchor, onClose }: { version: KickoffReportVersion; anchor?: KickoffAnchor; onClose: () => void }) {
  const status = version.lock ? (anchor?.reportNo === version.no ? '已应用为方案输入' : '已锁定') : '草稿';
  return <CaseDialog title={`开题报告 · v${version.no}`} subtitle={`${status}${version.parent ? ` · 修订自 v${version.parent}` : ''}`} onClose={onClose} className="si-version-dialog">
    <div className="si-dialog-scroll">
      <p className="si-muted">生成 {version.generation.kind} · {formatTime(version.generation.at)}{version.lock ? ` · 锁定 ${version.lock.operator} · ${formatTime(version.lock.at)}` : ''}</p>
      <p className="si-muted">内容指纹 <code>{version.contentSha256}</code></p>
      {version.revision && <p className="si-muted">限定修订请求：{version.revision.request} · 仅更新 {version.revision.patches.map(patch => patch.blockId).join('、')}</p>}
      <KickoffBody version={version} />
    </div>
    <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>关闭</button></div>
  </CaseDialog>;
}

export function VersionReceiptDialog({ candidate, anchorReport, batch, publication, onClose, onViewReport }: {
  candidate: CandidateVersion; anchorReport?: KickoffReportVersion; batch?: VerificationBatch; publication?: InitiativePublication; onClose: () => void; onViewReport?: () => void;
}) {
  const status = candidateStatus(candidate, { batch, publication });
  return <CaseDialog title={`查看准确版本 · ${candidateLabel(candidate)}`} subtitle={`候选会话 ${candidate.candidateId.slice(0, 8)} · 开题报告 v${candidate.anchor.reportNo}${candidate.parent ? ` · 修订自 v${candidate.parent.no}` : ''}`} onClose={onClose} className="si-version-dialog">
    <div className="si-dialog-scroll">
      <p><Badge tone={status.tone}>{status.label}</Badge></p>
      <p className="si-muted">内容指纹 <code>{candidate.contentSha256}</code>{candidate.lock ? ` · 锁定 ${candidate.lock.operator} · ${formatTime(candidate.lock.at)}` : ' · 尚未锁定'}</p>
      {candidate.revisionMeta && <p className="si-muted">限定修订请求：{candidate.revisionMeta.request} · 仅更新 {candidate.revisionMeta.patches.map(patch => patch.blockId).join('、')}</p>}
      <CandidateBody candidate={candidate} />
      {batch && <section className="si-content-block"><h4>检验回执 · 批次 {batch.batchId.slice(0, 8)}</h4>{batch.gates.map((gate, turn) => <div key={turn}><p><strong>{gateNames[turn]} · {gateStatus(gate).label}</strong></p><p>{gate.evidence || '证据暂不可读。'}</p><p className="si-muted">{gate.ref}{gate.finishedAt ? ` · ${formatTime(gate.finishedAt)}` : ''}</p></div>)}</section>}
      {publication && <section className="si-content-block"><h4>发布记录 · {publication.publicationId.slice(0, 8)}</h4>
        <p>{publication.state === 'active' ? '当前有效' : publication.state === 'replaced' ? `已被替代${publication.replacedBy ? ` → ${publication.replacedBy.slice(0, 8)}` : ''}` : '已撤销'} · 展示 {publication.template} · {formatTime(publication.publishedAt)}</p>
        {publication.withdrawnAt && <p className="si-muted">撤销于 {formatTime(publication.withdrawnAt)}；同版不能重发。</p>}
        {publication.handoffs.length ? publication.handoffs.map(receipt => <p key={receipt.operationId} className="si-muted">承接 {receipt.operationId.slice(0, 8)} · {receipt.scope.name} · {receipt.goals.map(goal => `${goal.goalId.slice(0, 8)} v${goal.version}`).join('、')} · {formatTime(receipt.at)}</p>) : <p className="si-muted">尚无目标承接回执。</p>}
      </section>}
      {anchorReport ? <section className="si-content-block"><h4>锚定开题报告 v{anchorReport.no}</h4><p className="si-muted">指纹 {anchorReport.contentSha256.slice(0, 12)}…</p>{onViewReport && <button type="button" className="text-button" onClick={onViewReport}>查看原开题报告</button>}</section> : <p className="si-muted">锚定开题报告 v{candidate.anchor.reportNo} 当前暂不可读；版本身份保留。</p>}
    </div>
    <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>关闭</button></div>
  </CaseDialog>;
}

export interface LegacyDiscussionAccess {
  active: boolean;
  scopes: GoalScope[]; projects: ClientProject[]; configurations: PublicModelConfiguration[]; selectedConfigurationId?: string | null;
  onSettings: () => void; getGoalScope?: (goal: GoalRef) => GoalScope | undefined; selectedGoal?: GoalVersion;
  onGoalsChanged: (goals?: GoalVersion[]) => Promise<void>;
  onReviewCandidate: (goal: GoalVersion, discussionId: string, reload: () => Promise<void>) => void;
  onStage: (stage: ManagementStage) => void;
}
export function LegacyDiscussionReadback({ discussionId, access, focusRequest }: { discussionId: string; access: LegacyDiscussionAccess; focusRequest?: { source: GoalDiscussionSourceRef; id: string } }) {
  const [stage, setStage] = useState<LegacyStrategyStage>('direction');
  const [notice, setNotice] = useState('');
  return <div className="si-legacy">
    <p className="si-muted">旧讨论沿原入口回读；其地图发布不计为当前有效版，旧发布与新增承接入口已退役。</p>
    {notice && <p className="si-notice" role="status">{notice}</p>}
    <StrategyDiscussionPanel
      stage={stage === 'strategy-release' ? 'direction' : stage}
      onStage={next => { if (next === 'goals') { access.onStage('goals'); return; } if (next === 'strategy-release') { setNotice('旧地图发布入口已退役；当前发布与承接请在「战略发布」和上方台账核对。'); return; } setStage(next); }}
      active={access.active} scopes={access.scopes} getGoalScope={access.getGoalScope} selectedGoal={access.selectedGoal}
      projects={access.projects} configurations={access.configurations} selectedConfigurationId={access.selectedConfigurationId}
      onSettings={access.onSettings} onGoalsChanged={access.onGoalsChanged} onReviewCandidate={access.onReviewCandidate}
      focusRequest={focusRequest?.source.id === discussionId ? focusRequest : undefined}
    />
  </div>;
}

interface LedgerEvent { at: string; title: string; detail: string; view?: { kind: 'report' | 'candidate'; no?: number; candidateId?: string } }
function ledgerEvents(history: InitiativeHistory, scopeKey: string): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (const version of history.reports.versions) {
    events.push({ at: version.generation.at, title: version.generation.kind === 'revision' ? '开题报告限定修订' : version.generation.kind === 'agent' ? '开题草稿已保存' : '开题报告已保存', detail: `v${version.no}${version.parent ? ` · 父版 v${version.parent}` : ''}`, view: { kind: 'report', no: version.no } });
    if (version.lock) events.push({ at: version.lock.at, title: '锁定开题报告', detail: `v${version.no} · ${version.lock.operator}`, view: { kind: 'report', no: version.no } });
  }
  for (const anchor of Object.values(history.reports.anchors)) events.push({ at: anchor.at, title: '应用开题报告', detail: `v${anchor.reportNo} · ${anchor.scope.name}`, view: { kind: 'report', no: anchor.reportNo } });
  for (const candidate of history.candidates) {
    if (candidate.scopeKey !== scopeKey) continue;
    events.push({ at: candidate.createdAt, title: candidate.revisionMeta ? '候选限定修订另存' : '候选会话已启动', detail: `${candidateLabel(candidate)} · 开题 v${candidate.anchor.reportNo}`, view: { kind: 'candidate', candidateId: candidate.candidateId, no: candidate.no } });
    if (candidate.lock) events.push({ at: candidate.lock.at, title: '锁定战略候选', detail: `${candidateLabel(candidate)} · ${candidate.lock.operator}`, view: { kind: 'candidate', candidateId: candidate.candidateId, no: candidate.no } });
    if (candidate.returned) events.push({ at: candidate.returned.at, title: '检验业务退回', detail: `${candidateLabel(candidate)} · 批次 ${candidate.returned.batchId.slice(0, 8)}`, view: { kind: 'candidate', candidateId: candidate.candidateId, no: candidate.no } });
  }
  for (const batch of history.verifications) {
    const candidate = history.candidates.find(item => item.candidateId === batch.candidateId && item.no === batch.no);
    if (candidate && candidate.scopeKey !== scopeKey) continue;
    events.push({ at: batch.createdAt, title: '检验批次已发起', detail: `批次 ${batch.batchId.slice(0, 8)} · ${candidate ? candidateLabel(candidate) : `${batch.candidateId.slice(0, 8)} v${batch.no}`}`, view: candidate ? { kind: 'candidate', candidateId: candidate.candidateId, no: candidate.no } : undefined });
    for (const gate of batch.gates) if (gate.finishedAt) events.push({ at: gate.finishedAt, title: `${gateNames[gate.turn]} ${gateStatus(gate).label}`, detail: `${gate.ref} · ${gate.evidence ?? '原始依据保留'}`, view: candidate ? { kind: 'candidate', candidateId: candidate.candidateId, no: candidate.no } : undefined });
  }
  for (const publication of history.publications) {
    if (publication.scopeKey !== scopeKey) continue;
    const candidate = history.candidates.find(item => item.candidateId === publication.candidateId && item.no === publication.no);
    const label = candidate ? candidateLabel(candidate) : `${publication.candidateId.slice(0, 8)} v${publication.no}`;
    const view = candidate ? { kind: 'candidate' as const, candidateId: candidate.candidateId, no: candidate.no } : undefined;
    events.push({ at: publication.publishedAt, title: '决策者确认正式发布', detail: `${label} · 展示 ${publication.template}`, view });
    if (publication.replacedAt) events.push({ at: publication.replacedAt, title: '原发布已被替代', detail: `${label} · 同事项同范围新版生效`, view });
    if (publication.withdrawnAt) events.push({ at: publication.withdrawnAt, title: '发布已撤销', detail: `${label} · 同版不能重发`, view });
    for (const receipt of publication.handoffs) events.push({ at: receipt.at, title: '已保存目标候选', detail: `${label} · ${receipt.goals.length} 个目标 · ${receipt.scope.name}`, view });
  }
  return events.sort((a, b) => b.at.localeCompare(a.at));
}

export function StrategyVersionsPanel({ initiativeId, scopeKey, history, access, legacyId, onLegacySelect, legacyFocus }: {
  initiativeId: string; scopeKey: string; history: InitiativeHistory | null; access: LegacyDiscussionAccess;
  legacyId: string; onLegacySelect: (id: string) => void; legacyFocus?: { source: GoalDiscussionSourceRef; id: string };
}) {
  const [viewing, setViewing] = useState<{ kind: 'report'; no: number } | { kind: 'candidate'; candidateId: string; no: number } | null>(null);
  const [historyError, setHistoryError] = useState('');
  const [localHistory, setLocalHistory] = useState(history);
  useEffect(() => { setLocalHistory(history); }, [history]);
  useEffect(() => {
    if (history) return;
    let alive = true;
    void api.readInitiativeHistory(initiativeId).then(value => { if (alive) setLocalHistory(value); }).catch(fault => { if (alive) setHistoryError(api.errorText(fault)); });
    return () => { alive = false; };
  }, [initiativeId, history]);
  const data = localHistory;
  const scopeCandidates = data?.candidates.filter(candidate => candidate.scopeKey === scopeKey) ?? [];
  const scopePublications = data?.publications.filter(publication => publication.scopeKey === scopeKey) ?? [];
  const activeCount = scopePublications.filter(publication => publication.state === 'active').length;
  const viewingReport = viewing?.kind === 'report' ? data?.reports.versions.find(version => version.no === viewing.no) : undefined;
  const viewingCandidate = viewing?.kind === 'candidate' ? data?.candidates.find(candidate => candidate.candidateId === viewing.candidateId && candidate.no === viewing.no) : undefined;
  const anchor = data?.reports.anchors[scopeKey];
  return <section className="sg-panel si-panel" aria-label="版本管理">
    <div className="si-panel-head"><div><p className="si-eyebrow">准确版本与回执</p><h2>版本管理</h2><p className="si-muted">含事项共用开题报告 · 当前范围候选与发布</p></div></div>
    <CaseFormError error={historyError} />
    {!data ? <p role="status">正在读取版本台账…</p> : <>
      <div className="si-ledger">
        <h3>开题报告</h3>
        {data.reports.versions.length ? data.reports.versions.slice().reverse().map(version => {
          const status = version.lock ? (anchor?.reportNo === version.no ? { label: '已应用为方案输入', tone: 'positive' as const } : { label: '已锁定', tone: 'accent' as const }) : { label: '草稿', tone: 'neutral' as const };
          return <div className="si-ledger-row" key={version.no}><button type="button" className="text-button" onClick={() => setViewing({ kind: 'report', no: version.no })}>开题报告 · v{version.no}</button><Badge tone={status.tone}>{status.label}</Badge></div>;
        }) : <p className="si-muted">尚无开题版本。</p>}
        <h3>战略候选与父版</h3>
        {scopeCandidates.length ? scopeCandidates.slice().reverse().map(candidate => {
          const batch = latestBatch(data.verifications, candidate);
          const publication = publicationFor(data.publications, candidate);
          const status = candidateStatus(candidate, { batch, publication });
          return <div className="si-ledger-row" key={`${candidate.candidateId}:${candidate.no}`}>
            <button type="button" className="text-button" onClick={() => setViewing({ kind: 'candidate', candidateId: candidate.candidateId, no: candidate.no })}>{candidateLabel(candidate)}</button>
            <span className="si-muted">{candidate.parent ? `父版 v${candidate.parent.no} · ` : ''}开题 v{candidate.anchor.reportNo}</span>
            <Badge tone={status.tone}>{status.label}</Badge>
          </div>;
        }) : <p className="si-muted">此范围尚无候选。</p>}
        <h3>检验批次</h3>
        {data.verifications.filter(batch => scopeCandidates.some(candidate => candidate.candidateId === batch.candidateId && candidate.no === batch.no)).length ? data.verifications.filter(batch => scopeCandidates.some(candidate => candidate.candidateId === batch.candidateId && candidate.no === batch.no)).slice().reverse().map(batch => <div className="si-ledger-row" key={batch.batchId}>
          <span>批次 {batch.batchId.slice(0, 8)} · {batch.candidateId.slice(0, 8)} v{batch.no}</span>
          <Badge tone={batch.state === 'passed' ? 'positive' : batch.state === 'returned' ? 'error' : batch.state === 'running' ? 'accent' : 'warning'}>{{ running: '运行中', passed: '两道通过', returned: '业务退回', stopped: '已停止', unknown: '结果未知' }[batch.state]}</Badge>
          <span className="si-muted">{batch.gates.map(gate => `${gate.turn ? '逻辑' : '因果'} ${gateStatus(gate).label}`).join(' · ')}</span>
        </div>) : <p className="si-muted">此范围尚无检验批次。</p>}
        <h3>发布与承接</h3>
        {scopePublications.length ? <><p className="si-muted">{scopePublications.length} 份发布记录 · {activeCount ? `当前有效 ${activeCount} 份` : '当前无有效版'}</p>{scopePublications.slice().reverse().map(publication => <div className="si-ledger-row" key={publication.publicationId}>
          <span>发布 {publication.publicationId.slice(0, 8)} · {publication.candidateId.slice(0, 8)} v{publication.no}</span>
          <Badge tone={publication.state === 'active' ? 'positive' : publication.state === 'withdrawn' ? 'warning' : 'neutral'}>{{ active: '当前有效', replaced: '已被替代', withdrawn: '已撤销' }[publication.state]}</Badge>
          <span className="si-muted">{publication.handoffs.length ? `${publication.handoffs.length} 批承接回执` : '尚无承接'}</span>
        </div>)}</> : <p className="si-muted">此范围尚无发布记录。</p>}
      </div>
      <div className="si-timeline"><h3>操作记录</h3>{ledgerEvents(data, scopeKey).length ? ledgerEvents(data, scopeKey).map((event, index) => <div className="si-event" key={index}>
        <span className="si-event-dot" aria-hidden="true" />
        <div><strong>{event.title}</strong><p>{event.detail}</p><p className="si-muted">{formatTime(event.at)}</p>{event.view && <button type="button" className="text-button" onClick={() => setViewing(event.view!.kind === 'report' ? { kind: 'report', no: event.view!.no! } : { kind: 'candidate', candidateId: event.view!.candidateId!, no: event.view!.no! })}>查看此版</button>}</div>
      </div>) : <p className="si-muted">锁定、检验和发布后可在此查看操作回执。</p>}</div>
      <div className="si-legacy-entry"><h3>原战略讨论</h3>
        {data.legacy.discussions.length ? <label className="si-inline-picker">选择旧讨论<select aria-label="选择旧讨论" value={legacyId} onChange={event => onLegacySelect(event.target.value)}><option value="">不回读</option>{data.legacy.discussions.map(discussion => <option key={discussion.id} value={discussion.id}>{discussion.title}</option>)}</select></label> : <p className="si-muted">尚无旧讨论记录。</p>}
        <p className="si-muted">旧讨论、模拟与历史文稿按原准确引用查阅；旧地图发布不成为当前有效版。</p>
        {legacyId && <LegacyDiscussionReadback key={legacyId} discussionId={legacyId} access={access} focusRequest={legacyFocus} />}
      </div>
    </>}
    {viewingReport && <ReportVersionDialog version={viewingReport} anchor={anchor} onClose={() => setViewing(null)} />}
    {viewingCandidate && <VersionReceiptDialog candidate={viewingCandidate} anchorReport={data?.reports.versions.find(version => version.no === viewingCandidate.anchor.reportNo)} batch={latestBatch(data?.verifications ?? [], viewingCandidate)} publication={publicationFor(data?.publications ?? [], viewingCandidate)} onClose={() => setViewing(null)} onViewReport={() => setViewing({ kind: 'report', no: viewingCandidate.anchor.reportNo })} />}
  </section>;
}