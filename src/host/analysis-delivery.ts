import { createHash } from 'node:crypto';
import path from 'node:path';
import { canonicalDataContextValue } from './project-data-context-request.ts';
import type { SapMethodSource } from '../../extensions/business-plugins/metric-factory/methods/types.ts';
import type { AnalysisDeliveryPort } from '../agent/analysis-delivery.ts';
import type { ProjectStore } from './project-store.ts';
import type { ProjectTaskResultBinding } from './project-task-results-types.ts';
import type { createAutomaticActionSettingsStore } from './automatic-action-settings-store.ts';
import type { ProjectFilesPort } from '../agent/project-files.ts';
export interface DeclaredAssetFinding { kind: 'metric' | 'semantic' | 'mapping' | 'knowledge' | 'method-issue'; title: string; body: string; sources: Record<string, unknown>[] }
export interface DeclaredCaseFinding { kind: 'judgment' | 'strategy' | 'observation'; title: string; body: string; sources: Record<string, unknown>[] }
export interface AnalysisDeliveryReceipt {
  schemaVersion: 1; type: 'optracall.analysis-delivery'; projectId: string; taskId: string; requestId: string; sessionId: string; toolCallId: string;
  completion: 'complete' | 'organize-partial'; format: 'full-report' | 'chat-summary'; summary: string; limitations: string[];
  selfCheck: { performed: true; findings: string[] }; methodChecks: { kind: 'skill' | 'sap-method'; id: string; version?: string; status: 'used' | 'not-applicable' | 'unavailable'; basis: string }[];
  reviewBasis?: { relativePath: string; sha256: string }[];
  source?: SapMethodSource; reportSources?: SapMethodSource[];
  caseFindings?: DeclaredCaseFinding[]; assetFindings?: DeclaredAssetFinding[];
  reports: ProjectTaskResultBinding[]; save: { status: 'not-requested' | 'disabled' | 'saved' | 'reused' | 'unknown'; settingsRevision?: number; code?: string }; claim: 'declared-not-professionally-verified';
}
/** Small confirmation of the exact Pi-persisted declaration, not another body or action ledger. */
export interface AnalysisDeliverySaveReceipt {
  schemaVersion: 1; type: 'optracall.analysis-delivery-receipt'; status: 'saved';
  delivery: { projectId: string; taskId: string; requestId: string; sessionId: string; toolCallId: string; entryId: string; sha256: string };
}
const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
function fail(code: string): never { throw Object.assign(new Error(code), { code }); }
const list = (value: unknown, max: number): value is string[] => Array.isArray(value) && value.length <= max && value.every(item => typeof item === 'string' && item.length <= 2000);
export function createAnalysisDeliveryPort(options: { projectId: string; taskId: string; projects: ProjectStore; settings: ReturnType<typeof createAutomaticActionSettingsStore>; projectFiles: ProjectFilesPort; listBoundReports(): Promise<ProjectTaskResultBinding[]>; assertOwner(): Promise<void> }): AnalysisDeliveryPort {
  return async (input, context) => {
    const check = async () => { context.signal.throwIfAborted(); context.assertCurrent(); await options.assertOwner(); context.signal.throwIfAborted(); context.assertCurrent(); };
    await check();
    if (!object(input) || Object.keys(input).some(key => !['completion', 'format', 'summary', 'limitations', 'selfCheck', 'methodChecks', 'reports', 'save', 'caseFindings', 'assetFindings', 'reviewBasis'].includes(key)) || !['complete', 'organize-partial'].includes(String(input.completion)) || !['full-report', 'chat-summary'].includes(String(input.format)) || typeof input.summary !== 'string' || !input.summary.trim() || input.summary.length > 4000 || !list(input.limitations, 40) || !object(input.selfCheck) || Object.keys(input.selfCheck).some(key => !['performed', 'findings'].includes(key)) || input.selfCheck.performed !== true || !list(input.selfCheck.findings, 40) || !Array.isArray(input.methodChecks) || input.methodChecks.length > 50 || !Array.isArray(input.reports) || input.reports.length > 20) fail('invalid_analysis_delivery');
    for (const item of input.methodChecks) if (!object(item) || Object.keys(item).some(key => !['kind', 'id', 'version', 'status', 'basis'].includes(key)) || !['skill', 'sap-method'].includes(String(item.kind)) || typeof item.id !== 'string' || !item.id || item.version !== undefined && typeof item.version !== 'string' || !['used', 'not-applicable', 'unavailable'].includes(String(item.status)) || typeof item.basis !== 'string' || !item.basis.trim() || item.basis.length > 2000) fail('invalid_analysis_delivery_methods');
    for (const key of ['caseFindings', 'assetFindings'] as const) if (input[key] !== undefined) {
      const findings = input[key];
      if (!Array.isArray(findings) || findings.length > 10 || JSON.stringify(findings).length > 16000 || findings.some(item => !object(item) || Object.keys(item).some(key => !['kind', 'title', 'body', 'sources'].includes(key)) || !(key === 'caseFindings' ? ['judgment', 'strategy', 'observation'] : ['metric', 'semantic', 'mapping', 'knowledge', 'method-issue']).includes(String(item.kind)) || typeof item.title !== 'string' || !item.title.trim() || item.title.length > 200 || typeof item.body !== 'string' || !item.body.trim() || item.body.length > 2000 || !Array.isArray(item.sources) || item.sources.length > 10 || item.sources.some(source => !object(source)))) fail('invalid_analysis_delivery_findings');
    }
    const checks = input.methodChecks as AnalysisDeliveryReceipt['methodChecks'];
    const required = context.providedContext?.projectPlan?.methods.filter(item => item.kind === 'skill' || item.kind === 'sap-method') || [];
    if (required.some(ref => !checks.some(item => item.kind === ref.kind && item.id === ref.id && item.version === ref.version))) fail('analysis_delivery_method_check_missing');
    if (input.reviewBasis !== undefined) {
      if (!Array.isArray(input.reviewBasis) || input.reviewBasis.length > 24 || new Set(input.reviewBasis.map(ref => object(ref) ? ref.relativePath : undefined)).size !== input.reviewBasis.length) fail('invalid_analysis_delivery_review_basis');
      for (const ref of input.reviewBasis) {
        if (!object(ref) || Object.keys(ref).sort().join(',') !== 'relativePath,sha256' || typeof ref.relativePath !== 'string' || !/^(020_clean|060_reports)\//.test(ref.relativePath) || ref.relativePath.split('/').some(part => !part || part === '.' || part === '..' || /[\\\u0000-\u001f]/.test(part)) || !/^[a-f0-9]{64}$/.test(String(ref.sha256))) fail('invalid_analysis_delivery_review_basis');
        const actual = await options.projects.captureFeedbackFile(options.projectId, ref.relativePath); await check();
        if (actual.sha256 !== ref.sha256) fail('analysis_delivery_basis_changed');
      }
    }
    const reports: ProjectTaskResultBinding[] = [], available = await options.listBoundReports(); await check();
    for (const ref of input.reports) {
      if (!object(ref) || Object.keys(ref).some(key => !['relativePath', 'sha256'].includes(key)) || typeof ref.relativePath !== 'string' || !/^[a-f0-9]{64}$/.test(String(ref.sha256))) fail('invalid_analysis_delivery_report');
      const bound = available.filter(item => item.relativePath === ref.relativePath && item.sha256 === ref.sha256 && item.projectId === options.projectId && item.taskId === options.taskId);
      if (!bound.length) fail('analysis_delivery_report_unbound');
      const actual = await options.projects.captureFeedbackFile(options.projectId, String(ref.relativePath)); await check();
      if (actual.sha256 !== ref.sha256 || actual.bytes.length !== bound[0]!.bytes) fail('analysis_delivery_report_changed');
      if (!reports.some(item => item.relativePath === ref.relativePath && item.sha256 === ref.sha256)) reports.push(bound[0]!);
    }
    const summary = input.summary, limitations = input.limitations, findings = input.selfCheck.findings;
    const buildReceipt = (reports: ProjectTaskResultBinding[], save: AnalysisDeliveryReceipt['save']): AnalysisDeliveryReceipt => {
      const receipt: AnalysisDeliveryReceipt = { schemaVersion: 1, type: 'optracall.analysis-delivery', projectId: options.projectId, taskId: options.taskId, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId, completion: input.completion as AnalysisDeliveryReceipt['completion'], format: input.format as AnalysisDeliveryReceipt['format'], summary, limitations, selfCheck: { performed: true, findings }, methodChecks: structuredClone(checks), ...(input.reviewBasis ? { reviewBasis: structuredClone(input.reviewBasis) as AnalysisDeliveryReceipt['reviewBasis'] } : {}), ...(input.caseFindings ? { caseFindings: structuredClone(input.caseFindings) as DeclaredCaseFinding[] } : {}), ...(input.assetFindings ? { assetFindings: structuredClone(input.assetFindings) as DeclaredAssetFinding[] } : {}), reports, save, claim: 'declared-not-professionally-verified' };
      receipt.source = { type: 'session', label: '本轮明确交付及已发现问题的原生声明', ref: `analysis-delivery:${receipt.projectId}:${receipt.taskId}:${receipt.requestId}:${receipt.sessionId}:${receipt.toolCallId}`, version: receipt.requestId, sha256: createHash('sha256').update(canonicalDataContextValue(receipt)).digest('hex') };
      receipt.reportSources = reports.map(report => ({ type: 'report', label: report.relativePath, ref: `project-report:${report.projectId}:${report.taskId}:${report.relativePath}`, version: report.sha256, sha256: report.sha256 }));
      return receipt;
    };
    // Match the unchanged public worker envelope limits before any optional save.
    const response = (receipt: AnalysisDeliveryReceipt) => {
      const value = { content: [{ type: 'text' as const, text: JSON.stringify(receipt) }], details: receipt as unknown as Record<string, unknown> };
      if (value.content[0].text.length > 32_768 || Buffer.byteLength(JSON.stringify(value), 'utf8') > 256 * 1024) fail('analysis_delivery_payload_limit');
      return value;
    };
    let save: AnalysisDeliveryReceipt['save'] = { status: 'not-requested' };
    if (input.save !== undefined) {
      if (!object(input.save) || Object.keys(input.save).sort().join(',') !== 'content,filename' || typeof input.save.filename !== 'string' || typeof input.save.content !== 'string' || input.save.content.length > 1_000_000) fail('invalid_analysis_delivery_save');
      const decision = await options.settings.readCurrent('save', { authorized: true, applicable: true, cancelled: context.signal.aborted }); await check();
      save = { status: 'disabled', settingsRevision: decision.settingsRevision };
      if (decision.allowed) {
        const project = await options.projects.get(options.projectId); await check();
        const name = input.save.filename, content = input.save.content, relativePath = '060_reports/' + name;
        const sha256 = createHash('sha256').update(content).digest('hex'), bytes = Buffer.byteLength(content);
        const prior = available.find(item => item.projectId === options.projectId && item.taskId === options.taskId && item.relativePath === relativePath && item.sha256 === sha256 && item.bytes === bytes);
        const prospective = { schemaVersion: 1, type: 'optracall.project-report-write', ...(prior || { projectId: options.projectId, taskId: options.taskId, relativePath, sha256, bytes, requestId: context.requestId, sessionId: context.sessionId, toolCallId: context.toolCallId }), filename: name, path: path.join(project.rootPath, relativePath), ...(prior ? { reused: true } : {}) };
        response(buildReceipt([...reports, prospective], { status: prior ? 'reused' : 'saved', settingsRevision: decision.settingsRevision }));
        const result = await options.projectFiles('write-report', input.save, context); await check();
        const receipt = result.details as unknown as ProjectTaskResultBinding;
        const reused = result.details.reused === true;
        if (receipt.projectId !== options.projectId || receipt.taskId !== options.taskId || (!reused && (receipt.requestId !== context.requestId || receipt.sessionId !== context.sessionId || receipt.toolCallId !== context.toolCallId)) || reused && !available.some(item => item.requestId === receipt.requestId && item.sessionId === receipt.sessionId && item.toolCallId === receipt.toolCallId && item.relativePath === receipt.relativePath && item.sha256 === receipt.sha256 && item.bytes === receipt.bytes)) fail('analysis_delivery_save_unknown');
        reports.push(receipt); save = { status: reused ? 'reused' : 'saved', settingsRevision: decision.settingsRevision };
      }
    }
    if (input.completion === 'complete' && input.format === 'full-report' && !reports.length) fail('analysis_delivery_required_report_missing');

    const result = response(buildReceipt(reports, save));
    await check(); return result;
  };
}
