import { EVIDENCE_LEVELS, PRIORITIES, type Evidence, type EvidenceFact, type EvidenceLevel, type NormalizedItem, type Priority } from '../types.ts';

export type ExtractionParseResult =
  | { ok: true; items: NormalizedItem[]; dropped: number }
  | { ok: false; error: 'extraction_invalid_output' };

const MAX_ITEMS = 20, MAX_FACTS = 10;
const MAX_TITLE = 120, MAX_TEXT = 2000, MAX_IMPACT = 1000, MAX_EFFORT = 200, MAX_FACT = 500, MAX_QUOTE = 1000;

function bounded(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || [...trimmed].length > max) return null;
  return trimmed;
}

function fact(value: unknown): EvidenceFact | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const text = bounded((value as Record<string, unknown>).text, MAX_FACT);
  if (text === null) return null;
  const quote = bounded((value as Record<string, unknown>).quote, MAX_QUOTE);
  return quote === null ? { text } : { text, quote };
}

function item(value: unknown): NormalizedItem | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const title = bounded(raw.title, MAX_TITLE);
  const rationale = bounded(raw.rationale, MAX_TEXT);
  if (title === null || rationale === null) return null;
  const priority = raw.priority === undefined ? 'medium' : PRIORITIES.includes(raw.priority as Priority) ? raw.priority as Priority : null;
  if (priority === null) return null;
  const expectedImpact = bounded(raw.expectedImpact, MAX_IMPACT);
  const effort = bounded(raw.effort, MAX_EFFORT);
  const evidenceRaw = raw.evidence;
  if (!evidenceRaw || typeof evidenceRaw !== 'object' || Array.isArray(evidenceRaw)) return null;
  const evidence = evidenceRaw as Record<string, unknown>;
  if (!EVIDENCE_LEVELS.includes(evidence.level as EvidenceLevel)) return null;
  const reasoning = bounded(evidence.reasoning, MAX_TEXT);
  if (reasoning === null) return null;
  const facts = Array.isArray(evidence.facts) ? evidence.facts.map(fact).filter((entry): entry is EvidenceFact => entry !== null).slice(0, MAX_FACTS) : [];
  if (!facts.length) return null;
  const parsed: Evidence = { facts, level: evidence.level as EvidenceLevel, reasoning };
  return { title, rationale, expectedImpact: expectedImpact ?? '', priority, effort: effort ?? null, evidence: parsed };
}

/** Parses the single ```json block (or bare JSON array) from a model reply.
 * Invalid items are dropped and counted; confidence is never read from the model. */
export function normalizeExtractionOutput(text: string): ExtractionParseResult {
  const fenced = /```json\s*([\s\S]*?)```/i.exec(text);
  const candidate = fenced ? fenced[1]! : text.trim();
  let parsed: unknown;
  try { parsed = JSON.parse(candidate); } catch { return { ok: false, error: 'extraction_invalid_output' }; }
  const list = Array.isArray(parsed) ? parsed : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).items) ? (parsed as Record<string, unknown>).items as unknown[] : null;
  if (!list) return { ok: false, error: 'extraction_invalid_output' };
  const items: NormalizedItem[] = [];
  let dropped = 0;
  for (const value of list) {
    const normalized = item(value);
    if (normalized === null) { dropped++; continue; }
    if (items.length >= MAX_ITEMS) { dropped++; continue; }
    items.push(normalized);
  }
  return { ok: true, items, dropped };
}
