import { createHash } from 'node:crypto';

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Annotate a read projection only; SDK messages and persisted source envelopes stay intact. */
export function presentContextMessages<Message extends { role: string; content?: unknown }>(messages: readonly Message[], entries: readonly unknown[]): (Message & { originalUserText?: string })[] {
  const questions = new Map<string, string>();
  for (const entry of entries) {
    if (!object(entry) || entry.type !== 'custom' || entry.customType !== 'optracall.run' || !object(entry.data)) continue;
    const context = entry.data.providedContext;
    if (!object(context) || context.version !== 1 || typeof context.originalUserText !== 'string' || context.originalUserText.length > 20000 ||
      typeof context.requestTextSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(context.requestTextSha256)) continue;
    questions.set(context.requestTextSha256, context.originalUserText);
  }
  return messages.map(message => {
    if (message.role !== 'user') return message;
    const raw = typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content
      .filter((part): part is Record<string, unknown> => object(part) && part.type === 'text' && typeof part.text === 'string').map(part => part.text).join('') : undefined;
    if (raw === undefined) return message;
    const originalUserText = questions.get(createHash('sha256').update(raw).digest('hex'));
    return originalUserText === undefined ? message : { ...message, originalUserText };
  });
}
