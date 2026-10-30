import { ProjectAgent, ProjectRuntimeError, type ProjectEvent } from '../agent/project-runtime.ts';
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

/**
 * Plugin session lifecycle for requirement instances — the generalized entry of
 * project-runtime driven with a workspace instead of a project directory. This is
 * the A-route seam: Qoder implementation, flagged for dedicated Codex review.
 * The manager transports SDK calls and events only; it never parses business data.
 */
export function createRequirementSessions(options: RequirementSessionManagerOptions) {
  type Entry = { agent: ProjectAgent; configuration: Readonly<RuntimeModelConfiguration> };
  type Opening = { configuration: Readonly<RuntimeModelConfiguration>; agent?: ProjectAgent; cancelled: boolean; task: Promise<ProjectAgent> };
  const entries = new Map<string, Entry>();
  const opening = new Map<string, Opening>();
  const sameConfiguration = (a: Readonly<RuntimeModelConfiguration>, b: Readonly<RuntimeModelConfiguration>) => a.id === b.id && a.revision === b.revision && a.provider === b.provider && a.model === b.model && a.apiKey === b.apiKey && a.api === b.api && a.baseUrl === b.baseUrl;
  const assertConfiguration = (snapshot: Readonly<RuntimeModelConfiguration>) => {
    const current = options.configurationSnapshot(snapshot.id, snapshot.revision);
    if (!current || !sameConfiguration(current, snapshot)) throw new ProjectRuntimeError('configuration_changed');
  };

  async function agentFor(instanceId: string): Promise<ProjectAgent> {
    const pending = opening.get(instanceId);
    if (pending) return pending.task;
    if (options.isClosing()) throw new ProjectRuntimeError('runtime_closed');
    const snapshot = options.configurationSnapshot();
    if (!snapshot) throw new ProjectRuntimeError('configuration_required');
    const assertOpening = () => {
      if (record.cancelled || opening.get(instanceId) !== record || options.isClosing()) throw new ProjectRuntimeError('runtime_closed');
      assertConfiguration(snapshot);
    };
    // Register ownership before joining the Host mutation queue. A credential
    // clear may own that queue and must invalidate this pending call without
    // waiting on the queued operation that follows it.
    const record: Opening = { configuration: snapshot, cancelled: false, task: Promise.resolve().then(async () => {
      try {
        const spawned = await options.mutate(() => {
          assertOpening();
          const existing = entries.get(instanceId);
          if (existing?.agent.alive && sameConfiguration(existing.configuration, snapshot)) { record.agent = existing.agent; return { agent: existing.agent, reused: true }; }
          if (existing?.agent.busy) throw new ProjectRuntimeError('session_busy');
          const agent = new ProjectAgent({
            projectId: `requirement:${instanceId}`,
            workspace: options.workspaceFor(instanceId),
            sessionDirectory: options.sessionDirectory(instanceId),
            codeRoot: options.codeRoot,
            resourceRoot: options.resourceRoot,
            configuration: snapshot,
            managementPorts: options.managementPorts(),
          });
          record.agent = agent;
          agent.subscribe(event => {
            if (entries.get(instanceId)?.agent === agent || (opening.get(instanceId) === record && !record.cancelled)) options.publish(instanceId, event);
          });
          return { agent, reused: false, previous: existing };
        });
        assertOpening();
        if (spawned.reused) return spawned.agent;
        if (spawned.previous) { await spawned.previous.agent.close(); if (entries.get(instanceId)?.agent === spawned.previous.agent) entries.delete(instanceId); }
        assertOpening();
        await spawned.agent.open();
        assertOpening();
        entries.set(instanceId, { agent: spawned.agent, configuration: snapshot });
        return spawned.agent;
      } catch (error) {
        if (record.agent) {
          if (entries.get(instanceId)?.agent === record.agent) entries.delete(instanceId);
          await record.agent.close().catch(() => {});
        }
        throw error;
      }
    }) };
    opening.set(instanceId, record);
    try { return await record.task; } finally { if (opening.get(instanceId) === record) opening.delete(instanceId); }
  }

  async function closeInstances(ids: Iterable<string>): Promise<void> {
    const targets = new Set<ProjectAgent>();
    for (const id of ids) {
      const pending = opening.get(id);
      if (pending) { pending.cancelled = true; opening.delete(id); if (pending.agent) targets.add(pending.agent); }
      const entry = entries.get(id);
      if (entry) { entries.delete(id); targets.add(entry.agent); }
    }
    await Promise.all([...targets].map(agent => agent.close()));
  }

  return {
    async run(instanceId: string, text: string, requestId: string): Promise<RequirementRunResult> {
      const agent = await agentFor(instanceId), entry = entries.get(instanceId);
      if (!entry || entry.agent !== agent || !agent.alive || options.isClosing()) throw new ProjectRuntimeError('runtime_closed');
      assertConfiguration(entry.configuration);
      const handle = agent.start(text, requestId);
      const result = await handle.completion;
      return { outcome: result.outcome, text: result.text };
    },
    async stop(instanceId: string): Promise<boolean> {
      if (opening.has(instanceId)) { await closeInstances([instanceId]); return true; }
      const entry = entries.get(instanceId);
      if (!entry) return false;
      await entry.agent.stop();
      return true;
    },
    busy(instanceId: string): boolean { return Boolean(entries.get(instanceId)?.agent.busy) || opening.has(instanceId); },
    live(instanceId: string): boolean { return Boolean(entries.get(instanceId)?.agent.alive); },
    close: (instanceId: string): Promise<void> => closeInstances([instanceId]),
    async closeAll(filter: { provider?: string } = {}): Promise<void> {
      const targets = new Set<ProjectAgent>();
      // A live entry and its replacement opening can belong to different
      // providers. Select the owned objects, not their shared instance ID.
      for (const [id, entry] of entries) if (!filter.provider || entry.configuration.provider === filter.provider) { entries.delete(id); targets.add(entry.agent); }
      for (const [id, pending] of opening) if (!filter.provider || pending.configuration.provider === filter.provider) { pending.cancelled = true; opening.delete(id); if (pending.agent) targets.add(pending.agent); }
      await Promise.all([...targets].map(agent => agent.close()));
    },
  };
}
