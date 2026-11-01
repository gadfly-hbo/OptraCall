/** Technical delivery records. None of these states means professional correctness. */
export type AutomaticOwner = { projectId: string; taskId: string };
export type AutomaticChainOwner = AutomaticOwner & { chainId: string };
export const automaticStates = ['preparing', 'running', 'paused', 'completed', 'cancelled', 'failed', 'unknown'] as const;
export const automaticPhases = ['prepare', 'cold', 'compare', 'author', 'recheck', 'ended'] as const;
export const automaticReasons = ['none', 'report_missing', 'report_unchanged', 'source_changed', 'semantics_changed', 'settings_changed', 'session_changed', 'configuration_changed', 'external_change', 'no_new_report', 'same_content', 'limit_reached', 'user_stopped', 'runtime_failed', 'persistence_failed', 'request_unknown', 'unsupported_protection'] as const;
export type AutomaticState = typeof automaticStates[number];
export type AutomaticPhase = typeof automaticPhases[number];
export type AutomaticReason = typeof automaticReasons[number];
export type AutomaticSettingsInput = {
  enabled: boolean; question?: string; dataFiles?: string[]; reportPath?: string; processFiles?: string[];
  businessContext?: string; requirementContext?: { instanceId: string; version?: string };
  useCurrentSap?: boolean; caseId?: string; caseRevision?: number; caseBackgroundIsPrior?: boolean;
  /** Absent means explicitly using the original task's bound configuration. */
  configurationId?: string; maxAuthorTurns?: 1 | 2 | 3;
};
export type AutomaticSettings = AutomaticOwner & Omit<AutomaticSettingsInput, 'dataFiles' | 'processFiles' | 'maxAuthorTurns'> & {
  formatVersion: 1; revision: number; dataFiles: string[]; processFiles: string[]; maxAuthorTurns: 1 | 2 | 3; updatedAt?: string;
};
export type AutomaticConfiguration = { id: string; revision: number; provider: string; model: string; name?: string; thinkingLevel?: string };
export type AutomaticNativeIdentity = { sessionFile: string; sessionId: string; bytes: number; sha256: string };
export type AutomaticObservedFile = { exists: false } | { exists: true; sha256: string; bytes: number };
export type AutomaticObservation = AutomaticOwner & {
  formatVersion: 1; requestId: string; requestFingerprint: string; settingsSnapshot: AutomaticSettings;
  native?: AutomaticNativeIdentity; completedNative?: AutomaticNativeIdentity; configuration: AutomaticConfiguration; verificationConfiguration?: AutomaticConfiguration; before: AutomaticObservedFile;
  admittedAt: string; updatedAt: string; after?: AutomaticObservedFile; observedAt?: string;
  reason: AutomaticReason; chainId?: string;
};
export type AutomaticObservationInput = Omit<AutomaticObservation, 'formatVersion' | 'admittedAt' | 'updatedAt' | 'reason'> & { admittedAt?: string; reason?: AutomaticReason };
export type AutomaticMaterial = {
  kind: 'data' | 'author' | 'report' | 'semantics'; relativePath: string; snapshotPath: string;
  bytes: number; sha256: string; observedAt: string;
};
export type AutomaticVersion = Omit<AutomaticMaterial, 'kind'> & {
  version: number; requestId?: string; recheckRequestId?: string;
};
export type AutomaticResultRef = { file: string; sha256: string; bytes: number; requestId: string; savedAt: string; text?: string };
export type AutomaticStep = {
  stepId: string; requestId: string; phase: Exclude<AutomaticPhase, 'prepare' | 'ended'>; ordinal: number;
  domain: 'project-tasks' | 'independent-verification'; owner: AutomaticOwner & { verificationId?: string };
  inputSha256?: string; status: 'planned' | 'accepted' | 'completed' | 'cancelled' | 'failed' | 'unknown';
  plannedAt: string; acceptedAt?: string; settledAt?: string; sessionFile?: string;
  result?: AutomaticResultRef;
  /** First cold/compare content remains authoritative in the original verification record. */
  verificationRef?: { verificationId: string; phase: 'cold' | 'compare'; requestId: string; sha256?: string };
};
export type AutomaticChain = AutomaticChainOwner & {
  formatVersion: 1; revision: number; triggerFingerprint: string; requestId: string; requestFingerprint: string; reportSha256: string;
  settingsSnapshot: AutomaticSettings; native: AutomaticNativeIdentity;
  configuration: AutomaticConfiguration; verificationConfiguration: AutomaticConfiguration;
  createdAt: string; updatedAt: string; state: AutomaticState; phase: AutomaticPhase; reason: AutomaticReason;
  authorAccepted: number; materials: AutomaticMaterial[]; versions: AutomaticVersion[]; steps: AutomaticStep[];
  semantics?: { text: string; sha256: string; sources: unknown[] };
  firstVerification?: { verificationId: string; coldRequestId?: string; compareRequestId?: string };
};
export type CreateAutomaticChainInput = AutomaticOwner & {
  requestId: string; requestFingerprint: string; reportSha256: string; settingsSnapshot: AutomaticSettings;
  native: AutomaticNativeIdentity; configuration: AutomaticConfiguration; verificationConfiguration: AutomaticConfiguration;
  materials?: AutomaticMaterial[]; versions?: AutomaticVersion[];
  semantics?: AutomaticChain['semantics']; firstVerification?: AutomaticChain['firstVerification'];
};
export type AutomaticChainUpdate = Partial<Pick<AutomaticChain, 'state' | 'phase' | 'reason' | 'authorAccepted' | 'materials' | 'versions' | 'steps' | 'firstVerification'>>;
/** Internal evidence-only completion of an already registered request. */
export type AutomaticStepFacts = Partial<Pick<AutomaticStep, 'status' | 'acceptedAt' | 'settledAt' | 'sessionFile' | 'result' | 'verificationRef'>>;
