import type { ProjectEvent, ProjectSnapshot } from '../../agent/project-runtime.ts';

/** The Host snapshot owns transcript entries, including user-text projection. Raw events never append another history. */
export function projectDiscussionSnapshot(snapshot: ProjectSnapshot, event: ProjectEvent): ProjectSnapshot {
  return event.type === 'snapshot' ? event.snapshot : snapshot;
}
export function projectDiscussionStreaming(streaming: string, event: ProjectEvent, previousSnapshot?: ProjectSnapshot): string {
  if (event.type === 'text.delta') return streaming + event.text;
  if (event.type === 'run.settled' || event.type === 'native' && event.event.type === 'message_end' && event.event.message?.role === 'assistant') return '';
  if (event.type === 'snapshot') {
    if (event.snapshot.status === 'idle') return '';
    const last = event.snapshot.messages.at(-1);
    // Only a newly finalized native entry or appended finalized position retires this tail. Old history, even identical text, does not.
    if (previousSnapshot && last?.role === 'assistant' && (typeof last.nativeEntryId === 'string' ? !previousSnapshot.messages.some(message => message.nativeEntryId === last.nativeEntryId && message.nativeSessionId === last.nativeSessionId) : event.snapshot.messages.length > previousSnapshot.messages.length)) return '';
  }
  return streaming;
}
