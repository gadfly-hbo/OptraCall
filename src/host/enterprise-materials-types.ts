/** Enterprise materials are source documents, never an analysis policy or a truth registry. */
export type EnterpriseMaterialFields = {
  title: string; category: string; body: string; source: string; owner: string; scope: string; effectiveTime: string;
  sourceFileId: string | null;
};
export type EnterpriseSourceFile = {
  id: string; name: string; bytes: number; sha256: string; path: string; createdAt: string;
};
export type EnterpriseMaterialRevision = EnterpriseMaterialFields & {
  revisionId: string; number: number; createdAt: string; bodySha256: string; bodyPath: string;
  sourceFile: EnterpriseSourceFile | null;
};
export type EnterpriseMaterial = {
  id: string; version: number; createdAt: string; updatedAt: string; enabled: boolean; activeRevisionId: string | null;
  draft: EnterpriseMaterialFields; revisions: EnterpriseMaterialRevision[]; files: EnterpriseSourceFile[];
};
export type EnterpriseMaterialSummary = {
  id: string; version: number; title: string; category: string; scope: string; updatedAt: string;
  enabled: boolean; activeRevisionId: string | null; revisionCount: number; bodyReadable: boolean;
};
export type EnterpriseMaterialsList = { storeId: string; directoryPath: string; materials: EnterpriseMaterialSummary[] };
export type EnterpriseMaterialDetail = { storeId: string; material: EnterpriseMaterial };
export type EnterpriseMaterialRef = { storeId: string; materialId: string; revisionId: string };
export type EnterpriseCaseSupplement = {
  id: string; text: string; source: string; scope: string; confirmation: string; createdAt: string; updatedAt: string;
};
export type EnterpriseCaseContext = {
  schemaVersion: 1; storeId: string; caseStoreId: string; caseId: string; revision: number; updatedAt: string | null;
  materials: EnterpriseMaterialRef[]; supplements: EnterpriseCaseSupplement[];
};
export type EnterpriseCaseSupplementInput = Pick<EnterpriseCaseSupplement, 'text' | 'source' | 'scope' | 'confirmation'> & { id?: string };
export type EnterpriseCaseContextInput = {
  expectedRevision: number; materials: EnterpriseMaterialRef[]; supplements: EnterpriseCaseSupplementInput[];
};
export type EnterpriseMaterialSelection = EnterpriseMaterialRef & { mode: 'full' | 'excerpt' | 'location'; start?: number; end?: number };
export type EnterpriseCaseSelection = Pick<EnterpriseCaseContext, 'storeId' | 'caseStoreId' | 'caseId' | 'revision'>;
export type EnterpriseMaterialProvision = EnterpriseMaterialRef & {
  title: string; bodySha256: string; bodyPath: string; mode: 'full' | 'excerpt' | 'location';
  start?: number; end?: number; providedText: string; providedAt: string; sourceFile?: EnterpriseSourceFile | null;
};
export type EnterpriseContextProvision = {
  directory: { storeId: string; indexPath: string; providedAt: string; claim: 'directory-visible-not-read' };
  materials: EnterpriseMaterialProvision[];
  case?: EnterpriseCaseSelection & { supplements: EnterpriseCaseSupplement[]; providedAt: string };
};
