import type { CaseProjectLink, CaseRecord, CaseStatus } from '../case-types.ts';
import type { ClientProject, ClientTask } from './project-types.ts';

export type CaseMapRelation = { relationId: string; fromCaseId: string; toCaseId: string; kind: 'follows_up' | 'supports'; lifecycle: 'active' | 'unlinked' };
export type CaseMapViewState = {
  display: 'map' | 'regular'; query: string; status: CaseStatus | 'all'; relation: 'all' | 'shared' | CaseMapRelation['kind'];
  expandedProjectIds: string[]; focusId: string | null; returnNodeId: string | null; scrollTop: number;
  scale: number; x: number; y: number; manualViewport: boolean; nodeLimit: number;
};
export const initialCaseMapView = (): CaseMapViewState => ({ display: 'map', query: '', status: 'all', relation: 'all', expandedProjectIds: [], focusId: null, returnNodeId: null, scrollTop: 0, scale: 1, x: 0, y: 0, manualViewport: false, nodeLimit: 200 });
type Position = { id: string; name: string; x: number; y: number; width: number; height: number };
export type CaseMapNode = Position & (
  | { kind: 'case'; caseId: string; record?: CaseRecord }
  | { kind: 'project'; projectId: string; project?: ClientProject; caseIds: string[]; taskCount: number }
  | { kind: 'task'; projectId: string; taskId: string; project: ClientProject; task: ClientTask }
);
export type CaseMapEdge = { id: string; from: string; to: string; kind: 'project' | 'task' | CaseMapRelation['kind']; relationId?: string };
export type CaseMapProjection = { nodes: CaseMapNode[]; allNodes: CaseMapNode[]; edges: CaseMapEdge[]; width: number; height: number; hiddenNodes: number; missingProjects: number; matchedTasks: number };
export function projectCaseMap(input: { cases: CaseRecord[]; projectLinks: CaseProjectLink[]; projects: ClientProject[]; relations?: CaseMapRelation[]; view: CaseMapViewState }): CaseMapProjection {
  const { view } = input, query = view.query.trim().toLocaleLowerCase(), matches = (text: string) => text.toLocaleLowerCase().includes(query);
  const caseIdsByProject = new Map<string, Set<string>>();
  for (const link of input.projectLinks) { const ids = caseIdsByProject.get(link.projectId) ?? new Set<string>(); ids.add(link.caseId); caseIdsByProject.set(link.projectId, ids); }
  const directCases = new Set(input.cases.filter(record => matches(`${record.title}\n${record.description}\n${record.judgement}\n${record.nextStep}`)).map(record => record.id));
  const directProjects = new Set(input.projects.filter(project => matches(project.name)).map(project => project.id));
  const matchedTaskKeys = new Set<string>(), taskProjectIds = new Set<string>();
  for (const project of input.projects) for (const task of project.tasks) if (query && matches(task.name)) { matchedTaskKeys.add(`${project.id}/${task.id}`); taskProjectIds.add(project.id); }
  const contextualCaseIds = new Set<string>();
  for (const projectId of [...directProjects, ...taskProjectIds]) for (const caseId of caseIdsByProject.get(projectId) ?? []) contextualCaseIds.add(caseId);
  const relations = (input.relations ?? []).filter(relation => relation.lifecycle === 'active' && view.relation !== 'shared' && (view.relation === 'all' || relation.kind === view.relation));
  const selectedEndpoints = new Set(relations.flatMap(relation => [relation.fromCaseId, relation.toCaseId]));
  const sharedProjectIds = new Set([...caseIdsByProject].filter(([, ids]) => ids.size > 1).map(([id]) => id));
  const sharedCaseIds = new Set([...sharedProjectIds].flatMap(id => [...caseIdsByProject.get(id) ?? []]));
  const initialCases = input.cases.filter(record => (view.relation === 'all' || (view.relation === 'shared' ? sharedCaseIds.has(record.id) : selectedEndpoints.has(record.id))) && (view.status === 'all' || record.status === view.status) && (!query || directCases.has(record.id) || contextualCaseIds.has(record.id)));
  const initialCaseIds = new Set(initialCases.map(record => record.id));
  const endpointIds = new Set(initialCaseIds);
  for (const relation of relations) if (initialCaseIds.has(relation.fromCaseId) || initialCaseIds.has(relation.toCaseId)) { endpointIds.add(relation.fromCaseId); endpointIds.add(relation.toCaseId); }
  const cases = input.cases.filter(record => endpointIds.has(record.id));
  const visibleCaseIds = new Set(cases.map(record => record.id));
  const projects = input.projects.filter(project => (view.relation === 'all' || (view.relation === 'shared' ? sharedProjectIds.has(project.id) : [...caseIdsByProject.get(project.id) ?? []].some(id => visibleCaseIds.has(id)))) && ((!query && (view.status === 'all' || !caseIdsByProject.get(project.id)?.size)) || directProjects.has(project.id) || taskProjectIds.has(project.id) || [...caseIdsByProject.get(project.id) ?? []].some(id => visibleCaseIds.has(id))));
  const nodes: CaseMapNode[] = cases.map((record, index) => ({ id: `case:${record.id}`, kind: 'case' as const, caseId: record.id, record, name: record.title, x: index % 4 === 0 || index % 4 === 3 ? 70 : 800, y: 100 + Math.floor(index / 2) * 300, width: 256, height: 140 }));
  const edges: CaseMapEdge[] = [];
  let projectY = 35;
  for (const project of projects) {
    const caseIds = [...caseIdsByProject.get(project.id) ?? []], showTasks = view.expandedProjectIds.includes(project.id) || taskProjectIds.has(project.id);
    const tasks = showTasks ? project.tasks.filter(task => !query || directCases.size > 0 || directProjects.has(project.id) || matchedTaskKeys.has(`${project.id}/${task.id}`)) : [];
    nodes.push({ id: `project:${project.id}`, kind: 'project', projectId: project.id, project, name: project.name, caseIds, taskCount: project.tasks.length, x: 435, y: projectY, width: 230, height: 110 });
    for (const caseId of caseIds) if (visibleCaseIds.has(caseId)) edges.push({ id: `link:${caseId}/${project.id}`, from: `case:${caseId}`, to: `project:${project.id}`, kind: 'project' });
    for (const [index, task] of tasks.entries()) {
      const id = `task:${project.id}/${task.id}`;
      nodes.push({ id, kind: 'task', projectId: project.id, taskId: task.id, project, task, name: task.name, x: 451, y: projectY + 122 + index * 78, width: 214, height: 68 });
      edges.push({ id: `contains:${project.id}/${task.id}`, from: `project:${project.id}`, to: id, kind: 'task' });
    }
    projectY += 200 + tasks.length * 78;
  }
  const knownProjectIds = new Set(input.projects.map(project => project.id));
  let missingProjects = 0;
  for (const [projectId, linkedCaseIds] of caseIdsByProject) {
    if (knownProjectIds.has(projectId) || (view.relation === 'shared' && !sharedProjectIds.has(projectId)) || ![...linkedCaseIds].some(id => visibleCaseIds.has(id))) continue;
    nodes.push({ id: `project:${projectId}`, kind: 'project', projectId, name: '原项目暂不可用', caseIds: [...linkedCaseIds], taskCount: 0, x: 435, y: projectY, width: 230, height: 110 });
    for (const caseId of linkedCaseIds) if (visibleCaseIds.has(caseId)) edges.push({ id: `link:${caseId}/${projectId}`, from: `case:${caseId}`, to: `project:${projectId}`, kind: 'project' });
    projectY += 200; missingProjects++;
  }
  for (const relation of relations) if (visibleCaseIds.has(relation.fromCaseId) && visibleCaseIds.has(relation.toCaseId)) edges.push({ id: `relation:${relation.relationId}`, from: `case:${relation.fromCaseId}`, to: `case:${relation.toCaseId}`, kind: relation.kind, relationId: relation.relationId });
  const visibleNodes = [...nodes].sort((left, right) => left.y - right.y || left.x - right.x).slice(0, Math.max(1, view.nodeLimit)), visibleNodeIds = new Set(visibleNodes.map(node => node.id));
  return { nodes: visibleNodes, allNodes: nodes, edges: edges.filter(edge => visibleNodeIds.has(edge.from) && visibleNodeIds.has(edge.to)), width: 1240, height: Math.max(660, ...visibleNodes.map(node => node.y + node.height + 60)), hiddenNodes: nodes.length - visibleNodes.length, missingProjects, matchedTasks: matchedTaskKeys.size };
}


export function caseMapEdgeGeometry(edge: CaseMapEdge, from: CaseMapNode, to: CaseMapNode) {
  if (edge.kind === 'task') return { d: `M${from.x + 8},${from.y + 110} V${to.y + 34} H${to.x}`, x: 0, y: 0 };
  if (edge.kind === 'project') {
    const fromX = from.x < to.x ? from.x + from.width : from.x, toX = from.x < to.x ? to.x : to.x + to.width;
    return { d: `M${fromX},${from.y + 70} C${(fromX + toX) / 2},${from.y + 70} ${(fromX + toX) / 2},${to.y + 55} ${toX},${to.y + 55}`, x: 0, y: 0 };
  }
  if (Math.abs(from.x - to.x) < 100) {
    const right = from.x > 500, x = right ? from.x + from.width : from.x, outer = x + (right ? 84 : -48);
    return { d: `M${x},${from.y + 70} C${outer},${from.y + 70} ${outer},${to.y + 70} ${x},${to.y + 70}`, x: outer - (right ? 16 : -12), y: (from.y + to.y) / 2 + 70 };
  }
  const roof = Math.max(10, Math.min(from.y, to.y) - 110), x1 = from.x + from.width / 2, x2 = to.x + to.width / 2;
  return { d: `M${x1},${from.y} C${x1},${roof} ${x2},${roof} ${x2},${to.y}`, x: (x1 + x2) / 2, y: roof + 12 };
}

export function layoutCaseMapEdges(edges: CaseMapEdge[], nodes: CaseMapNode[], width = 1240): Map<string, { d: string; x: number; y: number }> {
  const byId = new Map(nodes.map(node => [node.id, node])), layout = new Map<string, { d: string; x: number; y: number }>();
  const occupied: { x: number; y: number }[] = [], horizontalSteps = Math.ceil(width / 100);
  for (const edge of [...edges].sort((left, right) => left.id.localeCompare(right.id))) {
    const from = byId.get(edge.from), to = byId.get(edge.to); if (!from || !to) continue;
    const base = caseMapEdgeGeometry(edge, from, to); if (!edge.relationId) { layout.set(edge.id, base); continue; }
    let placed = false;
    for (let row = 0; row <= edges.length + nodes.length && !placed; row++) {
      const y = Math.max(18, base.y - 8) + row * 40;
      for (let step = 0; step <= horizontalSteps * 2; step++) {
        const shift = step === 0 ? 0 : Math.ceil(step / 2) * 100 * (step % 2 ? 1 : -1), x = Math.max(48, Math.min(width - 48, base.x + shift));
        if (occupied.some(label => Math.abs(label.x - x) < 100 && Math.abs(label.y - y) < 40)) continue;
        if (nodes.some(node => x + 48 > node.x && x - 48 < node.x + node.width && y + 16 > node.y && y - 16 < node.y + node.height)) continue;
        occupied.push({ x, y }); layout.set(edge.id, { ...base, x, y }); placed = true; break;
      }
    }
  }
  return layout;
}
