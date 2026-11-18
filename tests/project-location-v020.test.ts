import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveProjectLocation } from '../src/host/ui/project-location.ts';
import type { ClientProject } from '../src/host/ui/project-types.ts';
const projects = [{ id: 'original', archivedAt: null, tasks: [{ id: 'old-task', archivedAt: '2026-11-16T00:00:00.000Z' }, { id: 'current' }] }, { id: 'newest', archivedAt: null, tasks: [{ id: 'other' }] }] as unknown as ClientProject[];
test('old project and Task URLs keep the exact archived or current object without substituting a newer one', () => {
  assert.deepEqual(resolveProjectLocation(projects, 'http://localhost/?project=original&task=old-task'), { projectId: 'original', taskId: 'old-task' });
  assert.deepEqual(resolveProjectLocation(projects, 'http://localhost/?project=original'), { projectId: 'original' });
  assert.deepEqual(resolveProjectLocation(projects, 'http://localhost/?project=original&task=missing'), { projectId: 'original', missing: 'task' });
  assert.deepEqual(resolveProjectLocation(projects, 'http://localhost/?project=missing&task=other'), { missing: 'project' });
  assert.deepEqual(resolveProjectLocation(projects, 'http://localhost/?task=other'), { missing: 'project' });
  assert.deepEqual(resolveProjectLocation(projects, 'http://localhost/'), { projectId: 'newest', taskId: 'other' });
});
