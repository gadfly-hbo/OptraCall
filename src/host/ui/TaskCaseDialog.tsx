import { useEffect, useId, useState } from 'react';
import type { CaseRecord, CaseStorageStatus } from '../case-types.ts';
import type { ClientProject, ClientTask } from './project-types.ts';
import * as api from './case-client.ts';
import { CaseDialog, CaseFormError, caseError, caseStatusLabel, useOperationId } from './CaseDialogs.tsx';
import './case-board.css';

type CreateAttempt = { title: string; description: string; operationId: string };
export function TaskCaseDialog({ project, task, onClose, onDone, onGoToBoard }: { project: ClientProject; task: ClientTask; onClose: () => void; onDone: (caseId: string) => void; onGoToBoard?: () => void }) {
  const [storage, setStorage] = useState<CaseStorageStatus | null>(null), [title, setTitle] = useState(''), [description, setDescription] = useState(''), [attempt, setAttempt] = useState<CreateAttempt | null>(null), [created, setCreated] = useState<CaseRecord | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const createOperation = useOperationId(), linkOperation = useOperationId(), id = useId();
  const checkStorage = async () => { setError(''); try { setStorage(await api.status()); } catch (error) { setError(caseError(error)); } };
  useEffect(() => { let alive = true; void api.status().then(state => { if (alive) setStorage(state); }, error => { if (alive) setError(caseError(error)); }); return () => { alive = false; }; }, []);
  const readCreated = async () => {
    if (created) { setCreated((await api.detail(created.id)).case); return; }
    if (!attempt) return;
    const receipt = (await api.operation(attempt.operationId)).operation;
    const record = receipt?.kind === 'case_create' && receipt.phase === 'completed' ? receipt.result : null;
    if (record && typeof record === 'object' && 'id' in record && typeof record.id === 'string') setCreated((await api.detail(record.id)).case);
    else setError('创建结果尚未确认。保留原操作后重试，会使用同一个操作编号，不会另建 Case。');
  };
  const save = async () => {
    if (!created && (!title.trim() || Array.from(title.trim()).length > 80 || Array.from(description).length > 20000)) { setError('请输入 1–80 个字符的 Case 名称，问题背景最多 20000 个字符。'); return; }
    setBusy(true); setError(''); let record = created;
    try {
      if (!record) {
        const input = attempt ?? { title: title.trim(), description, operationId: createOperation({ title: title.trim(), description }) };
        setAttempt(input);
        try { record = (await api.create(input)).case; setCreated(record); }
        catch (error) { if (error instanceof api.CaseRequestError && error.status < 500 && error.code !== 'operation_conflict') setAttempt(null); throw error; }
      }
      await api.linkProject(record.id, { projectId: project.id, expectedRevision: record.revision, operationId: linkOperation({ caseId: record.id, caseRevision: record.revision, projectId: project.id }) });
      onClose(); onDone(record.id);
    } catch (error) { setError(`${record ? 'Case 已创建，项目关联尚未完成。原 Case 已保留，重试只会继续关联。' : attempt ? '创建结果尚未确认，原操作与输入已保留。' : ''}${caseError(error)}`); }
    finally { setBusy(false); }
  };
  return <CaseDialog title="从当前任务建立 Case" subtitle={`${project.name} / ${task.name}`} busy={busy} onClose={onClose}>
    <p className="case-message">关联的是整个原项目“{project.name}”及其中全部 {project.tasks.length} 个任务，当前任务仍保留原身份。不会复制会话或文件，也不会自动调用模型。</p>
    {!storage && !error && <p className="case-help" role="status">正在检查 Case 存储…</p>}
    {storage?.state === 'uninitialized' && <div className="case-storage-state"><h3>请先启用本机 Case 记录</h3><p>在 Case 看板显式启用后，再从任务建立 Case。现有任务和草稿保留。</p>{onGoToBoard && <button type="button" className="secondary-button" onClick={() => { onClose(); onGoToBoard(); }}>前往 Case 看板</button>}</div>}
    {storage?.state === 'unavailable' && <p className="case-message">Case 存储暂不可用。请先在 Case 看板核对本机记录；原项目和任务仍保留。</p>}
    {storage?.state === 'ready' && <form onSubmit={event => { event.preventDefault(); void save(); }}>
      {created ? <div className="case-message"><strong>Case 已保留：{created.title}</strong><p>状态：{caseStatusLabel[created.status]} · 修订 {created.revision}</p><p className="case-help">Case 编号：{created.id}</p><details><summary>核对当前 Case 背景</summary><p className="case-prose">{created.description || '问题背景尚未填写'}</p><p className="case-prose">{created.judgement || '当前判断尚未填写'}</p><p className="case-prose">{created.nextStep || '下一步尚未填写'}</p></details>{created.status === 'closed' && <p>此 Case 已结束，请先在 Case 看板重新打开，再继续关联。</p>}</div> : <><div className="case-field"><label htmlFor={`${id}-title`}>Case 名称 <span>必填</span></label><input id={`${id}-title`} value={title} required maxLength={160} disabled={busy || Boolean(attempt)} onChange={event => setTitle(event.target.value)} placeholder="写下需要持续推进的业务事项" /></div><div className="case-field"><label htmlFor={`${id}-description`}>问题背景（可选）</label><textarea id={`${id}-description`} value={description} maxLength={40000} rows={4} disabled={busy || Boolean(attempt)} onChange={event => setDescription(event.target.value)} placeholder="手工整理与此事项相关的背景，不会自动读取或改写当前会话。" /></div></>}
      {attempt && <p className="case-help">创建操作编号：{attempt.operationId}</p>}
      {(created || attempt) && <div className="case-inline-actions"><button type="button" className="text-button" disabled={busy} onClick={async () => { setBusy(true); setError(''); try { await readCreated(); } catch (error) { setError(caseError(error)); } finally { setBusy(false); } }}>{created ? '重新读取 Case 后核对' : '核对创建结果'}</button>{created && <button type="button" className="text-button" disabled={busy} onClick={() => { onClose(); onDone(created.id); }}>先查看已保留的 Case</button>}</div>}
      <CaseFormError error={error} /><div className="case-dialog-actions"><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>关闭</button><button type="submit" className="primary-button" disabled={busy || created?.status === 'closed'}>{busy ? '正在保存…' : created ? '确认关联此项目' : attempt ? '重试原创建并关联' : '创建 Case 并关联原项目'}</button></div>
    </form>}
    {storage?.state !== 'ready' && <><CaseFormError error={error} /><div className="case-dialog-actions"><button type="button" className="secondary-button" onClick={onClose}>关闭</button><button type="button" className="secondary-button" onClick={() => { void checkStorage(); }}>重新检查</button></div></>}
  </CaseDialog>;
}
