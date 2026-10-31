import { open } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAgentSessionDomain, type SessionResult } from './agent-sessions.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import { runtimeDiagnostic } from '../agent/run-diagnostics.ts';
import type { RunDiagnostic } from '../agent/run-diagnostics.ts';
import type { CreateVerificationInput, VerificationOwner, VerificationRecord, VerificationStore, VerificationAuthorRevision } from './verification-store.ts';
import { VerificationStoreError } from './verification-store.ts';

export type VerificationSelection = {
  verificationId: string; question: string; dataFiles: string[]; authorFiles: string[];
  businessContext?: string; requirementContext?: { instanceId: string; version?: string };
  caseId?: string; caseRevision?: number; caseBackgroundIsPrior?: boolean; useCurrentSap?: boolean;
  configurationId?: string; retryOf?: string;
};
export function createVerificationSessions(options: {
  store: VerificationStore; codeRoot: string; resourceRoot: string; managementPorts(): number[];
  configuration(id: string, revision: number): Readonly<RuntimeModelConfiguration> | null | undefined;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
  admit(owner: VerificationOwner): void | Promise<void>;
  admitRevision(owner: VerificationOwner): void | Promise<void>;
  admitRecheck(owner: VerificationOwner): void | Promise<void>;
  assertInputs(owner: VerificationOwner): void | Promise<void>;
  stopAuthor(record: VerificationRecord): Promise<void>;
  prepareRevision(record: VerificationRecord, instructions: string): Promise<Pick<VerificationAuthorRevision, 'mode' | 'configuration'>>;
  projectIds(): Promise<string[]>;
  prepare(projectId: string, taskId: string, selection: VerificationSelection): Promise<CreateVerificationInput>;
  revise(record: VerificationRecord, requestId: string, instructions: string): Promise<{ outcome: string; text: string; sessionFile?: string; files?: string[]; diagnostic?: RunDiagnostic }>;
  export(record: VerificationRecord, text: string): Promise<string>;
}) {
  const store = options.store;
  const domain = createAgentSessionDomain<VerificationRecord>({ name: 'independent-verification',
    profile: {
      key: owner => `${owner.projectId}/${owner.taskId}/${owner.verificationId}`,
      projectId: owner => owner.projectId,
      configuration: owner => options.configuration(owner.configuration.id, owner.configuration.revision),
      admit: owner => options.admit(owner),
      agentOptions: async owner => {
        const record = await store.read(owner);
        return { projectId: record.projectId, workspace: { cwd: record.workspace, systemPrompt: [
          'You are an independent verification analyst in OptraCall. Choose methods yourself and actually execute code when needed. Use only the copied inputs and provided business facts. Keep assumptions, unconfirmed meanings and differences visible. Do not infer causality from a numerical match.',
          'Work and write only inside this verification workspace. inputs/ contains fixed copies: do not edit these files; save transformations to new files. Do not search parent directories, other projects, native session history, Host metadata or the original author files. This is a soft instruction, not a sandbox. Shared tools and resources do not grant additional data or business-action authority.',
          'In the independent first turn do not seek the author answer. Later the Host may explicitly provide fixed author files for comparison. A repeated author script is reproducibility evidence, not an independent calculation. Do not publish assets, change source files or execute business actions.',
        ] }, sessionDirectory: record.sessionDirectory, ...(record.native?.sessionFile ? { sessionFile: record.native.sessionFile } : {}), codeRoot: options.codeRoot, resourceRoot: options.resourceRoot, managementPorts: options.managementPorts() };
      }, capabilities: { ui: true },
    }, configurationSnapshot: options.configuration, mutate: options.mutate, isClosing: options.isClosing,
  });
  const resultInput = (result: SessionResult, requestId: string) => ({ text: result.text, requestId, ...(typeof result.sessionFile === 'string' ? { sessionFile: result.sessionFile } : (result.snapshot as { sessionFile?: string } | undefined)?.sessionFile ? { sessionFile: (result.snapshot as { sessionFile: string }).sessionFile } : {}) });
  async function terminal(owner: VerificationOwner, result: SessionResult) {
    return options.mutate(() => store.update(owner, { state: result.outcome === 'cancelled' ? 'cancelled' : 'failed', ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}) }));
  }
  async function initial(record: VerificationRecord) {
    const ref = domain.ref(record);
    const eventFile = await open(path.join(store.recordDirectory(record), 'events.jsonl'), 'wx', 0o600);
    let writes = Promise.resolve(), cold = true, coldTools = 0, exposed = record.independence.status === 'informed';
    const unsubscribe = domain.subscribe(ref, event => {
      writes = writes.then(() => eventFile.writeFile(JSON.stringify(event) + '\n')).then(() => {});
      if (cold && event.type === 'native' && event.event.type === 'tool_execution_start') {
        coldTools++;
        const args = JSON.stringify(event.event.args ?? event.event.input ?? {});
        if (record.authorFiles.some(file => args.includes(file.relativePath) || file.sourcePath && args.includes(file.sourcePath)) || args.includes(store.recordDirectory(record))) exposed = true;
      }
    });
    try {
      await domain.withSession(ref, async lease => {
        await options.mutate(() => store.update(record, { state: 'running', phase: 'cold' }));
        const firstId = randomUUID();
        const first = await lease.run({ requestId: firstId, text: `独立核算任务：${record.question}\n\n只读取 inputs/ 中的获准数据和 inputs/business-context.md。请自主选择计算或验证方式，实际运行并保存依据；本轮尚未提供作者答案。最终回复说明关键计算、假设及不能确认的内容。` });
        await writes;
        if (!lease.context.isCurrent()) return;
        if (first.outcome !== 'completed') { await terminal(record, first); return; }
        await options.mutate(async () => {
          if (!lease.context.isCurrent()) return;
          await options.assertInputs(record);
          await store.saveColdResult(record, resultInput(first, firstId));
          await store.verifyWorkspaceInputs(record);
          await store.update(record, { native: resultInput(first, firstId), independence: { status: exposed ? 'informed' : coldTools ? 'observed' : 'unknown', note: exposed ? '捕获到冷读阶段可能接触作者产物；本次按知情复核记录。' : coldTools ? '仅在捕获工具活动范围内未观察到直接提前读取目标产物；不是安全隔离或完整访问证明。' : '已使用独立会话，但未捕获工具复算；不能确认独立计算已完成。' } });
          await store.revealAuthor(record);
        });
        if (!lease.context.isCurrent()) return;
        cold = false;
        const fixed = await store.read(record);
        const previews = (await store.readAuthorFiles(fixed)).map(file => `文件 author/${file.relativePath}，SHA256 ${file.sha256}\n${file.bytes.toString('utf8').slice(0, 4000)}`);
        const secondId = randomUUID();
        const second = await lease.run({ requestId: secondId, text: `独立结果已先保存。现在才开放固定作者产物：\n${previews.join('\n\n').slice(0, 12000)}\n\n完整副本位于 author/。请与本次独立依据对照，逐项说明核查范围、计算/口径/方法前提/解释差异和无法确认事项。明确哪些是独立复算，哪些只是重跑作者代码；不要以双方一致或程序完成证明业务成立，不要修改作者原稿。` });
        await writes;
        if (!lease.context.isCurrent()) return;
        if (second.outcome !== 'completed') { await terminal(record, second); return; }
        await options.mutate(async () => {
          if (!lease.context.isCurrent()) return;
          await options.assertInputs(record);
          await store.verifyWorkspaceInputs(record);
          await store.readAuthorFiles(record);
          await store.saveComparisonResult(record, resultInput(second, secondId));
          await store.update(record, { state: 'completed', native: resultInput(second, secondId) });
        });
      });
    } catch (error) {
      const current = await store.read(record);
      if (!['cancelled','interrupted'].includes(current.state)) await options.mutate(() => store.update(record, { state: 'unknown', diagnostic: runtimeDiagnostic(error) })).catch(() => {});
    } finally { unsubscribe(); await writes.catch(() => {}); await eventFile.close(); await domain.close(ref).catch(() => {}); }
  }
  async function start(projectId: string, taskId: string, selection: VerificationSelection) {
    const owner = { projectId, taskId, verificationId: selection.verificationId };
    // An existing accepted intent never re-reads changed sources or dispatches again.
    try {
      const previous = await store.read(owner);
      const ordered = (value: unknown): unknown => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered((value as Record<string, unknown>)[key])])) : value;
      if (JSON.stringify(ordered(previous.selection)) !== JSON.stringify(ordered(selection))) throw new VerificationStoreError('verification_selection_conflict');
      return { verification: previous, created: false };
    } catch (error) { if (!(error instanceof VerificationStoreError) || error.code !== 'verification_not_found') throw error; }
    const prepared = await options.mutate(async () => { await options.admit(owner); return store.create(await options.prepare(projectId, taskId, selection)); });
    if (prepared.created) void initial(prepared.record).catch(async error => { await options.mutate(() => store.update(owner, { state: 'unknown', diagnostic: runtimeDiagnostic(error) })).catch(() => {}); });
    return { verification: prepared.record, created: prepared.created };
  }
  async function read(owner: VerificationOwner) {
    const record = await store.read(owner), current = await domain.read(domain.ref(record));
    const authorReports = (await store.readAuthorFiles(record)).map(file => ({ path: file.relativePath, text: file.bytes.toString('utf8').slice(0, 100_000), sha256: file.sha256 }));
    return { ...record, id: record.verificationId, status: record.state, phase: record.phase === 'compare' ? 'comparison' : record.phase, model: record.configuration, independence: { ...record.independence, details: record.independence.note }, revision: record.authorRevision ? { ...record.authorRevision, text: record.authorRevision.reportText } : undefined, uiRequests: current.pendingUI.map(event => event.request), authorReports };
  }
  async function stop(owner: VerificationOwner) {
    const record = await store.read(owner);
    if (record.authorRevision?.status === 'running') {
      await options.mutate(() => store.update(owner, { authorRevision: { ...record.authorRevision!, status: 'cancelled' } }));
      await options.stopAuthor(record); return read(owner);
    }
    if (!['preparing','ready','running'].includes(record.state)) return read(owner);
    await domain.stop(domain.ref(record));
    await options.mutate(() => store.update(owner, { state: 'cancelled' }));
    return read(owner);
  }
  async function revise(owner: VerificationOwner, instructions = '') {
    const record = await options.mutate(async () => {
      await options.admit(owner); await options.admitRevision(owner); const record = await store.read(owner);
      if (record.state !== 'completed' || !record.comparisonResult || record.revisionCount) throw new VerificationStoreError('verification_revision_unavailable');
      const metadata = await options.prepareRevision(record, instructions);
      return store.update(owner, { revisionCount: 1, authorRevision: { requestId: randomUUID(), status: 'running', ...metadata } });
    });
    void (async () => {
      try {
        const result = await options.revise(record, record.authorRevision!.requestId, instructions);
        await options.mutate(async () => {
          const latest = await store.read(owner);
          if (latest.authorRevision?.status !== 'running') return;
          await store.update(owner, { ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}), authorRevision: { ...latest.authorRevision, status: result.outcome === 'completed' && result.text.trim() && result.files?.length ? 'completed' : result.outcome === 'cancelled' ? 'cancelled' : 'failed', ...(result.outcome === 'completed' && result.files?.length ? { reportText: result.text } : {}), ...(result.sessionFile ? { sessionFile: result.sessionFile } : {}), ...(result.files ? { files: result.files } : {}) } });
        });
      } catch (error) { await options.mutate(async () => {
        const latest = await store.read(owner);
        if (latest.authorRevision?.status !== 'running') return;
        const diagnostic = runtimeDiagnostic(error);
        const provenSourceFailure = diagnostic.code === 'verification_source_changed' || diagnostic.code === 'verification_source_missing';
        await store.update(owner, { authorRevision: { ...latest.authorRevision, status: provenSourceFailure ? 'failed' : 'unknown' }, diagnostic });
      }); }
    })();
    return read(owner);
  }
  async function recheck(owner: VerificationOwner) {
    const record = await options.mutate(async () => {
      await options.admit(owner); await options.admitRecheck(owner); const current = await store.read(owner);
      if (current.recheckCount || current.authorRevision?.status !== 'completed' || !current.authorRevision.reportText) throw new VerificationStoreError('verification_recheck_unavailable');
      if (!options.configuration(current.configuration.id, current.configuration.revision)) throw new VerificationStoreError('configuration_required');
      await store.verifyWorkspaceInputs(owner);
      await store.stageRevision(owner, current.authorRevision.reportText);
      return store.update(owner, { phase: 'recheck', state: 'running', recheckCount: 1 });
    });
    void domain.withSession(domain.ref(record), async lease => {
      const requestId = randomUUID(), result = await lease.run({ requestId, text: `这是对已见作者产物的修订复查，不是新的冷读独立核算。原数据与业务口径已核对固定副本；若发现新变化请明确无法沿用。完整作者修订回复位于 author-revision/revision.md，请读取全文；以下仅为可能截断的摘要：\n${record.authorRevision!.reportText!.slice(0, 8000)}\n请仅复查此前差异是否得到解决，保留证据与剩余分歧，不再要求下一轮自动修改。` });
      if (!lease.context.isCurrent()) return;
      if (result.outcome !== 'completed') { await terminal(owner, result); return; }
      await options.mutate(async () => { if (!lease.context.isCurrent()) return; await options.assertInputs(owner); await store.verifyWorkspaceInputs(owner, { revision: true }); await store.readAuthorFiles(owner); await store.saveRecheckResult(owner, resultInput(result, requestId)); await store.update(owner, { state: 'completed', native: resultInput(result, requestId) }); });
    }).catch(async error => { await options.mutate(() => store.update(owner, { state: 'unknown', diagnostic: runtimeDiagnostic(error) })).catch(() => {}); }).finally(() => domain.close(domain.ref(record)).catch(() => {}));
    return read(owner);
  }
  async function exportReport(owner: VerificationOwner) {
    return options.mutate(async () => {
    const record = await store.read(owner);
    if (!record.comparisonResult) throw new VerificationStoreError('verification_result_required');
    const text = `# 独立核算记录\n\n问题：${record.question}\n\n模型：${record.configuration.provider}/${record.configuration.model}\n\n独立性：${record.independence.status}；${record.independence.note ?? ''}\n\n## 首次独立结果\n\n${record.coldResult?.text ?? '未取得'}\n\n## 对照与分歧\n\n${record.comparisonResult.text}\n\n${record.recheckResult ? `## 修订复查\n\n${record.recheckResult.text}\n\n` : ''}本记录仅覆盖所列范围和固定输入，不表示业务采用、实际执行或效果验证。\n`;
    const exportedFile = await options.export(record, text);
    await store.update(owner, { exportedFile });
    return exportedFile;
    });
  }
  async function closeAll(filter: { projectId?: string; provider?: string } = {}) {
    await domain.closeAll(filter);
    for (const projectId of filter.projectId ? [filter.projectId] : await options.projectIds()) {
      for (const record of await store.list(projectId)) {
        const verifierMatches = !filter.provider || record.configuration.provider === filter.provider;
        const revisionMatches = !filter.provider || record.authorRevision?.mode === 'fixed-draft' && record.authorRevision.configuration?.provider === filter.provider;
        if (!verifierMatches && !revisionMatches) continue;
        if (!['preparing','ready','running'].includes(record.state) && record.authorRevision?.status !== 'running') continue;
        await options.mutate(async () => {
          const current = await store.read(record);
          if (verifierMatches && ['preparing','ready','running'].includes(current.state)) await store.update(record, { state: 'interrupted', diagnostic: runtimeDiagnostic({ code: 'runtime_closed' }) });
          if (revisionMatches && current.authorRevision?.status === 'running') await store.update(record, { authorRevision: { ...current.authorRevision, status: 'unknown' }, diagnostic: runtimeDiagnostic({ code: 'runtime_closed' }) });
        });
      }
    }
  }
  return { start, read, stop, revise, recheck, exportReport, list: store.list, closeAll,
    busy: async (projectId: string) => (await store.list(projectId)).some(record => domain.busy(domain.ref(record)) || ['preparing','ready','running'].includes(record.state) || record.authorRevision?.status === 'running'),
    respondUI: async (owner: VerificationOwner, input: { id: string; value?: string | boolean; cancelled?: boolean }) => domain.respondUI(domain.ref(await store.read(owner)), input),
  };
}
