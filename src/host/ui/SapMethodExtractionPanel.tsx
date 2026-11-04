import { useEffect, useRef, useState } from 'react';
import type { SapMethodRef } from '../../../extensions/business-plugins/metric-factory/methods/types.ts';
import type { ClientProject, ClientTask } from './project-types.ts';
import { listSapMethodExtractions, readSapMethodExtraction, startSapMethodExtraction, stopSapMethodExtraction, SapMethodRequestError, type SapMethodExtractionRecord } from './sap-method-client.ts';
import './sap-methods.css';

const statusText: Record<SapMethodExtractionRecord['status'], string> = {
  running: '正在回看来源并提炼分析方法…', saved: '已保存为未发布方法。', reused: '本次关联已有方法的确定版本，没有重复生成。', empty: '没有新增可迁移方法，原分析成果保持。', failed: '本次提取未完成，原分析和已保存记录保持。', cancelled: '已取消本次提取，已经实际保存的结果仍保留。', unknown: '本次提取结果 UNKNOWN，请先核对原请求。',
};
const errorText = (error: unknown) => error instanceof Error ? error.message : '提取状态暂时无法核对。';
export function SapMethodExtractionPanel({ project, task, taskBusy, hasHistory, onOpenMethod }: { project: ClientProject; task: ClientTask; taskBusy: boolean; hasHistory: boolean; onOpenMethod: (target: SapMethodRef) => void }) {
  const [record, setRecord] = useState<SapMethodExtractionRecord>(), [working, setWorking] = useState(false), [error, setError] = useState(''), [readUnavailable, setReadUnavailable] = useState(false);
  const operationEpoch = useRef(0), mounted = useRef(true), selected = useRef({ projectId: project.id, taskId: task.id }), pending = useRef<{ requestId: string; incomplete: boolean } | undefined>(undefined);
  selected.current = { projectId: project.id, taskId: task.id };
  const stillHere = (projectId: string, taskId: string) => mounted.current && selected.current.projectId === projectId && selected.current.taskId === taskId;
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController(), projectId = project.id, taskId = task.id, epoch = operationEpoch.current;
    void listSapMethodExtractions(projectId, taskId, controller.signal).then(values => { if (stillHere(projectId, taskId) && !controller.signal.aborted && epoch === operationEpoch.current) { const latest = values[0]; setRecord(latest); } }).catch(error => { if (!controller.signal.aborted && stillHere(projectId, taskId) && epoch === operationEpoch.current) { setReadUnavailable(true); setError(errorText(error)); } });
    return () => controller.abort();
  }, [project.id, task.id]);
  const inspect = async () => {
    if (!record || working) return; const projectId = project.id, taskId = task.id; setWorking(true); setError('');
    try { const next = await readSapMethodExtraction(projectId, taskId, record.requestId); if (stillHere(projectId, taskId)) { setRecord(next); setReadUnavailable(false); } }
    catch (error) { if (stillHere(projectId, taskId)) { setReadUnavailable(true); setError(errorText(error)); } }
    finally { if (stillHere(projectId, taskId)) setWorking(false); }
  };
  useEffect(() => {
    if (record?.status !== 'running' || readUnavailable) return;
    const controller = new AbortController(), projectId = project.id, taskId = task.id, requestId = record.requestId;
    const timer = setTimeout(() => { void readSapMethodExtraction(projectId, taskId, requestId, controller.signal).then(next => { if (stillHere(projectId, taskId) && !controller.signal.aborted) setRecord(next); }).catch(error => { if (stillHere(projectId, taskId) && !controller.signal.aborted) { setReadUnavailable(true); setError(errorText(error)); } }); }, 900);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [record, readUnavailable, project.id, task.id]);
  const start = async (incomplete: boolean, reuseRequest = false) => {
    if (taskBusy || project.archivedAt || working || record?.status === 'running') return;
    const projectId = project.id, taskId = task.id, request = reuseRequest && pending.current ? pending.current : { requestId: crypto.randomUUID(), incomplete };
    operationEpoch.current += 1; pending.current = request; setWorking(true); setError(''); setReadUnavailable(false);
    try { const value = await startSapMethodExtraction(projectId, taskId, request.requestId, request.incomplete); if (stillHere(projectId, taskId)) setRecord(value); }
    catch (error) {
      if (stillHere(projectId, taskId)) {
        const unknown = error instanceof SapMethodRequestError && error.uncertain;
        setRecord({ requestId: request.requestId, projectId, taskId, status: unknown ? 'unknown' : 'failed', message: errorText(error) });
        setError(errorText(error));
      }
    } finally { if (stillHere(projectId, taskId)) setWorking(false); }
  };
  const stop = async () => {
    if (!record || working) return; const projectId = project.id, taskId = task.id; setWorking(true); setError('');
    try { const next = await stopSapMethodExtraction(projectId, taskId, record.requestId); if (stillHere(projectId, taskId)) { setRecord(next); setReadUnavailable(false); } }
    catch (error) { if (stillHere(projectId, taskId)) { setReadUnavailable(true); setError(`停止尚未核定：${errorText(error)}`); } }
    finally { if (stillHere(projectId, taskId)) setWorking(false); }
  };
  const disabled = taskBusy || Boolean(project.archivedAt) || working || !hasHistory || record?.status === 'running' || record?.status === 'unknown';
  return <section className="sap-method-extraction" aria-label="提取分析方法" aria-busy={working || record?.status === 'running'}>
    <h3>把这次分析留下来</h3><p>任务结束后，可提炼方法、流程与判断依据，保存到 SAP 分析方法。提取不会自动发布，也不影响原分析交付。</p>
    {project.archivedAt ? <p>来源项目已归档，当前仅查看历史；全局 SAP 方法仍可按自身规则管理。</p> : taskBusy ? <p>原任务仍在运行、打开或收尾，来源稳定后可明确提取。</p> : !hasHistory ? <p>此任务尚无可核对的会话来源，完成分析后再提取。</p> : null}
    <div className="sap-method-actions"><button type="button" className="secondary-button" disabled={disabled} onClick={() => { void start(false); }}>本次分析已结束，提取方法</button>{record?.status === 'running' && <button type="button" className="secondary-button" disabled={working} onClick={() => { void stop(); }}>取消本次提取</button>}</div>
    {!project.archivedAt && <details><summary>整理未完成的材料</summary><p>按本次已留存材料整理，保留“分析未完成、来源不完整”的局限，不补造最终结论。</p><button type="button" className="text-button" disabled={disabled} onClick={() => { void start(true); }}>仅整理本次已有材料</button></details>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {record && <div className={`sap-method-note ${record.status === 'failed' ? 'is-error' : record.status === 'unknown' ? 'is-warning' : ''}`} role="status"><p>{statusText[record.status]}</p>{record.message && <p>{record.message}</p>}{record.error && <p>{record.error}</p>}{record.methodId && Number.isSafeInteger(record.version) && <button type="button" className="text-button" onClick={() => onOpenMethod({ methodId: record.methodId!, version: record.version! })}>查看{record.status === 'reused' ? '原方法的准确版本' : '已保存方法'}</button>}{(record.status === 'unknown' || readUnavailable) && <div className="sap-method-actions"><button type="button" className="secondary-button" disabled={working} onClick={() => { void inspect(); }}>核对此次提取</button>{record.status === 'unknown' && pending.current && <button type="button" className="text-button" disabled={working || taskBusy || Boolean(project.archivedAt)} onClick={() => { void start(pending.current!.incomplete, true); }}>按原请求重试提取</button>}</div>}</div>}
    {!record && readUnavailable && <button type="button" className="text-button" onClick={() => { const projectId = project.id, taskId = task.id, epoch = operationEpoch.current; setError(''); void listSapMethodExtractions(projectId, taskId).then(values => { if (stillHere(projectId, taskId) && epoch === operationEpoch.current) { setRecord(values[0]); setReadUnavailable(false); } }).catch(error => { if (stillHere(projectId, taskId) && epoch === operationEpoch.current) setError(errorText(error)); }); }}>重新读取提取记录</button>}
  </section>;
}
