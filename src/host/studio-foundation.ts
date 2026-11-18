import { parseFoundationContent, foundationReferences, foundationDependencyReferences, type FoundationMetricRef } from '../../extensions/business-plugins/studio/foundation.ts';
import type { StudioSourceRef } from '../../extensions/business-plugins/studio/contracts.ts';
import { StudioError } from '../../extensions/business-plugins/studio/store.ts';
import { digest } from '../../extensions/business-plugins/studio/validation.ts';
import { preparePublication } from '../../extensions/business-plugins/metric-factory/sap/validate.ts';
import type { StudioSourceRead } from './studio-sources.ts';

type ReadSource = (ref: StudioSourceRef) => Promise<StudioSourceRead>;

/** Qualifies the body through the existing source readers; it never evaluates business truth. */
export async function qualifyFoundationBody(body: string, read: ReadSource): Promise<{ references: StudioSourceRef[]; dependencies: StudioSourceRef[] }> {
  const parsed = parseFoundationContent(body);
  if (parsed.kind === 'invalid') throw new StudioError('invalid_studio_foundation');
  if (parsed.kind !== 'supported' || !parsed.profile) return { references: [], dependencies: [] };
  const profile = parsed.profile, reads = new Map<string, StudioSourceRead>();
  for (const ref of foundationReferences(profile)) reads.set(digest(ref), await read(ref));
  const source = (ref: StudioSourceRef) => {
    const result = reads.get(digest(ref));
    if (!result?.complete) throw new StudioError('studio_foundation_source_incomplete', 409);
    return result;
  };
  const metric = (ref: FoundationMetricRef) => {
    if (ref.sourceRef.authority !== 'sap-metric') throw new StudioError('studio_foundation_metric_source', 409);
    const document = preparePublication(new TextEncoder().encode(source(ref.sourceRef).text)).document;
    const selected = document.metrics.find(value => value.name === ref.metricName);
    if (!selected) throw new StudioError('studio_foundation_metric_not_found', 409);
    if (ref.scenario && !document.scenarios.some(value => `${value.id}@${value.version}` === ref.scenario && value.metric_usages.some(usage => usage.metric === ref.metricName))) throw new StudioError('studio_foundation_scenario_not_found', 409);
    return selected;
  };
  const externalItem = (ref: { sourceRef: StudioSourceRef; itemId: string }) => {
    const target = parseFoundationContent(source(ref.sourceRef).text);
    if (target.kind !== 'supported' || !target.profile?.items.some(item => item.itemId === ref.itemId)) throw new StudioError('studio_foundation_item_not_found', 409);
  };
  for (const link of profile.metricLinks ?? []) {
    const original = metric(link.metricRef);
    if (link.bindingRef && source(link.bindingRef).assetKind !== 'binding') throw new StudioError('studio_foundation_binding_type_mismatch', 409);
    for (const dimension of link.dimensions ?? []) if (!original.dimensions.includes(dimension.name)) throw new StudioError('studio_foundation_dimension_not_found', 409);
  }
  for (const link of profile.bindingLinks ?? []) {
    if (link.sourceRef.authority !== 'data' && !(link.sourceRef.authority === 'studio-source' && source(link.sourceRef).assetKind === 'binding')) throw new StudioError('studio_foundation_binding_type_mismatch', 409);
  }
  for (const requirement of profile.ruleExecution?.factRequirements ?? []) {
    const ref = requirement.bindingRef;
    if (ref.authority !== 'data' && !(ref.authority === 'studio-source' && source(ref).assetKind === 'binding')) throw new StudioError('studio_foundation_binding_type_mismatch', 409);
  }
  for (const relation of profile.relations ?? []) for (const target of [relation.from, relation.to]) {
    if (target.kind === 'metric') metric(target.metricRef);
    if (target.kind === 'external-item') externalItem(target.itemRef);
  }
  for (const adaptation of profile.adaptations ?? []) if (adaptation.referenceRef) externalItem(adaptation.referenceRef);
  return {
    references: [...new Map([...reads.values()].map(result => [digest(result.ref), result.ref])).values()],
    dependencies: foundationDependencyReferences(profile).map(ref => source(ref).ref),
  };
}

/** Select only after authorization of the original, version-pinned source. */
export function selectFoundationSource(read: StudioSourceRead, payload: Record<string, unknown>) {
  if (payload.itemId !== undefined && payload.metricName !== undefined) throw new StudioError('invalid_studio_foundation_selection');
  if (payload.itemId !== undefined) {
    if (typeof payload.itemId !== 'string' || !payload.itemId.trim()) throw new StudioError('invalid_studio_foundation_selection');
    const parsed = parseFoundationContent(read.text);
    const item = parsed.kind === 'supported' ? parsed.profile?.items.find(value => value.itemId === payload.itemId) : undefined;
    if (!item) throw new StudioError('studio_foundation_item_not_found', 404);
    return { text: JSON.stringify(item), selection: { itemId: item.itemId } };
  }
  if (payload.metricName !== undefined) {
    if (read.ref.authority !== 'sap-metric' || typeof payload.metricName !== 'string' || !payload.metricName.trim()) throw new StudioError('invalid_studio_foundation_selection');
    const document = preparePublication(new TextEncoder().encode(read.text)).document;
    const metric = document.metrics.find(value => value.name === payload.metricName);
    if (!metric) throw new StudioError('studio_foundation_metric_not_found', 404);
    return { text: JSON.stringify({ ...metric, package: document.package }), selection: { metricName: metric.name } };
  }
  return { text: read.text, selection: {} };
}

export const foundationContentContract = {
  contentProfile: 'studio-foundation/2',
  supportedProfiles: ['studio-foundation/1', 'studio-foundation/2'],
  body: 'Original Studio asset body remains the only editable authority. JSON: {contentProfile,items:[{itemId,kind,definition,sourceRef,name?,grain?,valueType?,parentItemId?,scope?,validFrom?,validTo?,evidenceNature?}],scope?,metricLinks?,relations?,adaptations?,bindingLinks?,readiness?,ruleExecution?}. Choose /2 only to add optional ruleExecution; /1 keeps its original strict fields. Legacy text/JSON remains readable. Unknown profiles are draft-only.',
  itemKinds: ['entity','attribute','key','value-domain','event','rule','dimension','time','concept'],
  references: 'ItemRef={sourceRef:original SourceRef,itemId}; MetricRef={sourceRef:original sap-metric SourceRef,metricName,scenario?:id@version}. Preserve original locator, exact version and hash. Embedded sources are qualified by original readers. Required sources remain dependencies; task refs used only in evidenceRefs remain exact provenance in the original body, not a cross-project read grant or a mandatory consumption dependency. Do not copy evidence-only task receipts into dependencies. Task refs in required source roles remain required and currently block shared structural publication.',
  metricLinks: '[{metricRef,entityItemIds?,eventItemIds?,ruleItemIds?,timeItemIds?,dimensions?:[{name,itemId}],bindingRef?}]; references only; formulas, definitions and scenario metric usages stay in the exact original SAP package.',
  relations: '[{relationId,type:catalog|formula-dependency|statistical-decomposition|analysis-use|domain,from,to,evidenceRefs,scope?,validFrom?,validTo?,detail?,role?,mutuallyExclusive?,complete?,additive?}]; target={kind:item,itemId}|{kind:external-item,itemRef}|{kind:metric,metricRef}. No inferred additivity or causal claim.',
  adaptations: '[{referenceRef?:ItemRef,targetItemId?,action:adopt|modify|exclude|add|pending,reason,evidenceRefs}]; input references are not a third enterprise layer.',
  bindingLinks: '[{sourceRef,field,itemId,grain,detail,evidenceRefs}]; sourceRef must resolve to an original studio-source kind:binding or authorized data input. Policy/report evidence belongs in evidenceRefs. No new execution engine.',
  readiness: '{definition?,mapping?,computation?,use?}; each={status:pass|fail|unknown|pending,detail,evidenceRefs,scope?}. Independent dimensions and author declarations; publication never means computation/use passed. Manual edits reset declarations pending.',
  ruleExecution: 'Optional in /2 only: {contractVersion:studio-rule-execution/1,engine:{name:semantica,version:0.7.0},rules:[{ruleId,ruleItemId,conditions:string[],conclusion:string}],predicates:[{predicate,namespace:absolute-https-or-urn,itemId,arguments:[{name,itemId,valueType}]}],factRequirements:[{requirementId,predicate,sourceRef:exact-Ref,bindingRef:exact-studio-source-Binding-Ref,fields:string[],grain,unit,timeBasis,coverage,kind:observed|external-computation,calculationRefs?:exact-Ref[]}],constraints?:{format:shacl-turtle,shapes:in-memory-safe-Core-Turtle,sourceRefs:exact-Ref[]}}. ruleItemId must name a rule item; predicate and argument itemIds must exist in items. External-computation requires calculationRefs. Use official positive atoms such as Member(?m), Normal(?m) -> Eligible(?m), one condition per array entry. Variables in conclusions must be bound by conditions; all predicate names/arity must be declared. Finite positive conjunctions and acyclic dependency only; no recursion/negation/functions/callbacks/aggregation. External input fact predicates cannot also be rule conclusion predicates; same-call internal chaining is supported. Actual SDK subset/resource checks remain separate from shape validation. Multiple producers may merge premises: report native primary-rule/union limits, never invent complete proof paths. Rules<=32,facts<=256,returned conclusions<=512,iterations<=32; static binding/working-fact upper bounds<=8192; unsupported/incomplete is not a negative business conclusion. SHACL accepts bounded in-memory structural Core only, no paths/imports/SPARQL/JS. Formal rule-execution publication needs exact successful native execution evidence plus original checks/readiness and an explicit publication purpose; definition-only remains separate.',
} satisfies Record<string, unknown>;
