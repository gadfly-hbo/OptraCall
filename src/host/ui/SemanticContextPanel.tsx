import { useEffect, useRef, useState } from 'react';
import { PersonalDialog } from './PersonalDialog.tsx';
import type { AssetContextRecord, StudioContextEvidence } from './semantic-context-history.ts';
import { readSemanticContext } from './semantic-context-client.ts';
import type { SemanticContextReader, SemanticContextRecord, SemanticGraphResult, SemanticGraphMetadata, SemanticItem, SemanticQueryInput, SemanticQueryResult, SemanticSourceState, SemanticTarget } from './semantic-context-client.ts';
import type { StudioSemanticGraphSourceRef } from '../../../extensions/business-plugins/semantic-context/graph.ts';
import { StudioRuleReceiptView } from './StudioRuleExecutionView.tsx';
import { StudioFoundationContent } from './StudioFoundationView.tsx';
import { readPreservedReportSnapshot, readTurnPackEvidence, type TurnPackEvidenceResponse } from './member-pack-client.ts';
import './semantic-context.css';

export type SemanticContextPanelProps = {
  projectId: string;
  taskId: string;
  sessionId?: string;
  messageId?: string;
  records?: AssetContextRecord[];
  turnEvidence?: TurnPackEvidenceResponse;
  readContext?: SemanticContextReader;
  onFollowup?: (draft: string) => void;
};

export function SemanticContextPanel(props: SemanticContextPanelProps) {
  return <SemanticContextOwner key={`${props.projectId}/${props.taskId}`} {...props} />;
}

function SemanticContextOwner({ projectId, taskId, sessionId, messageId, records = [], turnEvidence: suppliedTurnEvidence, readContext = readSemanticContext, onFollowup }: SemanticContextPanelProps) {
  const [open, setOpen] = useState(false), trigger = useRef<HTMLButtonElement>(null);
  const [view, setView] = useState<'saved' | 'current'>('saved'), [lookup, setLookup] = useState<SemanticContextLookup>({ state: 'idle' });
  const [turnEvidence, setTurnEvidence] = useState<TurnPackEvidenceResponse | undefined>(suppliedTurnEvidence);
  const [reportPreview, setReportPreview] = useState<{ locator: string; sha256: string; text: string } | { error: string } | null>(null);
  const current = useRef(0), controller = useRef<AbortController | null>(null), input = useRef<SemanticQueryInput | null>(null);
  useEffect(() => () => { ++current.current; controller.current?.abort(); }, []);
  useEffect(() => {
    if (!open || suppliedTurnEvidence) return;
    const ac = new AbortController();
    void readTurnPackEvidence(projectId, taskId, sessionId, messageId, ac.signal)
      .then(res => { if (!ac.signal.aborted) setTurnEvidence(res); })
      .catch(() => { /* pack feature may be disabled or empty */ });
    return () => ac.abort();
  }, [open, projectId, taskId, sessionId, messageId, suppliedTurnEvidence]);
  function cancel() { ++current.current; controller.current?.abort(); controller.current = null; setLookup({ state: 'cancelled' }); }
  function close() { if (controller.current) cancel(); setOpen(false); }
  async function query(request: SemanticQueryInput) {
    controller.current?.abort();
    const epoch = ++current.current, operation = new AbortController();
    controller.current = operation; input.current = request; setView('current'); setLookup({ state: 'loading' });
    try {
      const result = await readContext(projectId, taskId, request, operation.signal);
      if (operation.signal.aborted || epoch !== current.current) return;
      setLookup({ state: 'done', result });
    } catch (error) {
      if (operation.signal.aborted || epoch !== current.current) return;
      setLookup({ state: 'error', error: error instanceof Error ? error.message : '本次来源查询未能核定。' });
    } finally { if (epoch === current.current) controller.current = null; }
  }
  async function inspectSavedReport(packId: string, locator: string, sha256?: string) {
    try {
      const snap = await readPreservedReportSnapshot(packId, projectId, locator, sha256, taskId);
      setReportPreview({ locator: snap.locator, sha256: snap.sha256, text: snap.text });
    } catch (err) {
      setReportPreview({ error: err instanceof Error ? err.message : '无法按准确摘要回读原报告。' });
    }
  }
  const read = (target: SemanticTarget) => { void query({ action: 'read', target }); }, trace = (target: SemanticTarget) => { void query({ action: 'trace', target }); };
  return <div className="semantic-context-entry"><button ref={trigger} className="text-button" type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>本次依据</button>{open && <PersonalDialog drawer title="本次依据与前提变化" subtitle="原记录与现在回看分别展示；查看不启动模型" returnFocus={trigger.current} onClose={close}>
    <nav className="sc-view-switch" aria-label="依据查看方式"><button className="text-button" type="button" aria-pressed={view === 'saved'} onClick={() => setView('saved')}>原稿与当时返回</button><button className="text-button" type="button" aria-pressed={view === 'current'} onClick={() => setView('current')}>现在回看</button></nav>
    <SemanticContextDetails records={records} turnEvidence={turnEvidence} reportPreview={reportPreview} onInspectSavedReport={inspectSavedReport} view={view} lookup={lookup} onRead={read} onTrace={trace} onCancel={cancel} onFollowup={onFollowup ? draft => { close(); onFollowup(draft); } : undefined} onContinue={lookup.result?.coverage.continuation && input.current ? () => { void query({ ...input.current!, continuation: lookup.result!.coverage.continuation }); } : undefined} onContinueRecord={record => { if (record.input && record.result?.coverage.continuation) void query({ ...record.input, continuation: record.result.coverage.continuation }); }} />
  </PersonalDialog>}</div>;
}

const sourceLabels: Record<SemanticSourceState, string> = { available: '来源可读', missing: '来源缺失', 'hash-conflict': '哈希冲突', forbidden: '权限不足', excluded: '已排除', disabled: '已停用', unknown: '未知', partial: '部分结果' };
const targetLabel = (target: SemanticTarget | StudioSemanticGraphSourceRef): string => {
  switch (target.kind) {
    case 'studio-source': return `Studio ${target.systemId} · ${target.assetId}@${target.version}`;
    case 'sap': return `${target.packageId}@${target.version}${target.metricName ? ` · ${target.metricName}` : ''}`;
    case 'sap-method': return `SAP 方法 ${target.methodId} · v${target.version}`;
    case 'enterprise': return `${target.materialId} · 修订 ${target.revisionId}`;
    case 'data-input': return `${target.datasetId} · 输入 ${target.inputVersionId}`;
    case 'data-description': return `${target.datasetId} · 说明 ${target.descriptionRevisionId} · 输入 ${target.inputVersionId}`;
    case 'data-citation': return `成果来源 ${target.citationId}`;
    case 'data-evidence': return `成果来源 ${target.citationId} · ${target.attachmentIndex === null ? '原报告' : `附件 ${target.attachmentIndex}`}`;
    case 'case-decision': return `${target.recordId} · 修订 ${target.revision}`;
    case 'case-choice': return `人的选择 ${target.choiceId}`;
    case 'source': return `原来源 · ${target.source.type}`;
    case 'personal': return '准确个人资料来源';
  }
};

function SemanticSource({ item, perspective, onRead, onTrace }: { item: SemanticItem; perspective: 'saved' | 'current'; onRead?: (target: SemanticTarget) => void; onTrace?: (target: SemanticTarget) => void }) {
  if (item.state === 'forbidden') return <article className="sc-source"><strong>权限不足</strong><p className="sc-meta">本项来源超出当前可读范围，身份与正文不展示。原任务仍可继续使用已获准材料。</p></article>;
  const bodyAvailable = !['missing', 'hash-conflict', 'forbidden'].includes(item.state);
  return <article className="sc-source"><div className="sc-row"><h4>{item.title || targetLabel(item.target)}</h4><span className="sc-status">{sourceLabels[item.state]}</span></div>
    <p className="sc-meta">{targetLabel(item.target)}</p>
    <dl className="sc-metadata"><dt>留存时间{item.recordedAt ? `（${item.recordedAt.field}）` : ''}</dt><dd>{item.recordedAt?.value ?? '未记录 · UNKNOWN'}</dd><dt>业务时间声明</dt><dd>{item.businessTime.length ? item.businessTime.map((time, index) => <div key={index}><span>{time.text}</span><small>原文位置：{time.source}</small></div>) : item.metadataFragment ? '当前片段未提供完整业务时间声明 · UNKNOWN' : '未记录 · UNKNOWN；不由留存时间推定'}</dd></dl>
    {item.declaration ? <div className="sc-note"><strong>作者声明 · {item.declaration.actor}</strong><p>{item.declaration.text}</p></div> : <p className="sc-meta">{item.metadataFragment ? '当前片段未提供完整作者引用声明，其余原元数据仍待读取。' : '本项没有作者引用声明；已提供或检索命中不代表采用。'}</p>}
    {bodyAvailable && item.body !== null && ['excluded', 'disabled', 'unknown'].includes(item.state) && <p className="sc-note">沿原权限返回的准确历史原文，仅供核对；当前治理提示仍保留，不代表可重新供给 Agent。</p>}
    {!bodyAvailable || item.body === null ? <p className="sc-note">本次未返回可核定原文；正文未知，不用同名或最新版本替代。</p> : <><p className="sc-meta">{item.range ? `准确原文片段 [${item.range.start}, ${item.range.end}) / ${item.range.total} UTF-16；不代表全文` : '本次返回的原文'}</p><pre className="sc-paper">{item.body}</pre></>}
    {item.relations.length > 0 && <section className="sc-relations"><h5>显式引用与关系</h5><p className="sc-meta">方向沿原记录；关系声明不证明事实或因果。</p>{item.relations.map((relation, index) => relation.state === 'forbidden' ? <div className="sc-relation" key={index}><p className="sc-note">关联来源超出当前可读范围，权限不足；不展示目标身份或原始关系定位。</p></div> : <div className="sc-relation" key={index}><p>{targetLabel(item.target)} → <strong>{relation.relation}</strong> → {relation.target ? targetLabel(relation.target) : '准确目标未知'}</p><p className="sc-meta">{relation.claim === 'author-declaration' ? '作者关系声明' : '原记录显式引用'}{relation.note ? ` · ${relation.note}` : ''}</p>{relation.target && onRead && <button className="text-button" type="button" onClick={() => onRead(relation.target!)}>按准确引用查看目标</button>}<details><summary>关系原始引用</summary><pre>{JSON.stringify(relation, null, 2)}</pre></details></div>)}</section>}
    {item.gaps.length > 0 && <ul className="sc-gaps">{item.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
    {item.metadataFragment && <details><summary>原始元数据片段</summary><p className="sc-meta">准确 JSON 原文片段 [{item.metadataFragment.range.start}, {item.metadataFragment.range.end}) / {item.metadataFragment.range.total} UTF-16；不解析为完整关系或声明，后续内容仍未知。</p><pre>{item.metadataFragment.text}</pre></details>}
    <details><summary>{perspective === 'current' ? '本次核对的治理' : '当时返回的治理'}</summary>{item.governance === null ? <p>{item.metadataFragment ? '当前片段未提供治理全文 · UNKNOWN' : '治理未记录 · UNKNOWN'}</p> : <pre>{JSON.stringify(item.governance, null, 2)}</pre>}</details>
    <details><summary>准确身份与校验信息</summary><pre>{JSON.stringify({ target: item.target, sha256: item.sha256, code: item.code }, null, 2)}</pre></details>
    {(onRead || onTrace) && <div className="sc-row sc-actions">{onRead && <button className="secondary-button" type="button" onClick={() => onRead(item.target)}>现在回看准确原文</button>}{onTrace && <button className="text-button" type="button" onClick={() => onTrace(item.target)}>展开一层显式引用</button>}</div>}
  </article>;
}

export function SemanticContextEvidence({ result, perspective = 'saved', onRead, onTrace, onContinue }: { result: SemanticQueryResult; perspective?: 'saved' | 'current'; onRead?: (target: SemanticTarget) => void; onTrace?: (target: SemanticTarget) => void; onContinue?: () => void }) {
  return <div className="sc-evidence"><p className="sc-note">{result.action === 'find' ? '目录命中只说明本次找到了候选。' : '原文、明确引用与提供记录分别保留。'}作者声明、实际提供与专业正确性分别核对；真实计算采用／专业正确性仍未因此获证。</p>
    <p className="sc-meta">{perspective === 'saved' ? '当时返回' : '本次回看'} · {sourceLabels[result.state]} · {result.coverage.complete ? '本次返回范围完整，不代表全部历史知识' : '范围未完整核定 · 部分／未知'}</p>
    {result.coverage.gaps.length > 0 && <ul className="sc-gaps">{result.coverage.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
    {!result.items.length && !result.unknownTime.length && <p className="sc-empty">本次没有取得匹配来源；不代表当时没有规则或事实不存在。原任务仍可继续。</p>}
    {result.items.map((item, index) => <SemanticSource key={`item-${index}`} item={item} perspective={perspective} onRead={onRead} onTrace={onTrace} />)}
    {result.unknownTime.length > 0 && <section className="sc-unknown-time"><h3>留存时间未知的来源</h3><p className="sc-meta">无法据留存时点判断是否属于当次范围；这些来源没有被当作不存在。</p>{result.unknownTime.map((item, index) => <SemanticSource key={`unknown-${index}`} item={item} perspective={perspective} onRead={onRead} onTrace={onTrace} />)}</section>}
    {result.coverage.continuation && <div className="sc-note"><p>仍有后续页／片段，当前结果不是完整范围。</p>{onContinue && <button className="secondary-button" type="button" onClick={onContinue}>继续读取本次查询</button>}</div>}
  </div>;
}

const conditionLabels = { stated: '来源已声明，是否成立仍需核查', 'required-not-established': '必要条件尚未核实成立', unknown: '未知', disputed: '有争议' };
const savedGraphJson = (value: unknown) => JSON.stringify(value, (key, item) => key === 'sourceHandle' || key === 'continuation' ? undefined : item, 2);
function GraphMetadata({ metadata }: { metadata: SemanticGraphMetadata }) {
  return <>
    <p className="sc-meta">声明性质：{metadata.claimKind}；来源投影、工程解释与合成设定均不等于业务已确认。</p>
    {metadata.conditionState && <p className="sc-note">条件状态：{metadata.conditionState} · {conditionLabels[metadata.conditionState]}</p>}
    {metadata.operandRole && <p className="sc-note">操作数角色：{metadata.operandRole}{metadata.operandRole === 'subtrahend' ? '（减项）' : '（被减项）'}</p>}
    {metadata.roleText && <p>字段角色：{metadata.roleText}</p>}
    {metadata.predicate && <p>原关系声明：{metadata.predicate}</p>}
    {metadata.weak !== undefined && <p className="sc-note">{metadata.weak ? '弱关系声明，仍需结合来源核查；不推定为业务确认。' : '已记录非弱关系声明；是否成立仍以原文与实际核查为准。'}</p>}
    {metadata.actualMethod && <p className="sc-meta">实际提取方法：{metadata.actualMethod}{metadata.assetKind ? ` · 源稿类型：${metadata.assetKind}` : ''}</p>}
    <dl className="sc-metadata"><dt>适用前提</dt><dd>{metadata.conditions.length ? metadata.conditions.map((condition, index) => <div key={index}>{condition}</div>) : '未另列前提；不表示任意场景适用'}</dd>
      <dt>限制</dt><dd>{metadata.limitations.length ? metadata.limitations.map((limit, index) => <div key={index}>{limit}</div>) : '未另列限制；不表示没有局限'}</dd>
      <dt>业务时间声明</dt><dd>{metadata.businessTime.length ? metadata.businessTime.map((time, index) => <div key={index}>{time.text}<small>原文位置：{time.source}</small></div>) : '未记录 · UNKNOWN；不由图构建时间推定'}</dd></dl>
    {metadata.sourceRefs.length > 0 && <ul className="sc-gaps">{metadata.sourceRefs.map((ref, index) => <li key={index}>{targetLabel(ref)}{(ref.kind === 'sap' || ref.kind === 'sap-method') && ref.publishedHash == null && <small>发布哈希未声明 · UNKNOWN；不补造校验信息</small>}</li>)}</ul>}
    {metadata.buildSources.length > 0 && <p className="sc-meta">构建定位：{metadata.buildSources.map(source => `${source.inputKey} · ${source.locator}${source.nature ? ` · ${source.nature}` : ''}`).join('；')}。工程整理不冒充企业确认。</p>}
    <details><summary>原始元数据与准确引用</summary><pre>{savedGraphJson(metadata)}</pre></details>
  </>;
}

/** Only the actual saved payload is rendered. No graph continuation or source handle is activated here. */
export function SemanticGraphEvidence({ result }: { result: SemanticGraphResult }) {
  if (!['available', 'partial'].includes(result.state)) return <div className="sc-evidence"><p className="sc-note">当时返回 · {sourceLabels[result.state]}。本条语义结果未取得可展示正文，身份、原文与缓存内容不展示；具体依据仍为未知。原任务仍可继续。</p></div>;
  return <div className="sc-evidence"><h3>当时返回的业务含义</h3>
    <p className="sc-note">这是原工具当次实际提供的语义，不代表已正确采用或专业正确性已获证。条件、冲突与未知仍须结合原文核对；图中的依赖不证明因果。</p>
    <p className="sc-meta">{sourceLabels[result.state]} · {result.coverage.complete ? '本次返回范围完整；不代表全企业覆盖或经营真值' : '当时范围尚未完整核定 · 部分／未知'}{result.coverage.depthLimit !== undefined ? ` · 遍历上限 ${result.coverage.depthLimit}，实际深度 ${result.coverage.depthReached ?? '未知'}，${result.coverage.exhausted ? '本范围已穷尽' : '本范围未穷尽'}` : ''}</p>
    {result.coverage.gaps.length > 0 && <ul className="sc-gaps">{result.coverage.gaps.map((gap, index) => <li key={index}>{gap}</li>)}</ul>}
    {result.code && <p className="sc-note">当次状态：{result.code}</p>}
    {!result.nodes.length && !result.edges.length && !result.sources.length && <p className="sc-empty">当时没有取得本范围匹配内容；不代表规则或事实不存在。</p>}
    {result.nodes.map(node => <article className="sc-source" key={node.id}><div className="sc-row"><h4>{node.metadata.candidateLocator || node.type}</h4><span className="sc-status">{node.type}</span></div>
      {node.contentRange && <p className="sc-meta">准确语义片段 [{node.contentRange.start}, {node.contentRange.end}) / {node.contentRange.total} UTF-16；其余正文仍未返回。</p>}
      <pre className="sc-paper">{node.content}</pre><GraphMetadata metadata={node.metadata} /><details><summary>准确派生身份</summary><p>{node.id}</p></details></article>)}
    {result.edges.length > 0 && <section className="sc-relations"><h3>原关系与依据</h3><p className="sc-meta">每条关系保留原方向和独立依据；平行或相反声明分别展示，不自动裁决。</p>{result.edges.map(edge => <article className="sc-relation" key={edge.id}><h4>{edge.type}</h4><p>{edge.source} → {edge.target}</p><p className="sc-meta">关系身份：{edge.id}</p><GraphMetadata metadata={edge.metadata} /></article>)}</section>}
    {result.paths.length > 0 && <section className="sc-relations"><h3>当次有限依赖路径</h3><p className="sc-meta">相同节点顺序、不同关系依据的路径分别保留；不代表任意图的完整推理。</p>{result.paths.map((path, index) => <article className="sc-relation" key={JSON.stringify(path)}><h4>路径 {index + 1}</h4><p>{path.nodeIds.join(' → ')}</p><ol>{path.steps.map((step, stepIndex) => <li key={stepIndex}>{path.nodeIds[stepIndex]} {step.direction === 'forward' ? '→' : '←'} {path.nodeIds[stepIndex + 1]} · {step.edgeId} · {step.direction}</li>)}</ol></article>)}</section>}
    {result.sources.map((source, index) => <article className="sc-source" key={index}><h4>当时取得的准确原文</h4>{source.ref && <p className="sc-meta">{targetLabel(source.ref)}</p>}{source.buildSource && <p className="sc-meta">{source.buildSource.inputKey} · {source.buildSource.locator}；工程整理不冒充企业确认。</p>}<p className="sc-meta">来源性质：{source.nature}</p>
      {source.range && <p className="sc-meta">准确原文片段 [{source.range.start}, {source.range.end}) / {source.range.total} UTF-16；不代表全文。</p>}{source.body === null ? <p className="sc-note">当时未返回可核定正文 · UNKNOWN。</p> : <pre className="sc-paper">{source.body}</pre>}{source.gaps.length > 0 && <ul className="sc-gaps">{source.gaps.map((gap, gapIndex) => <li key={gapIndex}>{gap}</li>)}</ul>}</article>)}
    {result.coverage.continuation && <p className="sc-note">当时还有后续页／片段，当前详情仅展示已保存内容。需要时在原任务正常追问，重新取得有权结果。</p>}
    <details><summary>当时图快照的准确身份与校验信息</summary><pre>{savedGraphJson({ snapshot: result.snapshot, operation: result.operation })}</pre></details>
  </div>;
}

const verificationStatusText: Record<'pending' | 'pass' | 'fail' | 'partial', string> = {
  pending: '待独立核验',
  pass: '独立核验通过',
  fail: '独立核验未通过',
  partial: '部分通过（仍待补齐）',
};

function StudioEvidence({ evidence }: { evidence: StudioContextEvidence }) {
  if (evidence.action === 'reason') return <StudioRuleReceiptView receipt={evidence.result} historical />;
  const label = evidence.stage === 'directory' ? '企业资产目录' : evidence.stage === 'source' ? '准确来源读取' : evidence.stage === 'declaration' ? '作者使用声明' : evidence.stage === 'assessment' ? '独立核验回执' : '准确资产信息';
  const use = evidence.result.use && typeof evidence.result.use === 'object' && !Array.isArray(evidence.result.use) ? evidence.result.use as Record<string, any> : undefined;
  const memberPacks = Array.isArray(evidence.result.memberPacks) ? evidence.result.memberPacks as Record<string, any>[] : [];
  const memberPackUses = Array.isArray(evidence.result.memberPackUses) ? evidence.result.memberPackUses as Record<string, any>[] : [];
  const declaredReport = use?.report && typeof use.report === 'object' ? use.report as Record<string, any> : undefined;
  return <section className="sc-source"><div className="sc-row"><h3>{label}</h3><span className="sc-status">{evidence.stage === 'directory' ? '目录提供' : evidence.declaration ? '作者声明' : evidence.stage === 'assessment' ? '独立核验' : evidence.complete === true ? '本次返回完整' : evidence.complete === false ? '部分正文／元数据' : '范围待核'}</span></div>
    <p className="sc-note">{evidence.stage === 'directory' ? '目录命中不代表取得正文或采用资产。' : evidence.declaration ? '原 Studio 已保存作者明确声明的引用；不证明真实计算采用或专业正确。' : evidence.stage === 'assessment' ? '原 Studio 已记录核验回执；仅独立任务完整实读并通过复算核查后记为通过。' : '这里只展示当时实际返回的内容；读取成功不代表正确应用，采用声明另列。'}{memberPackUses.length === 0 ? '独立核验：详见下方本轮企业包独立核验状态（查实错版即使汇总数字相同也判该用途未通过，缺实际读取证据保持待验证）。' : ''}</p>
    {memberPacks.length > 0 && <div className="sc-relations"><h4>本任务固定的领域资产包目录供给</h4>{memberPacks.map((pack, idx) => <div className="sc-relation" key={String(pack.packId ?? idx)}><strong>{String(pack.name || pack.packCode || '企业领域资产包')}</strong> · 固定版 {pack.pinnedVersion ? `v${String(pack.pinnedVersion)}` : '未固定/未授权'}{pack.authorizationNote ? <p className="sc-meta">{String(pack.authorizationNote)}</p> : null}{Array.isArray(pack.purposes) && pack.purposes.length > 0 && <ul>{pack.purposes.map((pm: Record<string, any>) => <li key={String(pm.purposeId)}><strong>{String(pm.limitedCalculationName || pm.title)}</strong>（{String(pm.tier)}）· 授权层次：{Array.isArray(pm.accessLevels) ? pm.accessLevels.join(' / ') : '未核'}{pm.dataCutoffAt ? ` · 包截止 ${String(pm.dataCutoffAt)}` : ''}{Array.isArray(pm.grantedStores) && pm.grantedStores.length > 0 ? ` · 获准门店：${pm.grantedStores.join('、')}` : ''}{pm.authorizedSummary ? ` · 获准汇总：${String(pm.authorizedSummary.summaryAssetId)}@${String(pm.authorizedSummary.summaryVersion)}（${String(pm.authorizedSummary.grain)}）` : ''}{pm.restrictedDetailNote ? ` · ${String(pm.restrictedDetailNote)}` : ''}{Array.isArray(pm.dependencies) && pm.dependencies.length > 0 && <div className="sc-meta">固定原依赖：{pm.dependencies.map((d: any) => `${String(d.role)}:${String(d.ref?.id)}@${String(d.ref?.version)}`).join('；')}</div>}</li>)}</ul>}</div>)}</div>}
    {evidence.ref && <dl className="sc-metadata"><dt>来源权威</dt><dd>{evidence.ref.authority}</dd><dt>准确资产</dt><dd>{evidence.ref.id}</dd><dt>原版本</dt><dd>{evidence.ref.version}</dd>{evidence.ref.sha256 && <><dt>原内容摘要</dt><dd>{evidence.ref.sha256}</dd></>}{evidence.result.pinnedPack && typeof evidence.result.pinnedPack === 'object' ? <><dt>所属固定包版</dt><dd>v{String((evidence.result.pinnedPack as { packVersion?: string }).packVersion ?? '')}</dd></> : null}</dl>}
    {use && <dl className="sc-metadata"><dt>声明记录</dt><dd>{typeof use.id === 'string' ? use.id : '身份未记录'}</dd>{declaredReport?.locator && <><dt>关联已保存报告</dt><dd>{String(declaredReport.locator)}{declaredReport.sha256 ? ` · SHA-256 ${String(declaredReport.sha256).slice(0, 12)}` : ''}</dd></>}</dl>}
    {memberPackUses.length > 0 && <div className="sc-relations"><h4>本轮已登记的企业包采用与核验状态</h4>{memberPackUses.map((u, idx) => <p className="sc-meta" key={String(u.id ?? idx)}>用途 {String(u.purposeId)}（v{String(u.packVersion)}）· 状态：<strong>{verificationStatusText[(u.independentVerification?.status as 'pending' | 'pass' | 'fail') ?? 'pending'] ?? String(u.independentVerification?.status)}</strong>{u.independentVerification?.verdictDetail ? ` · ${String(u.independentVerification.verdictDetail)}` : ''}</p>)}</div>}
    {evidence.body !== undefined && <>{evidence.complete === true && <StudioFoundationContent body={evidence.body} sourceRef={evidence.ref} />}<p className="sc-meta">{evidence.complete === false ? '部分正文，不能当作全文。' : evidence.complete === true ? '本次准确返回的正文。' : '实际返回片段，完整性未核定。'}{evidence.range && ` 范围 [${evidence.range.start}, ${evidence.range.end}) / ${evidence.range.total}。`}</p><pre className="sc-paper">{evidence.body}</pre></>}
    {evidence.stage !== 'declaration' && evidence.stage !== 'assessment' && <p className="sc-meta">本项未保存作者使用声明；计算与判断请结合原报告、实际计算记录及其他来源声明核对。</p>}
    <details><summary>原 Studio 回执与准确引用</summary><pre>{JSON.stringify({ action: evidence.action, input: evidence.input, result: evidence.result }, null, 2)}</pre></details>
  </section>;
}

function TurnPackEvidenceSection({
  turnEvidence,
  reportPreview,
  onInspectSavedReport,
}: {
  turnEvidence: TurnPackEvidenceResponse;
  reportPreview?: { locator: string; sha256: string; text: string } | { error: string } | null;
  onInspectSavedReport?: (packId: string, locator: string, sha256?: string) => void;
}) {
  const hasAny = turnEvidence.savedReports.length > 0 || turnEvidence.useRecords.length > 0 || turnEvidence.feedbackLinks.length > 0;
  if (!hasAny) return null;
  const primaryPackId = turnEvidence.useRecords[0]?.packId ?? turnEvidence.feedbackLinks[0]?.packId;
  return <section className="sc-source" aria-label="本轮已保存报告与独立核验结果">
    <div className="sc-row"><h3>本轮已保存报告与独立核验结果</h3><span className="sc-status">{turnEvidence.useRecords.some(r => r.use.independentVerification.status === 'pass') ? '已有独立核验通过' : turnEvidence.useRecords.some(r => r.use.independentVerification.status === 'fail') ? '存在核验未通过' : '已关联本轮产物'}</span></div>
    {turnEvidence.savedReports.length > 0 && <div className="sc-relations"><h4>同轮已保存分析报告</h4><ul>{turnEvidence.savedReports.map((rep, idx) => <li key={`${rep.locator}:${rep.sha256}:${idx}`}><code>{rep.locator}</code>{rep.sha256 ? ` · SHA-256 ${rep.sha256.slice(0, 12)}` : ''}{primaryPackId && rep.locator && onInspectSavedReport && <> <button type="button" className="text-button" onClick={() => onInspectSavedReport(primaryPackId, rep.locator!, rep.sha256)}>按准确摘要查看原报告</button></>}</li>)}</ul></div>}
    {turnEvidence.useRecords.length > 0 && <div className="sc-relations"><h4>企业包采用与独立核验结论</h4>{turnEvidence.useRecords.map(entry => {
      const iv = entry.use.independentVerification;
      return <article className="sc-relation" key={entry.use.id}>
        <p><strong>{entry.packName || entry.packCode}</strong> · v{entry.use.packVersion} · 用途 <code>{entry.use.purposeId}</code> · <strong>{verificationStatusText[iv.status]}</strong>{iv.selfAssessmentOnly ? '（仅作者自评，未获独立通过）' : ''}</p>
        <p className="sc-meta">原报告：<code>{entry.use.reportRef.locator || entry.use.reportRef.id}</code>{entry.use.reportRef.sha256 ? `（SHA-256 ${entry.use.reportRef.sha256.slice(0, 12)}）` : ''}{entry.use.reportRef.locator?.startsWith('060_reports/') && onInspectSavedReport && <> <button type="button" className="text-button" onClick={() => onInspectSavedReport(entry.packId, entry.use.reportRef.locator!, entry.use.reportRef.sha256)}>查看原报告</button></>}</p>
        {iv.verifierTaskId && <p className="sc-meta">
          独立核验任务：{iv.verifierTaskId}
          {iv.assessmentReportRef?.locator ? ` · 核验报告：${iv.assessmentReportRef.locator}` : ''}
          {iv.verifierEvidenceSummary
            ? ` · 核验实读原依赖 ${iv.verifierEvidenceSummary.readRequiredAssetsCount}${typeof iv.verifierEvidenceSummary.requiredAssetsCount === 'number' ? `/${iv.verifierEvidenceSummary.requiredAssetsCount}` : ''} 项`
            : ''}
          {iv.verifierEvidenceSummary?.targetReportChecked === true
            ? ` · 已实读目标报告${typeof iv.verifierEvidenceSummary.targetReportReadTurnIndex === 'number' ? `（回合 #${iv.verifierEvidenceSummary.targetReportReadTurnIndex}）` : ''}`
            : iv.verifierEvidenceSummary?.targetReportChecked === false
              ? ' · 未实读目标报告'
              : ''}
          {typeof iv.verifierEvidenceSummary?.assessmentTurnIndex === 'number' ? ` · 核验回合 #${iv.verifierEvidenceSummary.assessmentTurnIndex}` : ''}
          {iv.verifierEvidenceSummary?.carriedFromTurnIndices?.length ? `（沿用前序回合 #${iv.verifierEvidenceSummary.carriedFromTurnIndices.join(', #')} 实读）` : ''}
          {iv.verifierEvidenceSummary?.assessmentReportBoundToTarget === false ? ' · 核验报告未绑定目标报告' : ''}
          {iv.verifierEvidenceSummary?.assessmentDisclaimerRejected === true ? ' · 核验声明未查看或未对照原报告（不可判通过）' : ''}
        </p>}
        <p className="sc-meta">核验说明：{iv.verdictDetail}</p>
      </article>;
    })}</div>}
    {turnEvidence.feedbackLinks.length > 0 && <div className="sc-relations"><h4>本轮关联企业包反馈与原 Case</h4><ul>{turnEvidence.feedbackLinks.map(fb => <li key={fb.feedbackId}><strong>{fb.feedbackCode} · {fb.title}</strong>（{fb.status}）· 报告 <code>{fb.reportRef.locator || '原回复'}</code>{fb.originalCaseRef ? ` · 原 Case：${fb.originalCaseRef.summary || fb.originalCaseRef.caseId}` : ''}</li>)}</ul></div>}
    {reportPreview && ('error' in reportPreview
      ? <p className="sc-error">{reportPreview.error}</p>
      : <div className="sc-relations"><h4>原报告快照回读 · {reportPreview.locator}</h4><p className="sc-meta">SHA-256：{reportPreview.sha256}</p><pre className="sc-paper">{reportPreview.text}</pre></div>)}
  </section>;
}

export type SemanticContextLookup = { state: 'idle' | 'loading' | 'cancelled' | 'error' | 'done'; result?: SemanticQueryResult; error?: string };
export function SemanticContextDetails({ records, turnEvidence, reportPreview, onInspectSavedReport, view, lookup, onRead, onTrace, onCancel, onFollowup, onContinue, onContinueRecord }: { records: AssetContextRecord[]; turnEvidence?: TurnPackEvidenceResponse; reportPreview?: { locator: string; sha256: string; text: string } | { error: string } | null; onInspectSavedReport?: (packId: string, locator: string, sha256?: string) => void; view: 'saved' | 'current'; lookup: SemanticContextLookup; onRead?: (target: SemanticTarget) => void; onTrace?: (target: SemanticTarget) => void; onCancel?: () => void; onFollowup?: (draft: string) => void; onContinue?: () => void; onContinueRecord?: (record: SemanticContextRecord) => void }) {
  return <div className="sc-content" aria-busy={view === 'current' && lookup.state === 'loading' || undefined}>
    {view === 'saved' ? <>
      <p className="sc-meta">以下按本条回复可核定的原工具结果展示。提供过、启用过与作者声明引用分别保留；不能重建当时全部已知信息。</p>
      {turnEvidence && <TurnPackEvidenceSection turnEvidence={turnEvidence} reportPreview={reportPreview} onInspectSavedReport={onInspectSavedReport} />}
      {!records.length && !(turnEvidence && (turnEvidence.savedReports.length || turnEvidence.useRecords.length || turnEvidence.feedbackLinks.length)) && <p className="sc-empty">本条回复尚无可核定的语义工具记录，原稿引用与实际采用为未知；不会用当前配置补齐。原任务仍可继续。</p>}
      {records.map((record, index) => <section className="sc-record" key={index} aria-label={`来源查询结果 ${index + 1}`}>
        {record.issue && <p className="sc-error" role="status">{record.issue} 原稿引用与提供范围未知，原记录保持。</p>}
        {record.issue && record.input?.action === 'read' && record.input.target && onRead && <div className="sc-note"><p>当前回读只核对这份准确来源，不能补造历史子工具正文或保存回执。</p><button className="secondary-button" type="button" onClick={() => onRead(record.input!.target!)}>现在按原引用回读</button></div>}
        {record.result && <SemanticContextEvidence result={record.result} onRead={onRead} onTrace={onTrace} onContinue={record.input && onContinueRecord ? () => onContinueRecord(record) : undefined} />}
        {record.studio && <StudioEvidence evidence={record.studio} />}
        {record.savedReport && <section className="sc-source"><h3>本轮已保存分析报告</h3><dl className="sc-metadata"><dt>报告位置</dt><dd>{record.savedReport.locator}</dd>{record.savedReport.sha256 && <><dt>文件 SHA-256</dt><dd>{record.savedReport.sha256}</dd></>}</dl></section>}
        {record.graphResult && <SemanticGraphEvidence result={record.graphResult} />}
        {record.receipt && <section className="sc-source"><h3>作者声明引用回执</h3><p className="sc-note">原 M2 已返回这份成果来源的保存回执；只代表作者明确声明引用，不证明真实计算采用或专业正确性。</p><dl className="sc-metadata"><dt>准确来源记录</dt><dd>{record.receipt.citationId}</dd><dt>原成果</dt><dd>{record.receipt.report.originalPath}</dd><dt>原操作</dt><dd>{record.receipt.operationId}</dd><dt>索引版本</dt><dd>{record.receipt.indexRevision}</dd></dl><p className="sc-meta">{record.receipt.replayed ? '回读原操作回执；没有重复创建引用。' : '本次原操作回执。'}</p>{onRead && <button className="secondary-button" type="button" onClick={() => onRead({ kind: 'data-citation', projectId: record.receipt!.projectId, citationId: record.receipt!.citationId })}>查看这份声明的准确来源</button>}<details><summary>原回执与校验信息</summary><pre>{JSON.stringify(record.receipt, null, 2)}</pre></details></section>}
        {!record.result && !record.graphResult && !record.receipt && !record.studio && !record.savedReport && !record.issue && <p className="sc-note">这项原工具结果无法核定，引用与提供范围未知。</p>}
        {record.native && <details><summary>原生记录身份</summary><dl className="sc-metadata"><dt>会话</dt><dd>{record.native.sessionId}</dd><dt>记录</dt><dd>{record.native.entryId}</dd>{record.native.toolCallId && <><dt>调用</dt><dd>{record.native.toolCallId}</dd></>}{record.native.recordedAt && <><dt>原生记录时间</dt><dd>{record.native.recordedAt}</dd></>}</dl></details>}
      </section>)}
    </> : <>
      <p className="sc-note">现在的原文与治理只在明确读取后核对，不会改写上面的历史结果或原稿引用。新材料是否改变判断由 Agent／人依据原文说明。</p>
      {lookup.state === 'idle' && <p className="sc-empty">可回到“原稿与当时返回”，按准确来源查看原文或展开一层引用；尚未发起查询。原任务仍可继续。</p>}
      {lookup.state === 'loading' && <div className="sc-note" role="status"><p>正在读取准确来源… 原任务仍可继续。</p>{onCancel && <button className="secondary-button" type="button" onClick={onCancel}>取消本次查看</button>}</div>}
      {lookup.state === 'cancelled' && <p className="sc-note" role="status">已取消本次查看，未取得完整结果；原记录保持，原任务仍可继续。</p>}
      {lookup.state === 'error' && <p className="sc-error" role="alert">本次查看未能核定：{lookup.error || '原因未知'} 这不是零命中；原记录保持，原任务仍可继续。</p>}
      {lookup.state === 'done' && lookup.result && <SemanticContextEvidence result={lookup.result} perspective="current" onRead={onRead} onTrace={onTrace} onContinue={onContinue} />}
    </>}
    {onFollowup && <footer className="sc-followup"><p className="sc-meta">只预填当前任务草稿，由你正常发送。</p><div className="sc-row"><button className="secondary-button" type="button" onClick={() => onFollowup('请沿原稿的准确引用继续核实依据与前提变化，区分作者声明、当时提供与专业正确性，保留未知。')}>继续追问</button><button className="text-button" type="button" onClick={() => onFollowup('补充纠正：请将我接下来提供的说明与原稿声明分开，保留原引用和未知部分。')}>补充纠正</button></div></footer>}
  </div>;
}
