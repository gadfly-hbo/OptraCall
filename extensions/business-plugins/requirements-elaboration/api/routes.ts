import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import { createRequirementStore, RequirementStoreFault, type RequirementReleaseEntry } from '../storage/store.ts';
import { computeGateReport, instanceStatus, pendingMustConfirm, type GateReport } from '../gates/checks.ts';
import { buildGenerationPrompt, normalizeElicit, normalizeHypotheses, normalizeFramework, parseModelJson, type GenerationCall } from '../session/prompts.ts';
import { parseInstance, isStale, upstreamFingerprint, RequirementFault, type RequirementInstance } from '../contract/validate.ts';
import { readRunDiagnostic, type RunDiagnostic } from '../../../../src/agent/run-diagnostics.ts';

class ApiFault extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}

export type RequirementRoutesOptions = {
  storeRoot: string;
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  sessions: {
    run: (instanceId: string, text: string, requestId: string) => Promise<{ outcome: 'completed' | 'cancelled' | 'failed'; text: string; diagnostic?: RunDiagnostic }>;
    withSession: <T,>(instanceId: string, use: (session: { run: (text: string, requestId: string) => Promise<{ outcome: 'completed' | 'cancelled' | 'failed'; text: string; diagnostic?: RunDiagnostic }> }) => Promise<T>) => Promise<T>;
    stop: (instanceId: string) => Promise<boolean>;
    busy: (instanceId: string) => boolean;
  };
};

export type InstanceView = {
  id: string; title: string; scene: RequirementInstance['instance']['scene']; createdAt: string; updatedAt: string;
  status: ReturnType<typeof instanceStatus>; mustConfirmPending: number; releasedCount: number;
};
export type InstanceDetail = { instance: RequirementInstance; gates: GateReport; releases: readonly RequirementReleaseEntry[] };

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
  REQ_PROPOSAL_SOURCE_CHANGED: '生成提案后需求内容已修改，请基于当前工作稿重新生成后再采纳。',
}[code] ?? '需求实例操作未完成，请检查输入或本地数据后重试。');

/** Host-owned HTTP transport calls these handlers; the plugin never binds a port itself. */
export function createRequirementRoutes(options: RequirementRoutesOptions) {
  const store = createRequirementStore(options.storeRoot);

  const view = (instance: RequirementInstance): InstanceView => ({
    id: instance.instance.id, title: instance.instance.title, scene: instance.instance.scene,
    createdAt: instance.instance.createdAt, updatedAt: instance.instance.updatedAt,
    status: instanceStatus(instance), mustConfirmPending: pendingMustConfirm(instance),
    releasedCount: store.releases(instance.instance.id).length,
  });
  const detail = (instance: RequirementInstance): InstanceDetail => ({ instance, gates: computeGateReport(instance), releases: store.releases(instance.instance.id) });
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
      if (id && !operation && request.method === 'GET') { const instance = readInstance(id); return { status: 200, value: detail(instance) }; }
      if (id && !operation && request.method === 'PATCH') {
        const input = await options.readBody(request);
        if (!input.instance || typeof input.instance !== 'object') throw new ApiFault(400, 'instance_body_required', '请求体必须包含完整 instance。');
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
        return { status: 200, value: detail(store.save({ ...next, instance: { ...next.instance, createdAt: current.instance.createdAt } })) };
      }
      if (id && operation === 'confirm' && request.method === 'POST') {
        const input = await options.readBody(request);
        const instance = readInstance(id);
        store.confirm(instance, actor(input));
        return { status: 200, value: detail(readInstance(id)) };
      }
      if (id && operation === 'publish' && request.method === 'POST') {
        const input = await options.readBody(request);
        const version = String(input.version ?? '');
        if (!semverPattern.test(version)) throw new ApiFault(400, 'version_invalid', '版本号必须是语义化版本（如 1.0.0）。');
        const entry = store.publish(id, version, actor(input));
        return { status: 201, value: { entry, releases: store.releases(id) } };
      }
      if (id && operation === 'releases' && request.method === 'GET' && !argument) return { status: 200, value: { releases: store.releases(id) } };
      if (id && operation === 'releases' && request.method === 'GET' && argument) {
        const release = store.readRelease(id, semverPattern.test(argument) ? argument : undefined);
        return { status: 200, value: release };
      }
      if (id && operation === 'generate' && request.method === 'POST') {
        const input = await options.readBody(request);
        const call = String(input.call ?? '') as GenerationCall;
        if (!calls.includes(call)) throw new ApiFault(400, 'call_invalid', '调用点必须是 elicit / hypotheses / framework。');
        const instance = readInstance(id);
        if (options.sessions.busy(id)) throw new ApiFault(409, 'session_busy', '该实例的模型调用正在进行，请等待完成或停止后重试。');
        const prompt = buildGenerationPrompt(call, instance);
        const source = { fingerprint: upstreamFingerprint(instance), confirmation: !instance.snapshot ? 'unconfirmed' : isStale(instance) ? 'stale' : 'confirmed' };
        return await options.sessions.withSession(id, async session => {
          const normalize = (reply: string) => {
            const parsed = parseModelJson(reply);
            return call === 'elicit' ? normalizeElicit(parsed, instance) : call === 'hypotheses' ? normalizeHypotheses(parsed, instance) : normalizeFramework(parsed, instance);
          };
          const incomplete = (outcome: 'cancelled' | 'failed', repairAttempts: 0 | 1, detail?: RunDiagnostic) => {
            const diagnostic = readRunDiagnostic(detail);
            return { status: 502, value: { code: 'model_run_failed', outcome, repairAttempts, message: diagnostic?.message ?? '模型调用未完成，未自动重放；请检查后显式重试。', ...(diagnostic ? { diagnostic } : {}) } };
          };
          const first = await session.run(prompt, randomUUID());
          if (first.outcome !== 'completed') return incomplete(first.outcome, 0, first.diagnostic);
          let validation: RequirementFault;
          try { return { status: 200, value: { call, proposal: normalize(first.text), source, repairAttempts: 0 } }; }
          catch (error) { if (!(error instanceof RequirementFault)) throw error; validation = error; }
          // Exactly one format correction after a completed reply. No failed,
          // cancelled or unknown run is replayed, and no analysis loop is built.
          const corrected = await session.run(`上一次输出已完成，但未通过输出校验：${validation.code}${validation.path ? ` @ ${validation.path}` : ''}。请在当前会话中仅修复上一次 JSON 的格式或结构，遵守原请求的字段约定；不要重新分析、不要新增事实或改变已知/未知边界。只返回一个完整 JSON 代码块。这是本次生成唯一的一次格式修复；本轮仍失败将停止。`, randomUUID());
          if (corrected.outcome !== 'completed') return incomplete(corrected.outcome, 1, corrected.diagnostic);
          try { return { status: 200, value: { call, proposal: normalize(corrected.text), source, repairAttempts: 1 } }; }
          catch (error) {
            if (!(error instanceof RequirementFault)) throw error;
            return { status: 422, value: { code: 'REQ_MODEL_OUTPUT_INVALID', validation: { code: error.code, path: error.path }, repairAttempts: 1, message: `输出经一次格式修复仍未通过校验（${error.code}${error.path ? ` @ ${error.path}` : ''}）；原始输出已保留，请检查后显式重试。` } };
          }
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
        const status = code === 'REQ_STORE_NOT_FOUND' ? 404 : ['REQ_VERSION_CONFLICT', 'REQ_SAME_CONTENT', 'REQ_STORE_CORRUPT', 'REQ_SNAPSHOT_REQUIRED', 'REQ_STALE_SNAPSHOT', 'REQ_FRAMEWORK_REQUIRED'].includes(code) ? 409 : 400;
        return { status, value: { code, message: storeMessage(code) } };
      }
      const code = (error as { code?: unknown }).code;
      if (code === 'generation_cancelled' || code === 'runtime_closed') return { status: 502, value: { code: 'model_run_failed', outcome: 'cancelled', message: '生成已停止或会话已关闭，未自动重放。' } };
      if (code === 'runtime_process_stopped' || code === 'runtime_unavailable') return { status: 502, value: { code: 'model_run_failed', outcome: 'failed', uncertain: true, message: '会话运行中断，结果未确认，未自动重放。' } };
      if (code === 'configuration_changed') return { status: 409, value: { code, message: '本次生成使用的模型配置已失效，未切换模型或自动重放。' } };
      if (code === 'configuration_required' || code === 'session_busy') return { status: 409, value: { code, message: code === 'configuration_required' ? '请先在模型设置中配置模型。' : '该实例的模型调用正在进行，请等待完成或停止后重试。' } };
      throw error;
    }
  };
  return { routes: run, store };
}
