import { useEffect, useState } from 'react';
import type { FrameworkMaterialTarget } from '../contract/framework-review.ts';
import type { DataContextSummary } from '../../../../src/host/project-data-context-types.ts';
import { readProjectDataContext } from '../../../../src/host/ui/project-data-context-client.ts';
import type { ClientProject } from '../../../../src/host/ui/project-types.ts';

function targetKey(target: FrameworkMaterialTarget): string {
  switch (target.kind) {
    case 'data-input': return `${target.projectId}/${target.datasetId}/${target.inputVersionId}`;
    case 'data-description': return `${target.projectId}/${target.datasetId}/${target.inputVersionId}/${target.descriptionRevisionId}`;
    case 'data-citation': return `${target.projectId}/${target.citationId}/citation`;
    case 'data-evidence': return `${target.projectId}/${target.citationId}/${target.attachmentIndex ?? 'report'}`;
  }
}

export function FrameworkMaterialPicker({ projects, selected, busy, onChange }: {
  projects: ClientProject[];
  selected: readonly FrameworkMaterialTarget[];
  busy: boolean;
  onChange: (selected: FrameworkMaterialTarget[]) => Promise<boolean>;
}) {
  const [browsingProject, setBrowsingProject] = useState('');
  const projectId = selected[0]?.projectId ?? browsingProject;
  const [summary, setSummary] = useState<DataContextSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!projectId) return;
    let current = true;
    setSummary(null);
    setError('');
    setLoading(true);
    void readProjectDataContext(projectId).then(value => {
      if (current) setSummary(value);
    }).catch(fault => {
      if (current) setError(fault instanceof Error ? fault.message : '项目资料目录暂时无法读取。');
    }).finally(() => {
      if (current) setLoading(false);
    });
    return () => { current = false; };
  }, [projectId]);

  const changeProject = async (next: string) => {
    if (next === projectId || (selected.length && !await onChange([]))) return;
    setSummary(null);
    setError('');
    setLoading(false);
    setBrowsingProject(next);
  };
  const keys = new Set(selected.map(targetKey));
  const item = (target: FrameworkMaterialTarget, title: string, detail: string) => {
    const key = targetKey(target);
    return <label className="re-framework-material" key={key}>
      <input type="checkbox" checked={keys.has(key)} disabled={busy} onChange={event => {
        setBrowsingProject(projectId);
        void onChange(event.target.checked ? [...selected, target] : selected.filter(candidate => targetKey(candidate) !== key));
      }} />
      <span>{title}<small>{detail}</small></span>
    </label>;
  };
  return <details className="re-framework-topic re-framework-materials">
    <summary>项目资料（可选）{selected.length ? ` · 已选 ${selected.length} 项` : ''}</summary>
    <div className="re-field">
      <label htmlFor="re-framework-project">资料所在项目</label>
      <select id="re-framework-project" value={projectId} disabled={busy} aria-describedby="re-framework-project-help" onChange={event => void changeProject(event.target.value)}>
        <option value="">选择项目</option>
        {projects.map(project => <option key={project.id} value={project.id}>{project.name}</option>)}
        {projectId && !projects.some(project => project.id === projectId) && <option value={projectId}>原项目已不可用</option>}
      </select>
      <p id="re-framework-project-help" className="re-help">勾选本轮可用的固定输入、说明或报告。切换项目会清除已勾选资料。</p>
    </div>
    {loading && <p className="re-help" role="status">正在读取固定资料目录…</p>}
    {error && <p className="field-error" role="alert">{error}</p>}
    {summary && !summary.datasets.length && !summary.citations.length && <p className="re-help">这个项目暂无已登记的固定资料。</p>}
    {summary?.datasets.map(({ dataset, versions, descriptions }) => <details className="re-framework-source" key={dataset.datasetId}>
      <summary>{dataset.name}</summary>
      {versions.map(version => item({ kind: 'data-input', projectId, datasetId: dataset.datasetId, inputVersionId: version.inputVersionId }, `固定输入 ${version.sourcePath}`, version.inputVersionId))}
      {descriptions.map(description => item({ kind: 'data-description', projectId, datasetId: dataset.datasetId, inputVersionId: description.inputVersionId, descriptionRevisionId: description.descriptionRevisionId }, '数据说明修订', description.descriptionRevisionId))}
    </details>)}
    {summary && summary.citations.length > 0 && <details className="re-framework-source">
      <summary>已记录的报告与附件</summary>
      {summary.citations.map(citation => <div key={citation.citationId}>
        {item({ kind: 'data-citation', projectId, citationId: citation.citationId }, `报告来源记录 ${citation.report.originalPath}`, citation.citationId)}
        {item({ kind: 'data-evidence', projectId, citationId: citation.citationId, attachmentIndex: null }, citation.report.originalPath, citation.citationId)}
        {citation.attachments.map((attachment, index) => item({ kind: 'data-evidence', projectId, citationId: citation.citationId, attachmentIndex: index }, attachment.originalPath, `${citation.citationId} · 附件 ${index + 1}`))}
      </div>)}
    </details>}
    {selected.length > 0 && <button type="button" className="text-button" disabled={busy} onClick={() => {
      setBrowsingProject(projectId);
      void onChange([]);
    }}>清除已选资料</button>}
  </details>;
}
