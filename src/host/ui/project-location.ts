import type { ClientProject } from './project-types.ts';
export interface ProjectLocation { projectId?: string; taskId?: string; missing?: 'project' | 'task' }
export function resolveProjectLocation(projects: readonly ClientProject[], location: string): ProjectLocation {
  const url = new URL(location), requestedProject = url.searchParams.get('project'), requestedTask = url.searchParams.get('task');
  if (url.searchParams.has('task') && !requestedProject) return { missing: 'project' };
  const project = url.searchParams.has('project') ? projects.find(item => item.id === requestedProject) : projects.filter(item => !item.archivedAt).at(-1) || projects.at(-1);
  if (!project) return url.searchParams.has('project') ? { missing: 'project' } : {};
  if (url.searchParams.has('task')) return project.tasks.some(item => item.id === requestedTask) ? { projectId: project.id, taskId: requestedTask! } : { projectId: project.id, missing: 'task' };
  const task = url.searchParams.has('project') ? undefined : project.tasks.at(-1);
  return { projectId: project.id, ...(task ? { taskId: task.id } : {}) };
}
