export type StudioLibraryArea = 'semantic' | 'analytics';
type StudioLibraryCategory = 'semantic' | 'binding' | 'materials' | 'metrics' | 'methods';
export type StudioLibraryTab = StudioLibraryCategory | 'workbench';
export type StudioLibraryRequest = { area: StudioLibraryArea };

const semanticTabs: ReadonlyArray<[StudioLibraryTab, string]> = [
  ['semantic', '业务语义'], ['binding', '数据映射'], ['materials', '企业资料'], ['workbench', '体系工作台'],
];
const analyticsTabs: ReadonlyArray<[StudioLibraryTab, string]> = [
  ['metrics', '分析指标'], ['methods', '分析方法'], ['workbench', '体系工作台'],
];

export const studioLibraryTitle = (area: StudioLibraryArea) => area === 'semantic' ? '语义资产' : '分析资产';
export const defaultStudioLibraryCategory = (area: StudioLibraryArea): StudioLibraryCategory => area === 'semantic' ? 'semantic' : 'metrics';
export const studioLibraryProfessionalArea = (kind: string): StudioLibraryArea => kind === 'materials' ? 'semantic' : 'analytics';

export function StudioLibraryTabs({area, tab, busy, onSelect}: {
  area: StudioLibraryArea; tab: StudioLibraryTab | 'all'; busy: boolean; onSelect: (tab: StudioLibraryTab) => void;
}) {
  const options = area === 'semantic' ? semanticTabs : analyticsTabs;
  return <nav className="sg-tabs workspace-studio-tabs" aria-label={studioLibraryTitle(area) + '工作视图'}>
    {options.map(([key, label]) => <button type="button" key={key} aria-current={tab === key ? 'page' : undefined}
      disabled={busy} onClick={() => onSelect(key)}>{label}</button>)}
  </nav>;
}
