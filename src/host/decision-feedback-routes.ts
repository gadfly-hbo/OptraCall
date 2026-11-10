import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DecisionFeedbackStore, DecisionFeedbackError, feedbackFail, feedbackHash, feedbackId, feedbackObject, feedbackTextHash } from './decision-feedback-store.ts';
import { boundedFeedbackText, captureFeedbackMaterials, feedbackDeterministicId, feedbackMaterialsText, feedbackRange, materialIdentity, parseFeedbackPreview, previewFingerprint, selectFeedbackMaterials } from './decision-feedback-context.ts';
import type { DecisionFeedbackDependencies, FeedbackCaseSelection, FeedbackContextReceipt, FeedbackContextSelection, FeedbackHandoff, FeedbackHandoffResult, FeedbackMaterialSnapshot, FeedbackOperation, FeedbackPreview, FeedbackPreviewInput, FeedbackRouteRequest, FeedbackRouteResult } from './decision-feedback-types.ts';

/** Routes own business mutations through the injected Host gate. Context preparation never reacquires it. */
export function createDecisionFeedbackFeature(deps: DecisionFeedbackDependencies) {
  const store = new DecisionFeedbackStore({ root: path.join(deps.dataRoot, 'decision-feedback') });
  const previews = new Map<string, { value: FeedbackPreview; input: FeedbackPreviewInput }>();
  const requireHandoff = (id: string) => store.getHandoff(feedbackId(id)) ?? feedbackFail('feedback_handoff_not_found', 404);
  const checkCase = (projectId: string, selection?: FeedbackCaseSelection | null) => {
    if (!selection) return;
    const current = deps.cases.getCase(selection.caseId);
    if (current.status === 'closed') feedbackFail('case_closed', 409);
    if (current.revision !== selection.expectedRevision) feedbackFail('revision_conflict', 409);
    if (!deps.cases.listProjectLinks(current.id).some(link => link.projectId === projectId)) feedbackFail('project_not_linked', 409);
  };
  const actionCaseSelection = (value: unknown): FeedbackCaseSelection | null => {
    if (value === null) return null;
    if (!feedbackObject(value) || !Number.isSafeInteger(value.expectedRevision) || Number(value.expectedRevision) < 1) feedbackFail('feedback_action_case_selection_required');
    return { caseId: feedbackId(value.caseId), expectedRevision: Number(value.expectedRevision) };
  };
  const admit = async (handoff: FeedbackHandoff, selection: FeedbackCaseSelection | null | undefined) => { await deps.assertActive(handoff.source.sourceProjectId); checkCase(handoff.source.sourceProjectId, selection); };
  const readSource = async (boardTaskId: string, revisionId: string | null) => {
    const source = await deps.readSource(feedbackId(boardTaskId), revisionId);
    feedbackId(source.sourceProjectId);
    if (source.boardTaskId !== boardTaskId || (source.feedbackRevision?.revisionId ?? null) !== revisionId) feedbackFail('feedback_source_mismatch', 409);
    await deps.projects.get(source.sourceProjectId); return source;
  };
  async function preview(input: FeedbackPreviewInput): Promise<FeedbackPreview> {
    const source = await readSource(input.boardTaskId, input.feedbackRevisionId);
    checkCase(source.sourceProjectId, input.caseSelection);
    const materials = await captureFeedbackMaterials(deps.projects, source, input.materials), now = new Date().toISOString();
    const base = { ...input, source, materials };
    const value: FeedbackPreview = { ...base, previewId: randomUUID(), createdAt: now, fingerprint: previewFingerprint(base) };
    if (previews.size >= 64) previews.delete(previews.keys().next().value!);
    previews.set(value.previewId, { value, input }); return value;
  }
  async function handoffResult(operation: FeedbackOperation): Promise<FeedbackHandoffResult> {
    const handoff = requireHandoff(operation.handoffId), task = await deps.projects.getTask(handoff.target.projectId, handoff.target.taskId);
    if (task.feedbackOrigin?.handoffId !== handoff.handoffId || task.feedbackOrigin.operationId !== operation.operationId || task.feedbackOrigin.requestHash !== operation.requestHash) feedbackFail('feedback_origin_conflict', 409);
    return { handoff, task, operation };
  }
  async function complete(operation: FeedbackOperation, resume: boolean): Promise<unknown> {
    const handoff = store.getHandoff(operation.handoffId) ?? operation.request.handoff as FeedbackHandoff | undefined;
    if (!handoff) feedbackFail('feedback_handoff_not_found', 404);
    await admit(handoff, operation.kind === 'handoff' ? handoff.caseSelection : actionCaseSelection(operation.request.caseSelection));
    try {
      if (!store.getHandoff(handoff.handoffId)) store.saveHandoff(handoff);
      if (operation.kind === 'handoff') {
        await deps.projects.createTaskWithFeedback(handoff.target.projectId, { taskId: handoff.target.taskId, name: handoff.taskName, draft: handoff.question, feedbackOrigin: { handoffId: handoff.handoffId, operationId: operation.operationId, requestHash: operation.requestHash } });
        store.saveHandoff({ ...handoff, target: { ...handoff.target, state: 'confirmed' } });
        operation.result = { taskId: handoff.target.taskId }; operation.steps.task = { state: 'succeeded' };
      } else if (operation.kind === 'file') {
        const body = String(operation.request.body), saved = await deps.projects.saveFeedbackFile(handoff.target.projectId, operation.operationId, body, resume);
        operation.result = { file: { path: saved.path, sha256: saved.sha256, bytes: saved.bytes } }; operation.steps.file = { state: 'succeeded' };
      } else {
        const request = operation.request as unknown as { title: string; scene: 'daily' | 'topic' | 'recurring'; background: string };
        const instance = deps.requirements.createFromFeedback({ instanceId: operation.planned.instanceId!, title: request.title, scene: request.scene, background: request.background, origin: { handoffId: handoff.handoffId, operationId: operation.operationId, requestHash: operation.requestHash }, resume });
        operation.result = { instanceId: instance.instance.id }; operation.steps.requirement = { state: 'succeeded' };
      }
      operation.phase = 'completed'; operation.updatedAt = new Date().toISOString(); delete operation.error; store.saveOperation(operation);
      if (operation.kind === 'handoff') return handoffResult(operation);
      if (operation.kind === 'requirement') return { operation, instanceId: operation.result!.instanceId, instance: deps.requirements.read(operation.result!.instanceId!) };
      return { operation, file: operation.result!.file };
    } catch (error) {
      // Keep all created targets and files. A failed receipt save is uncertain,
      // never a reason to allocate a second task or overwrite its edited draft.
      const saved = store.getOperation(operation.operationId);
      if (saved?.phase === 'completed') return operation.kind === 'handoff' ? handoffResult(saved) : { operation: saved, ...saved.result };
      operation.phase = 'needs_review'; operation.updatedAt = new Date().toISOString(); operation.error = safeCode(error);
      const key = operation.kind === 'handoff' ? 'task' : operation.kind;
      operation.steps[key] = { state: 'unknown', reason: operation.error }; store.saveOperation(operation);
      throw new DecisionFeedbackError('feedback_operation_needs_review', 409);
    }
  }
  async function createHandoff(raw: unknown) {
    if (!feedbackObject(raw)) feedbackFail('invalid_feedback_handoff');
    const operationId = feedbackId(raw.operationId), previewId = feedbackId(raw.previewId), previous = store.getOperation(operationId);
    if (Object.keys(raw).some(key => !['operationId', 'previewId'].includes(key))) feedbackFail('invalid_feedback_handoff');
    if (previous) {
      if (previous.kind !== 'handoff' || previous.request.previewId !== previewId) feedbackFail('operation_conflict', 409);
      if (previous.phase !== 'completed') feedbackFail('feedback_operation_needs_review', 409);
      return handoffResult(previous);
    }
    const cached = previews.get(previewId); if (!cached) feedbackFail('feedback_preview_expired', 409);
    const current = await preview(cached.input);
    if (current.fingerprint !== cached.value.fingerprint) feedbackFail('feedback_source_changed', 409);
    const { previewId: _previewId, ...fixed } = cached.value, handoffId = randomUUID(), taskId = randomUUID(), now = new Date().toISOString();
    const handoff: FeedbackHandoff = { ...fixed, schemaVersion: 1, handoffId, operationId, target: { projectId: fixed.source.sourceProjectId, taskId, state: 'planned' } };
    await admit(handoff, handoff.caseSelection);
    const operation: FeedbackOperation = { schemaVersion: 1, operationId, handoffId, sourceProjectId: handoff.source.sourceProjectId, kind: 'handoff', requestHash: feedbackHash({ previewId, fingerprint: fixed.fingerprint }), createdAt: now, updatedAt: now, phase: 'prepared', planned: { taskId }, request: { previewId, handoff }, steps: { task: { state: 'pending' } } };
    store.saveOperation(operation); return complete(operation, false);
  }
  async function saveMaterials(id: string, raw: unknown) {
    if (!feedbackObject(raw)) feedbackFail('invalid_feedback_selection');
    const handoff = requireHandoff(id), operationId = feedbackId(raw.operationId), caseSelection = actionCaseSelection(raw.caseSelection);
    const materials = selectFeedbackMaterials(handoff.materials, raw.selectedMaterialIds);
    if (!materials.length) feedbackFail('feedback_no_materials_selected');
    const command = { handoffId: handoff.handoffId, selectedMaterialIds: materials.map(material => material.id), caseSelection }, requestHash = feedbackHash(command), previous = store.getOperation(operationId);
    if (previous) {
      if (previous.kind !== 'file' || previous.requestHash !== requestHash) feedbackFail('operation_conflict', 409);
      if (previous.phase !== 'completed') feedbackFail('feedback_operation_needs_review', 409);
      return { operation: previous, file: previous.result?.file };
    }
    await admit(handoff, caseSelection);
    const body = `# 本次选定反馈资料\n\n这是供普通 Agent 自主读取的普通项目文件，之后可以修改；固定提供历史仍在交接记录。\n\n交接：${handoff.handoffId}\n\n${feedbackMaterialsText(materials)}\n`, now = new Date().toISOString();
    const operation: FeedbackOperation = { schemaVersion: 1, operationId, handoffId: handoff.handoffId, sourceProjectId: handoff.source.sourceProjectId, kind: 'file', requestHash, createdAt: now, updatedAt: now, phase: 'prepared', planned: { relativePath: `020_clean/feedback-${operationId}.md` }, request: { ...command, body }, steps: { file: { state: 'pending' } } };
    store.saveOperation(operation); return complete(operation, false);
  }
  async function createRequirement(id: string, raw: unknown) {
    if (!feedbackObject(raw) || !feedbackObject(raw.sourceSelection)) feedbackFail('invalid_feedback_requirement');
    const handoff = requireHandoff(id), operationId = feedbackId(raw.operationId), title = boundedFeedbackText(raw.title, 200).trim(), caseSelection = actionCaseSelection(raw.caseSelection);
    if (!title || !['daily', 'topic', 'recurring'].includes(String(raw.scene))) feedbackFail('invalid_feedback_requirement');
    const selected = raw.sourceSelection, sourceProjectId = feedbackId(selected.projectId);
    if (sourceProjectId !== handoff.target.projectId) feedbackFail('feedback_owner_mismatch', 409);
    if (!['file', 'reply'].includes(String(selected.kind))) feedbackFail('invalid_feedback_source');
    const sourceSelection = selected.kind === 'reply' ? {
      kind: 'reply' as const, projectId: sourceProjectId, taskId: feedbackId(selected.taskId), sessionId: boundedFeedbackText(selected.sessionId, 200), messageId: boundedFeedbackText(selected.messageId, 200),
      expectedTextSha256: boundedFeedbackText(selected.expectedTextSha256, 64),
      ...(selected.start === undefined ? {} : { start: selected.start }), ...(selected.end === undefined ? {} : { end: selected.end }),
    } : {
      kind: 'file' as const, projectId: sourceProjectId, relativePath: boundedFeedbackText(selected.relativePath, 2000), expectedSha256: boundedFeedbackText(selected.expectedSha256, 64),
      ...(selected.start === undefined ? {} : { start: selected.start }), ...(selected.end === undefined ? {} : { end: selected.end }),
    };
    if (sourceSelection.kind === 'reply' && (sourceSelection.taskId !== handoff.target.taskId || !sourceSelection.messageId || !sourceSelection.sessionId)) feedbackFail('feedback_owner_mismatch', 409);
    if (sourceSelection.kind === 'reply' && !/^[a-f0-9]{64}$/.test(sourceSelection.expectedTextSha256)) feedbackFail('feedback_source_preview_required', 409);
    if (sourceSelection.kind === 'file' && (!sourceSelection.relativePath.startsWith('060_reports/') || !/^[a-f0-9]{64}$/.test(sourceSelection.expectedSha256))) feedbackFail('feedback_source_preview_required', 409);
    const command = { handoffId: handoff.handoffId, title, scene: String(raw.scene), caseSelection, ...(raw.background === undefined ? {} : { background: boundedFeedbackText(raw.background, 100000) }), sourceSelection }, previous = store.getOperation(operationId);
    if (previous) {
      if (previous.kind !== 'requirement' || feedbackHash(previous.request.command) !== feedbackHash(command)) feedbackFail('operation_conflict', 409);
      if (previous.phase !== 'completed') feedbackFail('feedback_operation_needs_review', 409);
      return { operation: previous, instanceId: previous.result!.instanceId, instance: deps.requirements.read(previous.result!.instanceId!) };
    }
    await admit(handoff, caseSelection);
    let text: string, source: FeedbackMaterialSnapshot['source'], observation: FeedbackMaterialSnapshot['observation'] = null;
    if (sourceSelection.kind === 'reply') {
      const reply = await deps.readReply(sourceProjectId, sourceSelection.taskId, sourceSelection);
      if (reply.sessionId !== sourceSelection.sessionId || reply.messageId !== sourceSelection.messageId) feedbackFail('feedback_source_mismatch', 409);
      text = reply.text;
      if (sourceSelection.expectedTextSha256 && feedbackTextHash(text) !== sourceSelection.expectedTextSha256) feedbackFail('feedback_source_changed', 409);
      source = { projectId: sourceProjectId, sessionId: reply.sessionId, messageId: reply.messageId, sourceSha256: feedbackTextHash(text) };
    } else {
      const captured = await deps.projects.captureFeedbackFile(sourceProjectId, sourceSelection.relativePath);
      if (captured.sha256 !== sourceSelection.expectedSha256) feedbackFail('feedback_source_changed', 409);
      try { text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(captured.bytes); } catch { return feedbackFail('feedback_file_not_utf8', 422); }
      observation = { sha256: captured.sha256, bytes: captured.bytes.length, observedAt: captured.observedAt };
      source = { projectId: sourceProjectId, relativePath: sourceSelection.relativePath, sourceSha256: captured.sha256, sourceBytes: captured.bytes.length };
    }
    const range = feedbackRange(text, sourceSelection.start, sourceSelection.end), body = text.slice(range.start, range.end);
    if (body.length > 100000) feedbackFail('feedback_requirement_source_too_large', 413);
    const sourceMaterial: FeedbackMaterialSnapshot = { id: randomUUID(), kind: sourceSelection.kind, mode: sourceSelection.start === undefined && sourceSelection.end === undefined ? 'full' : 'excerpt', title: sourceSelection.kind === 'reply' ? '明确选择的复盘回复' : sourceSelection.relativePath, source, body, sha256: feedbackTextHash(body), range, observation };
    const sourceLabel = sourceMaterial.mode === 'full' ? '全文' : `明确片段（UTF-16 [${range.start}, ${range.end})，原文共 ${range.total} 字符）`;
    const background = command.background ?? `以下是用户选定的复盘来源，尚未确认为新需求事实，可继续编辑。\n来源：${sourceMaterial.title} · ${sourceLabel}\n\n${body}`;
    if (background.length > 100000) feedbackFail('feedback_requirement_background_too_large', 413);
    const now = new Date().toISOString(), operation: FeedbackOperation = { schemaVersion: 1, operationId, handoffId: handoff.handoffId, sourceProjectId, kind: 'requirement', requestHash: feedbackHash({ command, sourceMaterial: materialIdentity(sourceMaterial) }), createdAt: now, updatedAt: now, phase: 'prepared', planned: { instanceId: 'req-' + randomUUID().replace(/-/g, '').slice(0, 12) }, request: { command, title, scene: command.scene, caseSelection, background, sourceSelection, sourceMaterial }, steps: { requirement: { state: 'pending' } } };
    store.saveOperation(operation); return complete(operation, false);
  }
  async function selectedContext(projectId: string, taskId: string, selection: FeedbackContextSelection) {
    if (!feedbackObject(selection)) feedbackFail('invalid_feedback_selection');
    const handoff = requireHandoff(selection.handoffId), task = await deps.projects.getTask(projectId, taskId);
    if (handoff.target.state !== 'confirmed' || handoff.target.projectId !== projectId || handoff.target.taskId !== taskId || task.feedbackOrigin?.handoffId !== handoff.handoffId) feedbackFail('feedback_owner_mismatch', 409);
    return { handoff, materials: selectFeedbackMaterials(handoff.materials, selection.selectedMaterialIds) };
  }
  async function requestIdentity(projectId: string, taskId: string, selection?: FeedbackContextSelection): Promise<unknown | undefined> {
    if (selection === undefined) return undefined;
    const { handoff, materials } = await selectedContext(projectId, taskId, selection), conditions = materials.length ? { sourceNature: handoff.sourceNature, observationPeriod: handoff.observationPeriod, applicability: handoff.applicability, limitations: handoff.limitations } : {};
    return { projectId, taskId, handoffId: handoff.handoffId, selectedCase: materials.length ? handoff.caseSelection ?? null : null, ...conditions, materials: materials.map(materialIdentity) };
  }
  async function prepareFeedbackContext(projectId: string, taskId: string, selection?: FeedbackContextSelection, requestId?: string): Promise<{ text: string; receipt?: FeedbackContextReceipt; fingerprint?: unknown }> {
    if (selection === undefined) return { text: '' };
    const { handoff, materials } = await selectedContext(projectId, taskId, selection);
    await deps.assertActive(projectId);
    if (materials.length) checkCase(projectId, handoff.caseSelection);
    for (const material of materials) if (material.source.relativePath && material.kind === 'file') {
      if (material.mode === 'reference') {
        const current = await deps.projects.observeFeedbackReference(projectId, material.source.relativePath);
        if (material.observation && (current.observation?.sha256 !== material.observation.sha256 || current.observation?.bytes !== material.observation.bytes)) feedbackFail('feedback_source_changed', 409);
      } else {
        const observed = await deps.projects.observeFile(projectId, material.source.relativePath);
        if (!material.observation || observed.sha256 !== material.observation.sha256 || observed.bytes !== material.observation.bytes) feedbackFail('feedback_source_changed', 409);
      }
    }
    const receipt: FeedbackContextReceipt = { handoffId: handoff.handoffId, deliveryId: feedbackDeterministicId(['feedback-delivery', projectId, taskId, handoff.handoffId, feedbackId(requestId)]), sourceProjectId: handoff.source.sourceProjectId, boardTaskId: handoff.source.boardTaskId, feedbackRevisionId: handoff.feedbackRevisionId, selectedCase: materials.length ? handoff.caseSelection ?? null : null, sourceNature: materials.length ? handoff.sourceNature ?? 'unspecified' : 'unspecified', observationPeriod: materials.length ? handoff.observationPeriod ?? '' : '', applicability: materials.length ? handoff.applicability ?? '' : '', limitations: materials.length ? handoff.limitations ?? '' : '', materials, claim: 'provided-not-adopted' };
    const text = materials.length ? `【本轮明确选择的反馈与来源资料；不表示已验证、已读取或已采用】\n${JSON.stringify({ handoffId: handoff.handoffId, selectedCase: receipt.selectedCase, sourceNature: receipt.sourceNature, observationPeriod: receipt.observationPeriod, applicability: receipt.applicability, limitations: receipt.limitations })}\n${feedbackMaterialsText(materials)}` : '';
    return { text, receipt, fingerprint: await requestIdentity(projectId, taskId, selection) };
  }
  async function observations(operation: FeedbackOperation) {
    const result: Record<string, unknown> = {};
    if (operation.planned.taskId) {
      try { const task = await deps.projects.getTask(operation.sourceProjectId, operation.planned.taskId); result.task = { exists: true, taskId: task.id, originMatches: task.feedbackOrigin?.operationId === operation.operationId && task.feedbackOrigin?.requestHash === operation.requestHash }; }
      catch (error) { result.task = { exists: false, reason: safeCode(error) }; }
    }
    if (operation.planned.instanceId) { try { result.requirement = { exists: true, instanceId: deps.requirements.read(operation.planned.instanceId).instance.id, originMatches: deps.requirements.readFeedbackOrigin(operation.planned.instanceId)?.requestHash === operation.requestHash }; } catch (error) { result.requirement = { exists: false, reason: safeCode(error) }; } }
    if (operation.planned.relativePath) { try { result.file = { exists: true, path: operation.planned.relativePath, ...await deps.projects.observeFile(operation.sourceProjectId, operation.planned.relativePath) }; } catch (error) { result.file = { exists: false, reason: safeCode(error) }; } }
    return result;
  }
  async function handle({ pathname, method, input }: FeedbackRouteRequest): Promise<FeedbackRouteResult> {
    const url = new URL(pathname, 'http://feedback.local'), segments = url.pathname.split('/').filter(Boolean);
    if (segments[0] !== 'api' || segments[1] !== 'decision-feedback') return null;
    const [resource, id, action] = segments.slice(2);
    try {
      if (resource === 'sources' && id && method === 'GET') {
        const revision = url.searchParams.get('revisionId'), source = await readSource(id, revision === null ? null : feedbackId(revision));
        const caseCandidates = deps.cases.getStatus().state === 'ready' ? deps.cases.listCases().filter(record => deps.cases.listProjectLinks(record.id).some(link => link.projectId === source.sourceProjectId)) : [];
        return { status: 200, body: { source, caseCandidates, ...store.listForBoardTask(source.boardTaskId) } };
      }
      if (resource === 'preview' && !id && method === 'POST') return { status: 200, body: { preview: await preview(parseFeedbackPreview(input)) } };
      if (resource === 'handoffs' && !id && method === 'POST') return { status: 201, body: await deps.mutate(() => createHandoff(input)) };
      if (resource === 'handoffs' && id && !action && method === 'GET') return { status: 200, body: { handoff: requireHandoff(id) } };
      if (resource === 'handoffs' && id && action === 'files' && method === 'POST') return { status: 201, body: await deps.mutate(() => saveMaterials(id, input)) };
      if (resource === 'handoffs' && id && action === 'requirements' && method === 'POST') return { status: 201, body: await deps.mutate(() => createRequirement(id, input)) };
      if (resource === 'handoffs' && id && action === 'case-judgement' && method === 'POST') return { status: 200, body: await deps.mutate(async () => {
        if (!feedbackObject(input) || !feedbackObject(input.fields) || !Number.isSafeInteger(input.expectedRevision) || Number(input.expectedRevision) < 1) feedbackFail('invalid_feedback_case');
        const handoff = requireHandoff(id), caseId = feedbackId(input.caseId), operationId = feedbackId(input.operationId), expectedRevision = Number(input.expectedRevision), fields = input.fields;
        if (Object.keys(fields).some(key => !['title', 'description', 'judgement', 'nextStep'].includes(key))) feedbackFail('invalid_feedback_case');
        const command = { caseId, operationId, expectedRevision,
          ...(fields.title === undefined ? {} : { title: boundedFeedbackText(fields.title, 160) }),
          ...(fields.description === undefined ? {} : { description: boundedFeedbackText(fields.description, 40000) }),
          ...(fields.judgement === undefined ? {} : { judgement: boundedFeedbackText(fields.judgement, 40000) }),
          ...(fields.nextStep === undefined ? {} : { nextStep: boundedFeedbackText(fields.nextStep, 10000) }),
        };
        // The original Case Store validates the complete normalized command
        // against its immutable receipt before consulting current revisions.
        if (deps.cases.getOperation(operationId)?.phase === 'completed') return { case: deps.cases.updateCase(command) };
        await deps.assertActive(handoff.source.sourceProjectId);
        checkCase(handoff.source.sourceProjectId, { caseId, expectedRevision });
        return { case: deps.cases.updateCase(command) };
      }) };
      if (resource === 'requirements' && id && action === 'source' && method === 'GET') {
        const origin = deps.requirements.readFeedbackOrigin(id);
        if (!origin) return { status: 200, body: { sourceMaterial: null, sourceSelection: null } };
        const operation = store.getOperation(origin.operationId);
        if (!operation || operation.kind !== 'requirement' || operation.requestHash !== origin.requestHash || operation.handoffId !== origin.handoffId || operation.planned.instanceId !== id) feedbackFail('feedback_requirement_source_unavailable', 409);
        return { status: 200, body: { operationId: origin.operationId, handoffId: origin.handoffId, sourceSelection: operation.request.sourceSelection, sourceMaterial: operation.request.sourceMaterial } };
      }
      if (resource === 'operations' && id && !action && method === 'GET') { const operation = store.getOperation(feedbackId(id)) ?? feedbackFail('feedback_operation_not_found', 404); return { status: 200, body: { operation, observations: await observations(operation) } }; }
      if (resource === 'operations' && id && action === 'continue' && method === 'POST') return { status: 200, body: await deps.mutate(async () => { const operation = store.getOperation(feedbackId(id)) ?? feedbackFail('feedback_operation_not_found', 404); if (!feedbackObject(input) || input.requestHash !== operation.requestHash) feedbackFail('operation_conflict', 409); if (operation.phase === 'completed') return operation.kind === 'handoff' ? handoffResult(operation) : { operation, ...operation.result }; return complete(operation, true); }) };
      return { status: 404, body: { code: 'feedback_route_not_found' } };
    } catch (error) { const code = safeCode(error), status = error instanceof DecisionFeedbackError ? error.statusCode : /not_found/.test(code) ? 404 : /conflict|changed|closed|archived|linked/.test(code) ? 409 : 400; return { status, body: { code } }; }
  }
  return { store, init: () => store.init(), close: () => { previews.clear(); store.close(); }, handle, requestIdentity, prepareFeedbackContext };
}
function safeCode(error: unknown): string { return feedbackObject(error) && typeof error.code === 'string' ? error.code : error instanceof Error && /^[a-zA-Z_]+$/.test(error.message) ? error.message : 'feedback_operation_failed'; }
