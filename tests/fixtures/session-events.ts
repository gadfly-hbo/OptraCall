import type { ProjectEvent } from '../../src/agent/project-runtime.ts';
import type { startTestHost } from './host-process.ts';

export async function sessionEvents(host: Awaited<ReturnType<typeof startTestHost>>, projectId: string, taskId: string) {
  const response = await host.request(`/api/projects/${projectId}/tasks/${taskId}/events`);
  if (response.status !== 200 || !response.body) throw new Error('Synthetic session stream unavailable.');
  const reader = response.body.getReader(), decoder = new TextDecoder(), events: ProjectEvent[] = [];
  let settle!: (event: ProjectEvent) => void, fail!: (error: unknown) => void;
  const terminal = new Promise<ProjectEvent>((resolve, reject) => { settle = resolve; fail = reject; });
  void terminal.catch(() => {});
  const pump = (async () => {
    let buffer = '';
    try {
      for (;;) {
        const next = await reader.read(); if (next.done) break;
        buffer += decoder.decode(next.value, { stream: true });
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const line = block.split('\n').find(value => value.startsWith('data: ')); if (!line) continue;
          const value = JSON.parse(line.slice(6));
          if (value.type) { events.push(value); if (value.type === 'run.settled') settle(value); }
        }
      }
      if (!events.some(event => event.type === 'run.settled')) fail(new Error('Session ended without a terminal event.'));
    } catch (error) { fail(error); }
  })();
  return { events, terminal, close: async () => { await reader.cancel(); await pump; } };
}
