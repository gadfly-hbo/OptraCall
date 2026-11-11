import type { SemanticTarget } from '../../semantic-context/types.ts';
import type { FrameworkDocument } from './validate.ts';

export const frameworkVersionPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;

export type FrameworkSourceReference = {
  id: string;
  kind: SemanticTarget['kind'];
  title: string;
  version: string;
  target: SemanticTarget;
  digest: string;
  extent: 'metadata' | 'fragment' | 'full';
};

export type FrameworkPublicSearch = {
  operationId: string;
  status: 'not_searched' | 'unavailable' | 'sources' | 'empty' | 'failed' | 'cancelled' | 'unknown';
  sources: readonly { title: string; url: string; publishedAt?: string; retrievedAt?: string; excerpt?: string }[];
  checkedAt?: string;
  findings?: string;
  issues?: readonly ('failed' | 'unknown')[];
};

export type FrameworkAssessment = {
  value: string;
  feasibility: string;
  scope: string;
  gaps: readonly string[];
  evidence?: readonly { sourceId: string; claim: string }[];
  publicComparability?: { status: 'comparable' | 'insufficient' | 'unknown'; note: string };
};

export type FrameworkMaterialTarget = Extract<SemanticTarget, { kind: 'data-input' | 'data-description' | 'data-citation' | 'data-evidence' }>;
export type FrameworkInput = { revision: string; rapVersion?: string; materialTargets?: readonly FrameworkMaterialTarget[] };
export type FrameworkConfirmation = { version: string; confirmedAt: string; confirmedBy: string };
export type FrameworkReviewState = { input: FrameworkInput; current?: string; confirmations: readonly FrameworkConfirmation[] };
export type FrameworkProposalRecord = {
  version: string;
  inputRevision: string;
  upstreamFingerprint: string;
  draftFingerprint: string;
  selectedRap?: { version: string; title: string; fingerprint: string; extent: 'full' | 'fragment' };
  framework: FrameworkDocument;
  assessment: FrameworkAssessment;
  sources: readonly FrameworkSourceReference[];
  publicSearch: FrameworkPublicSearch;
  repairAttempts: 0 | 1;
};

export type FrameworkProposalView = {
  version: string;
  status: 'pending' | 'confirmed' | 'stale';
  changes?: string[];
  framework?: FrameworkDocument;
  assessment?: FrameworkAssessment;
  selectedRap?: { version: string; title: string; extent?: 'full' | 'fragment'; readable?: false };
  sources: { id: string; kind: SemanticTarget['kind']; title: string; version: string; locator: SemanticTarget; extent: FrameworkSourceReference['extent'] }[];
  publicSearch: FrameworkPublicSearch;
  repairAttempts: 0 | 1;
  confirmedAt?: string;
  confirmedBy?: string;
};
