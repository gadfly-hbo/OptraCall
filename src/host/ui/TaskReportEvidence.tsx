import { useEffect, useId, useRef, useState } from 'react';
import { conclusionCandidates, type ConclusionCandidates } from './conclusion-review-client.ts';
import { readSavedReport } from './runtime-client.ts';
import { TaskReportReferences } from './TaskReportReferences.tsx';

type Report = ConclusionCandidates['reports'][number];
const reportKey = ({ relativePath, sha256 }: Report) => `${relativePath}#${sha256 ?? ''}`;

export function TaskReportEvidence({ projectId, taskId, initialReport, onReportChange, onOpenCase }: {
  projectId: string; taskId: string; initialReport?: Report; onReportChange: (report?: Report) => void; onOpenCase: (caseId: string) => void;
}) {
  const selectId = useId();
  const [candidates, setCandidates] = useState<ConclusionCandidates>();
  const [selected, setSelected] = useState<Report | undefined>(initialReport);
  const [preview, setPreview] = useState<{ report: Report; text: string }>();
  const [error, setError] = useState(''), [loading, setLoading] = useState(true), [reading, setReading] = useState(false);
  const [revision, setRevision] = useState(0);
  const read = useRef<AbortController | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void conclusionCandidates(projectId, taskId, controller.signal).then(value => {
      if (controller.signal.aborted) return;
      setCandidates(value);
      const preselected = value.preselected;
      setSelected(previous => previous ?? value.reports.find(report => report.relativePath === preselected?.relativePath && report.sha256 === preselected?.sha256));
    }).catch(fault => {
      if (!controller.signal.aborted) setError(fault instanceof Error ? fault.message : '暂时无法核对报告与依据。');
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => { controller.abort(); read.current?.abort(); };
  }, [projectId, taskId, revision]);

  const current = selected && candidates?.reports.find(report => reportKey(report) === reportKey(selected));
  function resetPreview() {
    read.current?.abort();
    setReading(false); setPreview(undefined); setError('');
  }
  async function openReport() {
    if (!current?.reviewable || !current.sha256) return;
    onReportChange(current);
    resetPreview();
    const controller = new AbortController();
    read.current = controller;
    setReading(true);
    try {
      const text = await readSavedReport(projectId, current.relativePath, current.sha256, controller.signal);
      if (!controller.signal.aborted) setPreview({ report: current, text });
    } catch (fault) {
      if (!controller.signal.aborted) setError(fault instanceof Error ? fault.message : '这版报告目前无法读取。');
    } finally {
      if (!controller.signal.aborted) setReading(false);
    }
  }

  return <section className="task-report-evidence" aria-label="已保存报告与可用依据">
    <h3 tabIndex={-1} data-panel-focus>报告与依据</h3>
    <button type="button" className="text-button" disabled={loading} onClick={() => { resetPreview(); setCandidates(undefined); setLoading(true); setRevision(value => value + 1); }}>只读刷新</button>
    {loading && <p role="status">正在核对原任务可读取的报告…</p>}
    {error && <p className="cnr-notice error" role="alert">{error}</p>}
    {candidates && <>
      <label htmlFor={selectId}>已保存报告版本</label>
      <select id={selectId} value={selected ? reportKey(selected) : ''} onChange={event => {
        resetPreview();
        const next = candidates.reports.find(report => reportKey(report) === event.target.value);
        setSelected(next); onReportChange(next);
      }}>
        <option value="">选择报告版本</option>
        {selected && !current && <option value={reportKey(selected)}>先前选择 · {selected.relativePath}</option>}
        {candidates.reports.map(report => <option key={reportKey(report)} value={reportKey(report)}>
          {report.relativePath} · {report.sha256?.slice(0, 12) ?? '版本待核'}{report.current ? ' · 本任务当前交付' : ''}{report.reviewable ? '' : ' · 暂不可预览'}
        </option>)}
      </select>
      {!candidates.reports.length && <p>原任务目前没有可列出的已保存报告。</p>}
      {selected && <div className="cnr-version"><strong>{selected.relativePath}</strong><code>{selected.sha256 ?? '版本待核'}</code>
        {!current || !current.reviewable ? <p>这版暂不可读取。原选择保留，请核对路径与版本。</p> : <p>{current.current ? '本任务当前交付' : '本任务获准查看的项目报告'}</p>}</div>}
      <button type="button" className="secondary-button" disabled={!current?.reviewable || !current.sha256 || reading} onClick={() => void openReport()}>{reading ? '正在读取…' : '查看本版报告'}</button>
      {preview && <pre className="task-report-text" tabIndex={0} aria-label={preview.report.relativePath}>{preview.text}</pre>}
      {current?.reviewable && current.sha256 && <TaskReportReferences key={reportKey(current)} projectId={projectId} taskId={taskId} path={current.relativePath} sha256={current.sha256} onOpenCase={onOpenCase} />}
      {candidates.limitations?.map(note => <p key={note}>{note}</p>)}
      <details className="cnr-evidence"><summary>可选依据</summary>
        <p>原任务获准读取的项目资料，可在发起审查时选用。</p>
        {candidates.basisFiles.length ? <ul>{candidates.basisFiles.map(file => <li key={file.relativePath}>{file.relativePath}</li>)}</ul> : <p>暂无可列出的依据文件。</p>}
      </details>
    </>}
  </section>;
}
