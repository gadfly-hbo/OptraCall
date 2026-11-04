/** SAP method assets share one lifecycle regardless of their original source. */
export type SapMethodOrigin = 'ir' | 'other';
export type SapMethodContent = { conditions: string; logic: string; judgment: string; limits: string };
export type SapMethodRef = { methodId: string; version: number };
export type SapMethodSource = {
  type: 'session' | 'memory' | 'report' | 'method' | 'manual';
  label: string;
  ref: string;
  version: string | null;
  sha256: string | null;
};
export type SapMethodRelation = {
  kind: 'revision' | 'derived' | 'correction';
  target: SapMethodRef;
  reason: string;
};
export type SapMethodVersion = {
  schemaVersion: 1;
  methodId: string;
  version: number;
  origin: SapMethodOrigin;
  title: string;
  content: SapMethodContent;
  sources: SapMethodSource[];
  relation: SapMethodRelation | null;
  savedAt: string;
  contentSha256: string;
  requestId: string;
};
export type SapMethodPublication = {
  version: number;
  contentSha256: string;
  publishedAt: string;
  requestId: string;
};
export type SapMethodGovernance = {
  version: number;
  revision: number;
  status: 'suspected' | 'confirmed';
  note: string;
  replacement: SapMethodRef | null;
  recordedAt: string;
  requestId: string;
};
export type SapMethodSummary = {
  id: string;
  title: string;
  origin: SapMethodOrigin;
  latestVersion: number;
  publishedVersion: number | null;
  updatedAt: string;
  hasUnpublishedChanges: boolean;
  issue: SapMethodGovernance | null;
};
export type SapMethodDetail = SapMethodSummary & {
  selectedVersion: number;
  versions: SapMethodVersion[];
  publications: SapMethodPublication[];
  governance: SapMethodGovernance[];
  governanceRevision: number;
};
export type SapMethodSaveInput = {
  requestId: string;
  methodId?: string;
  baseVersion?: number;
  origin: SapMethodOrigin;
  title: string;
  content: SapMethodContent;
  sources: SapMethodSource[];
  relation?: SapMethodRelation | null;
};
export type SapMethodPublishInput = { requestId: string; version: number; expectedSha256: string };
export type SapMethodIssueInput = {
  requestId: string;
  version: number;
  expectedRevision: number;
  status: 'suspected' | 'confirmed';
  note: string;
  replacement?: SapMethodRef | null;
};
export type SapMethodWriteResult = { method: SapMethodDetail; version: SapMethodVersion; replayed: boolean };
export type SapMethodPublishedRead = { version: SapMethodVersion; publication: SapMethodPublication; issue: SapMethodGovernance | null };
export type SapMethodListOptions = { origin?: SapMethodOrigin; status?: 'draft' | 'published'; query?: string };
export type SapMethodOperation = {
  schemaVersion: 1;
  requestId: string;
  kind: 'save' | 'publish' | 'issue';
  fingerprint: string;
  contentSha256: string;
  methodId: string;
  version: number;
  recordedAt: string;
};
export type SapMethodOperationState = SapMethodOperation & { status: 'pending' | 'committed' };
