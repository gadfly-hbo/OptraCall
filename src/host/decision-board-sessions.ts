import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createAgentSessionDomain, type SessionResult } from './agent-sessions.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import { runtimeDiagnostic } from '../agent/run-diagnostics.ts';
import { createDecisionBoardStore, DecisionBoardFault } from '../../extensions/business-plugins/decision-board/storage/store.ts';
import type { ExtractionRecord } from '../../extensions/business-plugins/decision-board/types.ts';
import { boardSessionDirectory, boardWorkspace, buildExtractionPrompt, enforceVerbatimQuotes, stageReportText } from '../../extensions/business-plugins/decision-board/session/workspace.ts';
import { normalizeExtractionOutput } from '../../extensions/business-plugins/decision-board/extraction/normalize.ts';

type BoardStore = ReturnType<typeof createDecisionBoardStore>;
// This owner never leaves this Host adapter. Preserve the actual trigger-time
// credential snapshot in the shared lifecycle; only public metadata is stored.
type BoardOwner = { projectId: string; extractionId: string; capturedConfiguration?: Readonly<RuntimeModelConfiguration> };

/** Decision-board extraction profile: one fixed report per turn, no tools, no
 * continuation. Lifecycle is owned exclusively by the shared domain implementation. */
export function createDecisionBoardSessions(options: {
  store: BoardStore;
  extractionRoot: string;
  codeRoot: string;
  resourceRoot: string;
  managementPorts(): number[];
  configurationSnapshot(id?: string, revision?: number): Readonly<RuntimeModelConfiguration> | null | undefined;
  projectAccess(projectId: string): Promise<{ name: string }>;
  projectName(projectId: string): Promise<string>;
  readFile(projectId: string, relativePath: string): Promise<{ name: string; bytes: Buffer }>;
  observeFile(projectId: string, relativePath: string): Promise<{ sha256: string; bytes: number; observedAt: string }>;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>;
  isClosing(): boolean;
}) {
  const store = options.store;
  const directoryOf = (extractionId: string) => path.join(options.extractionRoot, extractionId);
  const domain = createAgentSessionDomain<BoardOwner>({
    name: 'decision-board-extraction',
    profile: {
      key: owner => owner.extractionId,
      projectId: owner => owner.projectId,
      configuration: owner => owner.capturedConfiguration,
      admit: async owner => {
        const record = store.readExtraction(owner.extractionId);
        if (!record || record.status !== 'running') throw new DecisionBoardFault('extraction_not_running');
        const running = store.runningExtractionForReport(record.reportId);
        if (running && running.id !== owner.extractionId) throw new DecisionBoardFault('extraction_busy');
        await options.projectAccess(owner.projectId);
      },
      agentOptions: owner => ({
        projectId: `decision-board:${owner.extractionId}`,
        workspace: boardWorkspace(directoryOf(owner.extractionId)),
        sessionDirectory: boardSessionDirectory(directoryOf(owner.extractionId)),
        codeRoot: options.codeRoot,
        resourceRoot: options.resourceRoot,
        managementPorts: options.managementPorts(),
      }),
    },
    configurationSnapshot: (id, revision) => options.configurationSnapshot(id, revision),
    mutate: options.mutate,
    isClosing: options.isClosing,
  });

  const sessionFile = (result: SessionResult) => result.sessionFile ?? (result.snapshot as { sessionFile?: string } | undefined)?.sessionFile;
  async function execute(owner: BoardOwner) {
    const ref = domain.ref(owner);
    try {
      await mkdir(boardWorkspace(directoryOf(owner.extractionId)).cwd, { recursive: true, mode: 0o700 });
      await mkdir(boardSessionDirectory(directoryOf(owner.extractionId)), { recursive: true, mode: 0o700 });
      await domain.withSession(ref, async lease => {
        const record = store.readExtraction(owner.extractionId);
        if (!record || record.status !== 'running') return;
        const report = store.getReport(record.reportId);
        const projectName = await options.projectName(owner.projectId).catch(() => owner.projectId);
        const result = await lease.run({ requestId: randomUUID(), text: buildExtractionPrompt({ projectName, reportPath: report?.relativePath ?? '', staged: { text: record.reportExcerpt, chars: record.sourceChars, truncated: record.truncated } }) });
        if (!lease.context.isCurrent()) return;
        if (result.outcome !== 'completed') {
          await options.mutate(() => store.finishExtraction(owner.extractionId, result.outcome === 'cancelled' ? { kind: 'cancelled', sessionFile: sessionFile(result) } : { kind: 'failed', error: readDiagnostic(result), sessionFile: sessionFile(result) })).catch(() => {});
          return;
        }
        const parsed = normalizeExtractionOutput(result.text);
        await options.mutate(() => store.finishExtraction(owner.extractionId, parsed.ok
          ? { kind: 'completed', items: enforceVerbatimQuotes(parsed.items, record.reportExcerpt).items, dropped: parsed.dropped, sessionFile: sessionFile(result) }
          : { kind: 'failed', error: parsed.error, sessionFile: sessionFile(result) })).catch(() => {});
      });
    } catch (error) {
      await options.mutate(() => store.finishExtraction(owner.extractionId, { kind: 'failed', error: runtimeDiagnostic(error).code || 'extraction_unknown' })).catch(() => {});
    } finally {
      await domain.close(ref).catch(() => {});
    }
  }
  function readDiagnostic(result: SessionResult): string { return result.diagnostic?.code || 'extraction_failed'; }

  async function start(projectId: string, relativePath: string): Promise<ExtractionRecord> {
    await options.projectAccess(projectId);
    // Reject non-report paths before any file bytes are read (DB11: never read 010_draw).
    if (typeof relativePath !== 'string' || !relativePath.startsWith('060_reports/')) throw new DecisionBoardFault('invalid_report_path');
    const configuration = options.configurationSnapshot();
    if (!configuration) throw new DecisionBoardFault('configuration_required');
    const observation = await options.observeFile(projectId, relativePath);
    const file = await options.readFile(projectId, relativePath);
    if (file.bytes.length !== observation.bytes) throw new DecisionBoardFault('report_changed_during_extraction');
    const staged = stageReportText(file.bytes);
    if (!staged) throw new DecisionBoardFault('report_not_utf8');
    // The recorded hash covers exactly the bytes staged for the model, not a second read.
    const sourceSha256 = createHash('sha256').update(file.bytes).digest('hex');
    const extractionId = randomUUID();
    const created = await options.mutate(() => {
      const report = store.registerReport({ projectId, relativePath, sha256: sourceSha256, bytes: observation.bytes });
      store.createExtraction({ id: extractionId, reportId: report.id, configuration: { id: configuration.id, name: configuration.name, provider: configuration.provider, model: configuration.model, revision: configuration.revision },
        sourceSha256, sourceBytes: observation.bytes, sourceChars: staged.chars, truncated: staged.truncated, reportExcerpt: staged.text });
      return store.readExtraction(extractionId)!;
    });
    void execute({ projectId, extractionId, capturedConfiguration: configuration });
    return created;
  }

  async function stop(extractionId: string): Promise<ExtractionRecord> {
    const record = store.readExtraction(extractionId);
    if (!record) throw new DecisionBoardFault('extraction_not_found');
    if (record.status !== 'running') return record;
    const report = store.getReport(record.reportId);
    await domain.stop(domain.ref({ projectId: report?.projectId ?? '', extractionId }));
    await options.mutate(() => store.finishExtraction(extractionId, { kind: 'cancelled' })).catch(() => {});
    return store.readExtraction(extractionId)!;
  }

  return {
    start, stop,
    busy: (projectId: string) => store.listExtractions().some(extraction => extraction.status === 'running' && store.getReport(extraction.reportId)?.projectId === projectId),
    closeAll: async (filter: { provider?: string; projectId?: string } = {}) => {
      await domain.closeAll(filter);
      for (const extraction of store.listExtractions()) {
        if (extraction.status !== 'running') continue;
        const report = store.getReport(extraction.reportId);
        if (filter.projectId && report?.projectId !== filter.projectId) continue;
        if (filter.provider && extraction.configuration.provider !== filter.provider) continue;
        await options.mutate(() => store.finishExtraction(extraction.id, { kind: 'failed', error: 'runtime_closed' })).catch(() => {});
      }
    },
  };
}
