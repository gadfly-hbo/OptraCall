export type EvidenceLevel = '数据支撑' | '多源佐证' | '逻辑推断' | '经验假设';
export type Priority = 'high' | 'medium' | 'low';
export type ItemStatus = 'suggested' | 'adopted' | 'dismissed';
export type TaskStatus = 'todo' | 'doing' | 'done';
export type ExtractionStatus = 'running' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export type SourceKind = 'extracted' | 'manual';

export const EVIDENCE_LEVELS: readonly EvidenceLevel[] = ['数据支撑', '多源佐证', '逻辑推断', '经验假设'];
export const PRIORITIES: readonly Priority[] = ['high', 'medium', 'low'];
/** Confidence is derived from the evidence level, never taken from model self-assessment. */
export const EVIDENCE_CONFIDENCE: Record<EvidenceLevel, number> = { '数据支撑': 0.9, '多源佐证': 0.75, '逻辑推断': 0.55, '经验假设': 0.35 };

export type EvidenceFact = { text: string; quote?: string };
export type Evidence = { facts: EvidenceFact[]; level: EvidenceLevel; reasoning: string };

export type ExtractionConfiguration = { id: string; name: string; provider: string; model: string; revision: number };

export type ReportRecord = {
  id: number; projectId: string; relativePath: string;
  observedSha256: string | null; observedBytes: number | null; observedAt: string | null;
  lastExtractionAt: string | null; firstSeenAt: string; updatedAt: string;
};
export type ExtractionRecord = {
  id: string; reportId: number;
  configuration: ExtractionConfiguration; status: ExtractionStatus; error: string | null;
  sourceSha256: string; sourceBytes: number; sourceChars: number; truncated: boolean;
  itemCount: number | null; droppedItemCount: number | null;
  sessionFile: string | null; reportExcerpt: string;
  createdAt: string; updatedAt: string;
};
export type BoardItemRecord = {
  id: string; projectId: string; reportId: number | null; extractionId: string | null; sourceKind: SourceKind;
  title: string; rationale: string; expectedImpact: string;
  priority: Priority; effort: string | null;
  confidence: number | null; evidenceLevel: EvidenceLevel | null; evidence: Evidence | null;
  status: ItemStatus; dismissedReason: string | null; decidedAt: string | null;
  createdAt: string; updatedAt: string;
};
export type BoardTaskRecord = {
  id: string; itemId: string; title: string; owner: string | null; dueDate: string | null;
  status: TaskStatus; priority: Priority; note: string;
  createdAt: string; updatedAt: string;
};
export type TaskFeedbackRecord = {
  taskId: string; adopted: boolean; outcome: string; metricDelta: string; review: string; score: number;
  createdAt: string; updatedAt: string;
};
export type BoardTaskView = BoardTaskRecord & { feedback?: TaskFeedbackRecord };
export type BoardItemView = BoardItemRecord & { tasks: BoardTaskView[] };

/** Validated extraction item shape produced by normalizeExtractionOutput. */
export type NormalizedItem = {
  title: string; rationale: string; expectedImpact: string;
  priority: Priority; effort: string | null;
  evidence: Evidence;
};
