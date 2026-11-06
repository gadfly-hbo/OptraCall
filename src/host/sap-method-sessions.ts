import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { createAgentSessionDomain, type AgentSessionDomainOptions, type SessionContext, type SessionFilter } from './agent-sessions.ts';
import type { ProjectEvent } from '../agent/project-runtime.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import { parseSapMethodExtractionOutcome, sapMethodExtractionPrompt, type SapMethodExtractionOutcome } from '../agent/sap-method-extraction.ts';
import type { SapMethodSources } from './sap-method-sources.ts';

export type SapMethodExtractionInput = {
  projectId: string; taskId: string; extractionId: string; configuration: Readonly<RuntimeModelConfiguration>;
};
export type SapMethodOwner = SapMethodExtractionInput & { sources?: SapMethodSources };
export type SapMethodOutcomeContext = {
  sources: SapMethodSources; sessionFile?: string; isCurrent(): boolean; assertCurrent(): void;
};
export type SapMethodExecutionResult<Result> = {
  outcome: 'completed' | 'cancelled' | 'failed'; result?: Result; sessionFile?: string; error?: string;
};
export type SapMethodSessionsOptions = {
  extractionRoot: string; codeRoot: string; resourceRoot: string; managementPorts(): number[];
  configurationSnapshot(id: string, revision: number): Readonly<RuntimeModelConfiguration> | null | undefined;
  mutate<T>(operation: () => T | Promise<T>): Promise<T>; isClosing(): boolean;
  admit(owner: SapMethodOwner): void | Promise<void>;
  prepareSources(owner: SapMethodOwner): Promise<SapMethodSources>;
  publish?(owner: SapMethodOwner, event: ProjectEvent, context: SessionContext<SapMethodOwner>): void;
  createAgent?: AgentSessionDomainOptions<SapMethodOwner>['createAgent'];
};

/** One attached business profile; the existing public domain alone owns resource state. */
export function createSapMethodSessions(options: SapMethodSessionsOptions) {
  const key = (owner: Pick<SapMethodOwner, 'projectId' | 'taskId' | 'extractionId'>) => `${owner.projectId}/${owner.taskId}/${owner.extractionId}`;
  const directory = (owner: SapMethodOwner) => path.join(options.extractionRoot, owner.extractionId);
  const domain = createAgentSessionDomain<SapMethodOwner>({
    name: 'sap-method-extraction',
    profile: {
      key, projectId: owner => owner.projectId, configuration: owner => owner.configuration,
      admit: options.admit,
      agentOptions: owner => ({
        projectId: `sap-method:${owner.extractionId}`,
        taskId: owner.taskId,
        workspace: { cwd: path.join(directory(owner), 'workspace'), capabilityPolicy: 'source-reader', defaultTools: [], systemPrompt: ['你是OptraCall的方法后置提炼Agent。只读Host授权来源，按需自行整理分析方法与明确判断依据。不执行代码、不修改原任务、文件或历史，不发布方法。'] },
        sessionDirectory: path.join(directory(owner), 'native'), codeRoot: options.codeRoot, resourceRoot: options.resourceRoot,
        managementPorts: options.managementPorts(),
        sapMethodSources: owner.sources!.read,
      }),
    },
    configurationSnapshot: options.configurationSnapshot, mutate: options.mutate, isClosing: options.isClosing,
    ...(options.publish ? { publish: options.publish } : {}), ...(options.createAgent ? { createAgent: options.createAgent } : {}),
  });
  const lookup = (owner: Pick<SapMethodOwner, 'projectId' | 'taskId' | 'extractionId'>) => domain.ref(owner as SapMethodOwner);
  return {
    async execute<Result>(input: SapMethodExtractionInput, onOutcome: (outcome: SapMethodExtractionOutcome, context: SapMethodOutcomeContext) => Promise<Result>): Promise<SapMethodExecutionResult<Result>> {
      const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
      if (![input.projectId, input.taskId, input.extractionId].every(value => uuid.test(value))) throw new Error('invalid_sap_method_owner');
      const owner: SapMethodOwner = { ...input, configuration: Object.freeze({ ...input.configuration }) }, ref = domain.ref(owner);
      let admitted = false;
      try {
        return await domain.withSession(ref, async lease => {
          admitted = true;
          const assertCurrent = () => { if (!domain.owns(ref, lease.context)) throw new Error('generation_cancelled'); };
          await options.admit(owner); assertCurrent();
          owner.sources = await options.prepareSources(owner); assertCurrent();
          await mkdir(path.join(directory(owner), 'workspace'), { recursive: true, mode: 0o700 }); assertCurrent();
          const result = await lease.run({ requestId: input.extractionId, text: sapMethodExtractionPrompt(owner.sources.promptContext) });
          const sessionFile = result.sessionFile ?? (result.snapshot as { sessionFile?: string } | undefined)?.sessionFile;
          if (result.outcome !== 'completed') return { outcome: result.outcome, ...(sessionFile ? { sessionFile } : {}), error: result.diagnostic?.code ?? 'sap_method_extraction_failed' };
          assertCurrent(); await owner.sources.assertUnchanged(); assertCurrent();
          await options.admit(owner); assertCurrent();
          const outcome = parseSapMethodExtractionOutcome(result.text);
          const saved = await onOutcome(outcome, { sources: owner.sources, ...(sessionFile ? { sessionFile } : {}), isCurrent: () => domain.owns(ref, lease.context), assertCurrent });
          return { outcome: 'completed', result: saved, ...(sessionFile ? { sessionFile } : {}) };
        });
      } finally {
        try { if (admitted) await domain.close(ref, { retryFailed: false }); }
        finally { owner.sources = undefined; }
      }
    },
    stop: (owner: Pick<SapMethodOwner, 'projectId' | 'taskId' | 'extractionId'>) => domain.stop(lookup(owner)),
    read: (owner: Pick<SapMethodOwner, 'projectId' | 'taskId' | 'extractionId'>) => domain.read(lookup(owner)),
    busy: (owner: Pick<SapMethodOwner, 'projectId' | 'taskId' | 'extractionId'>) => domain.busy(lookup(owner)),
    busyInScope: (filter: SessionFilter = {}) => domain.busyInScope(filter),
    busyForTask: (projectId: string, taskId: string) => domain.busyInScope({ projectId }, owner => owner.taskId === taskId),
    closeAll: (filter: SessionFilter = {}) => domain.closeAll(filter),
  };
}
