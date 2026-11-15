export type DbLinkEngine = 'postgresql' | 'mysql';
export type DbLinkTls = { ca?: string; rejectUnauthorized: true; verifyIdentity: true };
export type DbLinkBudget = {
  connectTimeoutMs: number; queryTimeoutMs: number; lockTimeoutMs: number;
  maxRows: number; maxBytes: number; maxCellBytes: number; chunkBytes: number; maxConcurrent: number;
};
export type DbLinkConnectionInput = {
  id?: string; name: string; engine: DbLinkEngine; host: string; port: number;
  database: string; username: string; password?: string; tls: DbLinkTls; budget: DbLinkBudget;
};
export type DbLinkRuntimeConnection = Omit<DbLinkConnectionInput, 'id' | 'password'> & {
  id: string; revision: number; fingerprint: string; password: string;
};
/** Host-only identity of the original read; never accepted through connection JSON. */
export type DbLinkReadOwner = { projectId: string; taskId: string; requestId: string; operationId: string };
/** These facts can only be supplied by the Host's configured probe, never HTTP JSON. */
export type DbLinkTestObservation = {
  reachable: boolean; sourceIdentity: string; permissionBinding: string;
  queryQualified: boolean; cancelCapability: 'verified' | 'unverified'; limitations: string[];
};
export type DbLinkProbeResourceState = { remoteTerminal: boolean; connectionEnded: boolean; commandTerminal: boolean; transactionEnded: boolean };
/** Host-only resource proof from the original catalog operation, never connection JSON. */
export type DbLinkProbeResult = {
  observation: DbLinkTestObservation; resourceState: DbLinkProbeResourceState;
  cleanup?: () => Promise<DbLinkProbeResourceState>;
};
export type DbLinkTestReceipt = DbLinkTestObservation & {
  id: string; fingerprint: string; testedAt: string; expiresAt: string;
};
export type DbLinkPublicConnection = Omit<DbLinkRuntimeConnection, 'password' | 'tls'> & {
  hasPassword: boolean; tls: Omit<DbLinkTls, 'ca'> & { hasCa: boolean };
  testedAt: string; observation: DbLinkTestObservation;
};
/** Explicit authorization only. This record is not proof that arbitrary SQL is constrained. */
export type DbLinkScope = { objects: string[]; description?: string };
export type DbLinkModelExport = { targets: string[]; structure: boolean; comments: boolean; queryText: boolean; results: boolean };
export type DbLinkProjectGrant = {
  id: string; projectId: string; connectionId: string; connectionRevision: number;
  connectionFingerprint: string; permissionBinding: string; scope: DbLinkScope;
  modelExport: DbLinkModelExport; grantedAt: string; revokedAt: string | null;
};
export type DbLinkProjectGrantInput = {
  connectionId: string; connectionRevision?: number; scope: DbLinkScope; modelExport: DbLinkModelExport;
};
export type DbLinkTaskPolicy = { excluded: boolean; scope?: DbLinkScope; modelExport?: DbLinkModelExport };
export type DbLinkSource = {
  grant: DbLinkProjectGrant; connection: DbLinkPublicConnection;
  scope: DbLinkScope; modelExport: DbLinkModelExport; configurationChanged: boolean;
};
export type DbLinkStoreOptions = {
  dataRoot: string;
  projectState: (projectId: string) => { archived: boolean } | null;
  taskProject: (taskId: string) => string | null;
  probe: (configuration: Readonly<DbLinkRuntimeConnection>) => Promise<DbLinkProbeResult>;
  now?: () => number;
  testReceiptTtlMs?: number;
};
