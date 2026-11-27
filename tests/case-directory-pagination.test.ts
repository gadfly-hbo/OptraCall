import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { CaseStore } from '../src/host/case-store.ts';
import { listVisibleCaseDirectory } from '../src/host/case-directory.ts';
import { createWorkspaceDailyRoutes } from '../src/host/workspace-daily-routes.ts';
import { createWorkspaceDraftStore } from '../src/host/workspace-draft-store.ts';

test('DW-FINAL-DIR-01: large visible directories page whole Case and issue identities within the native payload budget', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'optracall-directory-pages-'));
  const cases = new CaseStore({ dataRoot: root }); await cases.initialize(); t.after(() => cases.close());
  const record = cases.createCase({ operationId: randomUUID(), title: '长事项目录' });
  const ids: string[] = [];
  for (let i = 0; i < 132; i++) ids.push(cases.createDecisionIssue({ caseId: record.id, operationId: randomUUID(), expectedRevision: cases.getCase(record.id).revision, title: `事项${i}` + '甲'.repeat(230) }).id);
  const first = listVisibleCaseDirectory(cases, { limit: 1, issueLimit: 5 } as never) as any;
  assert.equal(first.items[0].issues.length, 5);
  assert.equal(first.items[0].nextIssueOffset, 5); assert.equal(first.items[0].totalIssues, 132);
  assert.equal(first.items[0].issuesTruncated, true); assert.equal(first.truncated, true);
  const readIds: string[] = [];
  let offset: number | null = 0;
  while (offset !== null) {
    const page = listVisibleCaseDirectory(cases, { caseId: record.id, limit: 1, issueLimit: 20, issueOffset: offset } as never) as any;
    assert.ok(JSON.stringify({ claim: 'visible-case-directory', ...page }).length <= 30000);
    assert.equal(page.items.length, 1); assert.equal(page.items[0].caseId, record.id);
    readIds.push(...page.items[0].issues.map((row: any) => row.issueId));
    offset = page.items[0].nextIssueOffset;
  }
  assert.deepEqual(readIds, ids);
  const second = cases.createCase({ operationId: randomUUID(), title: '第二Case' });
  const page1 = listVisibleCaseDirectory(cases, { limit: 1, issueLimit: 1 } as never) as any;
  const page2 = listVisibleCaseDirectory(cases, { limit: 1, issueLimit: 1, offset: page1.nextOffset } as never) as any;
  assert.deepEqual(new Set([page1.items[0].caseId, page2.items[0].caseId]), new Set([record.id, second.id]));
  assert.equal(page2.nextOffset, null);
  const routes = createWorkspaceDailyRoutes({ cases, drafts: createWorkspaceDraftStore({ root }), adoptGoal: async () => { throw Error('unused'); }, createCase: async () => { throw Error('unused'); } });
  const response = await routes({ pathname: '/api/workspace/case-directory', method: 'GET', searchParams: new URLSearchParams({ caseId: record.id, issueOffset: '125', issueLimit: '7', limit: '1' }) }) as any;
  assert.deepEqual(response.body.items[0].issues.map((row: any) => row.issueId), ids.slice(125));
  assert.equal(response.body.items[0].nextIssueOffset, null);
  assert.equal(listVisibleCaseDirectory(cases, { caseId: randomUUID() } as never).items.length, 0);
  assert.throws(() => listVisibleCaseDirectory(cases, { issueOffset: 1 } as never), { code: 'case_directory_case_required' });
});

test('DW10: directory Case pages fit the aggregate native budget without shortening any issue',()=>{
  const records=Array.from({length:30},(_,i)=>({id:randomUUID(),title:`Case ${i}`,status:'pending' as const,updatedAt:'2026-11-27T12:00:00Z'}));
  const issues=new Map<string,{id:string;title:string}[]>(records.map(record=>[record.id,Array.from({length:20},()=>({id:randomUUID(),title:'原始事项'.repeat(60)}))]));
  const cases={getStatus:()=>({state:'ready' as const}),listCases:()=>records,listDecisionIssues:(id:string)=>issues.get(id)!,getGoalBinding:()=>null};
  let offset:number|null=0;const found=new Set<string>();
  while(offset!==null){
    const page=listVisibleCaseDirectory(cases as never,{limit:30,issueLimit:20,offset});
    assert.ok(JSON.stringify({claim:'visible-case-directory',...page}).length<=30000);
    for(const entry of page.items){found.add(entry.caseId);assert.equal(entry.issues[0].title,'原始事项'.repeat(60));}
    offset=page.nextOffset;
  }
  assert.equal(found.size,30);
});
