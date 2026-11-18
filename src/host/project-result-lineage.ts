import {historicalTaskRoundReceipts,taskRoundReceiptKind} from './task-round-receipts.ts';
import type {TaskAssignment} from './task-assignment.ts';
import { taskSourceDeliveryType, tracksTaskSource } from '../agent/task-source-delivery.ts';
import { agentCandidateDetailsSha256, candidateCustomType, candidateToolName, parseAgentCandidateRecord, parseAgentCandidateDetails } from '../agent/agent-candidate.ts';
import type { ProjectRecord, TaskRecord } from './project-store.ts';
import path from 'node:path';
import { NativeSnapshotError, createNativeSnapshotReadBudget, readNativeSessionSnapshot } from './native-session-snapshot.ts';
import { listTaskResultSources, type ResultSessionSnapshot } from './project-task-result-sources.ts';
import { createHash } from 'node:crypto';

type Node = { id: string; type: string; parentId: string | null; fromId?: string };
const deny = (): never => { throw new Error('project_result_lineage_unavailable'); };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
export function projectResultAncestors<T extends Node>(entries: readonly T[], leaf: string, limit = 32768): T[] {
  const byId = new Map(entries.map(row => [row.id, row]));
  const output: T[] = [], visited = new Set<string>(), active = new Set<string>();
  const stack: { id: string; leave?: boolean }[] = [{ id: leaf }];
  while (stack.length) {
    const { id, leave } = stack.pop()!;
    if (leave) { active.delete(id); continue; }
    if (active.has(id)) deny();
    if (visited.has(id)) continue;
    const entry = byId.get(id);
    if (!entry || visited.size >= limit) return deny();
    visited.add(id); active.add(id); output.push(entry);
    stack.push({ id, leave: true });
    if (entry.parentId) stack.push({ id: entry.parentId });
    if (entry.type === 'branch_summary') {
      if (!entry.fromId) return deny();
      stack.push({ id: entry.fromId });
    }
  }
  return output;
}
export type TaskLineageCheck = {
  current(): void;
  run(project: ProjectRecord, task: TaskRecord, requestId: string, provided: Record<string, unknown>): Promise<void>;
  tool(project: ProjectRecord, task: TaskRecord, name: string, details: unknown, origin?: { requestId: string; sessionId: string; toolCallId: string }): Promise<void>;
  report(project: ProjectRecord, path: string, sha256: string, bytes: number): Promise<void>;
  teachProject(id: string, from: TaskRecord): Promise<ProjectRecord>;
  personalProject?(id: string): Promise<ProjectRecord>;
  signal?: AbortSignal;
};

type NestedCalls = { complete:boolean; calls:readonly {id:string;name:string;status:string}[] };
export function assertNestedSourceReceipts(nested:NestedCalls, recordsEveryDelivery:boolean, hasReceipt:(name:string,id:string)=>boolean) {
  if (!nested.complete && !recordsEveryDelivery) return deny();
  for(const child of nested.calls){
    if(tracksTaskSource(child.name) && child.status!=='error' && !hasReceipt(child.name,child.id))return deny();
  }
}

export async function hasReceivedTaskResults(project: ProjectRecord, task: TaskRecord) {
  if (!task.sessionFile) return false;
  const snapshot = await readNativeSessionSnapshot(task.sessionFile, task.sessionDirectory, path.join(project.rootPath, '020_clean'));
  const leaf = snapshot.manager.getLeafId();
  if(!leaf)return false;
  const branch=projectResultAncestors(snapshot.entries,leaf);
  const oldRunWithResults=branch.some(entry=>entry.type==='custom' && entry.customType==='optracall.run' && record(entry.data) &&
    entry.data.taskSourceReceiptVersion!==1 && record(entry.data.providedContext) &&
    (entry.data.providedContext.projectPlan || record(entry.data.providedContext.taskAssignment) && Array.isArray(entry.data.providedContext.taskAssignment.sources) && entry.data.providedContext.taskAssignment.sources.length));
  return branch.some(entry =>
    entry.type === 'custom' && entry.customType === 'optracall.run' && record(entry.data) && record(entry.data.providedContext) && !!entry.data.providedContext.projectGoalOrigin ||
    entry.type === 'message' && entry.message.role === 'toolResult' && entry.message.toolName === 'read_project_task_results' && !entry.message.isError ||
    entry.type === 'custom' && entry.customType===taskSourceDeliveryType && record(entry.data) && entry.data.name==='read_project_task_results' ||
    entry.type === 'message' && entry.message.role==='toolResult' && 'nestedCalls' in entry.message && (entry.message.nestedCalls?.calls.some(call=>call.name==='read_project_task_results' && call.status!=='error') || oldRunWithResults && entry.message.nestedCalls?.complete===false) ||
    entry.type === 'custom' && entry.customType === 'optracall.run' && record(entry.data) && record(entry.data.providedContext) && !!(entry.data.providedContext.teachSourceRights || entry.data.providedContext.doSourceRights || taskRoundReceiptKind(entry.data.providedContext.taskAssignment)));
}

/** A fresh traversal for one receiver/outlet. Nothing is stored with a source or reused as a grant. */
export async function verifyTaskResultLineage(project: ProjectRecord, target: Record<string, unknown>, checks: TaskLineageCheck) {
  const budget = createNativeSnapshotReadBudget(), seen = new Set<string>(), active = new Set<string>();
  const snapshots = new Map<string, { task: TaskRecord; sessions: Map<string, ResultSessionSnapshot>; sources: Awaited<ReturnType<typeof listTaskResultSources>> }>();
  let remaining = 32768, edges = 0;
  const used = new Map<string, { snapshot: ResultSessionSnapshot; directory: string; cwd: string }>();
  const check = () => { checks.signal?.throwIfAborted(); checks.current(); };
  async function visit(ref: Record<string, unknown>, project: ProjectRecord) {
    check();
    if (ref.projectId !== project.id || typeof ref.taskId !== 'string' || project.archivedAt) return deny();
    const task = project.tasks.find(row => row.id === ref.taskId);
    if (!task || task.archivedAt) return deny();
    if (ref.kind === 'task-history' && !task.sessionFile) return;
    const ownerKey = project.id + '/' + task.id;
    let state = snapshots.get(ownerKey);
    if (!state) {
      const sessions = new Map<string, ResultSessionSnapshot>();
      const sources = await listTaskResultSources(project, task, { signal: checks.signal, budget, assertCurrent: check, onSession: snapshot => {
        const id = snapshot.manager.getSessionId(); if (sessions.has(id)) deny(); sessions.set(id, snapshot);
      } });
      state = { task, sessions, sources }; snapshots.set(ownerKey, state); check();
    }
    const snapshot = ref.kind === 'task-history' ? [...state.sessions.values()].find(s => s.file === task.sessionFile) : state.sessions.get(String(ref.sessionId));
    if (!snapshot) return deny();
    used.set(snapshot.file, { snapshot, directory: task.sessionDirectory, cwd: path.join(project.rootPath, '020_clean') });
    let leaf: string | undefined;
    if (ref.kind === 'task-history') leaf = snapshot.manager.getLeafId() ?? undefined;
    else if (ref.kind === 'task-report' || ref.kind === 'report') {
      const row = state.sources.reports.find(r => r.sessionId === ref.sessionId && r.requestId === ref.requestId && r.toolCallId === ref.toolCallId && r.relativePath === ref.relativePath && r.sha256 === ref.sha256 && r.bytes === ref.bytes);
      if (!row?.nativeEntryId || ref.nativeEntryId && row.nativeEntryId !== ref.nativeEntryId) return deny();
      await checks.report(project, row.relativePath, row.sha256, row.bytes); leaf = row.nativeEntryId;
    } else if (ref.kind === 'agent-candidate') {
      const entry=snapshot.entries.find(e=>e.id===ref.entryId);
      if(!entry)return deny();
      const candidate=entry.type==='custom' && entry.customType===candidateCustomType ? parseAgentCandidateRecord(entry.data).details :
        entry.type==='message' && entry.message.role==='toolResult' && entry.message.toolName===candidateToolName && !entry.message.isError ? parseAgentCandidateDetails(entry.message.details) : undefined;
      if(!candidate || candidate.origin.projectId!==project.id || candidate.origin.taskId!==task.id ||
        candidate.origin.sessionId!==snapshot.manager.getSessionId() || candidate.origin.toolCallId!==ref.toolCallId ||
        agentCandidateDetailsSha256(candidate)!==ref.expectedDetailsSha256)return deny();
      leaf=entry.id;
    } else if (ref.kind === 'task-native-reply' || ref.kind === 'native-reply') {
      const entry = snapshot.entries.find(e => e.id === ref.messageId);
      if (!entry || entry.type !== 'message' || entry.message.role !== 'assistant') return deny();
      const content = entry.message.content;
      const body = typeof content === 'string' ? content : content.filter(part => part.type === 'text').map(part => part.text).join('');
      if (createHash('sha256').update(body).digest('hex') !== ref.sha256 || ref.bytes !== undefined && ref.bytes !== Buffer.byteLength(body)) return deny();
      if (ref.requestId !== undefined) {
        const original = projectResultAncestors(snapshot.entries, entry.id, remaining).find(e => e.type === 'custom' && e.customType === 'optracall.run' && record(e.data) && e.data.phase === 'started');
        if (!original || original.type !== 'custom' || !record(original.data) || original.data.requestId !== ref.requestId || original.data.sessionId !== ref.sessionId) return deny();
      }
      leaf = entry.id;
    } else return deny();
    if (!leaf) return deny();
    const key = JSON.stringify([project.id, task.id, snapshot.manager.getSessionId(), leaf]);
    if (active.has(key) || ++edges > 256) deny();
    if (seen.has(key)) return;
    active.add(key);
    const entries = projectResultAncestors(snapshot.entries, leaf, remaining); remaining -= entries.length;
    const entryById = new Map(entries.map(entry=>[entry.id,entry]));
    const markers = new Map<string,Record<string,unknown>>();
    function runAt(id:string) {
      const path:string[]=[];
      let cursor:string|null=id;
      let marker:Record<string,unknown>|undefined;
      while(cursor){
        marker=markers.get(cursor);
        if(marker)break;
        const entry=entryById.get(cursor);
        if(!entry)break;
        path.push(cursor);
        if(entry.type==='custom' && entry.customType==='optracall.run' && record(entry.data) && entry.data.phase==='started'){marker=entry.data;break;}
        cursor=entry.parentId;
      }
      if(marker)for(const entry of path)markers.set(entry,marker);
      return marker;
    }
    const legacyPrompts=new Map<Record<string,unknown>,string>();
    for(const entry of entries) {
      if(entry.type!=='message'||entry.message.role!=='user')continue;
      const run=runAt(entry.id);
      if(!run||!record(run.providedContext)||!taskRoundReceiptKind(run.providedContext.taskAssignment)||run.providedContext.taskRoundReceiptVersion)continue;
      const content=entry.message.content;
      const text=typeof content==='string'?content:content.filter(part=>part.type==='text').map(part=>part.text).join('');
      if(createHash('sha256').update(text).digest('hex')===run.providedContext.requestTextSha256)legacyPrompts.set(run,text);
    }
    const deliveries = new Set<string>();
    const identity = (request:unknown,name:string,call:string)=>JSON.stringify([request,name,call]);
    for(const entry of entries){
      if(entry.type!=='custom'||entry.customType!==taskSourceDeliveryType)continue;
      const receipt=entry.data, marker=runAt(entry.id);
      if(!record(receipt)||receipt.version!==1||receipt.projectId!==project.id||receipt.taskId!==task.id||
        receipt.sessionId!==snapshot.manager.getSessionId()||!marker||receipt.requestId!==marker.requestId||
        typeof receipt.name!=='string'||!tracksTaskSource(receipt.name)||typeof receipt.toolCallId!=='string'||!record(receipt.details))return deny();
      deliveries.add(identity(marker.requestId,receipt.name,receipt.toolCallId));
    }
    async function personalAncestors(details:Record<string,unknown>) {
      if(!Array.isArray(details.items))return;
      for(const item of details.items){
        if(!record(item))return deny();
        for(const ref of [item.target,item.sourceRef]){
          if(!record(ref)||!['agent-candidate','native-reply'].includes(String(ref.type)))continue;
          const target=ref.type==='agent-candidate'?ref.candidate:ref;
          if(!record(target)||typeof target.projectId!=='string')return deny();
          const owner=target.projectId===project.id?project:await checks.personalProject?.(target.projectId);
          if(!owner||owner.id!==target.projectId)return deny();
          const original=ref.type==='agent-candidate' ? {...target,kind:'agent-candidate',sessionId:target.originSessionId} :
            {...target,kind:'task-native-reply',sha256:target.expectedTextSha256};
          await visit(original,owner);
        }
      }
    }
    async function checkTool(toolName:string,details:unknown,id:string,toolCallId:string){
      if (toolName === 'read_project_task_results') {
        if (!record(details) || details.type !== 'optracall.project-task-results' || !record(details.scope) || details.scope.projectId !== project.id || details.scope.taskId !== task!.id) return deny();
        const upstream = details.action === 'read' ? [details.result] : details.action === 'find' && Array.isArray(details.results) ? details.results : undefined;
        if (!upstream) return deny();
        for (const ref of upstream) {
          if (!record(ref) || typeof ref.id !== 'string') return deny();
          await visit(ref, project);
        }
        return;
      }
      if (toolName === 'read_semantic_context' && record(details) && Array.isArray(details.items)) for (const item of details.items) {
        const ref = item?.target?.source;
        if (ref?.type === 'native-reply' && ['available','partial'].includes(item?.state)) await visit({ ...ref, kind: 'task-native-reply', sha256: ref.expectedTextSha256 }, project);
      }
      const run=runAt(id);
      if(toolName==='db_describe' && (!run||typeof run.requestId!=='string'||typeof run.sessionId!=='string'))return deny();
      const origin=run && typeof run.requestId==='string' && typeof run.sessionId==='string' ? {requestId:run.requestId,sessionId:run.sessionId,toolCallId} : undefined;
      await checks.tool(project,task!,toolName,details,origin);
      if((toolName==='read_personal_context'||toolName==='find_personal_context') && record(details))await personalAncestors(details);
    }
    for (const entry of entries) {
      check();
      if(entry.type==='custom' && entry.customType===taskSourceDeliveryType && record(entry.data)){
        const receipt=entry.data;
        await checkTool(String(receipt.name),receipt.details,entry.id,String(receipt.toolCallId));
        continue;
      }
      if (entry.type === 'custom' && entry.customType === 'optracall.run' && record(entry.data) && (entry.data.phase === 'started' || entry.data.phase === undefined)) {
        if (typeof entry.data.requestId !== 'string') return deny();
        let provided = record(entry.data.providedContext) ? entry.data.providedContext : {};
        const kind=taskRoundReceiptKind(provided.taskAssignment);
        if(kind){
          const rights=kind==='do'?'doSourceRights':'teachSourceRights',sources=kind==='do'?'doSources':'teachSources';
          if(provided.taskRoundReceiptVersion!==undefined && provided.taskRoundReceiptVersion!==1)return deny();
          if(provided.taskRoundReceiptVersion===1 || provided[rights]!==undefined || provided[sources]!==undefined){
            if(!Array.isArray(provided[rights])||!Array.isArray(provided[sources]))return deny();
          } else if(legacyPrompts.has(entry.data)){
            provided={...provided,...historicalTaskRoundReceipts(provided.taskAssignment as TaskAssignment,legacyPrompts.get(entry.data)!,provided.requestTextSha256)};
          } else if(leaf!==entry.id || ref.kind!=='task-history')return deny();
        }
        await checks.run(project, task, entry.data.requestId, provided);
        if(record(provided.personal))await personalAncestors(provided.personal);
        if (provided.teachSourceRights || provided.doSourceRights) {
          const sources = provided.doSourceRights ? provided.doSources : provided.teachSources;
          if (!Array.isArray(sources)) return deny();
          for (const ref of sources) {
            if (!record(ref) || typeof ref.projectId !== 'string') return deny();
            const source = ref.projectId === project.id ? project : await checks.teachProject(ref.projectId, task);
            await visit(ref, source);
          }
        }
      } else if (entry.type === 'message' && entry.message.role === 'toolResult') {
        const message=entry.message,run=runAt(entry.id);
        const nested='nestedCalls' in message ? message.nestedCalls : undefined;
        if(nested)assertNestedSourceReceipts(nested,run?.taskSourceReceiptVersion===1,
          (name,id)=>deliveries.has(identity(run?.requestId,name,id)));
        if(!message.isError && !deliveries.has(identity(run?.requestId,message.toolName,message.toolCallId))) {
          await checkTool(message.toolName,message.details,entry.id,message.toolCallId);
        }
      }
    }
    active.delete(key); seen.add(key); check();
  }
  await visit(target, project);
  const verificationBudget = createNativeSnapshotReadBudget();
  for (const { snapshot, directory, cwd } of used.values()) {
    check();
    const latest = await readNativeSessionSnapshot(snapshot.file, directory, cwd, undefined, { signal: checks.signal, budget: verificationBudget });
    if (latest.sha256 !== snapshot.sha256) throw new NativeSnapshotError('native_snapshot_changed');
  }
  check();
}
