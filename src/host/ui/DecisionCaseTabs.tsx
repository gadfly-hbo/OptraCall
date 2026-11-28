export type DecisionCaseArea = 'overview' | 'projects';

/** One 一级入口 "Decision Case" with two equal areas; the global project page stays the complete original page. */
export function DecisionCaseTabs({ area, onSelect }: { area: DecisionCaseArea; onSelect: (area: DecisionCaseArea) => void }) {
  const items: { id: DecisionCaseArea; label: string }[] = [{ id: 'overview', label: 'Case 总览' }, { id: 'projects', label: '全部项目' }];
  return <nav className="decision-case-tabs" aria-label="Decision Case 范围">
    {items.map(item => <button key={item.id} type="button" aria-pressed={area === item.id} aria-current={area === item.id ? 'page' : undefined} onClick={() => { if (area !== item.id) onSelect(item.id); }}>{item.label}</button>)}
  </nav>;
}
