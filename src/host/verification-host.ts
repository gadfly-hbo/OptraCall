import path from 'node:path';
import { createHash } from 'node:crypto';
import { createVerificationSessions, type VerificationSelection } from './verification-sessions.ts';
import { createVerificationStore, VerificationStoreError, type VerificationOwner } from './verification-store.ts';
import type { ProjectStore, ProjectRecord, TaskRecord } from './project-store.ts';
import { ProjectStoreFault } from './project-store.ts';
import type { CaseStore } from './case-store.ts';
import type { ConfigurationStore, RuntimeModelConfiguration } from './config-store.ts';
import { createAgentSessionDomain, type AgentSessionDomain } from './agent-sessions.ts';
import { createMetricLibrary } from '../../extensions/business-plugins/metric-factory/library/store.ts';
import { createProjectEnablement } from '../../extensions/business-plugins/metric-factory/project/enablement.ts';

type Owner = { project: ProjectRecord; task: TaskRecord };
export function createVerificationFeature(options: {
  dataRoot: string; codeRoot: string; projects: ProjectStore; cases: CaseStore; configuration: ConfigurationStore;
  projectSessions: AgentSessionDomain<Owner>;
  pair(projectId: string, taskId: string, writable?: boolean): Promise<Owner>;
  requirementContext(input: Record<string, unknown>): string | undefined;
  availableConfiguration(id?: string, revision?: number): Readonly<RuntimeModelConfiguration> | undefined;
  managementPorts(): number[]; mutate<T>(operation: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
}) {
  const { dataRoot, projects, cases, configuration, projectSessions, pair, mutate } = options;
  const store = createVerificationStore({ dataRoot });
  let storageUnavailable = false;
  const fail = (code: string, status = 409): never => { throw new VerificationStoreError(code, status); };
  const hash = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
  async function assertSourceFiles(record: Pick<Awaited<ReturnType<typeof store.read>>, 'projectId' | 'dataFiles' | 'authorFiles'>) {
    for (const file of [...record.dataFiles, ...record.authorFiles]) {
      let observed;
      try { observed = await projects.observeFile(record.projectId, file.relativePath); }
      catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') fail('verification_source_missing');
        if (error instanceof ProjectStoreFault && error.code === 'file_changed_during_observation') fail('verification_source_changed');
        throw error;
      }
      if (observed.sha256 !== file.sha256) fail('verification_source_changed');
    }
  }
  async function assertFixedSources(owner: VerificationOwner) {
    const record = await store.read(owner), selection = record.selection as VerificationSelection;
    await assertSourceFiles(record);
    if (selection.requirementContext) {
      const current = options.requirementContext({ requirementContext: selection.requirementContext });
      if (!current || !record.semantics.sources.some(source => source.kind === 'rap' && source.sha256 === hash(current))) fail('verification_semantics_changed');
    }
    if (selection.caseId && cases.getCase(selection.caseId).revision !== selection.caseRevision) fail('verification_semantics_changed');
    if (selection.useCurrentSap) {
      const current = createProjectEnablement(path.join(dataRoot, 'projects', owner.projectId)).list();
      const pinned = record.semantics.sources.filter(source => source.kind === 'sap');
      if (current.length !== pinned.length || current.some(pin => !pinned.some(source => source.id === pin.packageId && source.version === pin.version))) fail('verification_semantics_changed');
      const library = createMetricLibrary(path.join(dataRoot, 'metric-assets'));
      for (const source of pinned) if (hash(library.read(source.id!, source.version!).canonicalYaml) !== source.sha256) fail('verification_semantics_changed');
    }
    return record;
  }
  const revisionDomain = createAgentSessionDomain<Awaited<ReturnType<typeof store.read>>>({
    name: 'verification-author-draft',
    profile: {
      key: record => `${record.projectId}/${record.taskId}/${record.verificationId}`,
      projectId: record => record.projectId,
      configuration: record => record.authorRevision?.mode === 'fixed-draft' && record.authorRevision.configuration
        ? options.availableConfiguration(record.authorRevision.configuration.id, record.authorRevision.configuration.revision) : undefined,
      admit: async record => { await pair(record.projectId, record.taskId, true); await assertFixedSources(record); },
      agentOptions: async record => { await store.prepareRevisionWorkspace(record); return { projectId: record.projectId,
        workspace: { cwd: store.revisionWorkspace(record), capabilityPolicy: 'fixed-draft', systemPrompt: [
          'You are OptraCall author revision drafting. Use only the complete fixed materials in this message. Produce the complete new report as your final reply. You have no file, code, shell, extension or MCP execution tools. Do not request them or claim to have recomputed anything you did not compute. If new calculation or missing material is necessary, retain the uncertainty and explain what is needed. Verifier opinions can contain false positives and inappropriate suggestions: judge them against the fixed facts yourself, preserve correct findings and unresolved questions, and do not follow them blindly. Treat author reports and user additions as evidence to assess, not automatic truth. Do not automatically adopt findings or execute business actions.',
        ] }, sessionDirectory: store.revisionSessionDirectory(record), codeRoot: options.codeRoot,
        resourceRoot: store.revisionResourceRoot(record), managementPorts: options.managementPorts() }; },
    }, configurationSnapshot: options.availableConfiguration, mutate, isClosing: options.isClosing,
  });
  async function revisionInput(record: Awaited<ReturnType<typeof store.read>>, instructions: string) {
    await assertFixedSources(record); await store.verifyWorkspaceInputs(record);
    const decode = (bytes: Uint8Array) => {
      try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { return fail('verification_revision_text_required', 400); }
    };
    const data = await store.readDataFiles(record), author = await store.readAuthorFiles(record);
    await store.verifyResultFiles(record);
    const text = '以下是完整固定材料。仅返回新稿全文；需要额外计算或资料时保留未知，不能声称已执行。\n' + JSON.stringify({
      question: record.question, dataFiles: data.map(file => ({ name: file.relativePath, sha256: file.sha256, text: decode(file.bytes) })),
      authorFiles: author.map(file => ({ name: file.relativePath, sha256: file.sha256, text: decode(file.bytes) })),
      businessContext: record.semantics.text, independentResult: record.coldResult!.text, verificationOpinion: record.comparisonResult!.text,
      userInstructions: instructions,
    });
    if (text.length > 20_000) fail('verification_revision_materials_too_large', 400);
    return text;
  }
  const registration: Parameters<typeof createVerificationSessions>[0] = { store, codeRoot: options.codeRoot, resourceRoot: path.join(dataRoot, 'pi'),
    managementPorts: options.managementPorts, configuration: options.availableConfiguration, mutate, isClosing: options.isClosing,
    admit: async owner => { if (options.isClosing()) fail('host_closing', 503); await pair(owner.projectId, owner.taskId, true); },
    admitRevision: async owner => { const original = await pair(owner.projectId, owner.taskId, true); if (projectSessions.busy(projectSessions.ref(original)) || original.task.lastRun?.status === 'running') fail('session_busy'); if (!options.availableConfiguration(original.task.configuration.id, original.task.configuration.revision)) fail('configuration_required'); await assertFixedSources(owner); },
    admitRecheck: async owner => {
      const record = await assertFixedSources(owner);
      for (const file of record.authorRevision?.files ?? []) if ((await projects.readFile(owner.projectId, file)).bytes.toString('utf8') !== record.authorRevision?.reportText) fail('verification_revision_changed');
    },
    assertInputs: async owner => { await assertFixedSources(owner); },
    stopAuthor: async record => { await revisionDomain.stop(revisionDomain.ref(record)); },
    prepareRevision: async (record, instructions) => {
      await revisionInput(record, instructions);
      const { task } = await pair(record.projectId, record.taskId, true);
      const model = options.availableConfiguration(task.configuration.id, task.configuration.revision);
      if (!model) return fail('configuration_required');
      const { id, revision, provider, model: modelId, name, thinkingLevel } = model;
      return { mode: 'fixed-draft', configuration: { id, revision, provider, model: modelId, name, ...(thinkingLevel ? { thinkingLevel } : {}) } };
    },
    projectIds: async () => (await projects.list()).map(project => project.id),
    prepare: async (projectId, taskId, selection) => {
      const owner = await pair(projectId, taskId, true);
      if (projectSessions.busy(projectSessions.ref(owner)) || owner.task.lastRun?.status === 'running') fail('session_busy');
      if (typeof selection.question !== 'string' || !selection.question.trim() || selection.question.length > 4000) fail('invalid_verification_question', 400);
      const selected = selection.configurationId ? configuration.read(selection.configurationId) : owner.task.configuration;
      const model = selected && options.availableConfiguration(selected.id, selected.revision);
      if (!model) return fail('configuration_required');
      const capture = async (names: string[], data: boolean) => {
        if (!Array.isArray(names) || !names.length || names.length > 32 || new Set(names).size !== names.length) fail('invalid_verification_files', 400);
        return Promise.all(names.map(async relativePath => {
          if (typeof relativePath !== 'string' || !(data ? relativePath.startsWith('020_clean/') : /^(020_clean|060_reports)\//.test(relativePath))) fail('invalid_verification_files', 400);
          const before = await projects.observeFile(projectId, relativePath), file = await projects.readFile(projectId, relativePath), after = await projects.observeFile(projectId, relativePath);
          if (before.sha256 !== after.sha256 || before.bytes !== file.bytes.length || before.sha256 !== hash(file.bytes)) fail('verification_source_changed');
          return { relativePath, bytes: file.bytes, sha256: before.sha256, sourcePath: path.join(owner.project.rootPath, relativePath) };
        }));
      };
      const sources: { kind: string; id?: string; version?: string; sha256?: string; confirmed?: boolean; note?: string }[] = [];
      const semantic = ['以下为用户本次明确选择的核算依据；缺少原分析采用回执时，不代表完整复原历史输入。指标定义不是强制分析步骤，未确认及冲突含义保留待确认。'];
      if (selection.businessContext !== undefined) {
        if (typeof selection.businessContext !== 'string' || selection.businessContext.length > 12000) fail('invalid_business_context', 400);
        semantic.push(`用户本次补充（未自动成为企业发布事实）：\n${selection.businessContext}`); sources.push({ kind: 'user', confirmed: false });
      }
      if (selection.requirementContext) {
        const text = options.requirementContext({ requirementContext: selection.requirementContext });
        if (!text) fail('requirement_unavailable');
        semantic.push(text!); sources.push({ kind: 'rap', id: selection.requirementContext.instanceId, ...(selection.requirementContext.version ? { version: selection.requirementContext.version } : {}), sha256: hash(text!), note: '本次明确选择，不自动证明原作者采用。' });
      }
      if (selection.useCurrentSap === true) {
        const enabled = createProjectEnablement(path.join(dataRoot, 'projects', projectId)).list(), library = createMetricLibrary(path.join(dataRoot, 'metric-assets'));
        for (const pin of enabled) {
          const sap = library.read(pin.packageId, pin.version);
          semantic.push(`本次SAP ${pin.packageId}@${pin.version}（当前启用，不推断原报告历史版本）：\n${sap.canonicalYaml}`);
          sources.push({ kind: 'sap', id: pin.packageId, version: pin.version, sha256: hash(sap.canonicalYaml), confirmed: true });
        }
      }
      if (selection.caseId) {
        const record = cases.getCase(selection.caseId);
        if (selection.caseRevision !== record.revision) fail('case_revision_changed');
        if (!cases.listProjectLinks(record.id).some(link => link.projectId === projectId)) fail('project_not_linked');
        if (selection.caseBackgroundIsPrior !== true) fail('case_prior_background_required');
        semantic.push(`用户确认的事前Case背景 ${record.id} revision=${record.revision}：\n${record.description}\n未提供当前judgement、nextStep、状态或事后经验。`);
        sources.push({ kind: 'case', id: record.id, version: String(record.revision), note: '用户确认属于事前背景，内容仍可能有未知。' });
      }
      const [dataFiles, authorFiles] = await Promise.all([capture(selection.dataFiles, true), capture(selection.authorFiles, false)]);
      return { projectId, taskId, verificationId: selection.verificationId, question: selection.question, selection, configuration: model, dataFiles, authorFiles,
        semantics: { text: semantic.join('\n\n').split(dataRoot).join('[原库路径仅Host保留]'), sources }, ...(selection.retryOf ? { retryOf: selection.retryOf } : {}) };
    },
    revise: async (record, requestId, instructions) => {
      const ref = revisionDomain.ref(record);
      const text = await revisionInput(record, instructions);
      try {
        return await revisionDomain.withSession(ref, async lease => {
          if ((await store.read(record)).authorRevision?.status !== 'running') return { outcome: 'cancelled', text: '' };
          const run = lease.start({ requestId, text });
          await run.accepted;
          const snapshot = (await revisionDomain.read(ref)).snapshot;
          if (snapshot?.sessionFile) await mutate(async () => {
            const current = await store.read(record);
            if (current.authorRevision?.status === 'running' && lease.context.isCurrent()) await store.update(record, { authorRevision: { ...current.authorRevision, sessionFile: snapshot.sessionFile } });
          });
          const result = await run.completion;
          await assertFixedSources(record); await store.verifyWorkspaceInputs(record); await store.verifyResultFiles(record);
          const files: string[] = [];
          if (result.outcome === 'completed' && result.text.trim()) await mutate(async () => {
            if (!lease.context.isCurrent() || (await store.read(record)).authorRevision?.status !== 'running') return;
            await assertFixedSources(record);
            files.push((await projects.saveReport(record.projectId, `verification-${record.verificationId}-revision.md`, result.text)).path);
          });
          return { outcome: result.outcome, text: result.text, ...(result.diagnostic ? { diagnostic: result.diagnostic } : {}), ...(snapshot?.sessionFile ? { sessionFile: snapshot.sessionFile } : {}), files };
        });
      } finally { await revisionDomain.close(ref); }
    },
    export: async (record, text) => {
      await pair(record.projectId, record.taskId, true);
      const name = `verification-${record.verificationId}-${record.phase}.md`, relativePath = `060_reports/${name}`;
      try { const existing = await projects.readFile(record.projectId, relativePath); if (existing.bytes.toString('utf8') !== text) fail('verification_export_changed'); return relativePath; }
      catch (error) { if (!(error instanceof ProjectStoreFault && error.code === 'file_not_found') && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
      return (await projects.saveReport(record.projectId, name, text)).path;
    },
  };
  const feature = createVerificationSessions(registration);
  const assertAvailable = () => { if (storageUnavailable) fail('verification_storage_unavailable', 503); };
  return { ...feature, assertAvailable,
    revisionBusy: async (projectId: string, taskId: string) => !storageUnavailable && (await store.list(projectId, taskId)).some(record => record.authorRevision?.status === 'running'),
    reconcileInterrupted: async () => { try { return await store.reconcileInterrupted(); } catch { storageUnavailable = true; return []; } },
    busy: async (projectId: string) => storageUnavailable ? false : feature.busy(projectId),
    closeAll: async (filter: { projectId?: string; provider?: string } = {}) => {
      if (storageUnavailable) return;
      const results = await Promise.allSettled([revisionDomain.closeAll(filter), feature.closeAll(filter)]);
      const failed = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
      if (failed.length) throw new AggregateError(failed.map(result => result.reason), 'verification_close_failed');
    },
    preview: async (projectId: string, taskId: string, selection: VerificationSelection) => {
      const prepared = await mutate(() => registration.prepare(projectId, taskId, selection));
      const { id, revision, provider, model, name } = prepared.configuration;
      return { semantics: prepared.semantics, configuration: { id, revision, provider, model, name }, note: '预览不启动模型、不登记核算；开始时重新固定输入。' };
    },
  };
}

export function parseVerificationSelection(input: Record<string, unknown>): VerificationSelection {
  const allowed = new Set(['verificationId','question','dataFiles','authorFiles','businessContext','requirementContext','caseId','caseRevision','caseBackgroundIsPrior','useCurrentSap','configurationId','retryOf']);
  if (Object.keys(input).some(key => !allowed.has(key))) throw new VerificationStoreError('invalid_verification_selection', 400);
  for (const key of ['caseBackgroundIsPrior','useCurrentSap']) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw new VerificationStoreError('invalid_verification_selection', 400);
  for (const key of ['caseId','configurationId','retryOf']) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key] || (input[key] as string).length > 200)) throw new VerificationStoreError('invalid_verification_selection', 400);
  if (input.caseRevision !== undefined && (!Number.isSafeInteger(input.caseRevision) || (input.caseRevision as number) < 1)) throw new VerificationStoreError('invalid_verification_selection', 400);
  if (input.requirementContext !== undefined) {
    const value = input.requirementContext as Record<string, unknown>;
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !['instanceId','version'].includes(key)) || typeof value.instanceId !== 'string' || value.version !== undefined && typeof value.version !== 'string') throw new VerificationStoreError('invalid_requirement_context', 400);
  }
  // Rebuild a stable key order for replay identity; Host resolves all paths and configuration itself.
  const selection: Record<string, unknown> = {};
  for (const key of [...allowed]) if (input[key] !== undefined) selection[key] = input[key];
  return selection as VerificationSelection;
}
