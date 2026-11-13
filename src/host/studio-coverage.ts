import { coverageReferences, coverageRefIdentity, parseCoverageContent, type CoverageIssue, type CoverageReport } from '../../extensions/business-plugins/studio/coverage.ts';
import { parseFoundationContent } from '../../extensions/business-plugins/studio/foundation.ts';
import type { StudioAssetKind, StudioSourceRef, StudioSystem } from '../../extensions/business-plugins/studio/contracts.ts';
import { StudioError } from '../../extensions/business-plugins/studio/store.ts';
import { selectFoundationSource } from './studio-foundation.ts';
import type { StudioSourceRead } from './studio-sources.ts';

export interface CoverageReferenceMetadata { ref: StudioSourceRef; assetKind?: StudioAssetKind; foundationKinds?: ('master-data' | 'metric' | 'ontology')[] }
export interface StudioCoverageView {
  systemId: string; assetId: string; revision: number; ref: StudioSourceRef;
  status: 'ready' | 'invalid' | 'unsupported' | 'unavailable';
  report?: CoverageReport; issues?: CoverageIssue[]; references?: CoverageReferenceMetadata[]; error?: string; text?: string;
}
type Read = (ref: StudioSourceRef) => Promise<StudioSourceRead>;

function referenceMetadata(ref: StudioSourceRef, source: StudioSourceRead): CoverageReferenceMetadata {
  const profile = parseFoundationContent(source.text).profile, kinds: NonNullable<CoverageReferenceMetadata['foundationKinds']> = [];
  if (profile?.items.some(item => ['entity', 'attribute', 'key', 'value-domain'].includes(item.kind))) kinds.push('master-data');
  if (ref.authority === 'sap-metric' || profile?.metricLinks?.length) kinds.push('metric');
  if (source.assetKind === 'ontology' || source.assetKind === 'rule' || profile?.items.some(item => ['concept', 'event', 'rule'].includes(item.kind)) || profile?.relations?.some(relation => relation.type === 'domain')) kinds.push('ontology');
  return { ref, ...(source.assetKind ? { assetKind: source.assetKind } : {}), ...(kinds.length ? { foundationKinds: kinds } : {}) };
}

/** Every embedded report reference is required, using the existing exact authorized source readers. */
export async function qualifyCoverageBody(body: string, read: Read, system?: Pick<StudioSystem, 'id' | 'enterpriseId' | 'topics'>): Promise<{ references: StudioSourceRef[]; dependencies: StudioSourceRef[]; metadata: CoverageReferenceMetadata[] }> {
  const parsed = parseCoverageContent(body);
  if (parsed.kind === 'invalid') throw new StudioError('invalid_studio_coverage');
  if (parsed.kind !== 'supported' || !parsed.report) return { references: [], dependencies: [], metadata: [] };
  const report = parsed.report;
  if (system && (report.scope.systemId !== system.id || report.scope.enterpriseId !== system.enterpriseId || !system.topics.some(topic => topic.id === report.scope.topicId))) throw new StudioError('studio_coverage_scope_mismatch', 409);
  const reads = new Map<string, StudioSourceRead>(), references: StudioSourceRef[] = [], metadata: CoverageReferenceMetadata[] = [];
  for (const ref of coverageReferences(report)) {
    const source = await read(ref);
    if (!source.complete) throw new StudioError('studio_coverage_source_incomplete', 409);
    reads.set(coverageRefIdentity(ref), source); references.push(ref); metadata.push(referenceMetadata(ref, source));
  }
  for (const observation of report.observations) if (observation.sourceSelection) {
    const selection = observation.sourceSelection, source = reads.get(coverageRefIdentity(selection.sourceRef))!;
    const selected = selectFoundationSource(source, selection);
    // This version accepts an exact literal fragment in the already-selected original body.
    if (selection.fragmentLocator !== undefined && !selected.text.includes(selection.fragmentLocator)) throw new StudioError('studio_coverage_fragment_not_found', 409);
  }
  return { references, dependencies: references, metadata };
}

/** Read a precise original revision afresh; a failed grant never returns its old body or evidence. */
export async function readCoverageView(system: StudioSystem, assetId: string, revisionNumber: number, read: Read): Promise<StudioCoverageView> {
  const asset = system.assets.find(asset => asset.id === assetId), revision = asset?.revisions.find(revision => revision.revision === revisionNumber);
  if (!asset || !revision) throw new StudioError('studio_asset_not_found', 404);
  const ref: StudioSourceRef = { authority: 'studio-source', id: asset.id, version: String(revision.revision), sha256: revision.sha256, projectId: system.projectId, locator: system.id };
  const base = { systemId: system.id, assetId, revision: revisionNumber, ref };
  try {
    const source = await read(ref);
    if (!source.complete) throw new StudioError('studio_coverage_source_incomplete', 409);
    const parsed = parseCoverageContent(source.text);
    if (parsed.kind !== 'supported' || !parsed.report) return { ...base, status: parsed.kind === 'invalid' ? 'invalid' : 'unsupported', issues: parsed.issues, text: source.text };
    if (asset.kind !== 'business' || parsed.report.scope.topicId !== asset.topicId) throw new StudioError('studio_coverage_scope_mismatch', 409);
    const qualified = await qualifyCoverageBody(source.text, read, system);
    return { ...base, ref: source.ref, status: 'ready', report: parsed.report, references: qualified.metadata };
  } catch (error) {
    return { ...base, status: 'unavailable', error: error instanceof StudioError ? error.code : 'studio_coverage_read_failed' };
  }
}

export const coverageContentContract = {
  reportProfile: 'studio-coverage/1',
  carrier: 'Optional business asset body only; original sources/dependencies/revisions/publication remain authoritative. Legacy content remains unchanged; unknown report profiles are draft-only. No coordinate is required for ordinary analysis.',
  body: '{reportProfile,scope:{enterpriseId,systemId,topicId,purpose,included:string[],excluded:string[],validFrom?,validTo?},methodRefs:SourceRef[],basisRefs:SourceRef[],focusCells:Cell[],observations:[{id,description,subjectLabel,annotations:[{cell,reason}],evidenceRefs:SourceRef[],evidenceStatus:not-reviewed|located|partial|missing|not-applicable,reason?,sourceSelection?:{sourceRef,itemId?,metricName?,fragmentLocator?}}],questions:[{id,observationIds:string[],kind:missing|possible-conflict|dependency|business-decision,detail,impact,evidenceRefs:SourceRef[],workItemId?}],limitations:string[]}. Cell={row:1..6,column:What|How|Where|Who|When|Why}; 0..36 focus cells, 0/multiple annotations including outside focus; not-applicable requires reason.',
  references: 'All method/basis/evidence/sourceSelection refs are currently required and qualified through original exact readers, automatically included in outer sources/dependencies. No evidence-only exemption. Candidates only for original construction owner, formal current sources for ordinary supply. Missing/changed/unauthorized inputs prevent current coverage, never rewrite history or mark-issue.',
  selection: 'itemId and metricName are exclusive and verified by the original selection reader. fragmentLocator in this version is exact nonempty literal text that must exist within that selected original source body; not arbitrary line numbers or JSONPath. It never changes SourceRef.locator.',
  limits: 'body<=256KiB, observations<=256, unique exact references<=128, questions<=128, annotations<=36 per observation. SourceRef exact tuple excludes title; same name/different versions never merge.',
};
