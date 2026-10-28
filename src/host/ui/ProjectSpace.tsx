import { useEffect, useRef, useState } from 'react';
import type { ClientProject, FileNode, PublicModelConfiguration } from './project-types.ts';
import { copyToClean, downloadFile, HostRequestError, projectFiles, uploadFile } from './runtime-client.ts';

function FolderIcon() { return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" /></svg>; }
const errorText = (error: unknown) => error instanceof HostRequestError ? error.message : '本地文件服务暂时不可用，请重试。';
export function NewProjectDialog({ configurations, selectedId, onCreate, onSettings, onClose }: { configurations: PublicModelConfiguration[]; selectedId: string | null; onCreate: (name: string, configurationId: string) => Promise<void>; onSettings: () => void; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null); const input = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(''); const [configurationId, setConfigurationId] = useState(selectedId ?? ''); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const configured = configurations.find(value => value.id === configurationId)?.hasApiKey;
  useEffect(() => { if (!dialog.current?.open) dialog.current?.showModal(); input.current?.focus(); }, []);
  return <dialog ref={dialog} className="catalog-dialog project-dialog" aria-labelledby="new-project-title" onCancel={event => { if (busy) event.preventDefault(); }} onClose={onClose}>
    <div className="dialog-heading"><span className="catalog-symbol" aria-hidden="true"><FolderIcon /></span><button className="icon-button" aria-label="关闭新建项目" disabled={busy} onClick={() => dialog.current?.close()}>✕</button></div>
    <h2 id="new-project-title">新建项目</h2><p className="detail-summary">为一个分析与决策问题建立专属空间。</p>
    <form noValidate onSubmit={async event => { event.preventDefault(); const cleaned = name.trim(); if (!cleaned || cleaned.length > 60) { setError('请输入 1–60 个字符的项目名称。'); input.current?.focus(); return; } if (!configured) { setError('请先为所选模型配置凭据。'); return; } setBusy(true); setError(''); try { await onCreate(cleaned, configurationId); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } }}>
      <div className="field"><label htmlFor="project-name">项目名称</label><input ref={input} id="project-name" value={name} maxLength={60} placeholder="例如：十月经营复盘" required disabled={busy} aria-invalid={Boolean(error)} aria-describedby={error ? 'project-name-error' : 'project-name-help'} onChange={event => { setName(event.target.value); setError(''); }} />{error ? <p className="field-error" id="project-name-error" role="alert">{error}</p> : <p className="field-help" id="project-name-help">最多 60 个字符，项目和历史保存在本机。</p>}</div>
      <div className="field"><label htmlFor="project-model">项目模型</label><select id="project-model" value={configurationId} disabled={busy} onChange={event => { setConfigurationId(event.target.value); setError(''); }}><option value="">请选择模型</option>{configurations.map(value => <option key={value.id} value={value.id}>{value.name}{value.hasApiKey ? '' : ' · 需要配置'}</option>)}</select>{!configured && <button type="button" className="text-button" disabled={busy} onClick={onSettings}>前往模型设置</button>}</div>
      <div className="default-folders"><span>默认项目文件夹</span>{['010_draw', '020_clean', '060_reports'].map(folder => <span key={folder}><FolderIcon /><code>{folder}</code></span>)}</div>
      <p className="detail-footer">原件归档至 010_draw；分析资料和过程文件放入 020_clean，最终报告保存到 060_reports。目录是整理约定，不提供敏感数据隔离。</p>
      <div className="project-dialog-actions"><button className="secondary-button" type="button" disabled={busy} onClick={() => dialog.current?.close()}>取消</button><button className="primary-button" type="submit" disabled={busy}>{busy ? '正在创建…' : '创建项目'}</button></div>
    </form>
  </dialog>;
}

const folderNotes: Record<string, string> = { '010_draw': '上传原件归档', '020_clean': '分析资料与过程文件', '060_reports': '最终报告 · 可下载' };
export function ProjectFiles({ project, refreshToken, onClose }: { project: ClientProject; refreshToken: number; onClose: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null); const input = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<FileNode[]>([]); const [directory, setDirectory] = useState<'010_draw' | '020_clean'>('010_draw');
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const refresh = async () => { setLoading(true); try { setFiles(await projectFiles(project.id)); setError(''); } catch (error) { setError(errorText(error)); } finally { setLoading(false); } };
  useEffect(() => { if (window.innerWidth <= 1100) heading.current?.focus(); }, [project.id]);
  useEffect(() => { let alive = true; setLoading(true); void projectFiles(project.id).then(value => { if (alive) { setFiles(value); setError(''); } }, error => { if (alive) setError(errorText(error)); }).finally(() => { if (alive) setLoading(false); }); return () => { alive = false; }; }, [project.id, refreshToken]);
  const act = async (operation: () => Promise<void>, message: string) => { setBusy(true); setError(''); setNotice(''); try { await operation(); await refresh(); setNotice(message); } catch (error) { setError(errorText(error)); } finally { setBusy(false); } };
  const node = (item: FileNode) => item.kind === 'directory' ? <details key={item.path} open={item.path === '020_clean'}><summary><span className="folder-chevron" aria-hidden="true">›</span><FolderIcon /><code>{item.name}</code></summary>{folderNotes[item.path] && <p className="folder-note">{folderNotes[item.path]}</p>}{item.children?.length ? <div className="file-children">{item.children.map(node)}</div> : <p>空文件夹 · 尚无文件</p>}</details> : <div key={item.path} className="project-file-row"><span className="file-name" title={item.name}>{item.name}</span><div className="file-actions"><button className="text-button" disabled={busy} aria-label={`下载 ${item.name}`} onClick={() => { void act(() => downloadFile(project.id, item), '已准备文件下载。'); }}>下载</button>{item.path.startsWith('010_draw/') && <button className="text-button" disabled={busy} aria-label={`复制到分析区 ${item.name}`} onClick={() => { void act(() => copyToClean(project.id, item.path), '已复制到 020_clean，Agent 现在可以读取该副本；未自动开始分析。'); }}>放入分析区</button>}</div></div>;
  return <aside id="project-files" className="project-files" aria-label="项目文件">
    <div className="project-files-heading"><div><span className="eyebrow">项目空间</span><h2 ref={heading} tabIndex={-1}>项目文件</h2></div><button className="icon-button" aria-label="关闭项目文件栏" onClick={onClose}>✕</button></div>
    <div className="project-files-info"><FolderIcon /><div><strong>{project.name}</strong><span>本机项目 · 3 个默认文件夹</span></div></div>
    <div className="file-upload"><label htmlFor="upload-directory">上传位置</label><select id="upload-directory" value={directory} disabled={busy} onChange={event => setDirectory(event.target.value as '010_draw' | '020_clean')}><option value="010_draw">010_draw · 原件归档</option><option value="020_clean">020_clean · 分析资料与过程文件</option></select><button className="secondary-button" disabled={busy} onClick={() => input.current?.click()}>{busy ? '正在处理…' : '上传文件'}</button><input ref={input} type="file" multiple accept=".csv,.json,.md,.txt" hidden aria-label="选择上传文件" onChange={async event => {
      const selected = Array.from(event.target.files ?? []); event.target.value = ''; if (!selected.length) return;
      if (selected.length > 10 || selected.some(file => file.size > 10 * 1024 * 1024)) { setError('每次最多 10 个文件，单文件不超过 10 MiB。'); return; }
      const target = directory; await act(async () => { for (const file of selected) await uploadFile(project.id, file, target); }, target === '010_draw' ? '上传已保存到原件归档区。需要分析时请显式将副本放入分析区；未自动调用模型。' : '上传已保存到分析区，可发送你的分析问题；上传本身不会调用模型。');
    }} /><p>CSV / JSON / Markdown / TXT · UTF-8 · 单文件 ≤ 10 MiB</p><p className="file-scope-note">目录用途不提供敏感数据隔离，请勿上传敏感数据。</p></div>
    <div className="file-tree-toolbar"><span>项目目录</span><button className="text-button" disabled={busy || loading} onClick={() => { void refresh(); }}>刷新文件</button></div>
    {loading && <p className="file-feedback" role="status">正在读取项目文件…</p>}{error && <p className="file-feedback field-error" role="alert">{error}</p>}{notice && <p className="file-feedback" role="status">{notice}</p>}
    <nav className="project-file-tree" aria-label="项目文件夹">{files.map(node)}</nav>
    <footer><span>文件保存在本机</span><code title={project.rootPath}>{project.rootPath}</code></footer>
  </aside>;
}
