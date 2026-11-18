import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { SapMethodContent, SapMethodDetail, SapMethodIssueInput, SapMethodRef, SapMethodRelation, SapMethodSummary, SapMethodVersion } from '../../../extensions/business-plugins/metric-factory/methods/types.ts';
import { listSapMethods, markSapMethodIssue, publishSapMethod, readSapMethod, readSapMethodOperation, readSapMethodSource, saveSapMethod, SapMethodRequestError, type SapMethodDraftInput, type SapMethodSourceText } from './sap-method-client.ts';
import './sap-methods.css';

export type SapMethodsLeaveGuard = () => Promise<boolean>;
type Editor = { title: string; content: SapMethodContent; base: SapMethodVersion | null; derived: boolean; reason: string };
type PendingSave = { input: SapMethodDraftInput; publishAfter: boolean };
const emptyContent = (): SapMethodContent => ({ conditions: '', logic: '', judgment: '', limits: '' });
const fieldLabels: { key: keyof SapMethodContent; label: string }[] = [{ key: 'conditions', label: '问题与适用条件' }, { key: 'logic', label: '分析逻辑' }, { key: 'judgment', label: '判断依据与取舍' }, { key: 'limits', label: '检查与局限' }];
const errorText = (error: unknown) => error instanceof Error ? error.message : '方法请求未能完成，请核对原记录。';
const originText = (origin: string) => origin === 'ir' ? 'IR 提炼' : '非 IR 提炼';
const formatTime = (value: string) => new Date(value).toLocaleString('zh-CN');
const published = (method: SapMethodDetail, version: SapMethodVersion) => method.publications.some(item => item.version === version.version && item.contentSha256 === version.contentSha256);
const issueFor = (method: SapMethodDetail, version: number) => method.governance.filter(item => item.version === version).at(-1);
function referenceLabel(method: SapMethodSummary): string {
  if (method.publishedVersion === null) return '暂无已发布版本';
  return method.issue?.status === 'confirmed' ? `v${method.publishedVersion} 有已知错误，停止默认推荐` : `v${method.publishedVersion} 可供后续任务参考`;
}
function MethodDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null), trigger = useRef<HTMLElement | null>(document.activeElement instanceof HTMLElement ? document.activeElement : null);
  useEffect(() => {
    dialog.current?.showModal();
    requestAnimationFrame(() => (dialog.current?.querySelector<HTMLElement>('[data-initial-focus]') ?? dialog.current?.querySelector<HTMLElement>('input, textarea, button'))?.focus());
    return () => { dialog.current?.close(); requestAnimationFrame(() => { if (trigger.current?.isConnected && !trigger.current.matches(':disabled')) trigger.current.focus(); }); };
  }, []);
  return <dialog ref={dialog} className="sap-method-dialog" aria-labelledby="sap-method-dialog-title" onCancel={event => { event.preventDefault(); onClose(); }}><div className="sap-method-dialog-header"><h2 id="sap-method-dialog-title">{title}</h2><button type="button" className="text-button" onClick={onClose} aria-label={`关闭${title}`}>关闭</button></div>{children}</dialog>;
}

export function SapMethodsPage({ active = true, initialTarget, onTargetConsumed, onNavigationGuard, embedded = false, readOnly = false, allowedIds, onSaved }: { active?: boolean; initialTarget?: SapMethodRef; onTargetConsumed?: () => void; onNavigationGuard?: (guard: SapMethodsLeaveGuard | null) => void; embedded?: boolean; readOnly?: boolean; enterpriseId?: string; allowedIds?: string[]; onSaved?: (id: string) => void | Promise<void> }) {
  const [methods, setMethods] = useState<SapMethodSummary[]>([]), [detail, setDetail] = useState<SapMethodDetail>();
  const [query, setQuery] = useState(''), [origin, setOrigin] = useState<'' | 'ir' | 'other'>(''), [status, setStatus] = useState<'' | 'draft' | 'published'>('');
  const [loading, setLoading] = useState(false), [working, setWorking] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const [editor, setEditor] = useState<Editor>(), [pendingSave, setPendingSave] = useState<PendingSave>(), [pendingPublish, setPendingPublish] = useState<{ methodId: string; version: number; expectedSha256: string; requestId: string }>();
  const [fieldError, setFieldError] = useState<'title' | 'content'>(), [leaveOpen, setLeaveOpen] = useState(false);
  const [sourceView, setSourceView] = useState<{ label: string; loading: boolean; value?: SapMethodSourceText; error?: string }>();
  const [issueForm, setIssueForm] = useState<{ status: 'suspected' | 'confirmed'; note: string; requestId: string; error: string; unknown: boolean }>();
  const mounted = useRef(true), selectionEpoch = useRef(0), sourceEpoch = useRef(0), heading = useRef<HTMLHeadingElement>(null), leaveResolver = useRef<((value: boolean) => void) | null>(null);
  const selected = detail?.versions.find(item => item.version === detail.selectedVersion);
  const dirty = Boolean(editor && (editor.title !== (editor.base?.title ?? '') || fieldLabels.some(({ key }) => editor.content[key] !== (editor.base?.content[key] ?? '')) || editor.derived));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; leaveResolver.current?.(false); }; }, []);
  const allowLeave = useCallback(async () => {
    if (working || pendingSave || pendingPublish) { setError('当前操作尚未核定，请先核对保存或发布结果；原输入与请求保持。'); return false; }
    if (!dirty) return true;
    if (leaveResolver.current) return false;
    return new Promise<boolean>(resolve => { leaveResolver.current = resolve; setLeaveOpen(true); });
  }, [dirty, working, pendingSave, pendingPublish]);
  useEffect(() => { onNavigationGuard?.(allowLeave); return () => onNavigationGuard?.(null); }, [allowLeave, onNavigationGuard]);
  useEffect(() => {
    if (!dirty && !pendingSave && !pendingPublish) return;
    const prevent = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', prevent); return () => window.removeEventListener('beforeunload', prevent);
  }, [dirty, pendingSave, pendingPublish]);
  useEffect(() => { if (!active) { setSourceView(undefined); setIssueForm(undefined); } }, [active]);
  const finishLeave = (allowed: boolean) => { const resolve = leaveResolver.current; leaveResolver.current = null; setLeaveOpen(false); if (allowed) { setEditor(undefined); setFieldError(undefined); } resolve?.(allowed); };
  const reloadList = useCallback(async (signal?: AbortSignal) => {
    const values = await listSapMethods({ ...(origin ? { origin } : {}), ...(status ? { status } : {}), ...(query.trim() ? { query: query.trim() } : {}) }, signal);
    if (mounted.current && !signal?.aborted) setMethods(embedded ? values.filter(value => allowedIds?.includes(value.id)) : values);
  }, [origin, status, query, embedded, allowedIds]);
  useEffect(() => {
    if (!active || detail || editor) return;
    const controller = new AbortController(); setLoading(true); setError('');
    void reloadList(controller.signal).catch(error => { if (!controller.signal.aborted) setError(errorText(error)); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, detail, editor, reloadList]);
  const openMethod = async (id: string, version?: number) => {
    if (embedded && !allowedIds?.includes(id)) { setError('此方法尚未核定归属当前企业，未读取其他企业或待核内容。'); return; }
    if (!await allowLeave()) return;
    const epoch = ++selectionEpoch.current; setLoading(true); setError(''); setNotice('');
    try { const value = await readSapMethod(id, version); if (mounted.current && epoch === selectionEpoch.current) { setDetail(value); setEditor(undefined); setFieldError(undefined); requestAnimationFrame(() => heading.current?.focus()); } }
    catch (error) { if (mounted.current && epoch === selectionEpoch.current) setError(errorText(error)); }
    finally { if (mounted.current && epoch === selectionEpoch.current) setLoading(false); }
  };
  const targetRef = useRef(initialTarget); targetRef.current = initialTarget;
  useEffect(() => { if (active && initialTarget) { void openMethod(initialTarget.methodId, initialTarget.version).finally(() => { if (targetRef.current === initialTarget) onTargetConsumed?.(); }); } }, [active, initialTarget]);
  const startEditor = (derived = false) => {
    if (readOnly || working || pendingSave || pendingPublish) return;
    setEditor({ title: selected?.title ?? '', content: selected ? { ...selected.content } : emptyContent(), base: selected ?? null, derived, reason: selected ? `基于 v${selected.version} 后续整理` : '' });
    setError(''); setNotice(''); setFieldError(undefined);
    requestAnimationFrame(() => document.getElementById('sap-method-title')?.focus());
  };
  const applySaved = (value: SapMethodDetail) => { if (mounted.current) { setDetail(value); setEditor(undefined); setPendingSave(undefined); setFieldError(undefined); } };
  const performPublish = async (method: SapMethodDetail, version: SapMethodVersion, requestId: string = crypto.randomUUID()) => {
    const pending = { methodId: method.id, version: version.version, expectedSha256: version.contentSha256, requestId };
    try { const result = await publishSapMethod(method.id, { requestId, version: version.version, expectedSha256: version.contentSha256 }); if (mounted.current) { setDetail(result.method); setPendingPublish(undefined); setNotice(`v${version.version} 已发布，后续任务可沿 SAP 策略按需参考；旧版本与来源保持。`); } }
    catch (error) { if (mounted.current) { const uncertain = error instanceof SapMethodRequestError && error.uncertain; if (uncertain) { setPendingPublish(pending); setNotice('已保存内容保持；发布结果未核定，当前显示上次已核对的版本状态。'); } else setPendingPublish(undefined); setError(`发布${uncertain ? '结果待核定' : '失败'}。v${version.version} 的保存结果保持；${errorText(error)}`); } }
  };
  const performSave = async (input: SapMethodDraftInput, publishAfter: boolean) => {
    setWorking(true); setError(''); setNotice('');
    try {
      const result = await saveSapMethod(input); if (!mounted.current) return;
      applySaved(result.method); setNotice(`v${result.version.version} 已保存，尚未发布。${referenceLabel(result.method)}。`);
      if (onSaved) { try { await onSaved(result.method.id); } catch { setError('方法原版本已保存，企业归属关联尚未核定；原内容保持，不自动重复保存或继续发布。'); return; } }
      if (publishAfter) await performPublish(result.method, result.version);
      requestAnimationFrame(() => heading.current?.focus());
    } catch (error) {
      if (mounted.current) { if (error instanceof SapMethodRequestError && error.uncertain) setPendingSave({ input, publishAfter }); setError(`${errorText(error)} 编辑内容仍保留，未继续发布。`); }
    } finally { if (mounted.current) setWorking(false); }
  };
  const save = async (publishAfter: boolean) => {
    if (!editor || working || pendingSave || pendingPublish) return;
    if (!editor.title.trim()) { setFieldError('title'); document.getElementById('sap-method-title')?.focus(); return; }
    if (!fieldLabels.some(({ key }) => editor.content[key].trim())) { setFieldError('content'); document.getElementById('sap-method-logic')?.focus(); return; }
    if (!dirty && selected && detail) { setEditor(undefined); setNotice('内容未变化，沿用原确定版本，没有生成重复方法。'); if (publishAfter && !published(detail, selected)) { setWorking(true); await performPublish(detail, selected); if (mounted.current) setWorking(false); } return; }
    let relation: SapMethodRelation | null = null;
    if (editor.base && detail) relation = { kind: editor.derived ? 'derived' : issueFor(detail, editor.base.version)?.status === 'confirmed' ? 'correction' : 'revision', target: { methodId: editor.base.methodId, version: editor.base.version }, reason: editor.reason.trim() || `基于 v${editor.base.version} 后续整理` };
    const input: SapMethodDraftInput = { requestId: crypto.randomUUID(), ...(!editor.derived && detail ? { methodId: detail.id, baseVersion: detail.latestVersion } : {}), title: editor.title.trim(), content: { ...editor.content }, sources: editor.base?.sources ?? [], relation };
    await performSave(input, publishAfter);
  };
  const inspectSave = async () => {
    if (!pendingSave || working) return; setWorking(true); setError('');
    try {
      const value = await readSapMethodOperation(pendingSave.input.requestId); if (!mounted.current) return;
      if (value.operation?.status === 'committed' && value.operation.kind === 'save' && value.method) {
        if (pendingSave.input.methodId && value.method.id !== pendingSave.input.methodId) throw new Error('原保存请求的归属尚未核对，保留原输入。');
        applySaved(value.method); if (onSaved) { try { await onSaved(value.method.id); } catch { setError('原保存成功已核定；企业归属关联尚未核定，未重复保存或继续发布。'); return; } } setNotice(`已读回 v${value.operation.version} 保存成功，未重新保存，也未因核对自动发布。`); requestAnimationFrame(() => heading.current?.focus());
      } else setError(value.operation ? '原保存请求仍待核定，原输入与请求保持；可稍后再核对或显式重试原请求。' : '尚未找到原保存请求的确定记录，不能据此认定未保存；原输入与请求保持。');
    } catch (error) { if (mounted.current) setError(errorText(error)); }
    finally { if (mounted.current) setWorking(false); }
  };
  const inspectPublication = async () => {
    if (!pendingPublish || working) return; setWorking(true); setError('');
    try {
      const value = await readSapMethodOperation(pendingPublish.requestId); if (!mounted.current) return;
      if (value.operation?.status === 'committed' && value.operation.kind === 'publish' && value.method && value.method.id === pendingPublish.methodId && value.operation.version === pendingPublish.version && value.method.publications.some(item => item.version === pendingPublish.version && item.contentSha256 === pendingPublish.expectedSha256)) {
        setDetail(value.method); setPendingPublish(undefined); setNotice('已读回确定版本发布成功，未重新发布。');
      } else setError(value.operation ? '原发布请求仍未核定。已保存内容保持，可稍后再核对或显式重试原发布请求。' : '尚未找到原发布请求的确定记录，不能据此认定未发布；已保存内容与请求保持。');
    } catch (error) { if (mounted.current) setError(errorText(error)); }
    finally { if (mounted.current) setWorking(false); }
  };
  const readSource = async (index: number) => {
    if (!detail || !selected) return;
    const epoch = ++sourceEpoch.current, id = detail.id, number = selected.version, label = selected.sources[index]?.label ?? '原始来源';
    setSourceView({ label, loading: true });
    try { const value = await readSapMethodSource(id, number, index); if (mounted.current && epoch === sourceEpoch.current) setSourceView(current => current ? { label, loading: false, value } : current); }
    catch (error) { if (mounted.current && epoch === sourceEpoch.current) setSourceView(current => current ? { label, loading: false, error: errorText(error) } : current); }
  };
  const recordIssue = async () => {
    if (!detail || !selected || !issueForm || working) return;
    if (!issueForm.note.trim()) { setIssueForm({ ...issueForm, error: '请说明问题及依据。' }); return; }
    const input: SapMethodIssueInput = { requestId: issueForm.requestId, version: selected.version, expectedRevision: detail.governanceRevision, status: issueForm.status, note: issueForm.note.trim() };
    setWorking(true);
    try { const value = await markSapMethodIssue(detail.id, input); if (mounted.current) { setDetail({ ...value, selectedVersion: selected.version }); setIssueForm(undefined); setNotice('已记录版本问题，原方法正文与旧成果保持。'); } }
    catch (error) { if (mounted.current) setIssueForm({ ...issueForm, unknown: error instanceof SapMethodRequestError && error.uncertain, error: errorText(error) }); }
    finally { if (mounted.current) setWorking(false); }
  };
  const inspectIssue = async () => {
    if (!detail || !selected || !issueForm || working) return; setWorking(true);
    try {
      const value = await readSapMethod(detail.id, selected.version);
      if (!mounted.current) return;
      if (value.governance.some(item => item.requestId === issueForm.requestId)) { setDetail(value); setIssueForm(undefined); setNotice('已读回原问题记录，未重新写入。'); }
      else setIssueForm({ ...issueForm, error: '尚未读到原请求对应的问题记录；输入与请求保留，可显式重试原请求。' });
    } catch (error) { if (mounted.current) setIssueForm({ ...issueForm, error: errorText(error) }); }
    finally { if (mounted.current) setWorking(false); }
  };
  const Header = embedded ? 'h2' : 'h1';
  const selectedPublished = Boolean(detail && selected && published(detail, selected));
  const selectedIssue = detail && selected ? issueFor(detail, selected.version) : undefined;
  return <section className={`sap-method-page${embedded ? ' is-embedded' : ''}`} aria-label="SAP 分析方法" aria-busy={loading || working}>
    <header className="sap-method-heading"><div><Header ref={heading} tabIndex={-1}>{editor ? editor.derived ? '派生分析方法' : editor.base ? '编辑分析方法' : '新建分析方法' : selected ? selected.title : '分析方法'}</Header><p>{editor ? '保存形成未发布版本；发布后才可供后续任务参考。' : '两类来源统一管理，已发布且有权访问的版本按需供后续任务参考。'}</p></div>{!readOnly && !detail && !editor && <button type="button" className="primary-button" onClick={() => startEditor()} disabled={working}>新建方法</button>}</header>
    {error && <div className="sap-method-note is-error" role="alert">{error}</div>}{notice && <div className="sap-method-note" role="status">{notice}</div>}
    {pendingSave && <div className="sap-method-note is-warning" role="alert"><p>保存结果 UNKNOWN。原输入和原请求已保留，本页不会自动重放。</p><div className="sap-method-actions"><button type="button" className="secondary-button" disabled={working} onClick={() => { void inspectSave(); }}>核对此次保存结果</button><button type="button" className="text-button" disabled={working} onClick={() => { void performSave(pendingSave.input, pendingSave.publishAfter); }}>重试原保存请求</button></div></div>}
    {pendingPublish && <div className="sap-method-note is-warning" role="alert"><p>发布结果 UNKNOWN；已保存内容与旧发布版本保持。下方为上次已核对的版本状态，请核对本次发布结果。</p><div className="sap-method-actions"><button type="button" className="secondary-button" disabled={working} onClick={() => { void inspectPublication(); }}>核对发布结果</button><button type="button" className="text-button" disabled={working} onClick={() => { const p = pendingPublish, v = detail?.versions.find(item => item.version === p.version); if (detail && v) { setWorking(true); void performPublish(detail, v, p.requestId).finally(() => { if (mounted.current) setWorking(false); }); } }}>重试原发布请求</button></div></div>}
    {loading && <p className="sap-method-muted" role="status">正在读取方法与确定版本…</p>}
    {editor ? <form className="sap-method-editor" noValidate onSubmit={event => { event.preventDefault(); void save(false); }}>
      <div className="sap-method-badges"><span className="sap-method-badge">{editor.derived || !editor.base ? '非 IR 提炼' : originText(editor.base.origin)}</span><span className="sap-method-badge is-warning">{pendingSave ? '保存结果待核定' : '尚未保存'}</span></div>
      {editor.base && <p className="sap-method-muted">基于 v{editor.base.version} 整理；保存新版本不会覆盖原版。{detail?.publishedVersion ? `当前发布版为 v${detail.publishedVersion}。` : ''}</p>}
      <div className="field"><label htmlFor="sap-method-title">方法名称 <span className="sap-method-muted">（必填）</span></label><input id="sap-method-title" value={editor.title} maxLength={200} required disabled={working || Boolean(pendingSave)} aria-invalid={fieldError === 'title' || undefined} aria-describedby={fieldError === 'title' ? 'sap-method-title-error' : undefined} onChange={event => { setEditor({ ...editor, title: event.target.value }); setFieldError(undefined); }} />{fieldError === 'title' && <p id="sap-method-title-error" className="field-error" role="alert">请输入方法名称。</p>}</div>
      {fieldLabels.map(({ key, label }) => <div className="field" key={key}><label htmlFor={`sap-method-${key}`}>{label}</label><textarea id={`sap-method-${key}`} value={editor.content[key]} rows={key === 'logic' ? 6 : 3} disabled={working || Boolean(pendingSave)} aria-invalid={fieldError === 'content' && key === 'logic' || undefined} aria-describedby={fieldError === 'content' && key === 'logic' ? 'sap-method-content-error' : undefined} onChange={event => { setEditor({ ...editor, content: { ...editor.content, [key]: event.target.value } }); setFieldError(undefined); }} /></div>)}
      {fieldError === 'content' && <p id="sap-method-content-error" className="field-error" role="alert">请保留有价值的方法内容，无需填写全部栏目。</p>}
      {editor.base && <details><summary>来源与版本说明</summary><p>原始来源和确定版本继续保留，本次新增逻辑属于后续整理。</p><div className="field"><label htmlFor="sap-method-reason">变更说明</label><input id="sap-method-reason" value={editor.reason} disabled={working || Boolean(pendingSave)} onChange={event => setEditor({ ...editor, reason: event.target.value })} /></div></details>}
      <div className="sap-method-note">普通保存不发布。{detail ? referenceLabel(detail) : '新方法尚无已发布版本。'}</div>
      <div className="sap-method-actions"><button type="submit" className="primary-button" disabled={working || Boolean(pendingSave)}>{working ? '正在处理…' : '保存为未发布版本'}</button><button type="button" className="secondary-button" disabled={working || Boolean(pendingSave)} onClick={() => { void save(true); }}>保存并发布</button><button type="button" className="text-button" disabled={working || Boolean(pendingSave)} onClick={() => { void allowLeave().then(allowed => { if (allowed) { setEditor(undefined); setFieldError(undefined); } }); }}>取消编辑</button></div>
    </form> : detail && selected ? <>
      <div className="sap-method-actions">{!readOnly && <button type="button" className="text-button" disabled={working || Boolean(pendingPublish)} onClick={() => { setDetail(undefined); setError(''); setNotice(''); }}>← 返回分析方法</button>}<div className="sap-method-badges"><span className="sap-method-badge">{originText(selected.origin)}</span><span className={`sap-method-badge ${selectedPublished ? 'is-published' : 'is-warning'}`}>v{selected.version} · {selectedPublished ? '已发布' : '已保存未发布'}</span></div></div>
      <p className="sap-method-reference">{referenceLabel(detail)}{!selectedPublished && '；当前查看版本尚不可供后续任务参考。'}</p>
      {selectedIssue && <div className={`sap-method-note ${selectedIssue.status === 'confirmed' ? 'is-error' : 'is-warning'}`} role="status"><strong>{selectedIssue.status === 'confirmed' ? '此版本存在已确认错误，停止默认推荐' : '此版本有待核实的问题'}</strong><p>{selectedIssue.note}</p>{selectedIssue.replacement && <button type="button" className="text-button" disabled={readOnly} onClick={() => { void openMethod(selectedIssue.replacement!.methodId, selectedIssue.replacement!.version); }}>查看所关联的替代版本</button>}<p>原内容与旧成果保持，纠正版发布前不能作为后续任务替代方法。</p>{detail.versions.filter(item => item.relation?.kind === 'correction' && item.relation.target.methodId === detail.id && item.relation.target.version === selected.version).map(item => <button key={item.version} type="button" className="text-button" disabled={readOnly} onClick={() => { void openMethod(detail.id, item.version); }}>查看纠正版 v{item.version}（{published(detail, item) ? '已发布' : '未发布'}）</button>)}</div>}
      {!readOnly && <div className="sap-method-actions"><button type="button" className="secondary-button" disabled={working || Boolean(pendingPublish)} onClick={() => startEditor()}>{selectedPublished ? '编辑为新版本' : '编辑方法'}</button>{!selectedPublished && <button type="button" className="primary-button" disabled={working || Boolean(pendingPublish)} onClick={() => { setWorking(true); setError(''); void performPublish(detail, selected).finally(() => { if (mounted.current) setWorking(false); }); }}>发布此版本</button>}<button type="button" className="text-button" disabled={working || Boolean(pendingPublish)} onClick={() => startEditor(true)}>派生新方法</button><button type="button" className="text-button" disabled={working || Boolean(pendingPublish)} onClick={() => setIssueForm({ status: 'suspected', note: '', requestId: crypto.randomUUID(), error: '', unknown: false })}>记录版本问题</button></div>}
      <div className="sap-method-detail"><article>{fieldLabels.map(({ key, label }) => <section className="sap-method-section" key={key}><h2>{label}</h2><p>{selected.content[key] || '原记录未说明。'}</p></section>)}
      <details className="sap-method-sources"><summary>查看原始来源与可复用材料</summary>{selected.sources.length ? <ul>{selected.sources.map((source, index) => <li key={`${index}:${source.ref}`}><strong>{source.label}</strong><p className="sap-method-muted">{source.type === 'session' ? '原任务会话' : source.type === 'memory' ? '相关记忆' : source.type === 'report' ? '原报告' : source.type === 'method' ? '方法版本' : '人工来源'}{source.version ? ` · ${source.version}` : ''}</p><button type="button" className="text-button" onClick={() => { void readSource(index); }}>查看来源原文</button><details><summary>准确来源信息</summary><pre>{source.ref}{source.sha256 ? `\nSHA-256 ${source.sha256}` : '\n内容身份未记录'}</pre></details></li>)}</ul> : <p>此方法未关联可定位的外部来源；缺失信息不补造。</p>}</details></article>
      <aside className="sap-method-version-panel" aria-label="方法版本与采用信息"><h2>版本记录</h2>{[...detail.versions].reverse().map(version => <button type="button" className={`sap-method-version ${version.version === selected.version ? 'selected' : ''}`} key={version.version} aria-current={version.version === selected.version ? 'true' : undefined} disabled={readOnly || working || Boolean(pendingPublish)} onClick={() => { void openMethod(detail.id, version.version); }}><strong>v{version.version} · {published(detail, version) ? '已发布' : '未发布'}</strong><span>{formatTime(version.savedAt)}</span>{version.relation && <span>{version.relation.kind === 'derived' ? '派生自' : version.relation.kind === 'correction' ? '纠正' : '修订自'} v{version.relation.target.version} · {version.relation.reason}</span>}{issueFor(detail, version.version)?.status === 'confirmed' && <span className="sap-method-error-text">已知错误 · 历史保留</span>}</button>)}<p className="sap-method-muted">发布表达正式采用意图，不代表专业验证。Agent仍自主检查适用性，可调整、组合或不采用。</p></aside></div>
    </> : !readOnly ? <>
      <div className="sap-method-filter"><div className="field"><label htmlFor="sap-method-query">搜索方法</label><input type="search" id="sap-method-query" value={query} placeholder="名称、适用问题或方法内容" onChange={event => setQuery(event.target.value)} /></div><div className="field"><label htmlFor="sap-method-origin">来源</label><select id="sap-method-origin" value={origin} onChange={event => setOrigin(event.target.value as typeof origin)}><option value="">全部来源</option><option value="ir">IR 提炼</option><option value="other">非 IR 提炼</option></select></div><div className="field"><label htmlFor="sap-method-status">状态</label><select id="sap-method-status" value={status} onChange={event => setStatus(event.target.value as typeof status)}><option value="">全部状态</option><option value="draft">有未发布版本</option><option value="published">有已发布版本</option></select></div><button type="button" className="text-button" onClick={() => { setQuery(''); setOrigin(''); setStatus(''); }}>清除筛选</button><button type="button" className="text-button" disabled={loading} onClick={() => { setError(''); setLoading(true); void reloadList().catch(error => setError(errorText(error))).finally(() => { if (mounted.current) setLoading(false); }); }}>刷新列表</button></div>
      {methods.length ? <><p className="sap-method-mobile-hint">窄屏可横向滚动查看版本和操作。</p><div className="sap-method-table-wrap"><table className="sap-method-table"><thead><tr><th scope="col">分析方法</th><th scope="col">来源</th><th scope="col">最新保存</th><th scope="col">后续任务参考</th><th scope="col">操作</th></tr></thead><tbody>{methods.map(method => <tr key={method.id}><td><strong>{method.title}</strong><span className="sap-method-muted">{formatTime(method.updatedAt)}</span></td><td><span className="sap-method-badge">{originText(method.origin)}</span></td><td>v{method.latestVersion}<span className={`sap-method-badge ${method.hasUnpublishedChanges ? 'is-warning' : 'is-published'}`}>{method.hasUnpublishedChanges ? '已保存未发布' : '已发布'}</span></td><td>{referenceLabel(method)}</td><td><button type="button" className="secondary-button" aria-label={`查看${method.title}`} onClick={() => { void openMethod(method.id); }}>查看</button></td></tr>)}</tbody></table></div></> : !loading && <div className="sap-method-empty"><h2>{query || origin || status ? '没有符合条件的方法' : '还没有保存的分析方法'}</h2><p>{query || origin || status ? '调整筛选条件，查看其他方法。' : '分析结束后可在分析窗口提取，也可以手工新建。保存后需发布，才供后续任务参考。'}</p></div>}
    </> : null}
    {leaveOpen && <MethodDialog title="保留未保存的编辑？" onClose={() => finishLeave(false)}><div className="sap-method-dialog-body"><p>此处修改尚未保存。可以继续编辑，或明确放弃本次修改。已经保存的版本始终保持。</p></div><div className="sap-method-actions"><button data-initial-focus type="button" className="primary-button" onClick={() => finishLeave(false)}>继续编辑</button><button type="button" className="secondary-button" onClick={() => finishLeave(true)}>放弃未保存修改</button></div></MethodDialog>}
    {sourceView && <MethodDialog title={sourceView.label} onClose={() => setSourceView(undefined)}><div className="sap-method-dialog-body">{sourceView.loading ? <p role="status">正在读取准确来源…</p> : sourceView.error ? <p className="field-error" role="alert">{sourceView.error} 原引用保持，未用其他版本替代。</p> : <>{sourceView.value?.text ? <pre>{sourceView.value.text}</pre> : <p>此来源没有可读取的正文。</p>}{(!sourceView.value?.complete || sourceView.value?.limitation) && <p className="sap-method-note is-warning">{sourceView.value?.limitation || '仅提供当前可核对的部分来源，不能视为完整原文。'}</p>}{sourceView.value?.governance && <section aria-label="当前来源治理"><h3>当前来源治理</h3><pre>{sourceView.value.governance}</pre></section>}</>}</div><div className="sap-method-actions"><button data-initial-focus type="button" className="secondary-button" onClick={() => setSourceView(undefined)}>关闭来源</button></div></MethodDialog>}
    {issueForm && <MethodDialog title="记录版本问题" onClose={() => { if (!working && !issueForm.unknown) setIssueForm(undefined); }}><form onSubmit={event => { event.preventDefault(); void recordIssue(); }}><div className="sap-method-dialog-body"><p>针对当前 v{selected?.version} 记录，旧正文与成果不改写。</p><div className="field"><label htmlFor="sap-method-issue-status">问题状态</label><select id="sap-method-issue-status" value={issueForm.status} disabled={working || issueForm.unknown} onChange={event => setIssueForm({ ...issueForm, requestId: crypto.randomUUID(), status: event.target.value as 'suspected' | 'confirmed' })}><option value="suspected">疑似问题，保留意见</option><option value="confirmed">已确认错误，停止默认推荐</option></select></div><div className="field"><label htmlFor="sap-method-issue-note">问题与依据</label><textarea data-initial-focus id="sap-method-issue-note" value={issueForm.note} required disabled={working || issueForm.unknown} onChange={event => setIssueForm({ ...issueForm, requestId: crypto.randomUUID(), note: event.target.value })} /></div>{issueForm.error && <p role="alert" className="field-error">{issueForm.error}{issueForm.unknown ? ' 原请求保留，请按原请求核对。' : ''}</p>}</div><div className="sap-method-actions">{issueForm.unknown && <button type="button" className="secondary-button" disabled={working} onClick={() => { void inspectIssue(); }}>核对问题记录</button>}<button type="button" className="secondary-button" disabled={working || issueForm.unknown} onClick={() => setIssueForm(undefined)}>取消</button><button type="submit" className="primary-button" disabled={working}>{working ? '正在记录…' : issueForm.unknown ? '按原请求核对／重试' : '保存问题记录'}</button></div></form></MethodDialog>}
  </section>;
}
