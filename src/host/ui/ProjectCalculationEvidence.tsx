import { useEffect, useRef, useState } from 'react';
import { EVIDENCE_EXTENSIONS } from '../project-data-context-contract.ts';
import type { DataContextSummary, InputVersionRecord, ProjectDataContextSelection } from '../project-data-context-types.ts';
import type { FileNode } from './project-types.ts';
import * as api from './project-data-context-client.ts';

const flatten = (nodes: FileNode[]): FileNode[] => nodes.flatMap(node => node.kind === 'directory' ? flatten(node.children ?? []) : [node]);

/** An optional view over existing files and explicit citations; it infers no engine adoption. */
export function ProjectCalculationEvidence({ projectId, file, files, summary, busy, onCitation, onText, initiallyOpen = false }: {
  projectId: string; file: { path: string; name: string }; files: FileNode[]; summary: DataContextSummary | null; busy: boolean;
  onCitation: (citationId: string) => void; onText: (title: string, operation: () => Promise<string>) => void; initiallyOpen?: boolean;
}) {
  const [current, setCurrent] = useState<api.DataContextPreview>(), [checking, setChecking] = useState(false), [error, setError] = useState(''), [selectedFile, setSelectedFile] = useState('');
  const epoch = useRef(0), owner = `${projectId}/${file.path}`;
  useEffect(() => { ++epoch.current; setCurrent(undefined); setSelectedFile(''); setError(''); setChecking(false); return () => { ++epoch.current; }; }, [owner]);
  const checkCurrent = async () => {
    const ticket = ++epoch.current; setChecking(true); setError('');
    try { const result = await api.previewProjectDataFile(projectId, file.path); if (ticket === epoch.current) setCurrent(result); }
    catch (reason) { if (ticket === epoch.current) { setCurrent(undefined); setError(api.projectDataError(reason)); } }
    finally { if (ticket === epoch.current) setChecking(false); }
  };
  const citations = summary?.citations.filter(record => record.report.originalPath === file.path) ?? [];
  const materials = flatten(files).filter(item => /^(020_clean|060_reports)\//.test(item.path) && EVIDENCE_EXTENSIONS.some(extension => item.path.toLowerCase().endsWith(extension)) && item.path !== file.path);
  const downloadInput = async (selection: ProjectDataContextSelection, version: InputVersionRecord) => {
    const ticket = epoch.current; setError('');
    try { const bytes = await api.readProjectDataEvidenceBytes(projectId, selection.datasetId, selection.inputVersionId, version); if (ticket === epoch.current) api.downloadProjectDataBytes(bytes, version.sourcePath.split('/').at(-1)!); }
    catch (reason) { if (ticket === epoch.current) setError(api.projectDataError(reason)); }
  };
  return <details className="pdc-calculation-evidence pdc-section" open={initiallyOpen || undefined} onToggle={event => { if (event.currentTarget.open) void checkCurrent(); else ++epoch.current; }}>
    <summary>查看计算依据</summary>
    <p className="pdc-help">沿实际文件与明确来源记录查看。普通文件路径可变化，长期固定状态以具体来源记录为准；文件名、安装版本和完成状态不证明实际采用。</p>
    <p className="pdc-path">当前普通文件：{file.path}</p>
    <p className="pdc-help">SQL／脚本、参数、实际引擎／客户端版本与扩展配置，以已保存原材料为准。未记录、仅片段或尚未读取时，完整性保持未核定；没有记录的内容不会自动补填。</p>
    <button type="button" className="text-button" disabled={checking || busy} onClick={() => { void checkCurrent(); }}>核对当前文件版本</button>
    {checking && <p role="status">正在核对当前普通文件…</p>}{error && <p className="pdc-error" role="alert">{error}</p>}
    {current && <p className="pdc-help">本次核对 {new Date(current.observedAt).toLocaleString('zh-CN')} · {current.bytes.toLocaleString()} 字节<code>SHA-256 {current.sha256}</code></p>}
    {!citations.length && <p className="pdc-help">这份路径尚无固定来源记录。可直接查看已有普通材料；原“记录此稿来源”仍是可选动作。</p>}
    {citations.map(record => <article className="pdc-history" key={record.citationId}>
      <strong>固定来源 · {record.citationId.slice(0, 8)}</strong>
      <p>{record.report.originalPath} · {record.report.bytes.toLocaleString()} 字节</p><code>SHA-256 {record.report.sha256}</code>
      <p className="pdc-help">{!current ? '当前文件版本尚未核定，固定记录仍按原身份回读。' : current.sha256 === record.report.sha256 && current.bytes === record.report.bytes ? '当前文件与这份固定报告字节一致。' : '当前文件与这份固定报告版本不同；不以当前同名文件替换固定原稿。'}</p>
      <p>声明原文：{record.declaration || '未记录'}</p>
      <p className="pdc-help">输入版本 {record.selections.length} 项 · 固定文本附件 {record.attachments.length} 份；声明引用不代表已证明实际采用或业务正确。</p>
      {record.selections.map(selection => {
        const dataset = summary?.datasets.find(value => value.dataset.datasetId === selection.datasetId);
        const version = dataset?.versions.find(value => value.projectId === projectId && value.datasetId === selection.datasetId && value.inputVersionId === selection.inputVersionId);
        const description = selection.descriptionRevisionId ? dataset?.descriptions.find(value => value.projectId === projectId && value.datasetId === selection.datasetId && value.inputVersionId === selection.inputVersionId && value.descriptionRevisionId === selection.descriptionRevisionId) : undefined;
        return <details key={api.projectDataSelectionKey(selection)} className="pdc-calculation-input" open><summary>精确输入 · {selection.inputVersionId.slice(0, 8)}</summary><p className="pdc-help">输入 {selection.inputVersionId} · 说明 {selection.descriptionRevisionId ?? '未选择'}</p>{!version ? <p className="pdc-error">这份原输入版本无法核定；引用保留，不改用最新版本。</p> : <><p>{version.sourcePath} · {version.bytes.toLocaleString()} 字节</p><code>SHA-256 {version.sha256}</code><button type="button" className="text-button" disabled={busy} onClick={() => { if (version.sourcePath.toLowerCase().endsWith('.xlsx')) void downloadInput(selection, version); else onText('这份固定输入原文', async () => api.projectDataEvidenceText(await api.readProjectDataEvidenceBytes(projectId, selection.datasetId, selection.inputVersionId, version))); }}>{version.sourcePath.toLowerCase().endsWith('.xlsx') ? '下载这份固定 XLSX 原件' : '读取这份固定输入'}</button></>}{selection.descriptionRevisionId && !description ? <p className="pdc-error">这份精确说明无法核定；未改读当前说明。</p> : description && <div><p className="pdc-help">原说明的位置声明与限制，仍不是实际执行／采用证明。</p>{description.observation.fields.map((field, index) => <p key={`field-${index}`}>{api.projectDataFieldLocationLabel(field.location)} · {field.originalName || '空表头'} · {field.observedType}</p>)}{description.statements.filter(value => value.location).map(statement => <p key={statement.statementId}>{api.projectDataFieldLocationLabel(statement.location)} · {statement.text}</p>)}{description.mappings.map(mapping => <p key={mapping.mappingId}>{api.projectDataFieldLocationLabel(mapping.location)} · 映射声明{mapping.dispute ? ` · ${mapping.dispute}` : ''}</p>)}{!description.observation.fields.length && !description.statements.some(value => value.location) && !description.mappings.length && <p className="pdc-help">字段／片段位置未记录；普通文档不因此要求转换为表格。</p>}<p className="pdc-help">观察限制：{description.observation.limitations || '未记录；公式缓存新鲜度及是否重算不能据读取成功推断。'}</p></div>}</details>;
      })}
      <p className="pdc-help">原生引用：{record.nativeEvidence ? `任务 ${record.nativeEvidence.taskId} · 会话 ${record.nativeEvidence.nativeSessionId} · entry ${record.nativeEvidence.entryId}` : '未记录；不从当前会话补填。'}</p>
      <button type="button" className="secondary-button" disabled={busy} onClick={() => onCitation(record.citationId)}>查看此份固定来源</button>
      <button type="button" className="text-button" disabled={busy} onClick={() => onText('固定报告原文', async () => api.projectDataEvidenceText(await api.readCitationEvidenceBytes(projectId, record.citationId, record.report)))}>读取这份固定报告</button>
      {record.attachments.map((attachment, index) => <div className="pdc-calculation-attachment" key={`${index}/${attachment.sha256}`}><span>{attachment.originalPath} · {attachment.bytes.toLocaleString()} 字节</span><button type="button" className="text-button" disabled={busy} onClick={() => onText(`固定附件 · ${attachment.originalPath}`, async () => api.projectDataEvidenceText(await api.readCitationEvidenceBytes(projectId, record.citationId, attachment, index)))}>读取这份固定附件</button></div>)}
    </article>)}
    <details><summary>已有普通材料 · 未声明采用关系</summary><p className="pdc-help">这里只浏览当前文件，不把同名脚本当作固定历史，也不推断与本报告的采用关系。XLSX 原件沿精确输入版本回读，派生表另作文本材料。</p><label>计算材料文件<select value={selectedFile} onChange={event => setSelectedFile(event.target.value)}><option value="">按需选择已有文件</option>{materials.map(item => <option key={item.path} value={item.path}>{item.path}</option>)}</select></label><button type="button" className="text-button" disabled={!selectedFile || busy} onClick={() => onText(`当前普通文件 · ${selectedFile}（未固定）`, async () => (await api.readCurrentProjectDataText(projectId, selectedFile)).text)}>读取所选普通文件</button></details>
  </details>;
}
