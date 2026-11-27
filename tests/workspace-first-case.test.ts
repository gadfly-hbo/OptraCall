import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { startTestHost } from './fixtures/host-process.ts';
import { readJson } from './fixtures/joint-context.ts';
import { withCaseGoal } from './fixtures/case-goal.ts';

test('DW10/11: first explicit workspace create opts in through original storage initialization; GET never does',async t=>{
  const host=await startTestHost();t.after(()=>host.close());
  const marker=path.join(host.dataRoot,'decision-cases-store.json');
  for(let i=0;i<2;i++){
    assert.equal((await readJson(await host.request('/api/cases/storage'))).state,'uninitialized');
    await readJson(await host.request('/api/workspace/home-pending'));
    await assert.rejects(fs.access(marker),{code:'ENOENT'});
  }
  const input=await withCaseGoal(host,{operationId:randomUUID(),title:'首个Case'});
  const command={draftId:randomUUID(),title:'首个Case',description:'人工明确创建',rawInput:'先推进一件事',goal:{...input.goalBinding.primary,strategy:input.goalBinding.strategy,alreadyAdopted:true},adoptOperationId:randomUUID(),createOperationId:randomUUID()};
  const created=await readJson(await host.request('/api/workspace/create-case','POST',command),201);
  assert.equal(created.branch,'created');
  assert.equal((await readJson(await host.request('/api/cases/storage'))).state,'ready');
  const repeated=await readJson(await host.request('/api/workspace/create-case','POST',command),201);
  assert.equal(repeated.createdCase.id,created.createdCase.id);
  assert.equal(repeated.replayedFromOperation,true);
  assert.equal((await readJson(await host.request('/api/cases'))).cases.length,1);
});

test('DW16/18: first-create convenience never initializes over an unmarked existing database',async t=>{
  let host=await startTestHost();t.after(()=>host.close());
  const input=await withCaseGoal(host,{operationId:randomUUID(),title:'保全旧资料'});
  const {dataRoot,projectsRoot}=host;
  await host.close();
  const database=path.join(dataRoot,'decision-cases.sqlite3'),original=Buffer.from('unmarked original database bytes');
  await fs.writeFile(database,original);
  host=await startTestHost({dataRoot,projectsRoot});
  assert.equal((await readJson(await host.request('/api/cases/storage'))).state,'unavailable');
  const result=await host.request('/api/workspace/create-case','POST',{draftId:randomUUID(),title:'保全旧资料',description:'',rawInput:'保留输入',goal:{...input.goalBinding.primary,strategy:input.goalBinding.strategy,alreadyAdopted:true},adoptOperationId:randomUUID(),createOperationId:randomUUID()});
  assert.equal(result.status,503);
  assert.deepEqual(await fs.readFile(database),original);
  await assert.rejects(fs.access(path.join(dataRoot,'decision-cases-store.json')),{code:'ENOENT'});
});
