import path from 'node:path';
import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, open, realpath } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createProtectedExecutionScope } from '../agent/protected-tools.ts';
import type { BrowserUIRequest } from '../agent/project-runtime.ts';
import { createAutomaticVerificationStore, normalizeAutomaticSettings, AutomaticVerificationStoreError } from './automatic-verification-store.ts';
import type { AutomaticOwner, AutomaticChainOwner, AutomaticSettingsInput, AutomaticObservation, AutomaticNativeIdentity, AutomaticConfiguration, AutomaticChain, AutomaticReason, AutomaticStep, AutomaticPhase, AutomaticVersion, AutomaticMaterial } from './automatic-verification-types.ts';
import type { AgentSessionDomain, SessionContext, SessionExecutionPlan, SessionLease, SessionResult, SessionRun } from './agent-sessions.ts';
import type { ProjectStore, ProjectRecord, TaskRecord } from './project-store.ts';
import { ProjectStoreFault } from './project-store.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import type { createVerificationFeature } from './verification-host.ts';
import type { VerificationSelection } from './verification-sessions.ts';
import { authorContext } from './verification-context.ts';
import { automaticAuthorContext, automaticRecheckContext } from './automatic-verification-context.ts';
import { runtimeDiagnostic } from '../agent/run-diagnostics.ts';
import { readManagedExecutionHistory } from './managed-execution-history.ts';

type Owner = { project: ProjectRecord; task: TaskRecord };
type Verification = ReturnType<typeof createVerificationFeature>;
type UIItem = { domain: 'project-tasks' | 'independent-verification'; verificationId?: string; request: BrowserUIRequest };
const digest = (b: Uint8Array | string) => createHash('sha256').update(b).digest('hex');
const now = () => new Date().toISOString();
const active = (chain: AutomaticChain) => ['preparing', 'running'].includes(chain.state);
const fail = (code: string, status = 409): never => { throw new AutomaticVerificationStoreError(code, status); };
const publicConfiguration = (c: Pick<RuntimeModelConfiguration, 'id' | 'revision' | 'provider' | 'model' | 'name' | 'thinkingLevel'>): AutomaticConfiguration => ({ id: c.id, revision: c.revision, provider: c.provider, model: c.model, name: c.name, ...(c.thinkingLevel ? { thinkingLevel: c.thinkingLevel } : {}) });

/** Shared project files cannot be attributed to this request while another
 * known request overlaps its window. This is deliberately conservative and
 * does not inspect code or infer whether that Agent intended to write. */
function hasProjectConcurrency(project: ProjectRecord, taskId: string, observation: AutomaticObservation) {
  const start = Date.parse(observation.admittedAt);
  const selected = new Set([observation.settingsSnapshot.reportPath, ...observation.settingsSnapshot.dataFiles, ...observation.settingsSnapshot.processFiles]);
  return project.tasks.some(task => task.id !== taskId && task.lastRun && (task.lastRun.status === 'running'
    || Date.parse(task.lastRun.startedAt) >= start || task.lastRun.settledAt !== undefined && Date.parse(task.lastRun.settledAt) >= start))
    || project.uploads.some(file => selected.has(file.path) && Date.parse(file.uploadedAt) >= start);
}

/** This adapter schedules authorized material handoffs. It does not interpret
 * verifier prose, calculate business values, or choose either Agent's methods. */
export function createAutomaticVerificationFeature(options: {
  dataRoot: string; projects: ProjectStore; verification: Verification; sessions: AgentSessionDomain<Owner>;
  pair(projectId: string, taskId: string, writable?: boolean): Promise<Owner>;
  configuration(id?: string, revision?: number): Readonly<RuntimeModelConfiguration> | undefined;
  selectedConfiguration(id: string): Readonly<RuntimeModelConfiguration>;
  ordinaryReadRoots?(): readonly string[];
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  settle(owner: Owner, context: SessionContext<Owner>, requestId: string, startedAt: string, result?: Record<string, any>): Promise<void>;
  notify(owner: AutomaticOwner, text: string): void;
}) {
  const store = createAutomaticVerificationStore({ dataRoot: options.dataRoot });
  const verification = options.verification.automatic;
  let unavailable = false;
  const assertAvailable = () => { if (unavailable) fail('automatic_storage_unavailable', 503); };
  async function executionHistory(owner: Owner) {
    const state = options.sessions.executionState(options.sessions.ref(owner));
    const readObservation = (requestId: string) => store.readObservation({ projectId: owner.project.id, taskId: owner.task.id }, requestId).catch(() => undefined);
    const admission = owner.task.lastRun ? await readObservation(owner.task.lastRun.id) : undefined;
    const history = await readManagedExecutionHistory({ projectId: owner.project.id, taskId: owner.task.id,
      sessionDirectory: owner.task.sessionDirectory, sessionFile: owner.task.sessionFile, cwd: path.join(owner.project.rootPath, '020_clean'),
      trustedOwner: state.freshRegistered && !state.unmanagedSeen,
      allowFresh: !owner.task.sessionFile && (!owner.task.lastRun || Boolean(admission && !admission.native)), readObservation });
    return { state, history };
  }
  async function hasUnprovenProjectWriter(owner: Owner) {
    return owner.project.tasks.some(task => {
      if (task.id === owner.task.id) return false;
      const state = options.sessions.executionState(options.sessions.ref({ project: owner.project, task }));
      return !state.freshRegistered || state.unmanagedSeen || state.mode === 'unmanaged' || state.mode === 'unknown';
    }) || await verification.hasUnprovenProjectWriter(owner.project.id);
  }
  async function capabilities(id: AutomaticOwner) {
    let toolProtectionAvailable = process.platform === 'darwin';
    if (toolProtectionAvailable) try { await access('/usr/bin/sandbox-exec', constants.X_OK); } catch { toolProtectionAvailable = false; }
    if (!toolProtectionAvailable) return { supported: false, reason: '当前系统没有所需的原件保护执行能力，自动核算与修订暂不可用。' };
    const owner = await options.pair(id.projectId, id.taskId), { state, history } = await executionHistory(owner), projectWriterUnproven = await hasUnprovenProjectWriter(owner);
    const supported = !projectWriterUnproven && !state.unmanagedSeen && state.mode !== 'unmanaged' && state.mode !== 'unknown' && (history.state === 'fresh' || history.state === 'closed'
      || history.state === 'open' && history.active?.profile === state.mode);
    return { supported, ...(!supported ? { reason: projectWriterUnproven
      ? '本项目含旧的、未托管或收尾待核定的执行资源，暂不能自动交接；原项目和会话保留，可继续普通分析。只有相关资源归属已核定的新受信项目与任务才能先设置自动核算。'
      : '此任务缺少本次Host创建起点或受管执行的完整收尾证明；请保留原会话，关闭自动核算后可继续普通分析。新受信项目中尚未运行的任务可先设置自动核算。' } : {}) };
  }
  async function ordinaryExecution(owner: Owner, execution?: SessionExecutionPlan) {
    if (execution?.protectedExecution) return undefined;
    const id = { projectId: owner.project.id, taskId: owner.task.id }, settings = await store.readSettings(id);
    if (!settings.enabled) return undefined;
    if (!(await capabilities(id)).supported) fail('automatic_unmanaged_history');
    const home = await realpath(store.taskDirectory(id));
    const allocation = await mkdtemp(path.join(home, 'managed-ordinary-'));
    const work = path.join(allocation, 'work'), skills = path.join(allocation, 'skills');
    await mkdir(work, { mode: 0o700 }); await mkdir(skills, { mode: 0o700 });
    return createProtectedExecutionScope({ id: `ordinary-${randomUUID()}`, profile: 'ordinary', cwd: path.join(owner.project.rootPath, '020_clean'), writableRoot: work, skillRoot: skills,
      writeRoots: ['020_clean', '060_reports'].map(name => path.join(owner.project.rootPath, name)),
      readRoots: [...['010_draw', '020_clean', '060_reports'].map(name => path.join(owner.project.rootPath, name)), ...(options.ordinaryReadRoots?.() ?? [])] });
  }
  async function observe(owner: AutomaticOwner, relativePath: string) {
    try { const v = await options.projects.observeFile(owner.projectId, relativePath); return { exists: true as const, sha256: v.sha256, bytes: v.bytes }; }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof ProjectStoreFault && error.code === 'file_not_found') return { exists: false as const }; throw error; }
  }
  async function native(owner: Owner): Promise<AutomaticNativeIdentity | undefined> {
    const file = owner.task.sessionFile;
    if (!file) return undefined;
    const relative = path.relative(owner.task.sessionDirectory, file);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return fail('automatic_native_changed');
    const a = await lstat(file);
    if (!a.isFile() || a.isSymbolicLink() || a.nlink !== 1) return fail('automatic_native_changed');
    const fd = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const b = await fd.stat(), bytes = await fd.readFile(), c = await fd.stat(), d = await lstat(file);
      if (a.dev !== b.dev || a.ino !== b.ino || b.size !== c.size || b.mtimeMs !== c.mtimeMs || d.ino !== c.ino || d.dev !== c.dev || d.isSymbolicLink() || d.nlink !== 1 || !bytes.length || bytes.at(-1) !== 10) fail('automatic_native_changed');
      const header = JSON.parse(bytes.subarray(0, bytes.indexOf(10)).toString('utf8'));
      if (header.type !== 'session' || header.version !== 3 || typeof header.id !== 'string' || header.cwd !== path.join(owner.project.rootPath, '020_clean')) fail('automatic_native_changed');
      return { sessionFile: file, sessionId: header.id, bytes: bytes.length, sha256: digest(bytes) };
    } finally { await fd.close(); }
  }
  function configurationFor(owner: Owner, selectedId?: string) {
    const saved = selectedId ? options.selectedConfiguration(selectedId) : owner.task.configuration;
    const c = options.configuration(saved.id, saved.revision);
    if (!c) return fail('configuration_required');
    return c;
  }
  async function saveSettings(owner: AutomaticOwner, input: AutomaticSettingsInput, expectedRevision: number) {
    assertAvailable(); const original = await options.pair(owner.projectId, owner.taskId, true);
    const previous = await store.readSettings(owner), selection = normalizeAutomaticSettings(input, previous);
    if (selection.enabled) {
      configurationFor(original, selection.configurationId);
      for (const file of [...selection.dataFiles, ...selection.processFiles]) if (!(await observe(owner, file)).exists) fail('automatic_source_missing', 404);
      if (!(await capabilities(owner)).supported) fail('automatic_unmanaged_history');
    }
    // The CAS still happens after observations, never before failed validation.
    const result = await store.saveSettings(owner, input, expectedRevision);
    // A settings edit only revokes an admitted automatic chain. It must not
    // cancel the user's ordinary analysis before that chain has even started.
    const chains = (await store.listChains(owner)).filter(active);
    const matching = chains.filter(chain => original.task.lastRun && [chain.requestId, ...chain.steps.filter(step => step.phase === 'author').map(step => step.requestId)].includes(original.task.lastRun.id));
    for (const chain of matching) await store.updateChain(chain, { reason: 'settings_changed' });
    try {
      if (matching.length && options.sessions.busy(options.sessions.ref(original))) await options.sessions.stop(options.sessions.ref(original));
      for (const chain of matching) if (active(await store.readChain(chain))) await store.updateChain(chain, { state: 'paused', phase: 'ended', reason: 'settings_changed' });
    } catch (error) {
      for (const chain of matching) if (active(await store.readChain(chain))) await store.updateChain(chain, { state: 'unknown', phase: 'ended', reason: 'request_unknown' });
      throw error;
    }
    return result;
  }
  async function admit(owner: Owner, requestId: string, requestFingerprint: string): Promise<AutomaticObservation | undefined> {
    if (unavailable) return undefined;
    const id = { projectId: owner.project.id, taskId: owner.task.id }, settings = await store.readSettings(id);
    if (!settings.enabled) return undefined;
    if (!(await capabilities(id)).supported) fail('automatic_unmanaged_history');
    const c = configurationFor(owner), vc = configurationFor(owner, settings.configurationId), existing = await native(owner);
    return store.saveObservation({ ...id, requestId, requestFingerprint, settingsSnapshot: settings,
      ...(existing ? { native: existing } : {}), configuration: publicConfiguration(c), verificationConfiguration: publicConfiguration(vc),
      before: await observe(id, settings.reportPath!), reason: 'none' });
  }
  async function makeScope(owner: AutomaticChainOwner, label: string, readRoots: string[]) {
    const root = await store.prepareWorkDirectory(owner, label), cwd = path.join(root, 'work');
    await mkdir(cwd, { mode: 0o700 });
    const skillRoot = await store.prepareWorkDirectory(owner, `skills-${label}`);
    return createProtectedExecutionScope({ id: `${owner.chainId}-${label}`, cwd, writableRoot: root, readRoots, skillRoot });
  }
  async function complete(owner: Owner, lease: SessionLease<Owner>, observation: AutomaticObservation | undefined, initial: SessionResult) {
    let last = { requestId: observation?.requestId ?? '', result: initial };
    if (!observation || initial.outcome !== 'completed') return last;
    const id: AutomaticOwner = { projectId: owner.project.id, taskId: owner.task.id }, ref = options.sessions.ref(owner);
    let chainOwner: AutomaticChainOwner | undefined;
    let fixed: Awaited<ReturnType<typeof verification.store.read>> | undefined;
    const ensureParent = () => { if (!options.sessions.owns(ref, lease.context)) fail('automatic_cancelled'); };
    const patch = async (value: Parameters<typeof store.updateChain>[1]) => store.updateChain(chainOwner!, value);
    const finish = async (state: 'paused' | 'completed' | 'cancelled' | 'failed' | 'unknown', reason: AutomaticReason) => {
      if (!chainOwner) return;
      const current = await store.readChain(chainOwner); if (active(current)) await patch({ state, phase: 'ended', reason });
    };
    async function assertFixed() {
      ensureParent();
      const current = await options.pair(id.projectId, id.taskId, true), chain = await store.readChain(chainOwner!);
      if (!active(chain)) fail('automatic_cancelled');
      if (hasProjectConcurrency(current.project, id.taskId, observation!) || await hasUnprovenProjectWriter(current)) fail('automatic_project_concurrency');
      const settings = await store.readSettings(id);
      if (!settings.enabled || settings.revision !== chain.settingsSnapshot.revision) fail('automatic_settings_changed');
      const n = await native(current);
      if (!n || n.sessionId !== chain.native.sessionId || n.sessionFile !== chain.native.sessionFile || n.bytes < chain.native.bytes) return fail('automatic_native_changed');
      const fd = await open(n.sessionFile, constants.O_RDONLY | constants.O_NOFOLLOW);
      try { const prefix = Buffer.alloc(chain.native.bytes); const read = await fd.read(prefix, 0, prefix.length, 0); if (read.bytesRead !== prefix.length || digest(prefix) !== chain.native.sha256) fail('automatic_native_changed'); } finally { await fd.close(); }
      for (const c of [chain.configuration, chain.verificationConfiguration]) if (!options.configuration(c.id, c.revision)) fail('configuration_changed');
      if (fixed) { await verification.assertInputs(fixed); await verification.store.verifyWorkspaceInputs(fixed); }
      for (const v of chain.versions) {
        const observed = await observe(id, v.relativePath);
        if (!observed.exists || observed.sha256 !== v.sha256) fail('verification_source_changed');
        await store.readMaterial(chainOwner!, v);
      }
    }
    try {
      // No material is observed or frozen until the ordinary managed scope's
      // actual close acknowledgement proves its background writers ended.
      ensureParent(); await lease.quiesce(); ensureParent();
      const safeHistory = await executionHistory(await options.pair(id.projectId, id.taskId));
      if (safeHistory.history.state !== 'closed') fail('automatic_unmanaged_history');
      const settings = await store.readSettings(id), after = await observe(id, observation.settingsSnapshot.reportPath!), observedAt = now();
      let reason: AutomaticReason = settings.revision !== observation.settingsSnapshot.revision || !settings.enabled ? 'settings_changed'
        : !after.exists ? 'report_missing' : observation.before.exists && observation.before.sha256 === after.sha256 ? 'report_unchanged' : 'none';
      const fresh = await options.pair(id.projectId, id.taskId, true), n = await native(fresh);
      if (reason === 'none' && (hasProjectConcurrency(fresh.project, id.taskId, observation) || await hasUnprovenProjectWriter(fresh))) reason = 'external_change';
      if (reason === 'none' && !(await capabilities(id)).supported) reason = 'unsupported_protection';
      if (reason === 'none' && (!n || observation.native && n && (n.sessionId !== observation.native.sessionId || n.sessionFile !== observation.native.sessionFile))) reason = 'session_changed';
      const admission = { ...observation, after, observedAt, ...(n ? { completedNative: n } : {}) };
      if (reason !== 'none') { await store.saveObservation({ ...admission, reason }); return last; }
      if (!n) fail('automatic_native_changed');
      const vc = observation.verificationConfiguration ?? publicConfiguration(configurationFor(fresh, settings.configurationId));
      if (!options.configuration(vc.id, vc.revision)) { await store.saveObservation({ ...admission, reason: 'configuration_changed' }); return last; }
      ensureParent();
      const selection: VerificationSelection = { verificationId: randomUUID(), question: settings.question!, dataFiles: settings.dataFiles,
        authorFiles: [settings.reportPath!, ...settings.processFiles],
        ...(settings.businessContext === undefined ? {} : { businessContext: settings.businessContext }),
        ...(settings.requirementContext ? { requirementContext: settings.requirementContext } : {}),
        ...(settings.useCurrentSap ? { useCurrentSap: true } : {}),
        ...(settings.caseId ? { caseId: settings.caseId, caseRevision: settings.caseRevision, caseBackgroundIsPrior: settings.caseBackgroundIsPrior } : {}),
        ...(settings.configurationId ? { configurationId: settings.configurationId } : {}) };
      const prepared = await options.mutate(() => verification.prepare(id.projectId, id.taskId, selection, lease.context));
      fixed = prepared.record;
      if (fixed.configuration.id !== vc.id || fixed.configuration.revision !== vc.revision) fail('configuration_changed');
      const created = await store.createChain({ ...id, requestId: observation.requestId, requestFingerprint: observation.requestFingerprint,
        reportSha256: after.exists ? after.sha256 : fail('automatic_report_missing'), settingsSnapshot: observation.settingsSnapshot,
        native: n!, configuration: observation.configuration, verificationConfiguration: vc, semantics: fixed.semantics,
        firstVerification: { verificationId: fixed.verificationId } });
      chainOwner = { ...id, chainId: created.chain.chainId };
      await store.saveObservation({ ...admission, reason: 'none', chainId: chainOwner.chainId });
      if (!created.created) return last;
      const materials: AutomaticMaterial[] = [];
      for (const [i, file] of (await verification.store.readDataFiles(fixed)).entries()) materials.push(await store.fixMaterial(chainOwner, { key: `data-${i}`, kind: 'data', relativePath: file.relativePath, bytes: file.bytes, sha256: file.sha256 }));
      // Author copies are not exposed to a cold tool scope or request.
      const authorInput = await options.projects.readFile(id.projectId, settings.reportPath!);
      const report = await store.fixMaterial(chainOwner, { key: 'report-1', kind: 'report', relativePath: settings.reportPath!, bytes: authorInput.bytes, sha256: after.exists ? after.sha256 : undefined });
      materials.push(report);
      const version: AutomaticVersion = { relativePath: report.relativePath, snapshotPath: report.snapshotPath, bytes: report.bytes, sha256: report.sha256, observedAt: report.observedAt, version: 1, requestId: observation.requestId };
      await patch({ materials, versions: [version] });
      if (!(await capabilities(id)).supported) { await finish('paused', 'unsupported_protection'); return last; }
      const unsubscribeParent = lease.onCancel(async cleanup => { if (fixed) await verification.close(fixed, cleanup); });
      let childCleanupFailed = false;
      try {
        await verification.withSession(fixed, async verifier => {
          const events = await open(path.join(verification.store.recordDirectory(fixed!), 'events.jsonl'), 'wx', 0o600);
          let writes = Promise.resolve();
          const unsubscribe = verifier.subscribe(event => { writes = writes.then(() => events.writeFile(JSON.stringify(event) + '\n')).then(() => {}); });
          try {
            async function step(phase: Exclude<AutomaticPhase, 'prepare' | 'ended'>, text: string, run: (requestId: string) => SessionRun<any>, onResult?: (result: SessionResult, requestId: string) => Promise<void>) {
              await assertFixed();
              let chain = await store.readChain(chainOwner!);
              const requestId = randomUUID(), item: AutomaticStep = { stepId: randomUUID(), requestId, phase, ordinal: chain.steps.length + 1,
                domain: phase === 'author' ? 'project-tasks' : 'independent-verification',
                owner: { ...id, ...(phase === 'author' ? {} : { verificationId: fixed!.verificationId }) },
                inputSha256: chain.versions.at(-1)!.sha256, status: 'planned', plannedAt: now() };
              await patch({ state: 'running', phase, steps: [...chain.steps, item] });
              const startAt = now();
              if (phase === 'author') await options.mutate(async () => { ensureParent(); await options.projects.markRun(id.projectId, id.taskId, { id: requestId, status: 'running', startedAt: startAt }); });
              const request = run(requestId);
              let actual: SessionResult | undefined;
              try {
                await request.accepted;
                await store.recordStepFacts(chainOwner!, requestId, { status: 'accepted', acceptedAt: now() });
                if (phase !== 'author') {
                  const snapshot = (await verifier.read()).snapshot;
                  if (snapshot?.sessionFile) await verification.store.update(fixed!, { native: { requestId, sessionFile: snapshot.sessionFile } });
                }
                const result = actual = await request.completion;
                if (phase === 'author') { last = { requestId, result }; await options.settle(fresh, request.context, requestId, startAt, result); }
                await store.recordStepFacts(chainOwner!, requestId, { status: result.outcome, settledAt: now(), ...(result.sessionFile ? { sessionFile: result.sessionFile } : {}) });
                if (phase === 'author' || phase === 'recheck') {
                  const resultRef = await store.saveResult(chainOwner!, { requestId, text: result.text });
                  await store.recordStepFacts(chainOwner!, requestId, { result: resultRef });
                }
                if (result.outcome === 'completed') { await assertFixed(); await onResult?.(result, requestId); }
                if (result.outcome !== 'completed') fail(result.outcome === 'cancelled' ? 'automatic_cancelled' : 'automatic_runtime_failed');
                await writes;
                return { result, requestId };
              } catch (error) {
                if (phase === 'author' && !actual) {
                  last = { requestId, result: { outcome: 'failed', text: '', diagnostic: runtimeDiagnostic(error) } };
                  await options.settle(fresh, request.context, requestId, startAt).catch(() => {});
                }
                if (!actual) await store.recordStepFacts(chainOwner!, requestId, { status: 'unknown', settledAt: now() }).catch(() => {});
                throw error;
              }
            }
            const inputs = path.join(fixed!.workspace, 'inputs');
            const coldScope = await makeScope(chainOwner!, 'cold', [inputs]);
            await verification.store.update(fixed!, { state: 'running', phase: 'cold' });
            await verifier.reopen({ protectedExecution: coldScope });
            const cold = await step('cold', `独立核算任务：${fixed!.question}\n本轮只提供固定源数据和事前语义，作者稿尚未开放。固定资料只读位置：${inputs}；新计算工作区：${coldScope.cwd}。请自主决定方法、工具及查证，条件不足可以保留未知。`,
              requestId => verifier.lease.start({ requestId, text: `独立核算任务：${fixed!.question}\n固定资料只读位置：${inputs}；本轮未提供作者答案。工具当前工作区：${coldScope.cwd}。工具、计算、验证和自修复由你自主安排，条件不足可保留未知。` }),
              async (result, requestId) => { await verification.store.saveColdResult(fixed!, { text: result.text, requestId, sessionFile: result.sessionFile }); });
            const latest = await verification.store.read(fixed!);
            await store.recordStepFacts(chainOwner!, cold.requestId, { verificationRef: { verificationId: fixed!.verificationId, phase: 'cold', requestId: cold.requestId, sha256: latest.coldResult!.sha256 } });
            await assertFixed(); await verification.store.revealAuthor(fixed!);
            const compareScope = await makeScope(chainOwner!, 'compare', [inputs, path.join(fixed!.workspace, 'author'), coldScope.writableRoot]);
            await verifier.reopen({ protectedExecution: compareScope });
            const compareText = authorContext(await verification.store.readAuthorFiles(fixed!), fixed!.workspace, { automaticFeedback: true });
            const compared = await step('compare', compareText, requestId => verifier.lease.start({ requestId, text: compareText }),
              async (result, requestId) => { await verification.store.saveComparisonResult(fixed!, { text: result.text, requestId, sessionFile: result.sessionFile }); await verification.store.update(fixed!, { state: 'completed' }); });
            await verifier.lease.quiesce(); await assertFixed();
            const initialRecord = await verification.store.read(fixed!);
            await store.recordStepFacts(chainOwner!, compared.requestId, { verificationRef: { verificationId: fixed!.verificationId, phase: 'compare', requestId: compared.requestId, sha256: initialRecord.comparisonResult!.sha256 } });
            let chain = await store.readChain(chainOwner!);
            await patch({ firstVerification: { verificationId: fixed!.verificationId, coldRequestId: cold.requestId, compareRequestId: compared.requestId } });
            let opinion = { text: initialRecord.comparisonResult!.text, file: initialRecord.comparisonResult!.file, sha256: initialRecord.comparisonResult!.sha256 };
            const coldResult = { text: initialRecord.coldResult!.text, file: initialRecord.coldResult!.file, sha256: initialRecord.coldResult!.sha256 };
            for (let ordinal = 1; ordinal <= chain.settingsSnapshot.maxAuthorTurns; ordinal++) {
              await assertFixed(); chain = await store.readChain(chainOwner!);
              const lastVersion = chain.versions.at(-1)!, authorScope = await makeScope(chainOwner!, `author-${ordinal}`, [
                ...['010_draw', '020_clean', '060_reports'].map(directory => path.join(fresh.project.rootPath, directory)),
                path.join(store.chainDirectory(chainOwner!), 'fixed'), path.dirname(coldResult.file), coldScope.writableRoot, compareScope.writableRoot,
                ...(ordinal > 1 ? [path.join(store.chainDirectory(chainOwner!), 'results')] : []),
              ].filter(Boolean));
              // Results may not exist until the first author response.
              await lease.reopen(options.sessions.execution(ref, { protectedExecution: authorScope }));
              const outputPath = path.join(authorScope.cwd, 'report.md');
              const feedback = automaticAuthorContext({ question: settings.question!,
                report: { version: lastVersion.version, path: lastVersion.relativePath, fixedPath: store.materialPath(chainOwner!, lastVersion), sha256: lastVersion.sha256 },
                authorTurn: { number: ordinal, limit: chain.settingsSnapshot.maxAuthorTurns },
                coldResult, opinion, output: { reportPath: outputPath } });
              const author = await step('author', feedback, requestId => lease.start({ requestId, text: feedback }));
              await lease.quiesce();
              await assertFixed();
              let content: Buffer;
              try {
                const resolved = await realpath(outputPath), relative = path.relative(authorScope.writableRoot, resolved);
                if (resolved !== outputPath || relative.startsWith('..') || path.isAbsolute(relative)) fail('automatic_output_changed');
                const entry = await lstat(outputPath); if (entry.isSymbolicLink() || !entry.isFile() || entry.nlink !== 1) fail('automatic_output_changed');
                const fd = await open(outputPath, constants.O_RDONLY | constants.O_NOFOLLOW);
                try { const before = await fd.stat(); content = await fd.readFile(); const after = await fd.stat(); if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) fail('automatic_output_changed'); } finally { await fd.close(); }
              } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') { await finish('completed', 'no_new_report'); return; } throw error; }
              if (digest(content) === lastVersion.sha256) { await finish('completed', 'same_content'); return; }
              const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content);
              if (!text.trim()) fail('automatic_output_changed');
              const name = `automatic-${chainOwner!.chainId.slice(0, 16)}-revision-${ordinal}.md`;
              if ((await observe(id, `060_reports/${name}`)).exists) fail('automatic_output_changed');
              const saved = await options.mutate(async () => { await assertFixed(); return options.projects.saveReport(id.projectId, name, text); });
              const material = await store.fixMaterial(chainOwner!, { key: `report-${ordinal + 1}`, kind: 'report', relativePath: saved.path, bytes: content });
              chain = await store.readChain(chainOwner!);
              const nextVersion: AutomaticVersion = { relativePath: material.relativePath, snapshotPath: material.snapshotPath, bytes: material.bytes, sha256: material.sha256, observedAt: material.observedAt, version: chain.versions.length + 1, requestId: author.requestId };
              await patch({ versions: [...chain.versions, nextVersion], materials: [...chain.materials, material] });
              const recheckScope = await makeScope(chainOwner!, `recheck-${ordinal}`, [inputs, path.join(fixed!.workspace, 'author'), path.join(store.chainDirectory(chainOwner!), 'fixed'), compareScope.writableRoot, authorScope.writableRoot]);
              await verifier.reopen({ protectedExecution: recheckScope });
              const recheckText = automaticRecheckContext({ version: nextVersion.version, sha256: nextVersion.sha256,
                fixedPath: store.materialPath(chainOwner!, nextVersion), processPath: authorScope.cwd, text });
              const checked = await step('recheck', recheckText, requestId => verifier.lease.start({ requestId, text: recheckText }));
              await verifier.lease.quiesce(); await assertFixed();
              chain = await store.readChain(chainOwner!);
              const versions = chain.versions.map(v => v.version === nextVersion.version ? { ...v, recheckRequestId: checked.requestId } : v);
              await patch({ versions });
              const result = (await store.readChain(chainOwner!)).steps.at(-1)!.result!;
              opinion = { text: checked.result.text, file: path.join(store.chainDirectory(chainOwner!), result.file), sha256: result.sha256 };
              if (ordinal === settings.maxAuthorTurns) { await finish('completed', 'limit_reached'); return; }
            }
          } finally { unsubscribe(); await writes.catch(() => {}); await events.close(); }
        });
      } finally {
        try { await verification.close(fixed, { retryFailed: false }); }
        catch (cause) { childCleanupFailed = true; const error = new Error('automatic_child_cleanup_unknown', { cause }); Object.assign(error, { code: 'automatic_child_cleanup_unknown' }); throw error; }
        finally { if (!childCleanupFailed) unsubscribeParent(); }
      }
    } catch (error) {
      const code = (error as { code?: string }).code ?? '';
      const reason: AutomaticReason = code === 'automatic_cancelled' || code === 'generation_cancelled' ? 'user_stopped'
        : code.includes('cleanup_unknown') ? 'request_unknown'
        : code === 'automatic_project_concurrency' ? 'external_change'
        : code.includes('settings') ? 'settings_changed' : code.includes('semantics') ? 'semantics_changed'
        : code.includes('configuration') ? 'configuration_changed' : code.includes('native') ? 'session_changed'
        : code.includes('source') || code.includes('input') || code.includes('snapshot') ? 'source_changed'
        : code.includes('protected') || code.includes('protection') || code.includes('unmanaged') ? 'unsupported_protection' : code.includes('persistence') ? 'persistence_failed' : 'request_unknown';
      // Revoked dispatch is not a cleanup acknowledgement. The public stop or
      // the outer withSession completion records cancellation only after that
      // same lifecycle has confirmed resource retirement.
      if (reason === 'user_stopped') last = { ...last, result: { ...last.result, automaticCancellation: true } };
      else await finish(['source_changed', 'semantics_changed', 'settings_changed', 'configuration_changed', 'session_changed', 'unsupported_protection', 'external_change'].includes(reason) ? 'paused' : 'unknown', reason).catch(() => {});
      if (!chainOwner) await store.saveObservation({ ...observation, reason }).catch(() => {});
      if (fixed) { const r = await verification.store.read(fixed).catch(() => undefined); if (r && ['preparing', 'ready', 'running'].includes(r.state)) await verification.store.update(fixed, { state: reason === 'user_stopped' ? 'cancelled' : 'unknown' }).catch(() => {}); }
      options.notify(id, '自动核算或返修未继续派发；请查看原记录、材料变化或收尾待确认说明，未自动重发。');
      // A failed child cleanup must reach the shared parent lease. Its retained
      // cancellation hook then quarantines both owners instead of freeing only
      // the parent while the verifier may still be alive.
      if (code === 'automatic_child_cleanup_unknown') throw error;
    }
    return last;
  }
  async function readChain(owner: AutomaticChainOwner) {
    assertAvailable(); const pair = await options.pair(owner.projectId, owner.taskId), chain = await store.readChain(owner);
    const steps = await Promise.all(chain.steps.map(async step => step.result ? { ...step, result: { ...step.result, text: await store.readResult(owner, step.result) } } : step));
    const uiRequests: UIItem[] = [];
    if (active(chain)) {
      if (chain.phase === 'author') for (const event of (await options.sessions.read(options.sessions.ref(pair))).pendingUI) uiRequests.push({ domain: 'project-tasks', request: event.request });
      else if (chain.firstVerification) for (const request of await verification.ui({ projectId: owner.projectId, taskId: owner.taskId, verificationId: chain.firstVerification.verificationId })) uiRequests.push({ domain: 'independent-verification', verificationId: chain.firstVerification.verificationId, request });
    }
    const runtime = options.sessions.executionState(options.sessions.ref(pair));
    const sameRequest = Boolean(pair.task.lastRun && [chain.requestId, ...chain.steps.filter(step => step.phase === 'author').map(step => step.requestId)].includes(pair.task.lastRun.id));
    const trusted = sameRequest && runtime.freshRegistered && !runtime.unmanagedSeen;
    const cleanup = { state: trusted && !runtime.busy && runtime.mode === 'none' ? 'confirmed' as const : runtime.mode === 'unknown' || !trusted ? 'unknown' as const : 'pending' as const,
      retryable: trusted && (runtime.busy || runtime.mode === 'unknown' || runtime.mode === 'ordinary' || runtime.mode === 'protected') };
    return { ...chain, steps, uiRequests, cleanup };
  }
  /** Called only after the original public withSession promise has settled. */
  async function operationFinished(owner: AutomaticOwner, requestId: string, result?: SessionResult, error?: unknown) {
    const cancelled = result?.automaticCancellation === true || ['automatic_cancelled', 'generation_cancelled'].includes((error as { code?: string } | undefined)?.code ?? '');
    if (!cancelled && !error) return;
    const pair = await options.pair(owner.projectId, owner.taskId), runtime = options.sessions.executionState(options.sessions.ref(pair));
    const confirmed = !runtime.busy && runtime.mode === 'none' && runtime.freshRegistered && !runtime.unmanagedSeen;
    for (const chain of await store.listChains(owner)) if (chain.requestId === requestId && active(chain)) {
      const settingsChanged = chain.reason === 'settings_changed';
      await store.updateChain(chain, { state: cancelled && confirmed ? settingsChanged ? 'paused' : 'cancelled' : 'unknown', phase: 'ended', reason: cancelled && confirmed ? settingsChanged ? 'settings_changed' : 'user_stopped' : 'request_unknown' });
    }
  }
  async function readFixedReport(owner: AutomaticChainOwner, version: number) {
    assertAvailable(); await options.pair(owner.projectId, owner.taskId);
    if (!Number.isSafeInteger(version) || version < 1) fail('invalid_automatic_version', 400);
    const chain = await store.readChain(owner), report = chain.versions.find(item => item.version === version);
    if (!report) fail('automatic_version_not_found', 404);
    const content = await store.readMaterial(owner, report!);
    let text: string | undefined;
    try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content); } catch { /* Original bytes remain available for non-text reports. */ }
    return { version, relativePath: report!.relativePath, sha256: report!.sha256, bytes: content.length,
      contentBase64: content.toString('base64'), textStatus: text === undefined ? 'not-utf8' as const : 'utf8' as const, ...(text === undefined ? {} : { text }) };
  }
  async function stop(owner: AutomaticChainOwner) {
    assertAvailable(); const pair = await options.pair(owner.projectId, owner.taskId, true), chain = await store.readChain(owner);
    const observed = await readChain(owner);
    if (!active(chain) && chain.state !== 'unknown' && chain.state !== 'cancelled') return observed;
    if (!active(chain) && observed.cleanup.state === 'confirmed') return observed;
    const requestIds = [chain.requestId, ...chain.steps.filter(s => s.phase === 'author').map(s => s.requestId)];
    if (!pair.task.lastRun || !requestIds.includes(pair.task.lastRun.id)) fail('automatic_owner_changed');
    if (!active(chain) && !observed.cleanup.retryable) fail('automatic_cleanup_unproven');
    try {
      // Public cancellation revokes dispatch before its first await. UNKNOWN
      // retries use explicit close; neither route authorizes another turn.
      if (active(chain)) await options.sessions.stop(options.sessions.ref(pair));
      else await options.sessions.close(options.sessions.ref(pair));
      const runtime = options.sessions.executionState(options.sessions.ref(pair));
      if (runtime.mode === 'unknown' || !runtime.freshRegistered || runtime.unmanagedSeen) fail('automatic_cleanup_unknown');
      const current = await store.readChain(owner);
      if (active(current)) await store.updateChain(owner, { state: 'cancelled', phase: 'ended', reason: 'user_stopped' });
      return { ...await readChain(owner), cleanup: { state: 'confirmed' as const, retryable: false } };
    } catch (error) {
      const current = await store.readChain(owner);
      if (active(current)) await store.updateChain(owner, { state: 'unknown', phase: 'ended', reason: 'request_unknown' });
      throw error;
    }
  }
  async function respondUI(owner: AutomaticChainOwner, input: { domain: string; verificationId?: string; id: string; value?: string | boolean; cancelled?: boolean }) {
    const chain = await readChain(owner);
    if (!active(chain) || !chain.uiRequests.some(item => item.domain === input.domain && item.verificationId === input.verificationId && item.request.id === input.id)) fail('ui_request_expired');
    if (input.domain === 'project-tasks') { const pair = await options.pair(owner.projectId, owner.taskId, true); await options.sessions.respondUI(options.sessions.ref(pair), input); }
    else { await options.pair(owner.projectId, owner.taskId, true); await verification.respondUI({ projectId: owner.projectId, taskId: owner.taskId, verificationId: chain.firstVerification!.verificationId }, input); }
    return readChain(owner);
  }
  async function init() {
    try {
      for (const project of await options.projects.list()) for (const task of project.tasks) for (const chain of await store.listChains({ projectId: project.id, taskId: task.id })) {
        if (active(chain)) await store.updateChain(chain, { state: 'unknown', phase: 'ended', reason: 'request_unknown' });
      }
    } catch { unavailable = true; }
  }
  return { store, capabilities, ordinaryExecution, assertAvailable, saveSettings, admit, complete, operationFinished, readChain, readFixedReport, stop, respondUI, init };
}
