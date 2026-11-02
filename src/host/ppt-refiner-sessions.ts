import path from 'node:path';
import type { ProjectEvent } from '../agent/project-runtime.ts';
import { createAgentSessionDomain } from './agent-sessions.ts';
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
  configurationSnapshot: (id?: string, revision?: number) => Readonly<RuntimeModelConfiguration> | null | undefined;
  publish: (deckId: string, event: ProjectEvent) => void;
  mutate: <T,>(operation: () => T | Promise<T>) => Promise<T>;
  isClosing: () => boolean;
};

export type PptRefinerRunResult = { outcome: 'completed' | 'cancelled' | 'failed'; text: string; diagnostic?: RunDiagnostic };

/** Deck-bound model configuration: stored at register, falls back to current selection. */
export function refinerConfiguration(meta: { configuration?: { id: string; revision?: number } }, snapshot: (id?: string, revision?: number) => Readonly<RuntimeModelConfiguration> | null | undefined) {
  return meta.configuration ? snapshot(meta.configuration.id, meta.configuration.revision) : snapshot();
}

/** Refinement business profile: deck workspace + md anchor, unified lifecycle. */
export function createPptRefinerSessions(options: PptRefinerSessionManagerOptions) {
  const domain = createAgentSessionDomain<string>({
    name: 'ppt-refiner',
    profile: {
      key: deckId => deckId,
      configuration: deckId => refinerConfiguration(createDeckStore(path.join(options.deckRoot, deckId)).meta(), options.configurationSnapshot),
      agentOptions: deckId => {
        const deckDir = path.join(options.deckRoot, deckId);
        const meta = createDeckStore(deckDir).meta();
        return {
          projectId: `ppt-refiner:${deckId}`,
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
    publish: (deckId, event) => options.publish(deckId, event),
  });

  const refOf = (deckDir: string) => domain.ref(path.basename(deckDir));
  return {
    run: async (deckDir: string, turn: { text: string; requestId: string }): Promise<PptRefinerRunResult> => {
      const ref = refOf(deckDir);
      return domain.withSession(ref, async lease => {
        const result = await lease.run({ text: turn.text, requestId: turn.requestId });
        const diagnostic = readRunDiagnostic(result.diagnostic);
        return { outcome: result.outcome, text: result.text, ...(diagnostic ? { diagnostic } : {}) };
      });
    },
    stop: async (deckDir: string): Promise<void> => { await domain.stop(refOf(deckDir)); },
    busy: (deckDir: string): boolean => domain.busy(refOf(deckDir)),
    live: (deckDir: string): boolean => domain.live(refOf(deckDir)),
    close: (deckDir: string): Promise<void> => domain.close(refOf(deckDir)),
    closeAll: (filter: { provider?: string } = {}): Promise<void> => domain.closeAll(filter),
  };
}
