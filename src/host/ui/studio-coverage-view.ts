import type { CoverageCell, CoverageReport } from '../../../extensions/business-plugins/studio/coverage.ts';
import { coverageColumns, coverageReferences, coverageRefIdentity, parseCoverageContent } from '../../../extensions/business-plugins/studio/coverage.ts';
import type { StudioSourceRef } from '../../../extensions/business-plugins/studio/contracts.ts';
import type { CoverageReferenceMetadata, StudioCoverageView } from '../studio-coverage.ts';
import type { StudioFoundation } from './studio-api.ts';

export type { CoverageReferenceMetadata } from '../studio-coverage.ts';
export type CoverageReadResult = StudioCoverageView;
export interface CoverageEntry { key: string; systemId: string; assetId: string; revision: number; title: string; identity: 'candidate' | 'formal' | 'history'; ref: StudioSourceRef }
export interface CoverageReferenceEntry { key: string; ref: StudioSourceRef; categories: string[]; cells: string[]; observationIds: string[] }
export interface CoverageProjection {
  materials: CoverageReferenceEntry[]; assets: CoverageReferenceEntry[]; methods: CoverageReferenceEntry[]; unclassified: CoverageReferenceEntry[];
  cells: Map<string, { observations: CoverageReport['observations']; references: CoverageReferenceEntry[] }>;
}
export const coverageRows = [
  { name: '范围识别', titles: ['经营对象范围', '经营活动范围', '市场与渠道范围', '参与者范围', '经营节奏范围', '目标与约束范围'] },
  { name: '业务定义', titles: ['业务对象与关系', '业务过程与事件', '业务分布与归属', '业务角色与责任', '业务周期与时序', '业务目标与规则'] },
  { name: '逻辑表示', titles: ['逻辑数据模型', '逻辑功能模型', '逻辑分布模型', '逻辑角色与权限', '逻辑时间约束', '规则与指标逻辑'] },
  { name: '技术规格', titles: ['技术数据规格', '技术功能设计', '网络与部署规格', '身份权限技术规格', '调度与时限规格', '规则实现规格'] },
  { name: '具体配置', titles: ['表字段与映射配置', '程序与接口配置', '节点与地址配置', '角色权限配置', '任务周期配置', '规则与参数配置'] },
  { name: '运行实例', titles: ['实际业务对象记录', '实际业务活动', '实际分布实例', '实际参与与责任记录', '实际发生时间记录', '实际决策与规则执行记录'] },
] as const;
export const coverageColumnLabels = ['对象', '运作', '分布', '参与与责任', '时间', '目标与约束'];
export const coverageFramework = coverageRows.flatMap((row, index) => coverageColumns.map((column, c) => ({
  cell: { row: index + 1, column } as CoverageCell, key: 'R' + (index + 1) + ':' + column, title: row.titles[c], perspective: row.name,
})));
export const coverageFirstReference = coverageFramework.filter(({ cell }) => cell.row <= 2 || cell.row === 3 && ['What', 'Why'].includes(cell.column)).map(cell => cell.key);

/** The directory discovers identities only. Body evidence must come from a fresh qualified read. */
export function studioCoverageEntries(foundation?: StudioFoundation): CoverageEntry[] {
  return foundation?.systems.flatMap(system => system.enterpriseId !== foundation.enterprise.id ? [] : system.assets.flatMap(asset =>
    asset.kind !== 'business' ? [] : asset.revisions.flatMap(revision => parseCoverageContent(revision.body).kind === 'legacy' ? [] : [{
      key: system.id + ':' + asset.id + ':' + revision.revision, systemId: system.id, assetId: asset.id, revision: revision.revision, title: revision.title,
      identity: (asset.formalRevision === revision.revision ? 'formal' : asset.candidateRevision === revision.revision ? 'candidate' : 'history') as CoverageEntry['identity'],
      ref: { authority: 'studio-source' as const, id: asset.id, version: String(revision.revision), projectId: system.projectId, locator: system.id, sha256: revision.sha256, title: revision.title },
    }])
  )) || [];
}

/** A pure projection of this qualified response. No directory bodies, inferred coordinates or merged titles. */
export function projectCoverageReport(value?: CoverageReadResult): CoverageProjection | undefined {
  if (value?.status !== 'ready' || !value.report) return undefined;
  const report = value.report, methodKeys = new Set(report.methodRefs.map(coverageRefIdentity));
  const metadata = new Map((value.references || []).map(entry => [coverageRefIdentity(entry.ref), entry]));
  const references: CoverageReferenceEntry[] = coverageReferences(report).map(ref => {
    const key = coverageRefIdentity(ref), data = metadata.get(key);
    const observations = report.observations.filter(observation => [...observation.evidenceRefs, ...(observation.sourceSelection ? [observation.sourceSelection.sourceRef] : [])].some(source => coverageRefIdentity(source) === key));
    let categories: string[] = [];
    if (methodKeys.has(key) || ref.authority === 'sap-method') categories = ['方法'];
    else if (ref.authority === 'enterprise' || ref.authority === 'data') categories = ['资料'];
    else if (ref.authority === 'sap-metric') categories = ['指标体系'];
    else if (data?.foundationKinds?.length) categories = [...new Set(data.foundationKinds.map(kind => ({ 'master-data': '主数据', metric: '指标体系', ontology: '本体' })[kind]))];
    else if (data?.assetKind === 'ontology' || data?.assetKind === 'rule') categories = ['本体'];
    return { key, ref, categories, observationIds: observations.map(observation => observation.id), cells: [...new Set(observations.flatMap(observation => observation.annotations.map(annotation => coverageCellKey(annotation.cell))))] };
  });
  const cells: CoverageProjection['cells'] = new Map(coverageFramework.map(cell => [cell.key, {
    observations: report.observations.filter(observation => observation.annotations.some(annotation => coverageCellKey(annotation.cell) === cell.key)),
    references: references.filter(ref => ref.cells.includes(cell.key)),
  }]));
  return { materials: references.filter(ref => ref.categories.includes('资料')), assets: references.filter(ref => ref.categories.some(category => ['主数据', '指标体系', '本体'].includes(category))),
    methods: references.filter(ref => ref.categories.includes('方法')), unclassified: references.filter(ref => !ref.categories.length), cells };
}
export const coverageCellKey = (cell: CoverageCell) => 'R' + cell.row + ':' + cell.column;

/** Route a coverage request through the original construction UI/runtime only. */
export async function routeStudioCoverageBuild(input: {
  goal?: string; systemId?: string; foundation?: StudioFoundation; isCurrent: () => boolean;
  openExisting: (systemId: string) => Promise<boolean>;
  continueExisting: (system: NonNullable<StudioFoundation>['systems'][number], goal?: string) => void | Promise<void>;
  create: (goal?: string) => void | Promise<void>;
}): Promise<void> {
  if (!input.isCurrent()) return;
  if (!input.systemId) { await input.create(input.goal); return; }
  const system = input.foundation?.systems.find(system => system.id === input.systemId && system.enterpriseId === input.foundation?.enterprise.id);
  if (!system) throw new Error('未找到当前企业的原建设体系；未创建替代体系或发送目标。');
  if (!await input.openExisting(system.id) || !input.isCurrent()) return;
  await input.continueExisting(system, input.goal);
}
