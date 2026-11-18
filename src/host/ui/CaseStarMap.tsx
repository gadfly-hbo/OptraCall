import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { CaseRecord, CaseProjectLink } from '../case-types.ts';
import type { CaseRelationRevision } from '../case-relation-types.ts';
import type { ClientProject, ClientTask } from './project-types.ts';
import { caseStatusLabel, workStatusLabel } from './CaseDialogs.tsx';
import { projectCaseMap, layoutCaseMapEdges } from './case-star-map-view.ts';
import type { CaseMapNode, CaseMapViewState } from './case-star-map-view.ts';
import './case-star-map.css';

type Props = {
  cases: CaseRecord[]; projectLinks: CaseProjectLink[]; projects: ClientProject[]; relations: CaseRelationRevision[];
  view: CaseMapViewState; onViewChange: (update: (previous: CaseMapViewState) => CaseMapViewState) => void;
  onOpenCase: (record: CaseRecord) => void; onOpenProject: (project: ClientProject) => void;
  onCreateCase: () => void; onOpenTask: (project: ClientProject, task: ClientTask) => void; onOpenRelation: (relation: CaseRelationRevision) => void;
};
const relationName = (kind: string) => kind === 'supports' ? '支持' : '前后续';


export function CaseStarMap({ cases, projectLinks, projects, relations, view, onViewChange, onOpenCase, onOpenProject, onOpenTask, onOpenRelation, onCreateCase }: Props) {
  const viewport = useRef<HTMLDivElement>(null), nodeButtons = useRef(new Map<string, HTMLButtonElement>()), drag = useRef<{ clientX: number; clientY: number; x: number; y: number } | null>(null);
  const marker = useId().replace(/:/g, ''), [listOpen, setListOpen] = useState(() => typeof window !== 'undefined' && window.innerWidth <= 760), [listLimit, setListLimit] = useState(100);
  const projection = useMemo(() => projectCaseMap({ cases, projectLinks, projects, relations, view }), [cases, projectLinks, projects, relations, view.query, view.status, view.relation, view.expandedProjectIds, view.nodeLimit]);
  const edgeLayouts = useMemo(() => layoutCaseMapEdges(projection.edges, projection.nodes, projection.width), [projection]);
  const nodesById = new Map(projection.nodes.map(node => [node.id, node]));
  const relationsById = new Map(relations.map(relation => [relation.relationId, relation]));
  const fit = () => {
    const element = viewport.current; if (!element) return;
    const scale = window.innerWidth <= 760 ? .65 : Math.min(1, Math.max(.25, Math.min((element.clientWidth - 24) / projection.width, (element.clientHeight - 28) / projection.height)));
    onViewChange(previous => ({ ...previous, scale, x: window.innerWidth <= 760 ? 4 : (element.clientWidth - projection.width * scale) / 2, y: 10, manualViewport: false }));
  };
  useEffect(() => { const element = viewport.current; if (!element) return; const observer = new ResizeObserver(() => { if (!view.manualViewport) fit(); }); observer.observe(element); if (!view.manualViewport) fit(); return () => observer.disconnect(); }, [projection.width, projection.height, view.manualViewport]);
  useEffect(() => { if (view.returnNodeId) requestAnimationFrame(() => nodeButtons.current.get(view.returnNodeId!)?.focus({ preventScroll: true })); }, []);
  const open = (node: CaseMapNode) => {
    onViewChange(previous => ({ ...previous, returnNodeId: node.id }));
    if (node.kind === 'case' && node.record) onOpenCase(node.record);
    else if (node.kind === 'project' && node.project) onOpenProject(node.project);
    else if (node.kind === 'task') onOpenTask(node.project, node.task);
  };
  const zoom = (factor: number) => {
    const element = viewport.current; if (!element) return;
    onViewChange(previous => { const scale = Math.max(.25, Math.min(1.8, previous.scale * factor)), ratio = scale / previous.scale; return { ...previous, scale, x: element.clientWidth / 2 - (element.clientWidth / 2 - previous.x) * ratio, y: element.clientHeight / 2 - (element.clientHeight / 2 - previous.y) * ratio, manualViewport: true }; });
  };
  const focus = (node: CaseMapNode) => {
    const element = viewport.current;
    onViewChange(previous => previous.focusId === node.id ? { ...previous, focusId: null } : { ...previous, focusId: node.id, x: element ? element.clientWidth / 2 - (node.x + node.width / 2) * previous.scale : previous.x, y: element ? element.clientHeight / 2 - (node.y + node.height / 2) * previous.scale : previous.y, manualViewport: true });
  };
  const connected = new Set(view.focusId ? [view.focusId] : []);
  if (view.focusId) for (const edge of projection.edges) if (edge.from === view.focusId || edge.to === view.focusId) { connected.add(edge.from); connected.add(edge.to); }
  const nodeMeta = (node: CaseMapNode) => node.kind === 'case' ? node.record ? caseStatusLabel[node.record.status] : '暂不可读取' : node.kind === 'project' ? !node.project ? '原关联保留' : node.project.archivedAt ? '已归档 · 只读' : node.project.workUnavailable ? '工作信息暂不可用' : node.project.work?.workStatus ? workStatusLabel[node.project.work.workStatus] : '工作状态未设置' : node.task.lastRun?.status === 'running' ? '运行中' : node.task.lastRun?.status === 'completed' ? '分析已完成' : node.task.lastRun?.status === 'failed' ? '运行失败' : node.task.lastRun?.status === 'cancelled' ? '已停止' : node.task.lastRun?.status === 'interrupted' ? '中断 · 结果未知' : '未运行';
  const nodeLabel = (node: CaseMapNode) => `${node.kind === 'case' ? 'Case' : node.kind === 'project' ? '项目' : '分析任务'}：${node.name}`;
  const nodeMissing = (node: CaseMapNode) => (node.kind === 'case' && !node.record) || (node.kind === 'project' && !node.project);
  return <div className="csm-workspace">
    <div className="csm-stats"><span><strong>{cases.length}</strong> Case</span><span><strong>{projects.length}</strong> 项目</span><span><strong>{projects.reduce((count, project) => count + project.tasks.length, 0)}</strong> 分析任务</span><span><strong>{relations.filter(relation => relation.lifecycle === 'active').length}</strong> 已载入业务关系</span></div>
    {projection.missingProjects > 0 && <p className="case-message">{projection.missingProjects} 个原项目暂不可读取；原关联与占位保留，没有自动解绑。</p>}
    {(view.query || view.status !== 'all') && <p className="case-help">筛选保留必要的项目及业务关系两端上下文；关联不表示项目中每个任务都专属于某个 Case。</p>}
    {!projection.allNodes.length ? (!cases.length && !projects.length && !view.query.trim() && view.status === 'all' && view.relation === 'all' ? <div className="case-empty"><h2>从一件值得跟进的事开始</h2><p>Case 可以先独立存在，之后再关联项目与其他事项。</p><button type="button" className="primary-button" onClick={onCreateCase}>＋ 新建 Case</button></div> : <div className="case-empty"><h2>没有符合条件的事项、项目或分析任务</h2><p>可清除搜索与状态筛选；未删除任何记录。</p></div>) : <div className="csm-frame">
      <div className="csm-heading"><strong>事项关联</strong><span>点击节点直接打开 · 拖动空白平移 · 共享项目仅显示一次</span></div>
      <div ref={viewport} className="csm-viewport" aria-label="Case、项目与分析任务关系图" onPointerDown={event => { if ((event.target as Element).closest('button,a,input,select,summary')) return; drag.current = { clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y }; event.currentTarget.setPointerCapture(event.pointerId); }} onPointerMove={event => { if (!drag.current) return; const start = drag.current; onViewChange(previous => ({ ...previous, x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY, manualViewport: true })); }} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}>
        <div className="csm-canvas" style={{ width: projection.width, height: projection.height, transform: `translate(${view.x}px,${view.y}px) scale(${view.scale})` }}>
          <svg className="csm-edges" width={projection.width} height={projection.height} aria-hidden="true"><defs><marker id={`${marker}-arrow`} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto"><path d="M1 1 L7 4 L1 7" fill="none" stroke="currentColor" /></marker></defs>{projection.edges.map(edge => { const from = nodesById.get(edge.from), to = nodesById.get(edge.to); return from && to ? <path key={edge.id} className={`csm-edge ${edge.kind}${view.focusId && (!connected.has(edge.from) || !connected.has(edge.to)) ? ' dim' : ''}`} d={edgeLayouts.get(edge.id)?.d} markerEnd={edge.relationId ? `url(#${marker}-arrow)` : undefined} /> : null; })}</svg>
          {projection.edges.filter(edge => edge.relationId).map(edge => { const from = nodesById.get(edge.from), to = nodesById.get(edge.to), relation = relationsById.get(edge.relationId!); if (!from || !to || !relation) return null; const position = edgeLayouts.get(edge.id); if (!position) return null; return <button type="button" className={`csm-relation ${edge.kind}`} key={edge.id} style={{ left: position.x, top: position.y }} aria-label={`${from.name} ${relationName(edge.kind)} ${to.name}，查看关系说明`} onClick={() => onOpenRelation(relation)}>{relationName(edge.kind)} →</button>; })}
          {projection.nodes.map(node => <article key={node.id} className={`csm-node ${node.kind}${nodeMissing(node) ? ' missing' : ''}${view.focusId && !connected.has(node.id) ? ' dim' : ''}`} style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}>
            <button type="button" className="csm-node-main" ref={element => { if (element) nodeButtons.current.set(node.id, element); else nodeButtons.current.delete(node.id); }} data-map-node={node.id} aria-label={`打开${nodeLabel(node)}`} disabled={nodeMissing(node)} onClick={() => open(node)}><span className="csm-node-type">{node.kind === 'case' ? 'CASE' : node.kind === 'project' ? '项目' : '分析任务'}<span>{nodeMeta(node)}</span></span><strong>{node.name}</strong>{node.kind === 'case' && <span className="csm-node-description">{node.record?.nextStep || node.record?.judgement || '下一步尚未记录'}</span>}{node.kind === 'project' && <span className="csm-node-description">{node.caseIds.length ? `${node.caseIds.length} 个 Case 关联` : '未关联 Case · 独立项目'}</span>}</button>
            {node.kind !== 'task' && <div className="csm-node-footer">{node.kind === 'project' ? <button type="button" disabled={!node.project || !node.taskCount} aria-expanded={view.expandedProjectIds.includes(node.projectId) || projection.allNodes.some(item => item.kind === 'task' && item.projectId === node.projectId)} onClick={() => onViewChange(previous => ({ ...previous, expandedProjectIds: previous.expandedProjectIds.includes(node.projectId) ? previous.expandedProjectIds.filter(id => id !== node.projectId) : [...previous.expandedProjectIds, node.projectId], manualViewport: false }))}>{view.expandedProjectIds.includes(node.projectId) ? '收起' : projection.allNodes.some(item => item.kind === 'task' && item.projectId === node.projectId) ? '匹配任务' : '展开'} {node.taskCount} 个分析任务</button> : <span>{projectLinks.filter(link => link.caseId === node.caseId).length} 个关联项目</span>}<button type="button" onClick={() => focus(node)} aria-label={`聚焦 ${node.name} 的关联`} aria-pressed={view.focusId === node.id}>◎ 聚焦</button></div>}
          </article>)}
        </div>
        <div className="csm-controls" role="group" aria-label="图谱视野"><button type="button" aria-label="缩小图谱" onClick={() => zoom(1 / 1.2)}>−</button><output aria-label="当前缩放">{Math.round(view.scale * 100)}%</output><button type="button" aria-label="放大图谱" onClick={() => zoom(1.2)}>＋</button><button type="button" onClick={fit}>适应画布</button></div>
      </div>
      <div className="csm-legend"><span>─ 关联项目 / 包含任务</span><span className="continuation">→ 前后续</span><span className="supports">⇢ 支持</span><span>关系为原作者声明，可点击核对依据</span></div>
    </div>}
    {projection.hiddenNodes > 0 && <p className="case-message">画布显示 {projection.nodes.length} / {projection.allNodes.length} 个匹配节点，另有 {projection.hiddenNodes} 个尚未展开。<button type="button" className="text-button" onClick={() => onViewChange(previous => ({ ...previous, nodeLimit: previous.nodeLimit + 100, manualViewport: false }))}>展开更多节点</button>也可搜索或使用下方清单。</p>}
    <details className="csm-equivalent" open={listOpen} onToggle={event => setListOpen(event.currentTarget.open)}><summary>关系列表与节点导航 · 键盘及窄屏均可使用</summary>
      {relations.filter(relation => (!view.query && view.status === 'all' || projection.allNodes.some(node => node.kind === 'case' && (node.caseId === relation.fromCaseId || node.caseId === relation.toCaseId))) && view.relation !== 'shared' && (view.relation === 'all' || relation.kind === view.relation)).map(relation => <div className="csm-list-row" key={relation.relationId}><div><strong>{cases.find(record => record.id === relation.fromCaseId)?.title ?? '原 Case 暂不可读取'} — {relationName(relation.kind)} → {cases.find(record => record.id === relation.toCaseId)?.title ?? '原 Case 暂不可读取'}</strong><p>{relation.lifecycle === 'unlinked' ? '已解除 · 历史保留' : '当前关系'} · v{relation.revision}</p></div><button type="button" className="text-button" onClick={() => onOpenRelation(relation)}>{relation.lifecycle === 'unlinked' ? '查看历史' : '关系详情'}</button></div>)}
      {projection.allNodes.slice(0, listLimit).map(node => <div className="csm-list-row" key={node.id}><div><strong>{node.name}</strong><p>{nodeLabel(node).split('：')[0]} · {nodeMeta(node)}</p></div><button type="button" className="text-button" disabled={nodeMissing(node)} onClick={() => open(node)}>打开{node.kind === 'case' ? ' Case' : node.kind === 'project' ? '项目' : '分析任务'}</button></div>)}
      {projection.allNodes.length > listLimit && <button type="button" className="secondary-button" onClick={() => setListLimit(previous => previous + 100)}>继续显示节点（尚有 {projection.allNodes.length - listLimit} 个）</button>}
    </details>
    <p className="case-help">分析任务的运行、人的取舍、实际行动与反馈分别记录。图谱浏览不会发送消息或启动分析。</p>
  </div>;
}
