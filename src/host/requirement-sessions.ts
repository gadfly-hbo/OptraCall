import { ProjectAgent, ProjectRuntimeError, type ProjectEvent } from '../agent/project-runtime.ts';
import type { RuntimeModelConfiguration } from './config-store.ts';

export type RequirementWorkspaceDescriptor = { cwd: string; systemPrompt: readonly string[]; defaultTools?: readonly string[] };
export type RequirementSessionManagerOptions = {
  codeRoot: string;
  resourceRoot: string;
  managementPorts: () => number[];
  sessionDirectory: (instanceId: string) => string;
  workspaceFor: (instanceId: string) => RequirementWorkspaceDescriptor;
  configurationSnapshot: () => Readonly<RuntimeModelConfiguration> | null | undefined;
  publish: (instanceId: string, event: ProjectEvent) => void;
  mutate: <T,>(operation: () => T | Promise<T>) => Promise<T>;
  isClosing: () => boolean;
};
export type RequirementRunResult = { outcome: 'completed' | 'cancelled' | 'failed'; text: string };

/**
 * Plugin session lifecycle for requirement instances — the generalized entry of
 * project-runtime driven with a workspace instead of a project directory. This is
 * the A-route seam: Qoder implementation, flagged for dedicated Codex review.
 * The manager transports SDK calls and events only; it never parses business data.
 */
export function createRequirementSessions(options: RequirementSessionManagerOptions) {
  type Entry = { agent: ProjectAgent; configuration: Readonly<RuntimeModelConfiguration> };
  const entries = new Map<string, Entry>();
  const opening = new Map<string, Promise<ProjectAgent>>();
  const sameConfiguration = (a: Readonly<RuntimeModelConfiguration>, b: Readonly<RuntimeModelConfiguration>) => a.apiKey === b.apiKey && a.api === b.api && a.baseUrl === b.baseUrl;

  async function agentFor(instanceId: string): Promise<ProjectAgent> {
    const pending = opening.get(instanceId);
    if (pending) return pending;
    const task = (async () => {
      const spawned = await options.mutate(async () => {
        if (options.isClosing()) throw new ProjectRuntimeError('runtime_closed');
        const snapshot = options.configurationSnapshot();
        if (!snapshot) throw new ProjectRuntimeError('configuration_required');
        const existing = entries.get(instanceId);
        if (existing?.agent.alive && sameConfiguration(existing.configuration, snapshot)) return { agent: existing.agent, reused: true, snapshot };
        const agent = new ProjectAgent({
          projectId: `requirement:${instanceId}`,
          workspace: options.workspaceFor(instanceId),
          sessionDirectory: options.sessionDirectory(instanceId),
          codeRoot: options.codeRoot,
          resourceRoot: options.resourceRoot,
          configuration: snapshot,
          managementPorts: options.managementPorts(),
        });
        agent.subscribe(event => options.publish(instanceId, event));
        return { agent, reused: false, snapshot, previous: existing };
      });
      if (spawned.reused) return spawned.agent;
      try {
        if (spawned.previous) { await spawned.previous.agent.close(); if (entries.get(instanceId)?.agent === spawned.previous.agent) entries.delete(instanceId); }
        await spawned.agent.open();
        entries.set(instanceId, { agent: spawned.agent, configuration: spawned.snapshot });
        return spawned.agent;
      } catch (error) {
        if (entries.get(instanceId)?.agent === spawned.agent) entries.delete(instanceId);
        await spawned.agent.close().catch(() => {});
        throw error;
      }
    })();
    opening.set(instanceId, task);
    try { return await task; } finally { if (opening.get(instanceId) === task) opening.delete(instanceId); }
  }

  return {
    async run(instanceId: string, text: string, requestId: string): Promise<RequirementRunResult> {
      const agent = await agentFor(instanceId);
      const handle = agent.start(text, requestId);
      const result = await handle.completion;
      return { outcome: result.outcome, text: result.text };
    },
    async stop(instanceId: string): Promise<boolean> {
      const entry = entries.get(instanceId);
      if (!entry) return false;
      await entry.agent.stop();
      return true;
    },
    busy(instanceId: string): boolean {
      return Boolean(entries.get(instanceId)?.agent.busy) || opening.has(instanceId);
    },
    live(instanceId: string): boolean {
      return Boolean(entries.get(instanceId)?.agent.alive);
    },
    async close(instanceId: string): Promise<void> {
      const entry = entries.get(instanceId);
      if (!entry) return;
      entries.delete(instanceId);
      await entry.agent.close();
    },
    async closeAll(filter: { provider?: string } = {}): Promise<void> {
      const targets: Entry[] = [];
      for (const [id, entry] of entries) if (!filter.provider || entry.configuration.provider === filter.provider) { entries.delete(id); targets.push(entry); }
      await Promise.all(targets.map(entry => entry.agent.close()));
    },
  };
}
