import type { ProjectEvent } from '../agent/project-runtime.ts';
import { createAgentSessionDomain } from './agent-sessions.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';

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
};
export type RequirementRunResult = { outcome: 'completed' | 'cancelled' | 'failed'; text: string };
export type RequirementSessionLease = { run: (text: string, requestId: string) => Promise<RequirementRunResult> };

/** Requirement business profile: current selection per operation, its own workspace,
 * no automatic native-history reconstruction, and its original result projection.
 * Resource state and lifecycle are owned exclusively by the shared domain implementation.
 */
export function createRequirementSessions(options: RequirementSessionManagerOptions) {
  const domain = createAgentSessionDomain<string>({
    name: 'requirements-elaboration',
    profile: {
      key: instanceId => instanceId,
      configuration: () => options.configurationSnapshot(),
      agentOptions: instanceId => ({
        projectId: `requirement:${instanceId}`,
        workspace: options.workspaceFor(instanceId),
        sessionDirectory: options.sessionDirectory(instanceId),
        codeRoot: options.codeRoot,
        resourceRoot: options.resourceRoot,
        managementPorts: options.managementPorts(),
      }),
    },
    configurationSnapshot: options.configurationSnapshot,
    mutate: options.mutate,
    isClosing: options.isClosing,
    publish: (instanceId, event) => options.publish(instanceId, event),
  });

  async function withSession<T>(instanceId: string, use: (lease: RequirementSessionLease) => Promise<T>): Promise<T> {
    return domain.withSession(domain.ref(instanceId), lease => use({
      run: async (text, requestId) => {
        const result = await lease.run({ text, requestId });
        return { outcome: result.outcome, text: result.text };
      },
    }));
  }

  return {
    withSession,
    run: (instanceId: string, text: string, requestId: string): Promise<RequirementRunResult> => withSession(instanceId, lease => lease.run(text, requestId)),
    stop: (instanceId: string): Promise<boolean> => domain.stop(domain.ref(instanceId)),
    busy: (instanceId: string): boolean => domain.busy(domain.ref(instanceId)),
    live: (instanceId: string): boolean => domain.live(domain.ref(instanceId)),
    close: (instanceId: string): Promise<void> => domain.close(domain.ref(instanceId)),
    closeAll: (filter: { provider?: string } = {}): Promise<void> => domain.closeAll(filter),
  };
}
