import { useEffect, useId, useRef, useState } from 'react';
import type { PersonalLookupInput, PersonalLookupItem, PersonalLookupResult } from '../personal-retention-lookup.ts';
import type { EnterpriseMaterial, EnterpriseMaterialFields } from '../enterprise-materials-types.ts';
import type { PersonalContentTarget, PersonalItem, PersonalMetadata, PersonalSourceEvidence, PersonalStateInput, RetainPersonalInput } from '../personal-retention-types.ts';
import { addPersonalSourceRef, candidateExperiencePrefill, personalSourceNames, personalSourceStatusLabel, createPersonalOperationJournal, personalJsonEqual, personalJsonIdentity, personalRetentionApi, personalRetentionError, personalSourceFailureLabel, readPersonalMaterialView } from './personal-retention-client.ts';
import type { PersonalExperiencePrefill, PersonalMaterialView, PersonalRetentionApi, PersonalRetentionEntry } from './personal-retention-client.ts';
import { EnterpriseMaterialEditorFields } from './EnterpriseMaterialEditorFields.tsx';
import { emptyEnterpriseFields } from './enterprise-materials-client.ts';
import './enterprise-materials.css';
import './personal-retention.css';
import { PersonalDialog } from './PersonalDialog.tsx';
import { AgentCandidatesPanel } from './AgentCandidatesPanel.tsx';
import type { LearningSourceRef } from '../learning-source-types.ts';
import type { CandidateRow } from '../agent-candidate-reader.ts';
import type { PersonalContextSelection } from '../personal-context-types.ts';
import type { AgentCandidatesApi, CandidateView } from './agent-candidates-client.ts';

const kindNames = { all: '全部', concept: '概念', knowledge: '知识', experience: '经验', data: '项目数据' };
const matchNames = { title: '标题', aliases: '别名', scope: '范围', body: '正文' };
const when = (value: string) => new Date(value).toLocaleString('zh-CN');
const unknown = (value: string | null | undefined) => value || '未知';
const sourceNames = personalSourceNames;

export function PersonalRetentionConfirmation({ fields, request }: { fields: EnterpriseMaterialFields; request: RetainPersonalInput }) {
  return <>
    <p className="pr-note">保留只表达你的长期保留选择，不代表事实已证实、建议已采纳或经营效果已验证。</p>
    <h3>{fields.title}</h3><div className="pr-paper">{fields.body || '无文字正文；按原准确附件阅读，不自动 OCR。'}</div>
    <dl className="pr-metadata"><dt>个人分类</dt><dd>{kindNames[request.metadata.kind]}</dd><dt>用户别名</dt><dd>{request.metadata.aliases.join('、') || '未填写'}</dd><dt>适用范围</dt><dd>{unknown(fields.scope)}</dd><dt>业务时间</dt><dd>{unknown(fields.effectiveTime)}</dd><dt>适用提醒</dt><dd>{request.metadata.caution || '未填写'}</dd><dt>准确内容</dt><dd><code>{request.target.type === 'revision' ? request.target.revisionId : `已保存工作稿 version ${request.target.expectedMaterialVersion}`}</code></dd><dt>正文身份</dt><dd><code>{request.target.type === 'revision' ? request.target.expectedBodySha256 : request.target.expectedDraftSha256}</code></dd></dl>
    <h3>本次精确来源</h3>{request.metadata.sourceRefs.length ? request.metadata.sourceRefs.map((ref, index) => <div className="pr-source-card" key={index}><strong>{sourceNames[ref.type]}</strong><pre>{JSON.stringify(ref, null, 2)}</pre></div>) : <p className="pr-note">人工记录，外部原文未记录</p>}
    <p className="pr-footnote">成功发表个人决定后才更换当前保留版。旧正文、当时分类与来源保持；原资料启用状态独立。</p>
  </>;
}

export function PersonalLookupResults({ result, onOpen, onOpenProject, currentTaskLabel, onUse, onOther }: {
  result: PersonalLookupResult; onOpen: (item: PersonalLookupItem) => void; onOpenProject?: (id: string) => void; currentTaskLabel?: string; onUse?: (item: PersonalLookupItem) => void; onOther?: (item: PersonalLookupItem) => void;
}) {
  return <>
    {!result.complete && <div className="pr-note pr-warning" role="status"><strong>部分结果 · 未能核对完整范围</strong><p>下列范围读取未完成；不能把它视为无资料或相关事实不存在。</p><ul>{result.issues.map((issue, index) => <li key={index}>{issue.code}{issue.projectId ? ` · 项目 ${issue.projectId}` : ''}{issue.itemId ? ` · 条目 ${issue.itemId}` : ''}</li>)}</ul></div>}
    <section className="pr-panel pr-results" aria-label="查找结果">
      {!result.items.length ? <div className="pr-empty"><h2>{!result.complete ? '未能核对完整范围' : '当前范围没有匹配资料'}</h2><p>{result.complete ? '可尝试其他关键词，或显式包含草稿与归档。尚未整理资料时，可以新建人工笔记。' : '保留错误提示，明确刷新后再核对；这不是空库结论。'}</p></div> : result.items.map(item => <article className="pr-result" key={item.id}>
        <div className="pr-result-main"><div className="pr-row"><span className="pr-pill pr-purple">{kindNames[item.category]}</span>{item.personalState && <span className="pr-pill">{({ retained: '已保留', draft: '未保留草稿', archived: '已归档' })[item.personalState]}</span>}{item.status !== 'available' && <span className="pr-pill pr-warn">{item.status === 'disabled' ? '原资料未启用／已停用' : '内容不可用'}</span>}{item.project?.archived && <span className="pr-pill">原项目已归档</span>}</div>
          <h2><button className="pr-result-title" type="button" onClick={() => onOpen(item)}>{item.title}</button></h2>
          <p className="pr-preview">{item.bodyPreview === null ? '无文字正文；附件或原入口按准确身份阅读。' : item.bodyPreview}{item.bodyTruncated ? '…' : ''}</p>
          <p className="pr-meta">范围：{item.scope || '未知'}{item.aliases.length ? ` · 别名：${item.aliases.join('、')}` : ''}{item.project ? ` · ${item.project.name}` : ''}</p>
          {item.caution && <p className="pr-caution">适用提醒：{item.caution}</p>}
          {item.matches.length > 0 && <p className="pr-match">命中：{item.matches.map((match, index) => <span key={index}>{index > 0 ? '；' : ''}{matchNames[match.field]}{match.aliasIndex === undefined ? '' : ` ${match.aliasIndex + 1}`} [{match.start}, {match.end})</span>)}</p>}
          {item.sourceIssues.length > 0 && <p className="pr-caution">来源读取未完成：{item.sourceIssues.map(issue => issue.code).join('、')}；精确引用保留。</p>}
          {item.sources?.filter(source => source.status === 'disabled' || source.project?.archived).map((source, index) => <p className="pr-meta" key={index}>{source.status === 'disabled' ? '来源未启用／已停用，旧稿仍可读。' : ''}{source.project?.archived ? '来源项目已归档。' : ''}</p>)}
        </div>
        <div className="pr-row">{onUse && currentTaskLabel && item.materialId && (item.personalState === 'retained' || item.personalState === 'archived') && item.decisionId && item.bodySha256 && item.contentRef && item.status !== 'unavailable' && <button type="button" className="primary-button" onClick={() => onUse(item)}>加入当前任务 · {currentTaskLabel}</button>}{onOther && item.materialId && (item.personalState === 'retained' || item.personalState === 'archived') && item.decisionId && item.bodySha256 && item.contentRef && item.status !== 'unavailable' && <button type="button" className="secondary-button" onClick={() => onOther(item)}>{currentTaskLabel ? '选择其他任务' : '选择任务并加入'}</button>}{item.category === 'data' && item.project && onOpenProject ? <button className="secondary-button" type="button" onClick={() => onOpenProject(item.project!.id)}>回原项目</button> : <button className="secondary-button" type="button" onClick={() => onOpen(item)}>阅读详情</button>}</div>
      </article>)}
    </section>
  </>;
}

const captureFocus = () => document.activeElement instanceof HTMLElement && document.activeElement !== document.body ? document.activeElement : null;

function PersonalSourceCard({ refValue, api, onRead, onRemove }: { refValue: LearningSourceRef; api: PersonalRetentionApi; onRead: (value: LearningSourceRef) => void; onRemove?: () => void }) {
  const [source, setSource] = useState<PersonalSourceEvidence | null>(null), [error, setError] = useState(''), [errorLabel, setErrorLabel] = useState('来源未能核对');
  const identity = personalJsonIdentity(refValue);
  useEffect(() => { let alive = true; setSource(null); setError(''); void api.source(refValue).then(value => { if (alive) setSource(value); }).catch(error => { if (alive) { setError(personalRetentionError(error)); setErrorLabel(personalSourceFailureLabel(error)); } }); return () => { alive = false; }; }, [api, identity]);
  return <article className="pr-source-card"><div className="pr-row"><strong>{sourceNames[refValue.type]}</strong><span className={`pr-pill ${error || source?.status === 'excluded' || source?.status === 'governance-unknown' ? 'pr-warn' : ''}`}>{error ? errorLabel : source ? personalSourceStatusLabel(source) : '正在核对'}</span>{source?.project?.archived && <span className="pr-pill">原项目已归档</span>}</div>{source && <><p className="pr-meta">{source.title}</p><PersonalSourceGovernance source={source} /></>}{error && <p className="pr-caution">{error} 精确引用保持；新绑定须核对或由你明确移除后再保存。</p>}<details><summary>精确来源身份</summary><pre>{JSON.stringify(refValue, null, 2)}</pre></details><div className="pr-row"><button type="button" className="text-button" onClick={() => onRead(refValue)}>阅读准确原文</button>{onRemove && <button type="button" className="text-button" onClick={onRemove}>移除此来源</button>}</div></article>;
}

function PersonalSourceGovernance({ source }: { source: PersonalSourceEvidence }) {
  const governance = source.candidateGovernance;
  const latest = governance?.notes.reduce<(typeof governance.notes)[number] | null>((value, note) => !value || note.targetRevision > value.targetRevision ? note : value, null);
  return <>{(source.status === 'excluded' || source.status === 'governance-unknown') && <p className="pr-caution">{source.status === 'excluded' ? '来源候选今天已排除，Agent不再新读取其正文或摘要。人的历史原件仍可看，这份个人经验按自己的治理保留；旧正文与选择未被改写。' : '来源候选当前治理未知；不能据可读原件推定今天可新供给Agent。个人旧正文与准确引用保持。'}</p>}{latest && <p className="pr-note">人的最新纠正意见：{latest.note}<span className="pr-footnote"> · 独立意见，不覆盖原候选或这份个人经验</span></p>}</>;
}

function PersonalSources({ refs, api, onRead, onRemove }: { refs: LearningSourceRef[]; api: PersonalRetentionApi; onRead: (value: LearningSourceRef) => void; onRemove?: (index: number) => void }) {
  return refs.length ? <div className="pr-stack">{refs.map((ref, index) => <PersonalSourceCard key={`${index}:${personalJsonIdentity(ref)}`} refValue={ref} api={api} onRead={onRead} onRemove={onRemove ? () => onRemove(index) : undefined} />)}</div> : <p className="pr-note">人工记录，外部原文未记录</p>;
}

type PersonalEditor = {
  material: EnterpriseMaterial | null; item: PersonalItem | null; fields: EnterpriseMaterialFields; metadata: PersonalMetadata;
  aliasesText: string;
  target: PersonalContentTarget | null; direct: boolean; savedSignature: string | null; message: string;
  createUnknown: boolean; saveUnknown: boolean; saveConflict?: boolean; experience?: PersonalExperiencePrefill;
};
type PersonalDetail = PersonalMaterialView;
const editorSignature = (value: Pick<PersonalEditor, 'fields' | 'metadata' | 'target'>) => personalJsonIdentity({ fields: value.fields, metadata: value.metadata, target: value.target });
const editorHasInput = (value: PersonalEditor) => Boolean(value.fields.sourceFileId || Object.values(value.fields).some(field => typeof field === 'string' && field.trim()) || value.metadata.sourceRefs.length || value.metadata.aliases.length || value.metadata.caution?.trim());
const emptyMetadata = (kind: PersonalMetadata['kind'] = 'knowledge', sourceRefs: LearningSourceRef[] = []): PersonalMetadata => ({ kind, aliases: [], caution: null, sourceRefs });

export function PersonalMaterialsPage({ api = personalRetentionApi, candidateApi, active = true, initialSource, onSourceConsumed, onOpenProject, onOpenMaterial, currentTaskLabel, onUse, onOther }: {
  active?: boolean; candidateApi?: AgentCandidatesApi; currentTaskLabel?: string; onUse?: (selection: PersonalContextSelection, title: string) => void; onOther?: (selection: PersonalContextSelection, title: string) => void;
  api?: PersonalRetentionApi; initialSource?: PersonalRetentionEntry | null; onSourceConsumed?: () => void;
  onOpenProject?: (projectId: string) => void; onOpenMaterial?: (materialId: string, revisionId?: string) => void;
}) {
  const [view, setView] = useState<CandidateView | 'manual'>('all');
  const showManual = view === 'all' || view === 'manual';
  const id = useId(), heading = useRef<HTMLHeadingElement>(null), lookupEpoch = useRef(0);
  const activeRef = useRef(active); activeRef.current = active;
  const editorTrigger = useRef<HTMLElement | null>(null), detailTrigger = useRef<HTMLElement | null>(null), sourceTrigger = useRef<HTMLElement | null>(null), confirmationTrigger = useRef<HTMLElement | null>(null), rowTrigger = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState(''), [filters, setFilters] = useState<PersonalLookupInput>({ query: '', category: 'all', includeBody: false, includeDrafts: false, includeArchived: false, page: 1, pageSize: 20 });
  const [result, setResult] = useState<PersonalLookupResult | null>(null), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false);
  const [error, setError] = useState(''), [notice, setNotice] = useState(''), [detail, setDetail] = useState<PersonalDetail | null>(null);
  const [editor, setEditor] = useState<PersonalEditor | null>(null), [editorOpen, setEditorOpen] = useState(false), [tried, setTried] = useState(false);
  const [experienceTargets, setExperienceTargets] = useState<PersonalLookupResult | null>(null), [experienceTargetQuery, setExperienceTargetQuery] = useState('');
  const [parkedEditors, setParkedEditors] = useState<{ key: string; editor: PersonalEditor }[]>([]);
  const [confirmation, setConfirmation] = useState<{ fields: EnterpriseMaterialFields; materialId: string; request: RetainPersonalInput } | null>(null);
  const [source, setSource] = useState<{ ref: LearningSourceRef; evidence: PersonalSourceEvidence | null; error: string } | null>(null);
  const [readOnlyRow, setReadOnlyRow] = useState<PersonalLookupItem | null>(null), [pendingRequests, setPendingRequests] = useState<Record<string, RetainPersonalInput>>({});
  const [stateRequests, setStateRequests] = useState<Record<string, { action: 'archive' | 'restore'; request: PersonalStateInput }>>({});
  const [journalState] = useState(() => { try { return { journal: createPersonalOperationJournal(typeof window === 'undefined' ? undefined : window.sessionStorage), error: '' }; } catch { return { journal: createPersonalOperationJournal(), error: '本页不能保存待核对请求，暂不能发起保留。请核对浏览器存储权限；草稿输入保持。' }; } });
  const [journalError, setJournalError] = useState(journalState.error);
  const updatePending = () => { try { setPendingRequests(Object.fromEntries(journalState.journal.entries())); } catch (error) { setJournalError(personalRetentionError(error)); } };
  const refresh = async () => {
    if (!activeRef.current) return;
    const epoch = ++lookupEpoch.current; setLoading(true);
    try { const value = await api.lookup(filters); if (lookupEpoch.current === epoch) setResult(value); }
    catch (error) { if (lookupEpoch.current === epoch) { setResult(null); setError(personalRetentionError(error)); } }
    finally { if (lookupEpoch.current === epoch) setLoading(false); }
  };
  useEffect(() => {
    if (!active) return;
    heading.current?.focus(); updatePending();
    let alive = true;
    if (editor?.material) {
      const materialId = editor.material.id, originalRevision = editor.item?.revision ?? 0;
      void api.item(materialId).then(read => {
        if (!alive || !activeRef.current) return;
        if (read.item?.pending) { journalState.journal.remember(materialId, read.item.pending.request); updatePending(); }
        if ((read.item?.revision ?? 0) !== originalRevision) setEditor(previous => previous?.material?.id === materialId ? { ...previous, savedSignature: null, saveUnknown: true, message: '返回后发现条目状态已变化。原输入与基准保持，请明确回查正文及个人草稿信息后核对。' } : previous);
      }).catch(error => { if (alive && activeRef.current) setError(`返回后的条目回查未完成，原输入保持。${personalRetentionError(error)}`); });
    }
    return () => { alive = false; };
  }, [active, api]);
  useEffect(() => { if (active) void refresh(); return () => { ++lookupEpoch.current; }; }, [active, api, filters]);
  useEffect(() => { if (active && initialSource) void beginEntry(initialSource).finally(() => onSourceConsumed?.()); }, [active, initialSource]);

  async function readDetail(materialId: string, decisionId?: string, showDraft = false) {
    if (!detail) detailTrigger.current = captureFocus();
    setBusy(true); setError('');
    try {
      const read = await readPersonalMaterialView(api, materialId, decisionId, showDraft);
      setDetail(read);
      if (!showDraft && read.decision && !read.content) setError('准确保留正文不可读，精确身份保持；不会用当前工作草稿替代。');
      if (read.item?.pending) { journalState.journal.remember(materialId, read.item.pending.request); updatePending(); }
    } catch (error) { setError(personalRetentionError(error)); }
    finally { setBusy(false); }
  }
  async function readSource(ref: LearningSourceRef) {
    if (!source) sourceTrigger.current = captureFocus();
    setSource({ ref, evidence: null, error: '' });
    try { const evidence = await api.source(ref); setSource(previous => previous && personalJsonEqual(previous.ref, ref) ? { ref, evidence, error: '' } : previous); }
    catch (error) { setSource(previous => previous && personalJsonEqual(previous.ref, ref) ? { ref, evidence: null, error: personalRetentionError(error) } : previous); }
  }
  async function beginEntry(entry?: PersonalRetentionEntry, materialId?: string, experience?: PersonalExperiencePrefill, switchingTarget = false) {
    if (!editorOpen) editorTrigger.current = captureFocus();
    if (!switchingTarget && editor && editor.savedSignature !== editorSignature(editor)) {
      if (materialId && editor.material?.id === materialId) { setEditorOpen(true); return; }
      if (editorHasInput(editor)) {
        setParkedEditors(previous => [...previous, { key: crypto.randomUUID(), editor }]);
        setNotice('原未完成草稿输入仍保留在本页，可从“继续未完成稿”返回；其他条目可独立整理。');
      }
    }
    setBusy(true); setError(''); setTried(false);
    try {
      const selectedId = materialId ?? (entry?.direct && entry.ref.type === 'enterprise' ? entry.ref.materialId : undefined);
      if (!selectedId) {
        setEditor({ material: null, item: null, fields: experience ? structuredClone(experience.fields) : emptyEnterpriseFields(), metadata: experience ? structuredClone(experience.metadata) : emptyMetadata(entry?.kind, entry ? [entry.ref] : []), aliasesText: experience?.metadata.aliases.join('，') ?? '', experience, target: null, direct: false, savedSignature: null, message: '新整理独立保存，原稿保持。保存草稿不等于保留。', createUnknown: false, saveUnknown: false }); setEditorOpen(true); return;
      }
      const [snapshot, personal] = await Promise.all([api.editor(selectedId), api.item(selectedId)]);
      if (personal.item?.pending || pendingRequests[selectedId] || personal.item?.archived) { setNotice(personal.item?.archived ? '该资料已有归档条目，请先显式恢复。' : '该条目已有待核对操作，先回查或明确结束原操作。'); await readDetail(selectedId); return; }
      let fields = experience ? structuredClone(experience.fields) : snapshot.material.draft, target: PersonalContentTarget | null = experience ? null : snapshot.draftTarget;
      if (entry?.direct && entry.ref.type === 'enterprise') {
        await api.source(entry.ref);
        const original = await api.readRevision(selectedId, entry.ref.revisionId);
        fields = original.revision; target = { type: 'revision', revisionId: original.revision.revisionId, expectedBodySha256: original.revision.bodySha256 };
      }
      let metadata = experience ? structuredClone(experience.metadata) : personal.item ? structuredClone(personal.item.draftMeta) : emptyMetadata(entry?.kind);
      if (entry) { metadata.kind = entry.kind ?? metadata.kind; metadata.sourceRefs = addPersonalSourceRef(metadata.sourceRefs, entry.ref); }
      setEditor({ material: snapshot.material, item: personal.item, fields: { ...fields }, metadata, aliasesText: metadata.aliases.join('，'), target, direct: Boolean(entry?.direct), experience, savedSignature: null, message: entry?.direct ? '此精确修订只读；只保存个人草稿信息，不改原工作稿。' : '新草稿与旧保留版并存，保存不会自动更换当前保留版。', createUnknown: false, saveUnknown: false }); setEditorOpen(true);
    } catch (error) { setError(personalRetentionError(error)); }
    finally { setBusy(false); }
  }
  async function lookupExperienceTargets(page = 1) {
    try { setExperienceTargets(await api.lookup({ query: experienceTargetQuery, category: 'experience', includeDrafts: true, includeArchived: false, page, pageSize: 50 })); }
    catch (error) { setError(`已有经验查找未完成；默认新建与原输入保持。${personalRetentionError(error)}`); }
  }
  async function organizeCandidate(row: CandidateRow) {
    const prefill = candidateExperiencePrefill(row);
    await beginEntry(undefined, undefined, prefill);
    await lookupExperienceTargets();
  }
  const changeEditor = (patch: Partial<PersonalEditor>) => setEditor(previous => previous ? { ...previous, ...patch } : previous);
  async function saveEditor() {
    if (!editor || editor.createUnknown || editor.saveUnknown || editor.saveConflict) return;
    setTried(true); setError('');
    if (!editor.fields.title.trim() || !editor.direct && !editor.fields.body.trim() && !editor.fields.sourceFileId) { changeEditor({ message: '请填写资料标题和人工整理正文；未知范围与业务时间可以留空。' }); return; }
    if (new TextEncoder().encode(editor.fields.body).length > 1024 * 1024 || editor.metadata.aliases.length > 20 || editor.metadata.aliases.some(alias => alias.length > 100)) { changeEditor({ message: '正文最多 1 MiB；别名最多 20 项、每项 100 UTF-16 字符。输入保持，请调整后再保存。' }); return; }
    setBusy(true); let material = editor.material, fields = editor.fields, target = editor.target, bodySaved = editor.direct;
    try {
      if (!editor.direct) {
        if (!material || !personalJsonEqual(material.draft, fields)) {
          try { material = (material ? await api.saveMaterial(material.id, material.version, fields) : await api.createMaterial(fields)).material; fields = material.draft; bodySaved = true; changeEditor({ material, fields, savedSignature: null, message: '正文已明确保存，正在单独保存个人草稿信息…' }); }
          catch (error) { const unknown = !(error && typeof error === 'object' && 'status' in error && Number(error.status) >= 400 && Number(error.status) < 500); changeEditor({ createUnknown: !material && unknown, saveUnknown: Boolean(material) && unknown, saveConflict: Boolean(material) && !unknown, message: `${material ? '正文保存' : '新建资料'}${unknown ? '结果为 UNKNOWN' : '失败'}。输入保持；${!material && unknown ? '没有可核定的新资料 ID，不能盲目再创建。请回原资料页核对。' : '先明确回查已保存正文，不自动重放。'} ${personalRetentionError(error)}` }); return; }
        } else bodySaved = true;
        const snapshot = await api.editor(material.id);
        if (!personalJsonEqual(snapshot.material.draft, fields)) { changeEditor({ material, fields, target: null, savedSignature: null, message: '正文已保存，但权威草稿随后变化。原输入保持；请明确回查，不保留另一份内容。' }); return; }
        material = snapshot.material; target = snapshot.draftTarget;
      }
      if (!material || !target) throw new Error('准确内容身份未取得；不能保留。');
      const saved = await api.saveDraft(material.id, { expectedRevision: editor.item?.revision ?? 0, metadata: editor.metadata });
      const next: PersonalEditor = { ...editor, material, fields, target, item: saved.item, saveUnknown: false, savedSignature: null, message: editor.direct ? '个人草稿信息已明确保存；原资料正文和工作稿保持。尚未保留。' : '正文与个人草稿信息分别已明确保存。尚未保留；默认仍按原保留版显示。' };
      next.savedSignature = editorSignature(next); setEditor(next); await refresh();
    } catch (error) { changeEditor({ material, fields, target, savedSignature: null, saveUnknown: true, message: `${bodySaved ? '正文已保存／精确修订保持，但个人草稿信息未核定成功。' : '保存未完成。'} 输入保持，请明确回查后核对。${personalRetentionError(error)}` }); }
    finally { setBusy(false); }
  }
  async function recheckEditor() {
    if (!editor?.material) return;
    setBusy(true);
    try {
      const [snapshot, read] = await Promise.all([api.editor(editor.material.id), api.item(editor.material.id)]);
      const fieldsMatch = editor.direct || personalJsonEqual(snapshot.material.draft, editor.fields), metadataMatch = Boolean(read.item && personalJsonEqual(read.item.draftMeta, editor.metadata));
      const next = { ...editor, material: snapshot.material, item: read.item, target: editor.direct ? editor.target : fieldsMatch ? snapshot.draftTarget : null, saveUnknown: false, saveConflict: false, savedSignature: null as string | null, message: fieldsMatch && metadataMatch ? '回查确认正文与个人草稿信息均已保存；保留仍需你的明确确认。' : '已回查最新身份，原输入保持，尚未与权威内容一致。核对后再明确保存；没有自动覆盖。' };
      if (fieldsMatch && metadataMatch && !read.item?.pending) next.savedSignature = editorSignature(next);
      setEditor(next); if (read.item?.pending) { journalState.journal.remember(editor.material.id, read.item.pending.request); updatePending(); }
    } catch (error) { changeEditor({ message: `回查未完成，UNKNOWN 和输入保持。${personalRetentionError(error)}` }); }
    finally { setBusy(false); }
  }
  function prepareRetain() {
    if (!editor?.material || !editor.item || !editor.target || !editor.savedSignature || editor.savedSignature !== editorSignature(editor) || editor.item.pending || editor.item.archived || journalError || pendingRequests[editor.material.id]) return;
    confirmationTrigger.current = captureFocus();
    setConfirmation({ fields: structuredClone(editor.fields), materialId: editor.material.id, request: { operationId: crypto.randomUUID(), expectedRevision: editor.item.revision, target: structuredClone(editor.target), metadata: structuredClone(editor.metadata), personalLabel: null } });
  }
  async function publish(materialId: string, request: RetainPersonalInput) {
    setBusy(true); setError('');
    try {
      try { journalState.journal.remember(materialId, request); updatePending(); }
      catch (error) { setJournalError(`原请求未能安全记录，本次未发送保留请求。${personalRetentionError(error)}`); return; }
      const write = await api.retain(materialId, request);
      journalState.journal.settle(materialId, request.operationId); updatePending();
      setConfirmation(null); setEditorOpen(false); setEditor(null);
      setNotice(write.termination ? '原操作已结束，返回原终结回执；没有再次保留。' : write.replayed ? '已回读原操作成功回执；没有重复发表决定。' : '已明确保留准确内容。保留表达你的选择，不代表事实已证实。');
      await readDetail(materialId); await refresh();
    } catch (error) { setConfirmation(null); changeEditor({ message: `保留未能核定成功，原请求已保持。请回查同一操作或明确结束；不自动换 ID。${personalRetentionError(error)}` }); setError(personalRetentionError(error)); }
    finally { setBusy(false); }
  }
  async function inspectOperation(materialId: string, operationId: string) {
    setBusy(true); setError('');
    try {
      const read = await api.operation(materialId, operationId);
      if (read.state === 'committed' || read.state === 'ended') { journalState.journal.settle(materialId, operationId); updatePending(); setNotice(read.state === 'committed' ? '同操作已成功，回读原决定；没有改写后来的当前指针。' : '同操作已明确结束，原请求与 FAIL／UNKNOWN 回执仍在历史中。'); }
      else if (read.state === 'pending' && read.pending) { journalState.journal.remember(materialId, read.pending.request); updatePending(); setNotice('原操作仍待完成。可明确同请求继续，或结束本次保留。旧保留版保持。'); }
      else setNotice('权威中尚未找到此操作。原 UNKNOWN 请求仍保留；可明确用原请求继续，或明确结束，不能自动换 ID。');
      await readDetail(materialId); await refresh();
    } catch (error) { setError(`原操作回查未完成；UNKNOWN 保持。${personalRetentionError(error)}`); }
    finally { setBusy(false); }
  }
  async function endOperation(materialId: string, request: RetainPersonalInput) {
    setBusy(true); setError('');
    try {
      const write = await api.endPending(materialId, request.operationId, request);
      journalState.journal.settle(materialId, request.operationId); updatePending();
      setNotice(write.decision ? '回查发现同操作已成功，返回原成功回执；未把成功改成取消。' : '本次保留已明确结束，原请求、FAIL／UNKNOWN 和可能固化的正文保留，旧保留指针不变。');
      await readDetail(materialId); await refresh();
    } catch (error) { setError(`结束未能核定，原请求与占用保持。${personalRetentionError(error)}`); }
    finally { setBusy(false); }
  }
  async function changeArchive(value: PersonalDetail) {
    if (!value.item || value.item.pending || pendingRequests[value.material.id]) return;
    setBusy(true); setError('');
    const operation = stateRequests[value.material.id] ?? { action: value.item.archived ? 'restore' as const : 'archive' as const, request: { operationId: crypto.randomUUID(), expectedRevision: value.item.revision, personalLabel: null } };
    setStateRequests(previous => ({ ...previous, [value.material.id]: operation }));
    try {
      await api[operation.action](value.material.id, operation.request);
      setStateRequests(previous => { const next = { ...previous }; delete next[value.material.id]; return next; });
      setNotice(operation.action === 'restore' ? '条目已恢复，仍使用原保留版；未自动采用新草稿。' : '个人条目已归档，正文、来源与历史保持；不撤回原资料另行启用。');
      await readDetail(value.material.id); await refresh();
    } catch (error) { setError(`归档／恢复结果未核定；请明确回查该条目，未自动重试。${personalRetentionError(error)}`); }
    finally { setBusy(false); }
  }
  async function inspectStateOperation(materialId: string) {
    const operation = stateRequests[materialId]; if (!operation) return;
    setBusy(true); setError('');
    try {
      const read = await api.operation(materialId, operation.request.operationId);
      if (read.state === 'committed' || read.state === 'ended') { setStateRequests(previous => { const next = { ...previous }; delete next[materialId]; return next; }); setNotice('已回读该归档／恢复原操作的明确结果；没有换 ID 重放。'); }
      else setNotice('原归档／恢复尚无明确完成回执。保留原请求，可明确同请求重试。');
      await readDetail(materialId); await refresh();
    } catch (error) { setError(`原归档／恢复结果仍未核定。${personalRetentionError(error)}`); }
    finally { setBusy(false); }
  }
  const pendingFor = (materialId: string, item?: PersonalItem | null) => pendingRequests[materialId] ?? item?.pending?.request ?? null;
  const pendingPanel = (materialId: string, item?: PersonalItem | null) => {
    const request = pendingFor(materialId, item); if (!request) return null;
    return <section className="pr-note pr-warning" aria-label="待核对保留操作"><strong>本条目有待核对操作 · {item?.pending?.failure?.outcome ?? 'UNKNOWN'}</strong><p>旧保留版保持；只占用此条目。正文固化不等于个人保留成功。</p><details><summary>原操作与完整请求</summary><pre>{JSON.stringify(request, null, 2)}</pre></details><div className="pr-row"><button className="secondary-button" type="button" disabled={busy} onClick={() => { void inspectOperation(materialId, request.operationId); }}>回查原操作</button><button className="secondary-button" type="button" disabled={busy} onClick={() => { void publish(materialId, request); }}>明确同请求继续</button><button className="text-button" type="button" disabled={busy} onClick={() => { void endOperation(materialId, request); }}>结束本次保留</button></div></section>;
  };
  // Lookup keeps accurate retained and draft rows separate; updating targets the one stable material editor.
  const experienceTargetOptions = new Map<string, PersonalLookupItem>();
  for (const item of experienceTargets?.items ?? []) {
    if (!item.materialId || !item.personalState || item.personalState === 'archived') continue;
    if (!experienceTargetOptions.has(item.materialId) || item.personalState === 'draft') experienceTargetOptions.set(item.materialId, item);
  }
  const canRetain = Boolean(editor?.material && editor.item && editor.target && editor.savedSignature && editor.savedSignature === editorSignature(editor) && !editor.item.archived && !pendingFor(editor.material.id, editor.item) && !journalError);
  const shownFields = detail?.content ?? (detail?.decision ? null : detail?.draft);
  const shownMetadata = detail?.decision?.metadata ?? detail?.item?.draftMeta;
  const shownAttachment = detail?.content?.sourceFile ?? (!detail?.decision ? detail?.draftFiles.find(file => file.id === detail.draft?.sourceFileId) : undefined);
  const useRetained = (value: PersonalMaterialView, other = false) => {
    const decision = value.decision, ref = decision?.contentRef;
    if (!decision || !ref || !decision.bodySha256 || !value.content) throw new Error('准确保留决定或正文尚未核对；选择与原问题保持。');
    (other ? onOther : onUse)?.({ target: { type: 'retained', storeId: ref.storeId, materialId: ref.materialId, decisionId: decision.operationId, revisionId: ref.revisionId, expectedBodySha256: decision.bodySha256 } }, value.content.title);
    setDetail(null);
  };
  const useLookupItem = async (item: PersonalLookupItem, other = false) => {
    if (!item.materialId || busy) return;
    setBusy(true); setError('');
    try {
      if (!item.decisionId || !item.bodySha256 || !item.contentRef) throw new Error('列表中的准确决定身份尚未核对，请明确刷新；不会改用当前稿。');
      const exact = await readPersonalMaterialView(api, item.materialId, item.decisionId);
      if (exact.decision?.operationId !== item.decisionId || exact.decision.bodySha256 !== item.bodySha256 || !personalJsonEqual(exact.decision.contentRef, item.contentRef)) throw new Error('所选准确资料已变化，问题与原引用保持；不会改用新保留版。');
      useRetained(exact, other);
    }
    catch (error) { setError(personalRetentionError(error)); }
    finally { setBusy(false); }
  };
  const openLookupItem = (item: PersonalLookupItem) => {
    if (item.category === 'knowledge' || item.category === 'experience') { if (item.materialId) void readDetail(item.materialId, undefined, item.personalState === 'draft'); }
    else { rowTrigger.current = captureFocus(); setReadOnlyRow(item); }
  };
  return <section className="pr-page" aria-labelledby={`${id}-heading`}>
    <header className="page-heading"><div><p className="eyebrow">工作自然留下线索，按需要再来看</p><h1 ref={heading} tabIndex={-1} id={`${id}-heading`}>个人资料</h1><p>Agent 在工作中自选记录候选，你按需阅读、收藏、纠正或排除。无需每天写笔记，也不要求逐条审批。</p></div><div className="pr-row">{editor && <button type="button" className="secondary-button" disabled={busy} onClick={() => { editorTrigger.current = captureFocus(); setEditorOpen(true); }}>继续编辑草稿</button>}<button type="button" className="primary-button" disabled={busy} onClick={() => { void beginEntry(); }}>新建人工笔记</button></div></header>
    <div className="pr-tabs pr-view-tabs" role="group" aria-label="发现范围">{([['all', '全部资料'], ['bookmarked', '重点收藏'], ['manual', '原有人工资料'], ['anomalies', '异常历史'], ['excluded', '已排除']] as const).map(([key, label]) => <button type="button" key={key} aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>
    <section className="pr-panel pr-findbar" aria-label="个人资料查找"><form onSubmit={event => { event.preventDefault(); setError(''); setFilters(previous => ({ ...previous, query, page: 1 })); }}><div className="pr-search-row"><label className="pr-search"><span>查找个人资料</span><input type="search" value={query} maxLength={200} placeholder="标题、用户别名或适用范围关键词" autoComplete="off" onChange={event => setQuery(event.target.value)} /></label><button className="primary-button" type="submit">查找</button><button className="secondary-button" type="button" onClick={() => { setQuery(''); setError(''); setFilters(previous => ({ ...previous, query: '', page: 1 })); }}>清空</button></div><div className="pr-filter-row">{([['includeBody', '含正文关键词'], ['includeDrafts', '含未保留草稿'], ['includeArchived', '含归档条目']] as const).filter(([key]) => key === 'includeBody' || showManual).map(([key, label]) => <label key={key}><input type="checkbox" checked={Boolean(filters[key])} onChange={event => setFilters(previous => ({ ...previous, [key]: event.target.checked, page: 1 }))} />{label}</label>)}</div></form><div className="pr-tabs" role="group" aria-label="资料类别">{(Object.keys(kindNames) as (keyof typeof kindNames)[]).map(category => <button key={category} type="button" aria-pressed={filters.category === category} onClick={() => setFilters(previous => ({ ...previous, category, page: 1 }))}>{kindNames[category]}</button>)}</div></section>
    <div hidden={view === 'manual' || filters.category === 'concept' || filters.category === 'data'}><AgentCandidatesPanel active={active && view !== 'manual' && filters.category !== 'concept' && filters.category !== 'data'} view={view === 'manual' ? 'all' : view} api={candidateApi} search={{ query: filters.query ?? '', includeBody: Boolean(filters.includeBody), category: filters.category === 'knowledge' || filters.category === 'experience' ? filters.category : 'all' }} onReadSource={ref => { void readSource(ref); }} onOpenProject={onOpenProject} currentTaskLabel={currentTaskLabel} onUse={onUse} onOther={onOther} onOrganize={organizeCandidate} /></div>
    {view !== 'all' && view !== 'manual' && (filters.category === 'concept' || filters.category === 'data') && <p className="pr-note">当前范围没有此类别的 Agent 候选；可切换知识／经验，或在全部资料中阅读概念与项目数据。</p>}
    <div hidden={!showManual}>
    <h2 className="pr-manual-heading">原有人工资料、概念与项目数据</h2>
    {parkedEditors.length > 0 && <div className="pr-note"><strong>本页保留的未完成输入</strong><div className="pr-row">{parkedEditors.map(parked => <button key={parked.key} type="button" className="text-button" disabled={busy} onClick={() => { editorTrigger.current = captureFocus(); setParkedEditors(previous => [...previous.filter(value => value.key !== parked.key), ...(editor && editorHasInput(editor) && editor.savedSignature !== editorSignature(editor) ? [{ key: crypto.randomUUID(), editor }] : [])]); setEditor(parked.editor); setEditorOpen(true); }}>继续未完成稿：{parked.editor.fields.title || '未命名人工笔记'}{parked.editor.createUnknown ? ' · 新建结果 UNKNOWN' : ''}</button>)}</div><p className="pr-footnote">未保存输入只在本页保留；先核对并保存，不以重新新建代替原 UNKNOWN 回查。</p></div>}

    {error && <div className="error-notice" role="alert"><p>{error}</p><button className="text-button" type="button" disabled={busy || loading} onClick={() => { setError(''); void refresh(); }}>明确刷新查找范围</button></div>}{journalError && <p className="pr-note pr-warning" role="alert">{journalError}</p>}{notice && <p className="pr-note" role="status">{notice}</p>}
    {Object.entries(pendingRequests).filter(([materialId]) => materialId !== detail?.material.id && materialId !== editor?.material?.id).map(([materialId, request]) => <div key={materialId} className="pr-note pr-warning"><strong>待核对保留操作</strong><p><code>{materialId}</code> · <code>{request.operationId}</code></p><button type="button" className="text-button" disabled={busy} onClick={() => { void readDetail(materialId); }}>打开条目并核对原操作</button></div>)}
    <div className="pr-results-head"><span aria-live="polite">{loading ? '正在读取个人资料…' : result ? `本次范围 ${result.total} 项` : '查找未完成'}</span><span className="pr-footnote">知识／经验默认显示已保留、未归档的版本</span></div>
    <div aria-busy={loading || undefined}>{result && <PersonalLookupResults result={result} onOpen={openLookupItem} onOpenProject={onOpenProject} currentTaskLabel={currentTaskLabel} onUse={onUse ? item => { void useLookupItem(item); } : undefined} onOther={onOther ? item => { void useLookupItem(item, true); } : undefined} />}{loading && <p role="status" className="pr-footnote">正在核对已登记资料与准确引用…</p>}</div>
    {result && result.total > 0 && <nav className="pr-pagination" aria-label="结果分页"><button className="secondary-button" type="button" disabled={loading || result.page <= 1} onClick={() => setFilters(previous => ({ ...previous, page: result.page - 1 }))}>上一页</button><span>第 {result.page} 页 · 共 {Math.max(1, Math.ceil(result.total / result.pageSize))} 页</span><button className="secondary-button" type="button" disabled={loading || result.page * result.pageSize >= result.total} onClick={() => setFilters(previous => ({ ...previous, page: result.page + 1 }))}>下一页</button></nav>}
    <p className="pr-footnote">正文预览为原文截取；来源不可用单独提示。此处只阅读或回原入口，不会自动送入任务。</p>
    </div>
    {active && detail && <PersonalDialog returnFocus={detailTrigger.current} fallbackFocus={heading.current} title={shownFields?.title || '个人资料详情'} subtitle={detail.decision ? '准确保留决定与当时内容' : detail.draft ? '工作草稿 · 尚未保留' : '个人草稿元信息 · 正文按需读取'} drawer busy={busy} onClose={() => setDetail(null)} footer={<>{onUse && currentTaskLabel && detail.decision && detail.content && <button className="primary-button" type="button" disabled={busy} onClick={() => { try { useRetained(detail); } catch (error) { setError(personalRetentionError(error)); } }}>加入当前任务 · {currentTaskLabel}</button>}<>{onOther && detail.decision && detail.content && <button className="secondary-button" type="button" disabled={busy} onClick={() => { try { useRetained(detail, true); } catch (error) { setError(personalRetentionError(error)); } }}>{currentTaskLabel ? '选择其他任务' : '选择任务并加入'}</button>}</><button className="secondary-button" type="button" disabled={busy || Boolean(pendingFor(detail.material.id, detail.item)) || detail.item?.archived} onClick={() => { void beginEntry(undefined, detail.material.id); }}>编辑个人草稿</button>{detail.item && <button className="text-button" type="button" disabled={busy || Boolean(pendingFor(detail.material.id, detail.item)) || Boolean(stateRequests[detail.material.id])} onClick={() => { void changeArchive(detail); }}>{detail.item.archived ? '恢复个人条目' : '归档个人条目'}</button>}<button className="text-button" type="button" disabled={busy} onClick={() => { void readDetail(detail.material.id); }}>回查当前条目</button></>}>
      {error && <p className="pr-note pr-warning" role="alert">{error}</p>}{notice && <p className="pr-note" role="status">{notice}</p>}
      {pendingPanel(detail.material.id, detail.item)}{stateRequests[detail.material.id] && <section className="pr-note pr-warning"><strong>原归档／恢复结果待核对</strong><p><code>{stateRequests[detail.material.id]!.request.operationId}</code> · 输入与原操作保持。</p><div className="pr-row"><button type="button" className="secondary-button" disabled={busy} onClick={() => { void inspectStateOperation(detail.material.id); }}>回查原归档／恢复操作</button><button type="button" className="secondary-button" disabled={busy} onClick={() => { void changeArchive(detail); }}>明确同请求重试归档／恢复</button></div></section>}<div className="pr-row"><span className="pr-pill">{detail.item?.archived ? '已归档' : detail.decision ? '已保留' : '未保留草稿'}</span><span className="pr-pill">{detail.material.enabled === null ? '原资料启用状态尚未核对' : detail.material.enabled ? '原资料已另行启用' : '原资料未启用／已停用'}</span></div>
      <div className="pr-paper">{shownFields ? shownFields.body || '无文字正文；按原准确附件阅读，不自动 OCR。' : detail.decision ? '准确保留正文不可读；不会用当前工作草稿替代。' : '工作草稿尚未读取，可显式阅读或编辑。'}</div>
      <dl className="pr-metadata"><dt>个人分类</dt><dd>{shownMetadata ? kindNames[shownMetadata.kind] : '尚未填写'}</dd><dt>用户别名</dt><dd>{shownMetadata?.aliases.join('、') || '未填写'}</dd><dt>适用范围</dt><dd>{unknown(shownFields?.scope)}</dd><dt>业务时间</dt><dd>{unknown(shownFields?.effectiveTime)}</dd><dt>适用提醒</dt><dd>{shownMetadata?.caution || '未填写'}</dd><dt>准确内容</dt><dd><code>{detail.decision?.contentRef ? JSON.stringify(detail.decision.contentRef) : '尚未保留，工作草稿不是精确修订'}</code></dd><dt>本次决定</dt><dd><code>{detail.decision?.operationId ?? '无'}</code></dd></dl>
      {shownAttachment && <div className="pr-note"><strong>准确来源附件：{shownAttachment.name}</strong><p>{shownAttachment.bytes} 字节 · 无正文时不制造文字命中</p><button className="text-button" type="button" onClick={() => { void api.downloadFile(detail.material.id, shownAttachment.id, shownAttachment.name).catch(error => setError(personalRetentionError(error))); }}>下载此准确附件</button></div>}
      <section className="pr-section"><h3>当时精确来源与当前状态</h3><PersonalSources refs={shownMetadata?.sourceRefs ?? []} api={api} onRead={ref => { void readSource(ref); }} /></section>
      <section className="pr-section"><h3>工作草稿与原资料</h3><p className="pr-footnote">草稿与当前保留版并存。个人条目在原资料页仍可见；另行启用时全部修订会沿原目录可见。归档不删源、不撤回启用。</p><p className="pr-meta">原工作稿：{detail.draft?.title ?? '尚未按需读取'} · 个人草稿分类：{detail.item ? kindNames[detail.item.draftMeta.kind] : '未登记'}</p><div className="pr-row"><button className="text-button" type="button" disabled={busy} onClick={() => { void readDetail(detail.material.id, undefined, true); }}>阅读未保留工作草稿</button>{onOpenMaterial && <button className="text-button" type="button" onClick={() => onOpenMaterial(detail.material.id, detail.decision?.contentRef?.revisionId)}>回原资料页与准确修订</button>}</div></section>
      <section className="pr-section"><h3>个人决定历史</h3>{detail.item?.decisions.length ? <ol className="pr-history">{[...detail.item.decisions].reverse().map(decision => <li key={decision.operationId}><div className="pr-version"><div><strong>{{ retain: '明确保留', archive: '归档', restore: '恢复' }[decision.action]}</strong> · {when(decision.decidedAt)}<p className="pr-meta">{kindNames[decision.metadata.kind]} · 别名：{decision.metadata.aliases.join('、') || '无'} · 提醒：{decision.metadata.caution || '未填写'}</p><code>{decision.operationId}</code></div>{decision.action === 'retain' && <button className="secondary-button" type="button" disabled={busy} onClick={() => { void readDetail(detail.material.id, decision.operationId); }}>阅读准确旧版</button>}</div><details><summary>当时元信息与精确来源</summary><pre>{JSON.stringify({ contentRef: decision.contentRef, metadata: decision.metadata, personalLabel: decision.personalLabel, request: decision.request }, null, 2)}</pre></details></li>)}</ol> : <p className="pr-footnote">尚未发表个人保留决定。</p>}{detail.item?.terminations.map(termination => <details key={termination.operationId} className="pr-note pr-warning"><summary>已结束的原操作 · {termination.failure?.outcome ?? 'UNKNOWN'}</summary><p>未发表；旧指针不变。原请求、原失败与可能固化的内容保留。</p><pre>{JSON.stringify(termination, null, 2)}</pre></details>)}</section>
    </PersonalDialog>}
    {active && editorOpen && editor && <PersonalDialog returnFocus={editorTrigger.current} fallbackFocus={heading.current} title={editor.experience ? '整理为个人经验' : editor.direct ? '直接保留已有精确资料' : editor.material ? '编辑个人草稿' : '新建人工笔记'} subtitle="复用原资料正文编辑；保存与保留分别确认" busy={busy} onClose={() => setEditorOpen(false)} footer={<><span className="pr-footnote">{canRetain ? '草稿已明确保存 · 尚未保留' : '有未保存或待核对内容'}</span><div className="pr-row"><button className="secondary-button" type="submit" form={`${id}-editor-form`} disabled={busy || editor.createUnknown || editor.saveUnknown || editor.saveConflict || Boolean(editor.material && pendingFor(editor.material.id, editor.item))}>保存草稿</button><button className="primary-button" type="button" disabled={busy || !canRetain} onClick={prepareRetain}>保留这份内容</button></div><p className="pr-footnote">{canRetain ? '可核对并明确保留当前已保存内容。' : '先保存准确正文与个人信息；未保存修改时不能静默保留旧内容。'}</p></>}>
      {error && <p className="pr-note pr-warning" role="alert">{error}</p>}{journalError && <p className="pr-note pr-warning" role="alert">{journalError}</p>}<form id={`${id}-editor-form`} onSubmit={event => { event.preventDefault(); void saveEditor(); }}>
        {editor.experience && <section className="pr-section"><h3>保存到哪里</h3><p className="pr-footnote">默认新建独立经验。只有你明确选择已有经验，才向同一资料追加新稿；旧保留版与原候选保持。预填尚未保存。</p><label className="pr-target"><span>保存到哪里</span><select value={editor.material?.id ?? 'new'} disabled={busy || editor.createUnknown || editor.saveUnknown || editor.saveConflict || Boolean(editor.material && (editor.savedSignature || pendingFor(editor.material.id, editor.item)))} onChange={event => { const id = event.target.value; void beginEntry(undefined, id === 'new' ? undefined : id, { fields: structuredClone(editor.fields), metadata: structuredClone(editor.metadata) }, true); }}><option value="new">新建个人经验 · 默认</option>{[...experienceTargetOptions.values()].map(item => <option key={item.materialId} value={item.materialId!}>更新已有经验：{item.title}</option>)}</select></label><details><summary>查找其他已有经验</summary><div className="pr-row"><label className="pr-search"><span>已有经验关键词</span><input value={experienceTargetQuery} maxLength={200} onChange={event => setExperienceTargetQuery(event.target.value)} /></label><button type="button" className="secondary-button" disabled={busy} onClick={() => { void lookupExperienceTargets(); }}>查找已有经验</button></div>{experienceTargets && <div className="pr-row"><span className="pr-footnote">第 {experienceTargets.page} 页 · {experienceTargets.total} 项{!experienceTargets.complete ? ' · 范围未完整核对' : ''}</span><button type="button" className="text-button" disabled={busy || experienceTargets.page <= 1} onClick={() => { void lookupExperienceTargets(experienceTargets.page - 1); }}>上页经验</button><button type="button" className="text-button" disabled={busy || experienceTargets.page * experienceTargets.pageSize >= experienceTargets.total} onClick={() => { void lookupExperienceTargets(experienceTargets.page + 1); }}>下页经验</button></div>}</details></section>}
        <fieldset disabled={busy}><legend>资料内容 · 原资料编辑</legend><p className="pr-note">{editor.direct ? '直接引用所选精确旧修订，正文只读，不改原资料当前工作稿。' : '这份整理独立保存，原文保持。前提、局限、反证、反馈或未知可直接写进正文。'}</p><EnterpriseMaterialEditorFields fields={editor.fields} idPrefix={`${id}-personal`} onChange={(key, value) => changeEditor({ fields: { ...editor.fields, [key]: value } })} readOnly={editor.direct} bodyRequired={!editor.direct && !editor.fields.sourceFileId} tried={tried} disabled={busy} /></fieldset>
        <fieldset className="pr-section" disabled={busy}><legend>个人分类与查找</legend><div className="pr-field-grid"><label><span>整理为</span><select value={editor.metadata.kind} onChange={event => changeEditor({ metadata: { ...editor.metadata, kind: event.target.value as PersonalMetadata['kind'] } })}><option value="knowledge">知识</option><option value="experience">经验</option></select></label><label htmlFor={`${id}-aliases`}><span>用户别名</span><input id={`${id}-aliases`} aria-describedby={`${id}-aliases-help`} aria-invalid={tried && (editor.metadata.aliases.length > 20 || editor.metadata.aliases.some(alias => alias.length > 100)) || undefined} value={editor.aliasesText} placeholder="多个词用中文逗号分隔" onChange={event => changeEditor({ aliasesText: event.target.value, metadata: { ...editor.metadata, aliases: event.target.value.split(/[，,、\n]/).map(value => value.trim()).filter(Boolean) } })} /><small id={`${id}-aliases-help`}>最多 20 项，每项 100 UTF-16 字符；不自动推断同义词。</small></label><label className="pr-wide"><span>适用提醒</span><textarea value={editor.metadata.caution ?? ''} maxLength={2000} rows={3} placeholder="可留空；这是你的提醒，不是系统正确性判断。" onChange={event => changeEditor({ metadata: { ...editor.metadata, caution: event.target.value || null } })} /></label></div></fieldset>
        <section className="pr-section"><h3>精确来源</h3><PersonalSources refs={editor.metadata.sourceRefs} api={api} onRead={ref => { void readSource(ref); }} onRemove={busy ? undefined : index => changeEditor({ metadata: { ...editor.metadata, sourceRefs: editor.metadata.sourceRefs.filter((_ref, at) => at !== index) } })} /><p className="pr-footnote">移除来源是你的明确决定，须重新保存。历史保留版的来源保持。</p></section>
        <div className={`pr-note ${editor.saveUnknown || editor.createUnknown || editor.saveConflict ? 'pr-warning' : ''}`} role="status">{editor.message}</div>{editor.material && (editor.saveUnknown || editor.saveConflict || editor.item?.pending) && <button className="secondary-button" type="button" disabled={busy} onClick={() => { void recheckEditor(); }}>回查正文与个人草稿信息</button>}{editor.createUnknown && onOpenMaterial && <button className="text-button" type="button" onClick={() => onOpenMaterial('')}>打开原资料页核对新建结果</button>}{editor.material && pendingPanel(editor.material.id, editor.item)}
      </form>
    </PersonalDialog>}
    {active && confirmation && <PersonalDialog returnFocus={confirmationTrigger.current} fallbackFocus={heading.current} title="保留这份内容" subtitle="只保留下面已保存的准确内容与本次个人信息" busy={busy} onClose={() => setConfirmation(null)} footer={<><button className="secondary-button" type="button" disabled={busy} onClick={() => setConfirmation(null)}>返回核对</button><button className="primary-button" type="button" disabled={busy} onClick={() => { void publish(confirmation.materialId, confirmation.request); }}>{busy ? '正在发表个人决定…' : '确认保留'}</button></>}><PersonalRetentionConfirmation fields={confirmation.fields} request={confirmation.request} /></PersonalDialog>}
    {active && source && <PersonalDialog returnFocus={sourceTrigger.current} fallbackFocus={heading.current} title={source.evidence?.title ?? '来源原文'} subtitle="按原权威精确读取，不启动 Agent" onClose={() => setSource(null)} footer={<div className="pr-row">{source.ref.type === 'enterprise' && onOpenMaterial && <button className="text-button" type="button" onClick={() => { if (source.ref.type === 'enterprise') onOpenMaterial(source.ref.materialId, source.ref.revisionId); }}>回原资料准确修订</button>}{source.evidence?.project && onOpenProject && <button className="text-button" type="button" onClick={() => onOpenProject(source.evidence!.project!.id)}>回原项目</button>}</div>}>
      {source.error ? <p className="pr-note pr-warning" role="alert">{source.error} 精确身份保留，不回落最新版本；个人旧正文仍按自己的修订读取。</p> : source.evidence ? <><div className="pr-row"><span className="pr-pill">{personalSourceStatusLabel(source.evidence)}</span>{source.evidence.project?.archived && <span className="pr-pill">原项目已归档</span>}</div><PersonalSourceGovernance source={source.evidence} /><div className="pr-paper">{source.evidence.text ?? '此准确附件没有可读文字。保留文件身份，不自动 OCR。'}</div>{source.evidence.attachment && <p className="pr-note">附件：{source.evidence.attachment.name} · {source.evidence.attachment.bytes} 字节 · SHA-256 <code>{source.evidence.attachment.sha256}</code></p>}</> : <p role="status">正在核对准确来源…</p>}<details open><summary>精确来源身份</summary><pre>{JSON.stringify(source.ref, null, 2)}</pre></details>
    </PersonalDialog>}
    {active && readOnlyRow && <PersonalDialog returnFocus={rowTrigger.current} fallbackFocus={heading.current} title={readOnlyRow.title} subtitle={readOnlyRow.category === 'concept' ? '来自 M2 明确字段映射的真实资料修订' : 'M2 已登记项目数据元信息'} onClose={() => setReadOnlyRow(null)} footer={<div className="pr-row">{readOnlyRow.contentRef && <button className="secondary-button" type="button" onClick={() => { if (readOnlyRow.contentRef) void readSource({ type: 'enterprise', ...readOnlyRow.contentRef }); }}>阅读准确概念正文</button>}{readOnlyRow.project && onOpenProject && <button className="secondary-button" type="button" onClick={() => onOpenProject(readOnlyRow.project!.id)}>回原项目</button>}</div>}><p className="pr-note">{readOnlyRow.category === 'concept' ? '仅聚合实际引用，不按类别或名称猜概念。' : '这里只展示已登记元信息；正文与维护仍在原项目。'}</p><div className="pr-paper">{readOnlyRow.bodyPreview ?? '无文字预览。'}</div><pre>{JSON.stringify(readOnlyRow.data ?? { contentRef: readOnlyRow.contentRef, conceptUses: readOnlyRow.conceptUses }, null, 2)}</pre>{readOnlyRow.project?.archived && <p className="pr-note">原项目已归档，状态如实保留。</p>}</PersonalDialog>}
  </section>;
}
