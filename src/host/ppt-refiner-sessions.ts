import path from 'node:path';
import { ProjectRuntimeError, type ProjectEvent } from '../agent/project-runtime.ts';
import { createAgentSessionDomain, type AgentSessionDomainOptions } from './agent-sessions.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';
import { readRunDiagnostic, type RunDiagnostic } from '../agent/run-diagnostics.ts';
import { createDeckStore } from '../../extensions/business-plugins/ppt-refiner/storage/deck-store.ts';
import { refinerSystemPrompt, refinerWorkspace } from '../../extensions/business-plugins/ppt-refiner/session/workspace.ts';

export type PptRefinerSessionManagerOptions = {
  codeRoot: string;
  resourceRoot: string;
  managementPorts: () => number[];
  deckRoot: string;
  skillScriptsDir: string;
  resolveOwner: (deckId: string) => Promise<{ projectId: string; configuration: { id: string; revision: number } }>;
  configurationSnapshot: (id?: string, revision?: number) => Readonly<RuntimeModelConfiguration> | null | undefined;
  publish: (deckId: string, event: ProjectEvent) => void;
  mutate: <T,>(operation: () => T | Promise<T>) => Promise<T>;
  isClosing: () => boolean;
  /** Host-only transport replacement for tests, never supplied by a business request. */
  createAgent?: AgentSessionDomainOptions<PptRefinerOwner>['createAgent'];
};

export type PptRefinerRunResult = { outcome: 'completed' | 'cancelled' | 'failed'; text: string; diagnostic?: RunDiagnostic };
export type PptRefinerSessionLease = {
  run(turn: { text: string; requestId: string }): Promise<PptRefinerRunResult>;
  commit<T>(operation: () => T | Promise<T>): Promise<T>;
  isCurrent(): boolean;
};
type PptRefinerOwner = {
  deckId: string;
  projectId?: string;
  configuration?: { id: string; revision: number };
};

/** Legacy metadata may use its Host-verified project's fixed configuration, never the global selection. */
export function refinerConfiguration(meta: { configuration?: { id: string; revision?: number } }, snapshot: (id?: string, revision?: number) => Readonly<RuntimeModelConfiguration> | null | undefined, projectConfiguration?: { id: string; revision: number }) {
  const configuration = meta.configuration ?? projectConfiguration;
  return configuration ? snapshot(configuration.id, configuration.revision) : undefined;
}

/** Refinement business profile: deck workspace + md anchor, unified lifecycle. */
export function createPptRefinerSessions(options: PptRefinerSessionManagerOptions) {
  const fail = (code: string): never => { throw new ProjectRuntimeError(code); };
  const deckIdOf = (deckDir: string) => {
    const deckId = path.basename(deckDir);
    if (!/^deck-[a-z0-9][a-z0-9-]{0,64}$/.test(deckId) || path.resolve(deckDir) !== path.resolve(options.deckRoot, deckId)) fail('invalid_session_reference');
    return deckId;
  };
  const resolve = async (deckId: string): Promise<PptRefinerOwner> => {
    if (options.isClosing()) fail('runtime_closed');
    const owner = await options.resolveOwner(deckId);
    if (options.isClosing()) fail('runtime_closed');
    if (!owner.projectId) fail('project_required');
    if (!owner.configuration?.id || !Number.isSafeInteger(owner.configuration.revision)) fail('configuration_required');
    return { deckId, projectId: owner.projectId, configuration: { ...owner.configuration } };
  };
  const assertOwner = async (owner: PptRefinerOwner) => {
    const current = await resolve(owner.deckId);
    if (current.projectId !== owner.projectId) fail('project_changed');
    if (current.configuration?.id !== owner.configuration?.id || current.configuration?.revision !== owner.configuration?.revision) fail('configuration_changed');
  };
  const domain = createAgentSessionDomain<PptRefinerOwner>({
    name: 'ppt-refiner',
    profile: {
      key: owner => owner.deckId,
      projectId: owner => owner.projectId,
      configuration: owner => owner.configuration ? options.configurationSnapshot(owner.configuration.id, owner.configuration.revision) : undefined,
      admit: assertOwner,
      agentOptions: owner => {
        const projectId = owner.projectId ?? fail('project_required');
        const deckDir = path.join(options.deckRoot, owner.deckId);
        const meta = createDeckStore(deckDir).meta();
        return {
          projectId,
          workspace: {
            ...refinerWorkspace(deckDir),
            systemPrompt: refinerSystemPrompt(meta, {
              skillScriptsDir: options.skillScriptsDir,
              editScript: path.resolve(options.codeRoot, 'extensions/business-plugins/ppt-refiner/scripts/edit_slide.py'),
            }),
          },
          sessionDirectory: path.join(deckDir, 'sessions'),
          codeRoot: options.codeRoot,
          resourceRoot: options.resourceRoot,
          managementPorts: options.managementPorts(),
        };
      },
    },
    configurationSnapshot: options.configurationSnapshot,
    mutate: options.mutate,
    isClosing: options.isClosing,
    publish: (owner, event) => options.publish(owner.deckId, event),
    ...(options.createAgent ? { createAgent: options.createAgent } : {}),
  });

  // Key-only references remain private to Host state/stop lookups. They cannot
  // reserve an operation: only a fully resolved owner supplies a configuration.
  const lookup = (deckDir: string) => domain.ref({ deckId: deckIdOf(deckDir) });
  async function withSession<T>(deckDir: string, use: (lease: PptRefinerSessionLease) => Promise<T>): Promise<T> {
    const owner = await resolve(deckIdOf(deckDir));
    return domain.withSession(domain.ref(owner), async lease => {
      let active = true;
      const isCurrent = () => active && lease.context.isCurrent();
      try {
        return await use({
          isCurrent,
          run: async turn => {
            const result = await lease.run({ text: turn.text, requestId: turn.requestId });
            const diagnostic = readRunDiagnostic(result.diagnostic);
            return { outcome: result.outcome, text: result.text, ...(diagnostic ? { diagnostic } : {}) };
          },
          commit: operation => options.mutate(async () => {
            if (!isCurrent()) fail('generation_cancelled');
            await assertOwner(owner);
            if (!isCurrent()) fail('generation_cancelled');
            return operation();
          }),
        });
      } finally { active = false; }
    });
  }
  return {
    withSession,
    run: (deckDir: string, turn: { text: string; requestId: string }): Promise<PptRefinerRunResult> => withSession(deckDir, lease => lease.run(turn)),
    mutate: <T,>(deckDir: string, operation: () => T | Promise<T>): Promise<T> => options.mutate(async () => {
      const ref = lookup(deckDir);
      if (domain.busy(ref)) fail('session_busy');
      await resolve(deckIdOf(deckDir));
      if (domain.busy(ref)) fail('session_busy');
      return operation();
    }),
    stop: async (deckDir: string): Promise<void> => { await domain.stop(lookup(deckDir)); },
    busy: (deckDir: string): boolean => domain.busy(lookup(deckDir)),
    busyProject: (projectId: string): boolean => domain.busyInScope({ projectId }),
    live: (deckDir: string): boolean => domain.live(lookup(deckDir)),
    close: (deckDir: string): Promise<void> => domain.close(lookup(deckDir)),
    closeAll: (filter: { provider?: string; projectId?: string } = {}): Promise<void> => domain.closeAll(filter),
  };
}
