import type { RunDiagnostic } from './run-diagnostics.ts';
export type Outcome = 'completed' | 'cancelled' | 'failed';
export type PresentationEvent = { sessionId: string; requestId: string } & (
  { type: 'text.delta'; text: string } |
  { type: 'message.final'; text: string } |
  { type: 'run.settled'; outcome: Outcome; error?: string; diagnostic?: RunDiagnostic }
);
