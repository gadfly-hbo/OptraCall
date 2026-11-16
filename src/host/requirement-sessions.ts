import path from 'node:path';
import { ProjectRuntimeError, type ProjectEvent, type ProvidedContextInput } from '../agent/project-runtime.ts';
import { createAgentSessionDomain, type AgentSessionDomainOptions, type SessionLease } from './agent-sessions.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import { readRunDiagnostic, type RunDiagnostic } from '../agent/run-diagnostics.ts';
import type { SemanticContextReadPort } from '../agent/semantic-context.ts';
import type { FrameworkMaterialTarget, FrameworkPublicSearch, FrameworkSourceReference } from '../../extensions/business-plugins/requirements-elaboration/contract/framework-review.ts';
import { frameworkSystemPrompt } from '../../extensions/business-plugins/requirements-elaboration/session/workspace.ts';
import { createRequirementPublicSearch } from './requirement-public-search.ts';
import { dbLinkModelOutlet } from './db-link-planning.ts';

type SourceAccess = { read: SemanticContextReadPort; references: () => readonly FrameworkSourceReference[] };
type ConfigurationIdentity = Pick<RuntimeModelConfiguration, 'id' | 'revision'>;
type RequirementOwner = { instanceId: string; configuration?: Readonly<RuntimeModelConfiguration> };
type FrameworkOwner = { instanceId: string; operationId: string; configuration: ConfigurationIdentity; sources: SourceAccess };

export type RequirementWorkspaceDescriptor = { cwd: string; systemPrompt: readonly string[]; defaultTools?: readonly string[] };
export type RequirementSessionManagerOptions = {
  codeRoot: string;
  resourceRoot: string;
  managementPorts: () => number[];
  sessionDirectory: (instanceId: string) => string;
  workspaceFor: (instanceId: string) => RequirementWorkspaceDescriptor;
  configurationSnapshot: (id?: string, revision?: number) => Readonly<RuntimeModelConfiguration> | null | undefined;
  publish: (instanceId: string, event: ProjectEvent) => void;
  mutate: <T,>(operation: () => T | Promise<T>) => Promise<T>;
  isClosing: () => boolean;
  beginFrameworkSources?: (targets: readonly FrameworkMaterialTarget[], assertCurrent: () => void) => SourceAccess;
  /** The original Host transport seam; production construction stays in the shared domain. */
  createAgent?: AgentSessionDomainOptions<RequirementOwner>['createAgent'];
};
export type RequirementRunResult = { outcome: 'completed' | 'cancelled' | 'failed'; text: string; diagnostic?: RunDiagnostic };
type GenerationSession = { run: (text: string, requestId: string, verifyBeforeDispatch?: () => Promise<void>, providedContext?: ProvidedContextInput) => Promise<RequirementRunResult> };
export type RequirementSessionLease = GenerationSession & {
  /** Host metadata only; validity still comes from this lease's isCurrent(). */
  readonly modelIdentity: Readonly<ConfigurationIdentity & { outlet: string }>;
  isCurrent: () => boolean;
  withFramework: <T>(operationId: string, publicTopic: string | undefined, targets: readonly FrameworkMaterialTarget[], assertInput: () => void, use: (session: GenerationSession, search: FrameworkPublicSearch, references: SourceAccess['references']) => Promise<T>) => Promise<T>;
};

/** Requirement business profile: current selection per operation, its own workspace,
 * no automatic native-history reconstruction, and its original result projection.
 * Resource state and lifecycle are owned exclusively by the shared domain implementation.
 */
export function createRequirementSessions(options: RequirementSessionManagerOptions) {
  const domain = createAgentSessionDomain<RequirementOwner>({
    name: 'requirements-elaboration',
    profile: {
      key: owner => owner.instanceId,
      projectId: ({ instanceId }) => instanceId.startsWith('req-plan-') ? instanceId.slice(9) : undefined,
      configuration: owner => owner.configuration ?? options.configurationSnapshot(),
      agentOptions: ({ instanceId }) => ({
        projectId: `requirement:${instanceId}`,
        workspace: options.workspaceFor(instanceId),
        sessionDirectory: options.sessionDirectory(instanceId),
        codeRoot: options.codeRoot,
        resourceRoot: options.resourceRoot,
        managementPorts: options.managementPorts(),
      }),
    },
    configurationSnapshot: options.configurationSnapshot,
    createAgent: options.createAgent,
    mutate: options.mutate,
    isClosing: options.isClosing,
    publish: (owner, event) => options.publish(owner.instanceId, event),
  });

  const publicSearch = createRequirementPublicSearch(options);
  const framework = createAgentSessionDomain<FrameworkOwner>({
    name: 'requirements-framework',
    profile: {
      key: owner => owner.instanceId,
      configuration: owner => options.configurationSnapshot(owner.configuration.id, owner.configuration.revision),
      agentOptions(owner) {
        const directory = path.join(options.sessionDirectory(owner.instanceId), 'framework', owner.operationId);
        const workspace = options.workspaceFor(owner.instanceId);
        return {
          projectId: `requirement:${owner.instanceId}`,
          workspace: { ...workspace, cwd: path.join(directory, 'workspace'), systemPrompt: frameworkSystemPrompt, capabilityPolicy: 'source-reader' },
          sessionDirectory: path.join(directory, 'native'),
          resourceRoot: path.join(directory, 'resources'),
          codeRoot: options.codeRoot,
          managementPorts: [],
          semanticContextRead: owner.sources.read,
        };
      },
    },
    configurationSnapshot: options.configurationSnapshot,
    mutate: options.mutate,
    isClosing: options.isClosing,
    publish(owner, event) {
      if (event.type === 'run.accepted' || event.type === 'run.settled') options.publish(owner.instanceId, event);
    },
  });

  function generationSession<Owner>(lease: SessionLease<Owner>): GenerationSession {
    return {
      async run(text, requestId, verifyBeforeDispatch, providedContext) {
        const result = await lease.run({ text, requestId, verifyBeforeDispatch, providedContext });
        const diagnostic = readRunDiagnostic(result.diagnostic);
        return { outcome: result.outcome, text: result.text, ...(diagnostic ? { diagnostic } : {}) };
      },
    };
  }

  async function withSession<T>(instanceId: string, use: (lease: RequirementSessionLease) => Promise<T>): Promise<T> {
    // The shared domain captures synchronously at reserve. Child profiles
    // receive only that same configuration identity.
    const selected = structuredClone(options.configurationSnapshot());
    if (!selected) throw new ProjectRuntimeError('configuration_required');
    const parentRef = domain.ref({ instanceId, configuration: selected });
    return domain.withSession(parentRef, lease => use({
      ...generationSession(lease),
      modelIdentity: Object.freeze({ id: selected.id, revision: selected.revision, outlet: dbLinkModelOutlet(selected) }),
      isCurrent: () => domain.owns(parentRef, lease.context) && Boolean(options.configurationSnapshot(selected.id, selected.revision)),
      async withFramework(operationId, publicTopic, targets, assertInput, generate) {
        if (!options.beginFrameworkSources) throw new ProjectRuntimeError('runtime_unavailable');
        const configuration = { id: selected.id, revision: selected.revision };
        // Preserve the public-search adapter's original string owner view; its
        // currentness and cancellation still use this same authoritative lease.
        const parent = { context: { owner: instanceId, isCurrent: () => domain.owns(parentRef, lease.context) }, onCancel: lease.onCancel };
        const search = await publicSearch.run({ instanceId, operationId, topic: publicTopic, configuration, parent });
        if (!domain.owns(parentRef, lease.context) || search.status === 'cancelled') throw new ProjectRuntimeError('generation_cancelled');
        const sources = options.beginFrameworkSources(targets, () => {
          if (!domain.owns(parentRef, lease.context)) throw new ProjectRuntimeError('generation_cancelled');
          assertInput();
        });
        const ref = framework.ref({ instanceId, operationId, configuration, sources });
        const removeCancel = lease.onCancel(({ retryFailed }) => framework.close(ref, { retryFailed }));
        try {
          return await framework.withSession(ref, child => generate(generationSession(child), search, sources.references));
        } finally {
          await framework.close(ref, { retryFailed: false }).catch(() => { throw new ProjectRuntimeError('runtime_unavailable'); });
          removeCancel();
        }
      },
    }));
  }

  return {
    withSession,
    run: (instanceId: string, text: string, requestId: string): Promise<RequirementRunResult> => withSession(instanceId, lease => lease.run(text, requestId)),
    currentRequestId: (instanceId: string) => domain.currentRequestId(domain.ref({ instanceId })),
    async stop(instanceId: string, guard?: { expectedRequestId: string }): Promise<boolean> {
      const ref = domain.ref({ instanceId });
      if (guard || domain.executionState(ref).mode !== 'unknown') return domain.stop(ref, guard);
      await domain.close(ref);
      return true;
    },
    busy: (instanceId: string): boolean => domain.busy(domain.ref({ instanceId })),
    live: (instanceId: string): boolean => domain.live(domain.ref({ instanceId })),
    async close(instanceId: string): Promise<void> {
      await domain.close(domain.ref({ instanceId }));
      await framework.closeAll({}, owner => owner.instanceId === instanceId);
      await publicSearch.close(instanceId);
    },
    async closeAll(filter: { provider?: string } = {}): Promise<void> {
      await domain.closeAll(filter);
      await framework.closeAll(filter);
      await publicSearch.closeAll(filter);
    },
  };
}
