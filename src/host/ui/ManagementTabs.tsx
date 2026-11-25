import type {KeyboardEvent} from 'react';

export type ManagementStage = 'co-create' | 'strategy-check' | 'strategy-release' | 'strategy-versions' | 'goals' | 'adopt' | 'cases' | 'history' | 'bsc';
export type StrategyStage = 'co-create' | 'strategy-check' | 'strategy-release' | 'strategy-versions' | 'bsc';
type GoalStage = 'goals' | 'adopt' | 'cases' | 'history';
export type ManagementRoute = {area: 'strategy'; stage: StrategyStage} | {area: 'gsa'; stage: GoalStage};
/** Old five-tab discussion workbench stages, kept only for legacy discussion read-back inside 版本管理. */
export type LegacyStrategyStage = 'direction' | 'compare' | 'handoff' | 'strategy-release' | 'strategy-versions' | 'goals';

const strategyViews: ReadonlyArray<[StrategyStage, string]> = [
  ['co-create', '战略共创'], ['strategy-check', '战略检验'], ['strategy-release', '战略发布'], ['strategy-versions', '版本管理'],
];
const goalViews: ReadonlyArray<[GoalStage, string]> = [
  ['goals', '目标与策略'], ['adopt', '核对与采用'], ['cases', '年度决策事项'], ['history', '版本与反馈'],
];
export const managementTitle = (route: ManagementRoute) => route.area === 'strategy' ? '战略选择' : '目标管理';

export function ManagementTabs({route, onStage}: {route: ManagementRoute; onStage: (stage: ManagementStage) => void}) {
  if (route.area === 'gsa') return null;
  const views = strategyViews;
  const selected = route.stage === 'bsc' ? 'strategy-versions' : route.stage;
  function moveTab(event:KeyboardEvent<HTMLElement>) {
    if(event.key!=='ArrowLeft'&&event.key!=='ArrowRight')return;
    const buttons=[...event.currentTarget.querySelectorAll('button')];
    const index=buttons.findIndex(button=>button===event.target);
    if(index<0)return;
    event.preventDefault();
    const next=(index+(event.key==='ArrowRight'?1:-1)+views.length)%views.length;
    onStage(views[next]![0]);
    buttons[next]?.focus();
  }
  return <nav className="sg-tabs workspace-management-tabs" aria-label={`${managementTitle(route)}工作视图`} onKeyDown={moveTab}>
    {views.map(([stage, label]) => <button key={stage} type="button" aria-current={selected === stage ? 'page' : undefined} onClick={() => onStage(stage)}>{label}</button>)}
  </nav>;
}
