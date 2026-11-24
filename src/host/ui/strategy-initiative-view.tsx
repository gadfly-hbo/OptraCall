import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { CaseDialog } from './CaseDialogs.tsx';
import type { CandidateVersion, KickoffFields, KickoffReportVersion, VerificationBatch, VerificationGate } from '../strategy-initiative-types.ts';
import type { InitiativeFile, InitiativePublication } from './strategy-initiative-client.ts';

export const gateNames = ['因果检验 · TOC/TP', '逻辑检验 · 战略假设'] as const;
export const gateMissions = ['因果检验 Agent · 核对因果链、前提和反例', '战略假设 Agent · 核对假设、取舍和验证方法'] as const;
export type BadgeTone = 'neutral' | 'accent' | 'positive' | 'warning' | 'error';
export function Badge({ tone = 'neutral', children }: { tone?: BadgeTone; children: ReactNode }) { return <span className={`si-badge si-badge-${tone}`}>{children}</span>; }
export const candidateLabel = (candidate: Pick<CandidateVersion, 'title' | 'no'>) => `${candidate.title} · v${candidate.no}`;
export const formatTime = (value?: string) => value ? new Date(value).toLocaleString('zh-CN', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '时间未记录';

export const latestBatch = (batches: VerificationBatch[], candidate: Pick<CandidateVersion, 'candidateId' | 'no'>) => batches.filter(batch => batch.candidateId === candidate.candidateId && batch.no === candidate.no).at(-1);
export const passedBatchFor = (batches: VerificationBatch[], candidate: CandidateVersion) => candidate.lock ? batches.find(batch => batch.candidateId === candidate.candidateId && batch.no === candidate.no && batch.state === 'passed' && batch.contentSha256 === candidate.lock!.fingerprint && batch.lockOperationId === candidate.lock!.operationId && batch.gates.every(gate => gate.status === 'completed' && gate.verdict === 'pass')) : undefined;
export const publicationFor = (publications: InitiativePublication[], candidate: Pick<CandidateVersion, 'candidateId' | 'no'>) => publications.filter(item => item.candidateId === candidate.candidateId && item.no === candidate.no).at(-1);

export function reportBadge(version: KickoffReportVersion, anchor?: { reportNo: number }): { label: string; tone: BadgeTone } {
  if (anchor?.reportNo === version.no) return { label: '已应用为方案输入', tone: 'positive' };
  return version.lock ? { label: '已锁定', tone: 'accent' } : { label: '草稿', tone: 'neutral' };
}
export function candidateStatus(candidate: CandidateVersion, options: { busy?: boolean; batch?: VerificationBatch; publication?: InitiativePublication } = {}): { label: string; tone: BadgeTone } {
  const { busy, batch, publication } = options;
  if (publication?.state === 'active') return { label: '当前发布', tone: 'positive' };
  if (publication?.state === 'replaced') return { label: '已被替代', tone: 'neutral' };
  if (publication?.state === 'withdrawn') return { label: '已撤销 · 锁定稿保留', tone: 'warning' };
  if (candidate.returned) return { label: '检验退回', tone: 'error' };
  if (busy || candidate.lastRun?.status === 'accepted') return { label: '会话生成中', tone: 'accent' };
  if (candidate.lock && batch?.state === 'passed' && batch.contentSha256 === candidate.lock.fingerprint) return { label: '待发布', tone: 'positive' };
  if (candidate.lock && batch?.state === 'running') return { label: '检验中', tone: 'accent' };
  if (candidate.lock) return { label: '已锁定 · 待检验', tone: 'accent' };
  return { label: '候选', tone: 'neutral' };
}
export type MainSessionPresentationInput = {
  dispatching: boolean;
  pending: { requestId: string } | null;
  lastRun?: { id: string; status: string };
  busy: boolean;
  live: boolean;
  snapshotRunning: boolean;
  disconnected: boolean;
};
export type MainSessionPresentation = {
  kind: 'idle' | 'sending' | 'running' | 'succeeded' | 'failed' | 'cancelled' | 'disconnected' | 'interrupted' | 'unknown';
  label: string; detail: string; tone: BadgeTone; canRecover: boolean; canReplace: boolean;
};
export function mainSessionPresentation(input: MainSessionPresentationInput): MainSessionPresentation {
  const {dispatching, pending, busy, live, snapshotRunning, disconnected} = input;
  const lastRun = pending ? (input.lastRun?.id === pending.requestId ? input.lastRun : undefined) : input.lastRun;
  const running = busy || live || snapshotRunning;
  const base = {canRecover: false, canReplace: false};
  if (dispatching) return {kind: 'sending', label: '正在发送并等待受理', detail: '原输入和请求编号已保留；尚未收到受理回执，不会重复派发。', tone: 'accent', ...base};
  if (lastRun?.status === 'accepted' && running) return {
    kind: 'running', label: disconnected ? '已受理运行中 · 观察连接受损' : '已受理运行中',
    detail: disconnected ? 'Host 仍在运行，仅观察连接受损；可只读核对，不会自动重发。' : 'Host 已受理本轮请求，Agent 正在执行；原请求保留用于防止重复派发。',
    tone: 'accent', canRecover: Boolean(pending && disconnected), canReplace: false,
  };
  if (lastRun?.status === 'completed') return {kind: 'succeeded', label: '本轮已完成', detail: '已收到完成回执，讨论记录和已保存成果保持可核对。', tone: 'positive', ...base};
  if (lastRun?.status === 'failed') return {kind: 'failed', label: '本轮失败', detail: '失败回执和原输入保留；可先核对原请求，再明确是否替换后发送。', tone: 'error', canRecover: Boolean(pending), canReplace: Boolean(pending && !busy)};
  if (lastRun?.status === 'cancelled') return {kind: 'cancelled', label: '本轮已取消', detail: '取消回执和原输入保留；未自动重发，可核对后明确替换。', tone: 'neutral', canRecover: Boolean(pending), canReplace: Boolean(pending && !busy)};
  if (lastRun?.status === 'unknown') return {kind: 'unknown', label: '原请求结果未知', detail: '技术结果尚未确认，原输入和编号保留；先只读核对，不自动重发。', tone: 'warning', canRecover: Boolean(pending), canReplace: false};
  if (lastRun?.status === 'accepted') return {
    kind: 'interrupted', label: '原请求结果未确认',
    detail: '记录显示已受理，但当前没有存活运行资源；可能是 Host 重开后的中断。先核对原请求，明确后再替换，未自动重发。',
    tone: 'warning', canRecover: Boolean(pending), canReplace: Boolean(pending && !busy),
  };
  if (!pending && (busy || snapshotRunning)) return {kind: 'running', label: disconnected ? '运行中 · 观察连接受损' : '运行中', detail: disconnected ? 'Host 仍在运行，可只读核对；不会自动重发。' : 'Host 正在处理当前请求。', tone: 'accent', ...base};
  if (disconnected) return {kind: 'disconnected', label: '观察连接受损', detail: '仅实时观察不可用；可刷新讨论记录核对，未重发消息。', tone: 'warning', canRecover: Boolean(pending), canReplace: false};
  if (pending) return {kind: 'unknown', label: '原请求受理状态待核', detail: '尚未核对到原请求的准确状态，输入与原编号保留；请先只读核对，不要重复发送。', tone: 'warning', canRecover: true, canReplace: false};
  return {kind: 'idle', label: '', detail: '', tone: 'neutral', ...base};
}

export function gateStatus(gate?: VerificationGate): { label: string; tone: BadgeTone } {
  if (!gate) return { label: '未开始', tone: 'neutral' };
  if (gate.verdict === 'pass') return { label: '通过', tone: 'positive' };
  if (gate.verdict === 'fail') return { label: '不通过', tone: 'error' };
  if (gate.verdict === 'insufficient') return { label: '依据不足', tone: 'warning' };
  if (gate.status === 'running') return { label: '检验中', tone: 'accent' };
  if (gate.status === 'waiting') return { label: '等待前道通过', tone: 'neutral' };
  if (gate.status === 'failed') return { label: '技术失败', tone: 'error' };
  if (gate.status === 'cancelled') return { label: '已取消', tone: 'neutral' };
  if (gate.status === 'unknown') return { label: '结果未知', tone: 'warning' };
  return { label: '结果未知', tone: 'warning' };
}

const kickoffSectionLabels: Record<'horizon' | 'diagnosis' | 'assumptions' | 'evidenceGaps' | 'followUp', string> = { horizon: '时间视野', diagnosis: '诊断摘要', assumptions: '事实与假设', evidenceGaps: '证据缺口', followUp: '后续方案形成要求' };
export function KickoffBody({ version }: { version: KickoffReportVersion }) {
  const fields = version.fields;
  return <div className="si-body">
    {(['horizon', 'diagnosis'] as const).map(key => <section className="si-content-block" key={key}><h4>{kickoffSectionLabels[key]}</h4><p>{fields[key]}</p></section>)}
    <section className="si-content-block"><h4>核心战略命题</h4>{fields.propositions.map(proposition => <div className="si-proposition" key={proposition.id}>
      <strong>{proposition.id} · {proposition.question}</strong>
      <p>为何影响选择：{proposition.whyItMatters}</p>
      {proposition.evidence && <p className="si-muted">依据：{proposition.evidence}</p>}
      {proposition.gaps && <p className="si-muted">缺口：{proposition.gaps}</p>}
    </div>)}</section>
    {(['assumptions', 'evidenceGaps', 'followUp'] as const).map(key => fields[key] ? <section className="si-content-block" key={key}><h4>{kickoffSectionLabels[key]}</h4><p>{fields[key]}</p></section> : null)}
    {fields.priorReview && <p className="si-muted">上期经营复盘：{fields.priorReview === 'not-applicable' ? '标记不适用' : '适用'}</p>}
    <section className="si-content-block"><h4>来源</h4>{version.sources.length ? <ul>{version.sources.map((source, index) => <li key={index}>{source.kind === 'file' ? '获准文件' : '公开来源'} · {source.title || source.ref}{source.sha256 && <span className="si-muted"> · 指纹 {source.sha256.slice(0, 12)}…</span>}</li>)}</ul> : <p className="si-muted">尚未记录来源；资料不足时如实记录依据强弱。</p>}</section>
  </div>;
}
export function CandidateBody({ candidate }: { candidate: CandidateVersion }) {
  return <div className="si-body">
    {candidate.blocks.length ? candidate.blocks.map(block => <section className="si-content-block" key={block.id}><h4>{block.label}</h4><p>{block.text}</p></section>) : <p className="si-muted">候选正文尚未回传；独立会话完成后在此核对。</p>}
    {candidate.goals.length > 0 && <section className="si-content-block"><h4>战略目标</h4><ul>{candidate.goals.map((goal, index) => <li key={index}>G{index + 1} · {goal}</li>)}</ul></section>}
  </div>;
}
export interface PatchTarget { blockId: string; label: string; text: string }
export function kickoffPatchTargets(fields: KickoffFields): PatchTarget[] {
  const targets: PatchTarget[] = (['horizon', 'diagnosis', 'assumptions', 'evidenceGaps', 'followUp'] as const).map(key => ({ blockId: key, label: kickoffSectionLabels[key], text: fields[key] }));
  for (const proposition of fields.propositions) {
    targets.push({ blockId: `proposition:${proposition.id}:question`, label: `命题 ${proposition.id} · 关键问题`, text: proposition.question });
    targets.push({ blockId: `proposition:${proposition.id}:whyItMatters`, label: `命题 ${proposition.id} · 为何影响选择`, text: proposition.whyItMatters });
    if (proposition.evidence !== undefined) targets.push({ blockId: `proposition:${proposition.id}:evidence`, label: `命题 ${proposition.id} · 依据`, text: proposition.evidence });
    if (proposition.gaps !== undefined) targets.push({ blockId: `proposition:${proposition.id}:gaps`, label: `命题 ${proposition.id} · 缺口`, text: proposition.gaps });
  }
  return targets;
}
export const reportText = (version: KickoffReportVersion) => [
  `时间视野\n${version.fields.horizon}`, `诊断摘要\n${version.fields.diagnosis}`,
  `核心战略命题\n${version.fields.propositions.map(p => `${p.id} ${p.question}\n为何影响选择：${p.whyItMatters}${p.evidence ? `\n依据：${p.evidence}` : ''}${p.gaps ? `\n缺口：${p.gaps}` : ''}`).join('\n\n')}`,
  `事实与假设\n${version.fields.assumptions}`, `证据缺口\n${version.fields.evidenceGaps}`, `后续方案形成要求\n${version.fields.followUp}`,
].join('\n\n');
export const candidateText = (candidate: CandidateVersion) => candidate.blocks.map(block => `${block.label}\n${block.text}`).join('\n\n') + (candidate.goals.length ? `\n\n战略目标\n${candidate.goals.map((goal, index) => `G${index + 1} · ${goal}`).join('\n')}` : '');

/** Presentation-only templates: both render the same locked content and the same fingerprint. */
export function ReleaseMap({ candidate, template }: { candidate: CandidateVersion; template: string }) {
  if (template === '条目表') return <div className="si-map si-map-list">
    <div className="si-map-node"><span>战略选择</span><strong>{candidate.title}</strong></div>
    {candidate.goals.map((goal, index) => <div className="si-map-node si-map-goal" key={index}><span>G{index + 1} · {index === 0 ? '核心结果' : '配套指标'}</span><strong>{goal}</strong></div>)}
  </div>;
  return <div className="si-map">
    <div className="si-map-node"><span>战略选择</span><strong>{candidate.title}</strong></div>
    <div className="si-map-arrow" aria-hidden="true">↓</div>
    <div className="si-map-grid">{candidate.goals.map((goal, index) => <div className="si-map-node si-map-goal" key={index}><span>G{index + 1} · {index === 0 ? '核心结果' : '配套指标'}</span><strong>{goal}</strong></div>)}</div>
  </div>;
}

export function LifecyclePlaceholderDialog({ module, onClose }: { module: '战略复盘' | '战略重构'; onClose: () => void }) {
  return <CaseDialog title={module} subtitle="战略生命周期占位 · 仅查看说明" onClose={onClose}>
    <p>{module === '战略复盘' ? '战略复盘用于验证假设、对照实际结果与战略预期，属于战略迭代期。此入口保留在战略生命周期中，本次工作台覆盖启动与规划、检验、发布和版本管理；复盘能力后续单独交付。' : '战略重构用于识别业务生命周期终点、安排退场与新生，属于战略重构期。此入口保留在战略生命周期中，本次不提供重构操作；相关能力后续单独交付。'}</p>
    <p className="si-muted">当前占位不创建记录、不调用模型，也不改变现有发布与目标。</p>
    <div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>关闭</button></div>
  </CaseDialog>;
}

export interface ReportFileEntry { name: string; kind: string; content: string }
export function systemReportEntries(reports: KickoffReportVersion[], candidates: CandidateVersion[], batches: VerificationBatch[]): ReportFileEntry[] {
  const entries: ReportFileEntry[] = reports.filter(version => version.lock).map(version => ({ name: `开题报告 · v${version.no}.md`, kind: '锁定报告', content: reportText(version) }));
  for (const candidate of candidates) {
    if (!candidate.blocks.length) continue;
    entries.push({ name: `${candidateLabel(candidate)}.md`, kind: '战略候选', content: candidateText(candidate) });
    const batch = latestBatch(batches, candidate);
    if (batch) for (const gate of batch.gates) {
      if (gate.verdict === 'pass' || gate.verdict === 'fail') entries.push({ name: `${gate.ref} · ${gate.turn ? '逻辑' : '因果'}检验.md`, kind: candidateLabel(candidate), content: gate.evidence || '结论证据暂不可读。' });
    }
  }
  return entries;
}

export function InitiativeFilePanel({ files, reports, candidates, batches, scopeKey, busy = false, onUpload, onOpenFile, onOpenReport }: {
  files: InitiativeFile[]; reports: KickoffReportVersion[]; candidates: CandidateVersion[]; batches: VerificationBatch[]; scopeKey: string; busy?: boolean;
  onUpload: (directory: '010_draw' | '020_clean', file: File, scopeExclusive: boolean) => void;
  onOpenFile: (file: InitiativeFile) => void; onOpenReport: (entry: ReportFileEntry) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [directory, setDirectory] = useState<'010_draw' | '020_clean'>('010_draw');
  const [scopeExclusive, setScopeExclusive] = useState(false);
  const reportEntries = systemReportEntries(reports, candidates, batches);
  const directories: { key: string; note: string; entries: ReactNode[] }[] = [
    { key: '010_draw', note: '原始资料', entries: files.filter(file => file.directory === '010_draw').map(file => <FileRow key={file.fileId} file={file} scopeKey={scopeKey} onOpen={() => onOpenFile(file)} />) },
    { key: '020_clean', note: '整理资料与过程产物', entries: files.filter(file => file.directory === '020_clean').map(file => <FileRow key={file.fileId} file={file} scopeKey={scopeKey} onOpen={() => onOpenFile(file)} />) },
    { key: '060_reports', note: '系统成果 · 锁定报告／候选／检验', entries: reportEntries.map(entry => <button type="button" className="si-file-entry" key={entry.name} onClick={() => onOpenReport(entry)}><span className="si-file-icon" aria-hidden="true">▤</span><span><strong>{entry.name}</strong><small>{entry.kind}</small></span></button>) },
  ];
  return <aside className="si-files" aria-label="事项文件">
    <div className="si-files-head"><div><h3>事项文件</h3><p className="si-muted">事项共用资料及当前范围</p></div></div>
    <div className="si-file-upload">
      <label>上传位置<select value={directory} disabled={busy} onChange={event => setDirectory(event.target.value as '010_draw' | '020_clean')}><option value="010_draw">010_draw · 原始资料</option><option value="020_clean">020_clean · 整理资料</option></select></label>
      <label className="si-check-row"><input type="checkbox" checked={scopeExclusive} disabled={busy} onChange={event => setScopeExclusive(event.target.checked)} />仅当前范围专属</label>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>{busy ? '正在处理…' : '＋ 上传资料'}</button>
      <input ref={input} type="file" hidden aria-label="选择上传文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) onUpload(directory, file, scopeExclusive); }} />
      <p className="si-muted">上传仅进入 010／020；060 由系统成果展示。目录不提供敏感数据隔离。</p>
    </div>
    {directories.map(folder => <details className="si-folder" key={folder.key} open={folder.key !== '020_clean' || undefined}>
      <summary><span aria-hidden="true">▱</span><strong>{folder.key}</strong><span className="si-file-count">{folder.key === '060_reports' ? reportEntries.length : files.filter(file => file.directory === folder.key).length}</span><small>{folder.note}</small></summary>
      <div className="si-folder-entries">{folder.entries.length ? folder.entries : <p className="si-muted">{folder.key === '060_reports' ? '暂无成果' : '暂无文件'}</p>}</div>
    </details>)}
  </aside>;
}
function FileRow({ file, scopeKey, onOpen }: { file: InitiativeFile; scopeKey: string; onOpen: () => void }) {
  const exclusive = file.scopeKey !== undefined;
  return <button type="button" className="si-file-entry" onClick={onOpen}>
    <span className="si-file-icon" aria-hidden="true">▤</span>
    <span><strong>{file.name}</strong><small>{exclusive ? (file.scopeKey === scopeKey ? '范围专属 · 当前范围' : '范围专属 · 其他范围') : '事项共用'} · {(file.size / 1024).toFixed(1)} KB</small></span>
  </button>;
}
