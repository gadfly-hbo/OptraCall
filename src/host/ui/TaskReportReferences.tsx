import { useEffect, useRef, useState } from 'react';
import type { CaseRecord } from '../case-types.ts';
import type { DataContextSummary } from '../project-data-context-types.ts';
import { caseStatusLabel } from './CaseDialogs.tsx';
import { ProjectCalculationEvidence, type CalculationEvidenceMeta } from './ProjectCalculationEvidence.tsx';
import * as caseApi from './case-client.ts';
import { projectDataError, readProjectDataCitation, readProjectDataContext } from './project-data-context-client.ts';
import type { FileNode } from './project-types.ts';
import { projectFiles } from './runtime-client.ts';

type Props = { projectId: string; taskId: string; path: string; sha256: string; onOpenCase: (caseId: string) => void };

export function TaskReportReferences({ projectId, taskId, path, sha256, onOpenCase }: Props) {
  const [evidence, setEvidence] = useState<{ summary: DataContextSummary; files: FileNode[] }>();
  const [evidenceBusy, setEvidenceBusy] = useState(false), [evidenceError, setEvidenceError] = useState('');
  const [text, setText] = useState<{ title: string; value?: string; error?: string; meta: CalculationEvidenceMeta }>();
  const [cases, setCases] = useState<CaseRecord[]>(), [caseBusy, setCaseBusy] = useState(false), [caseError, setCaseError] = useState('');
  const evidenceEpoch = useRef(0), caseRead = useRef<AbortController | undefined>(undefined);
  const citationTrigger = useRef<HTMLElement | null>(null), citationHeading = useRef<HTMLDivElement>(null);
  useEffect(() => () => { evidenceEpoch.current++; caseRead.current?.abort(); }, []);

  async function loadEvidence() {
    const ticket = ++evidenceEpoch.current;
    setEvidenceBusy(true); setEvidenceError(''); setText(undefined);
    try {
      const [summary, files] = await Promise.all([readProjectDataContext(projectId), projectFiles(projectId)]);
      if (ticket === evidenceEpoch.current) setEvidence({ summary, files });
    } catch (failure) {
      if (ticket === evidenceEpoch.current) setEvidenceError(projectDataError(failure));
    } finally { if (ticket === evidenceEpoch.current) setEvidenceBusy(false); }
  }

  async function showEvidence(title: string, read: () => Promise<string>, meta: CalculationEvidenceMeta) {
    if (document.activeElement instanceof HTMLElement) citationTrigger.current = document.activeElement;
    const ticket = ++evidenceEpoch.current;
    setEvidenceBusy(true); setEvidenceError(''); setText(undefined);
    try {
      const value = await read();
      if (ticket === evidenceEpoch.current) {
        setText({ title, value, meta });
        requestAnimationFrame(() => citationHeading.current?.focus());
      }
    } catch (failure) {
      if (ticket === evidenceEpoch.current) {
        const msg = projectDataError(failure);
        setEvidenceError(msg);
        setText({ title, error: msg, meta });
        requestAnimationFrame(() => citationHeading.current?.focus());
      }
    } finally { if (ticket === evidenceEpoch.current) setEvidenceBusy(false); }
  }

  function closeCitation() {
    setText(undefined);
    requestAnimationFrame(() => {
      if (citationTrigger.current?.isConnected) citationTrigger.current.focus();
    });
  }

  useEffect(() => {
    if (!text) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      closeCitation();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [Boolean(text)]);

  async function readCases() {
    caseRead.current?.abort();
    const controller = new AbortController();
    caseRead.current = controller;
    const { signal } = controller;
    setCaseBusy(true); setCaseError(''); setCases(undefined);
    try {
      const status = await caseApi.status(signal);
      if (signal.aborted) return;
      if (status.state === 'uninitialized') { setCases([]); return; }
      if (status.state !== 'ready') throw new Error('Case 记录暂不可读取。');
      const index = await caseApi.list(signal);
      const ids = [...new Set(index.projectLinks.filter(link => link.projectId === projectId).map(link => link.caseId))];
      const matches: CaseRecord[] = [];
      let partial = false;
      for (const id of ids) {
        if (signal.aborted) return;
        try {
          const details = await caseApi.detail(id, signal);
          if (details.case.id !== id) { partial = true; continue; }
          if (details.artifacts.some(artifact => artifact.caseId === id && artifact.projectId === projectId && artifact.taskId === taskId
            && !artifact.unlinkedAt && artifact.availability === 'available'
            && ((artifact.relativePath === path && artifact.observedSha256 === sha256)
              || (artifact.adoptedVersion?.sourceRelativePath === path && artifact.adoptedVersion.sourceSha256 === sha256)))) matches.push(details.case);
        } catch { partial = true; }
      }
      if (!signal.aborted) {
        setCases(matches);
        if (partial) setCaseError('部分 Case 暂不可读取。当前只显示已核对的关联。');
      }
    } catch (failure) {
      if (!signal.aborted) setCaseError(failure instanceof Error ? failure.message : 'Case 记录暂不可读取。');
    } finally { if (!signal.aborted) setCaseBusy(false); }
  }

  return <>
    {evidence ? <ProjectCalculationEvidence projectId={projectId} file={{ path, name: path.split('/').at(-1)! }} files={evidence.files}
      summary={evidence.summary} expectedSha256={sha256} busy={evidenceBusy} initiallyOpen
      onText={(title, read, meta) => void showEvidence(title, read, meta ?? { path, sha256, kindLabel: '当前引用' })}
      onCitation={id => { void showEvidence('固定来源声明', async () => {
        const { record } = await readProjectDataCitation(projectId, id);
        if (record.projectId !== projectId || record.citationId !== id || record.report.originalPath !== path || record.report.sha256 !== sha256) throw new Error('固定来源身份未能核对。');
        return [record.declaration || '来源未声明', record.revisionReason].filter(Boolean).join('\n\n');
      }, { citationId: id, path, sha256, kindLabel: '固定来源声明' }); }} /> : <button type="button" className="text-button" disabled={evidenceBusy} onClick={() => void loadEvidence()}>查看固定输入与计算依据</button>}
    {evidenceBusy && <p role="status">正在读取所选报告的依据…</p>}
    {evidenceError && <p className="cnr-notice error" role="alert">{evidenceError}</p>}
    {text && <section className="task-citation-reader" role="region" aria-label="引用原文检视" onKeyDown={event => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeCitation(); }
    }}>
      <div ref={citationHeading} tabIndex={-1} className="task-citation-reader-head">
        <strong>{text.title}</strong>
        <button type="button" className="text-button" onClick={closeCitation}>关闭引用</button>
      </div>
      <p className="task-citation-meta">
        项目 {projectId}
        {text.meta.citationId ? ` · 引用 ${text.meta.citationId}` : ''}
        {` · ${text.meta.path}`}
        {text.meta.sha256 ? ` · SHA-256 ${text.meta.sha256}` : ' · 未固定版本'}
      </p>
      {text.error ? (
        <p className="cnr-notice error">此项原文暂不可读取，已保留准确引用定位。</p>
      ) : (
        <pre className="task-report-text" tabIndex={0} aria-label={text.title}>{text.value}</pre>
      )}
    </section>}
    <section className="task-report-case" aria-label="本版报告关联 Case">
      <button type="button" className="text-button" disabled={caseBusy} onClick={() => void readCases()}>核对关联 Case</button>
      {caseBusy && <p role="status">正在核对本版报告的关联…</p>}
      {caseError && <p className="cnr-notice error" role="alert">{caseError}</p>}
      {cases?.map(record => <div className="cnr-version" key={record.id}>
        <strong>{record.title}</strong><small>修订 {record.revision} · {caseStatusLabel[record.status]}</small>
        <button type="button" className="secondary-button" onClick={() => onOpenCase(record.id)}>查看关联 Case</button>
      </div>)}
      {cases?.length === 0 && !caseError && <p>暂未查到与本任务及这版报告相符的 Case 产物引用。</p>}
    </section>
  </>;
}
