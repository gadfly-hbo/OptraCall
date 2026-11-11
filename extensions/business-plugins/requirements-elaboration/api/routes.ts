import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequirementStore, RequirementStoreFault, type RequirementReleaseEntry } from '../storage/store.ts';
import { computeGateReport, instanceStatus, pendingMustConfirm, type GateReport } from '../gates/checks.ts';
import { buildGenerationPrompt, frameworkReviewInstructions, normalizeElicit, normalizeHypotheses, normalizeFramework, normalizeFrameworkAssessment, parseModelJson, type GenerationCall } from '../session/prompts.ts';
import { canonicalYaml, parseInstance, isStale, upstreamFingerprint, RequirementFault, type RequirementInstance } from '../contract/validate.ts';
import { frameworkVersionPattern, type FrameworkInput, type FrameworkMaterialTarget, type FrameworkProposalRecord, type FrameworkProposalView, type FrameworkPublicSearch, type FrameworkSourceReference } from '../contract/framework-review.ts';
import { createFrameworkReview, frameworkDraftFingerprint, type RevalidateFrameworkSources } from './framework-review.ts';
import { parseSemanticQueryInput, SemanticReadFault } from '../../semantic-context/reader.ts';
import { readRunDiagnostic, type RunDiagnostic } from '../../../../src/agent/run-diagnostics.ts';

class ApiFault extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

type GenerationSession = {
  run: (text: string, requestId: string, verifyBeforeDispatch?: () => Promise<void>) => Promise<{ outcome: 'completed' | 'cancelled' | 'failed'; text: string; diagnostic?: RunDiagnostic }>;
};
type RequirementSession = GenerationSession & {
  isCurrent?: () => boolean;
  withFramework?: <T>(operationId: string, publicTopic: string | undefined, targets: readonly FrameworkMaterialTarget[], assertInput: () => void, use: (session: GenerationSession, search: FrameworkPublicSearch, references: () => readonly FrameworkSourceReference[]) => Promise<T>) => Promise<T>;
};
export type RequirementRoutesOptions = {
  storeRoot: string;
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  mutate?: <T>(operation: () => T | Promise<T>) => Promise<T>;
  revalidateFrameworkSources?: RevalidateFrameworkSources;
  sessions: {
    run: (instanceId: string, text: string, requestId: string) => Promise<{ outcome: 'completed' | 'cancelled' | 'failed'; text: string; diagnostic?: RunDiagnostic }>;
    withSession: <T,>(instanceId: string, use: (session: RequirementSession) => Promise<T>) => Promise<T>;
    stop: (instanceId: string) => Promise<boolean>;
    busy: (instanceId: string) => boolean;
  };
};

export type InstanceView = {
  id: string; title: string; scene: RequirementInstance['instance']['scene']; createdAt: string; updatedAt: string;
  status: ReturnType<typeof instanceStatus>; mustConfirmPending: number; releasedCount: number;
};
type ReleaseView = RequirementReleaseEntry & { readable?: false };
export type InstanceDetail = {
  instance: RequirementInstance; gates: GateReport; releases: readonly ReleaseView[];
  frameworkInput?: Omit<FrameworkInput, 'revision'>;
  frameworkProposal?: FrameworkProposalView;
  confirmedFramework?: { version: string; status: 'confirmed' | 'stale'; sendable: boolean };
  frameworkHistory?: readonly { version: string; confirmedAt: string }[];
  generationBusy?: true;
};

const instanceIdPattern = /^req-[a-z0-9][a-z0-9-]{0,60}$/;
const semverPattern = /^\d+\.\d+\.\d+$/;
const calls: readonly GenerationCall[] = ['elicit', 'hypotheses', 'framework'];

const storeMessage = (code: string): string => ({
  REQ_STORE_NOT_FOUND: '未找到该需求实例。',
  REQ_VERSION_CONFLICT: '该版本号已存在且内容不同，RAP 版本不可覆盖。',
  REQ_SAME_CONTENT: '内容与既有版本完全一致，已拒绝重新发版。',
  REQ_STORE_CORRUPT: '需求实例数据异常，已停止写入；请检查本地数据后重试。',
  REQ_SNAPSHOT_REQUIRED: '尚未确认正式需求：请先在 Stage 02 完成确认。',
  REQ_STALE_SNAPSHOT: '快照已失效（上游内容有修改）：请回 Stage 02 重新确认后再发布。',
  REQ_FRAMEWORK_REQUIRED: '尚未生成分析与报告框架：请先在 Stage 03 生成框架。',
  REQ_PROPOSAL_SOURCE_CHANGED: '提案版本或依据已变化。请查看当前工作稿及来源，重新生成后再确认。',
  REQ_PROPOSAL_NOT_FOUND: '未找到该版本的分析框架提案。',
  REQ_FRAMEWORK_INPUT_TOO_LARGE: '当前工作稿超过本轮模型输入上限。请缩小范围后再生成，原稿和已有提案已保留。',
}[code] ?? '需求实例操作未完成，请检查输入或本地数据后重试。');

/** Host-owned HTTP transport calls these handlers; the plugin never binds a port itself. */
export function createRequirementRoutes(options: RequirementRoutesOptions) {
  const store = createRequirementStore(options.storeRoot);
  const review = createFrameworkReview(store, options.revalidateFrameworkSources);
  const mutate = options.mutate ?? (async <T,>(operation: () => T | Promise<T>) => operation());

  const view = (instance: RequirementInstance): InstanceView => ({
    id: instance.instance.id, title: instance.instance.title, scene: instance.instance.scene,
    createdAt: instance.instance.createdAt, updatedAt: instance.instance.updatedAt,
    status: instanceStatus(instance), mustConfirmPending: pendingMustConfirm(instance),
    releasedCount: store.releases(instance.instance.id).length,
  });
  const releaseViews = (id: string): Promise<ReleaseView[]> => Promise.all(store.releases(id).map(async entry => {
    if (!entry.frameworkVersion) return entry;
    try { await review.assertReleaseReadable(id, entry.version); return entry; }
    catch (error) {
      if (!(error instanceof RequirementStoreFault)) throw error;
      return { ...entry, readable: false as const };
    }
  }));
  async function detail(instance: RequirementInstance): Promise<InstanceDetail> {
    const id = instance.instance.id, state = store.readFrameworkState(id);
    const current = state?.current ? await review.inspect(instance, store.readFrameworkProposal(id, state.current)) : undefined;
    const last = state?.confirmations.at(-1);
    const accepted = last && (last.version === current?.version ? current : await review.inspect(instance, store.readFrameworkProposal(id, last.version)));
    const displayed = accepted ? { ...instance, framework: accepted.status === 'confirmed' ? accepted.framework : undefined } : instance;
    const gates = computeGateReport(displayed);
    return {
      instance, gates, releases: await releaseViews(id),
      ...(options.sessions.busy(id) ? { generationBusy: true as const } : {}),
      ...(state ? { frameworkInput: { rapVersion: state.input.rapVersion, materialTargets: state.input.materialTargets } } : {}),
      ...(current ? { frameworkProposal: current } : {}),
      ...(accepted ? { confirmedFramework: { version: accepted.version, status: accepted.status === 'confirmed' ? 'confirmed' : 'stale', sendable: accepted.status === 'confirmed' && !isStale(instance) && !gates.publishBlocked } } : {}),
      ...(state?.confirmations.length ? { frameworkHistory: state.confirmations.map(({ version, confirmedAt }) => ({ version, confirmedAt })) } : {}),
    };
  }
  const readInstance = (id: string): RequirementInstance => {
    if (!instanceIdPattern.test(id)) throw new ApiFault(404, 'REQ_STORE_NOT_FOUND', storeMessage('REQ_STORE_NOT_FOUND'));
    return store.read(id);
  };
  const actor = (input: Record<string, unknown>): string => {
    const value = String(input.confirmedBy ?? input.releasedBy ?? input.actor ?? '').trim();
    if (!value || value.length > 200) throw new ApiFault(400, 'actor_invalid', '请填写操作人后再继续。');
    return value;
  };

  const run = async function requirementRoutes(request: IncomingMessage, url: URL): Promise<{ status: number; value: unknown } | undefined> {
    if (!url.pathname.startsWith('/api/requirement-instances')) return undefined;
    try {
      const segments = url.pathname.slice('/api/requirement-instances/'.length).split('/').filter(Boolean);
      const [id, operation, argument] = segments;
      if (!id && request.method === 'GET') return { status: 200, value: { instances: store.list().map(summary => view(store.read(summary.id))) } };
      if (!id && request.method === 'POST') {
        const input = await options.readBody(request);
        const title = String(input.title ?? '').trim(), scene = String(input.scene ?? '');
        if (!title || title.length > 200) throw new ApiFault(400, 'title_invalid', '请填写需求名称。');
        if (!['daily', 'topic', 'recurring'].includes(scene)) throw new ApiFault(400, 'scene_invalid', '场景必须是 daily / topic / recurring。');
        const instance = store.create({ title, scene: scene as 'daily' | 'topic' | 'recurring' });
        return { status: 201, value: { instance: view(instance) } };
      }
      if (id && !operation && request.method === 'GET') return { status: 200, value: await detail(readInstance(id)) };
      if (id && !operation && request.method === 'PATCH') {
        const input = await options.readBody(request);
        if (!input.instance || typeof input.instance !== 'object') throw new ApiFault(400, 'instance_body_required', '请求体必须包含完整 instance。');
        return await mutate(async () => {
          const current = readInstance(id);
          if (input.proposalSourceFingerprint !== undefined && input.proposalSourceFingerprint !== upstreamFingerprint(current)) throw new ApiFault(409, 'REQ_PROPOSAL_SOURCE_CHANGED', storeMessage('REQ_PROPOSAL_SOURCE_CHANGED'));
          let proposed = input.instance;
          if (input.proposalSourceFingerprint !== undefined) {
            // A generation proposal never owns confirmation. Another window may
            // have confirmed the same upstream while the model was still running.
            const { snapshot: _ignored, ...draft } = proposed as Record<string, unknown>;
            proposed = { ...draft, ...(current.snapshot ? { snapshot: current.snapshot } : {}) };
          }
          let next: RequirementInstance;
          try { next = parseInstance(new Uint8Array(Buffer.from(JSON.stringify(proposed), 'utf8'))); }
          catch (error) { if (error instanceof RequirementFault) throw new ApiFault(400, error.code, `实例未通过校验（${error.code}${error.path ? ` @ ${error.path}` : ''}）。`); throw error; }
          if (next.instance.id !== current.instance.id) throw new ApiFault(400, 'instance_identity_mismatch', '实例 id 不可修改。');
          const accepted = store.readFrameworkState(id)?.confirmations.at(-1);
          if (accepted && (!next.framework || canonicalYaml(next.framework) === canonicalYaml(store.readFrameworkProposal(id, accepted.version).framework))) {
            next = { ...next, framework: current.framework };
          }
          return { status: 200, value: await detail(store.save({ ...next, instance: { ...next.instance, createdAt: current.instance.createdAt } })) };
        });
      }
      if (id && operation === 'confirm' && request.method === 'POST') {
        const input = await options.readBody(request);
        return await mutate(async () => {
          store.confirm(readInstance(id), actor(input));
          return { status: 200, value: await detail(readInstance(id)) };
        });
      }
      if (id && operation === 'framework-input' && request.method === 'PUT') {
        const input = await options.readBody(request);
        const version = readRapSelection(input);
        return await mutate(async () => {
          const instance = readInstance(id);
          if (version) await review.assertReleaseReadable(id, version);
          store.selectFrameworkInput(id, version, readMaterialTargets(input));
          return { status: 200, value: await detail(instance) };
        });
      }
      if (id && operation === 'framework-proposals' && argument && request.method === 'GET') {
        const instance = readInstance(id);
        return { status: 200, value: { frameworkProposal: await review.inspect(instance, store.readFrameworkProposal(id, argument)) } };
      }
      if (id && operation === 'confirm-framework' && request.method === 'POST') {
        const input = await options.readBody(request), version = input.version;
        if (typeof version !== 'string' || !frameworkVersionPattern.test(version)) throw new ApiFault(400, 'version_invalid', '分析框架版本无效。');
        return await mutate(async () => {
          const instance = readInstance(id), state = store.readFrameworkState(id);
          if (state?.current !== version) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
          const record = store.readFrameworkProposal(id, version);
          if ((await review.inspect(instance, record)).status === 'stale') throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
          store.confirmFrameworkProposal(id, version, actor(input));
          return { status: 200, value: await detail(instance) };
        });
      }
      if (id && operation === 'publish' && request.method === 'POST') {
        const input = await options.readBody(request);
        const version = String(input.version ?? '');
        if (!semverPattern.test(version)) throw new ApiFault(400, 'version_invalid', '版本号必须是语义化版本（如 1.0.0）。');
        return await mutate(async () => {
          const confirmed = await review.confirmed(readInstance(id));
          const entry = store.publish(id, version, actor(input), confirmed?.version);
          return { status: 201, value: { entry, releases: await releaseViews(id) } };
        });
      }
      if (id && operation === 'releases' && request.method === 'GET' && !argument) return { status: 200, value: { releases: await releaseViews(id) } };
      if (id && operation === 'releases' && request.method === 'GET' && argument) {
        const version = semverPattern.test(argument) ? argument : store.readRelease(id).entry.version;
        const release = await review.assertReleaseReadable(id, version);
        return { status: 200, value: release };
      }
      if (id && operation === 'generate' && request.method === 'POST') {
        const input = await options.readBody(request);
        const call = String(input.call ?? '') as GenerationCall;
        if (!calls.includes(call)) throw new ApiFault(400, 'call_invalid', '调用点必须是 elicit / hypotheses / framework。');
        const instance = readInstance(id);
        if (options.sessions.busy(id)) throw new ApiFault(409, 'session_busy', '该实例的模型调用正在进行，请等待完成或停止后重试。');
        const isReview = call === 'framework' && input.frameworkReview === true;
        const prompt = buildGenerationPrompt(call, instance);
        const source = { fingerprint: upstreamFingerprint(instance), confirmation: !instance.snapshot ? 'unconfirmed' : isStale(instance) ? 'stale' : 'confirmed' };
        return await options.sessions.withSession(id, async session => {
          const captured = isReview ? await mutate(async () => {
            if (frameworkDraftFingerprint(readInstance(id)) !== frameworkDraftFingerprint(instance)) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
            const version = readRapSelection(input) ?? store.readFrameworkState(id)?.input.rapVersion;
            const release = version ? await review.assertReleaseReadable(id, version) : undefined;
            const publicTopic = readPublicTopic(input), targets = readMaterialTargets(input);
            return { state: store.selectFrameworkInput(id, version, targets), release, version: randomUUID(), publicTopic };
          }) : undefined;
          const assertInput = () => {
            if (captured && (frameworkDraftFingerprint(readInstance(id)) !== frameworkDraftFingerprint(instance) ||
              store.readFrameworkState(id)?.input.revision !== captured.state.input.revision)) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
          };
          const generate = async (runner: GenerationSession, search?: FrameworkPublicSearch, references: () => readonly FrameworkSourceReference[] = () => []) => {
            const instructions = search ? frameworkReviewInstructions({ rap: captured?.release?.rap, publicSearch: search, budget: 20_000 - prompt.length }) : undefined;
            const finish = (reply: string, repairAttempts: 0 | 1) => {
              const parsed = parseModelJson(reply);
              const proposal = call === 'elicit' ? normalizeElicit(parsed, instance) : call === 'hypotheses' ? normalizeHypotheses(parsed, instance) : normalizeFramework(parsed, instance, captured?.release?.rap);
              const sources = references();
              const record: FrameworkProposalRecord | undefined = captured && search && 'framework' in proposal ? {
                version: captured.version, inputRevision: captured.state.input.revision, upstreamFingerprint: source.fingerprint,
                draftFingerprint: frameworkDraftFingerprint(instance),
                ...(captured.release ? { selectedRap: { version: captured.release.entry.version, title: captured.release.entry.title, fingerprint: captured.release.entry.packageFingerprint, extent: instructions!.rapExtent } } : {}),
                framework: proposal.framework, assessment: normalizeFrameworkAssessment(parsed, new Set(sources.map(item => item.id)), search.status === 'sources'),
                sources, publicSearch: search, repairAttempts,
              } : undefined;
              return { status: 200, value: { call, proposal, source, repairAttempts }, record };
            };
            const incomplete = (outcome: 'cancelled' | 'failed', repairAttempts: 0 | 1, detail?: RunDiagnostic) => {
              const diagnostic = readRunDiagnostic(detail);
              return { status: 502, value: { code: 'model_run_failed', outcome, repairAttempts, message: diagnostic?.message ?? '模型调用未完成，未自动重放；请检查后显式重试。', ...(diagnostic ? { diagnostic } : {}) } };
            };
            const verifyBeforeDispatch = captured ? async () => {
              assertInput();
              if (captured.release) {
                const current = await review.assertReleaseReadable(id, captured.release.entry.version);
                if (current.entry.packageFingerprint !== captured.release.entry.packageFingerprint) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
              }
              const delivered = references();
              if (delivered.length && (!options.revalidateFrameworkSources || (await options.revalidateFrameworkSources(delivered, captured.state.input.materialTargets ?? [])).length)) throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
            } : undefined;
            const first = await runner.run(prompt + (instructions?.text ?? ''), randomUUID(), verifyBeforeDispatch);
            if (first.outcome !== 'completed') return incomplete(first.outcome, 0, first.diagnostic);
            let validation: RequirementFault;
            try { return finish(first.text, 0); }
            catch (error) { if (!(error instanceof RequirementFault)) throw error; validation = error; }
            // Exactly one format correction after a completed reply. No failed,
            // cancelled or unknown run is replayed, and no analysis loop is built.
            const corrected = await runner.run(`上一次输出已完成，但未通过输出校验：${validation.code}${validation.path ? ` @ ${validation.path}` : ''}。请在当前会话中仅修复上一次 JSON 的格式或结构，遵守原请求的字段约定；不要重新分析、不要新增事实或改变已知/未知边界。只返回一个完整 JSON 代码块。这是本次生成唯一的一次格式修复；本轮仍失败将停止。`, randomUUID(), verifyBeforeDispatch);
            if (corrected.outcome !== 'completed') return incomplete(corrected.outcome, 1, corrected.diagnostic);
            try { return finish(corrected.text, 1); }
            catch (error) {
              if (!(error instanceof RequirementFault)) throw error;
              return { status: 422, value: { code: 'REQ_MODEL_OUTPUT_INVALID', validation: { code: error.code, path: error.path }, repairAttempts: 1, message: `输出经一次格式修复仍未通过校验（${error.code}${error.path ? ` @ ${error.path}` : ''}）；原始输出已保留，请检查后显式重试。` } };
            }
          };
          const result = captured
            ? session.withFramework
              ? await session.withFramework(captured.version, captured.publicTopic, captured.state.input.materialTargets ?? [], assertInput, generate)
              : await generate(session, { operationId: captured.version, status: captured.publicTopic ? 'unavailable' : 'not_searched', sources: [] })
            : await generate(session);
          if (!('record' in result) || !result.record) return result;
          const record = result.record;
          return await mutate(async () => {
            if (session.isCurrent?.() === false) throw new ApiFault(502, 'model_run_failed', '生成已停止或会话已关闭，未保存迟到提案。');
            const current = readInstance(id);
            const frameworkProposal = await review.inspect(current, record);
            if (frameworkProposal.status === 'stale') throw new RequirementStoreFault('REQ_PROPOSAL_SOURCE_CHANGED');
            if (session.isCurrent?.() === false) throw new ApiFault(502, 'model_run_failed', '生成已停止或会话已关闭，未保存迟到提案。');
            store.saveFrameworkProposal(id, record);
            return { status: result.status, value: { call, source, repairAttempts: record.repairAttempts, frameworkProposal } };
          });
        });
      }
      if (id && operation === 'stop' && request.method === 'POST') {
        await options.readBody(request);
        const stopped = await options.sessions.stop(id);
        return { status: 200, value: { stopped } };
      }
      return undefined;
    } catch (error) {
      if (error instanceof ApiFault) return { status: error.status, value: { code: error.code, message: error.message } };
      if (error instanceof RequirementStoreFault || error instanceof RequirementFault) {
        const code = error instanceof RequirementStoreFault ? error.code : error.code;
        if (code === 'REQ_FRAMEWORK_INPUT_TOO_LARGE') return { status: 413, value: { code, message: storeMessage(code) } };
        const status = code === 'REQ_STORE_NOT_FOUND' || code === 'REQ_PROPOSAL_NOT_FOUND' ? 404 : ['REQ_VERSION_CONFLICT', 'REQ_SAME_CONTENT', 'REQ_STORE_CORRUPT', 'REQ_SNAPSHOT_REQUIRED', 'REQ_STALE_SNAPSHOT', 'REQ_FRAMEWORK_REQUIRED', 'REQ_PROPOSAL_SOURCE_CHANGED'].includes(code) ? 409 : 400;
        return { status, value: { code, message: storeMessage(code) } };
      }
      const code = (error as { code?: unknown }).code;
      if (code === 'generation_cancelled' || code === 'runtime_closed') return { status: 502, value: { code: 'model_run_failed', outcome: 'cancelled', message: '生成已停止或会话已关闭，未自动重放。' } };
      if (code === 'runtime_process_stopped' || code === 'runtime_unavailable' || error instanceof AggregateError && ['session_close_failed', 'session_child_stop_failed'].includes(error.message)) return { status: 502, value: { code: 'model_run_failed', outcome: 'failed', uncertain: true, message: '会话运行中断，结果未确认，未自动重放。' } };
      if (code === 'configuration_changed') return { status: 409, value: { code, message: '本次生成使用的模型配置已失效，未切换模型或自动重放。' } };
      if (code === 'configuration_required' || code === 'session_busy') return { status: 409, value: { code, message: code === 'configuration_required' ? '请先在模型设置中配置模型。' : '该实例的模型调用正在进行，请等待完成或停止后重试。' } };
      throw error;
    }
  };
  return { routes: run, store, review };
}

function readRapSelection(input: Record<string, unknown>) {
  if (input.rapVersion === undefined) return undefined;
  if (typeof input.rapVersion !== 'string' || !semverPattern.test(input.rapVersion)) throw new ApiFault(400, 'version_invalid', '请选择确切 RAP 版本。');
  return input.rapVersion;
}

function readPublicTopic(input: Record<string, unknown>) {
  if (input.publicTopic === undefined || input.publicTopic === '') return undefined;
  if (typeof input.publicTopic !== 'string' || !input.publicTopic.trim() || input.publicTopic.length > 400 || /[\x00-\x1f]/.test(input.publicTopic.trim())) throw new ApiFault(400, 'public_topic_invalid', '请填写不超过 400 字的单行公开检索主题。');
  return input.publicTopic.trim();
}

function readMaterialTargets(input: Record<string, unknown>): FrameworkMaterialTarget[] | undefined {
  if (input.materialTargets === undefined) return undefined;
  const invalid = () => new ApiFault(400, 'framework_material_invalid', '请选择同一项目内的确切资料版本。');
  if (!Array.isArray(input.materialTargets) || input.materialTargets.length > 24) throw invalid();
  const targets = new Map<string, FrameworkMaterialTarget>();
  for (const item of input.materialTargets) {
    try {
      const query = parseSemanticQueryInput({ action: 'read', target: item });
      if (!query.target || !['data-input', 'data-description', 'data-citation', 'data-evidence'].includes(query.target.kind)) throw invalid();
      const target = query.target as FrameworkMaterialTarget;
      targets.set(canonicalYaml(target), target);
    } catch (error) {
      if (error instanceof SemanticReadFault) throw invalid();
      throw error;
    }
  }
  if (new Set([...targets.values()].map(target => target.projectId)).size > 1) throw invalid();
  return [...targets.keys()].sort().map(key => targets.get(key)!);
}
