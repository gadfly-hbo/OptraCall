import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';

test('FC17: associating a review file rejects archived project writes and preserves original receipts', {timeout:30000}, async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  await readJson(await host.request('/api/configuration','PUT',{name:'归档边界合成配置',provider:'openai-compatible',baseUrl:'http://127.0.0.1:1/v1',model:'synthetic',apiKey:'synthetic-no-call'}));
  const {project}=await readJson(await host.request('/api/projects','POST',{name:'Case反馈关联边界'}),201);
  await readJson(await host.request(`/api/projects/${project.id}/files/save-report`,'POST',{name:'复盘.md',text:'# 合成复盘\n效果未知。'}),201);
  await readJson(await host.request('/api/cases/storage/initialize','POST',{}));
  let record=(await readJson(await host.request('/api/cases','POST',{operationId:randomUUID(),title:'合成Case',description:'不做经营动作'}),201)).case;
  record=(await readJson(await host.request(`/api/cases/${record.id}/projects`,'POST',{operationId:randomUUID(),expectedRevision:record.revision,projectId:project.id}))).case;
  const savedInput={operationId:randomUUID(),expectedRevision:record.revision,projectId:project.id,relativePath:'060_reports/复盘.md',taskId:null,role:'report',displayName:'合成复盘'};
  const saved=await readJson(await host.request(`/api/cases/${record.id}/artifacts`,'POST',savedInput));
  await readJson(await host.request(`/api/projects/${project.id}/archive`,'POST',{}));
  const rejected=await host.request(`/api/cases/${record.id}/artifacts`,'POST',{...savedInput,operationId:randomUUID(),expectedRevision:saved.case.revision});
  assert.equal(rejected.status,409,'An archived source project cannot receive a new Case file association');
  assert.equal((await rejected.json()).code,'project_archived');
  const retried=await readJson(await host.request(`/api/cases/${record.id}/artifacts`,'POST',savedInput));
  assert.equal(retried.artifact.id,saved.artifact.id,'Querying a successful original intent still returns the original association');
});
