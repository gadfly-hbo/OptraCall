import type { ReactNode } from 'react';
import type { ClientProject } from './project-types.ts';
import { useWorkspaceDeskData } from './use-workspace-desk-data.ts';
import {
  buildWorkspaceHomeModel,
  type HomeFoundationId,
  type HomeFoundationTile,
} from './workspace-home-model.ts';
import './workspace-home.css';

export interface FoundationOverviewProps {
  active: boolean;
  projects: ClientProject[];
  currentProjectId?: string;
  selectedEnterpriseId?: string;
  onEnterpriseChange?: (enterpriseId: string | undefined) => void;
  onResolvedEnterpriseName?: (name: string | undefined) => void;
  refreshToken: number;
  preferredCaseId?: string;
  onOpenFoundation: (id: HomeFoundationId) => void;
  onOpenCase: (caseId: string) => void;
  onCreateCase: () => void;
  onOpenProjectMap: () => void;
  onOpenSettings: (trigger?: HTMLButtonElement) => void;
}

const FOUNDATION_NOTES: Record<
  HomeFoundationId,
  { cadence: string; desc: string }
> = {
  strategy: {
    cadence: '年度制定 · 季度或月度回顾',
    desc: '比较候选方向，核对支持与反对依据，发布可承接的战略版本。',
  },
  goals: {
    cadence: '年度设定 · 月度或周度跟进',
    desc: '确认总目标 GSA，核对测算和正式拆解，按阶段实绩复盘。',
  },
  semantic: {
    cadence: '业务口径或数据源变化时',
    desc: '核对同一企业下的业务定义、数据映射和企业资料。',
  },
  analysis: {
    cadence: '方法或指标口径变化时',
    desc: '管理分析指标和可复用方法，回看版本和适用范围。',
  },
};

function FoundationGlyph({ kind }: { kind: HomeFoundationId | 'stars' | 'settings' }) {
  const shapes: Record<HomeFoundationId | 'stars' | 'settings', ReactNode> = {
    strategy: <><path d="M21 11a8 8 0 0 1-8 8H6l-4 3 1-6a8 8 0 0 1-1-5 9 9 0 0 1 19 0Z" /></>,
    goals: <><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M2 12h2m16 0h2" /></>,
    semantic: <><path d="m12 3 9 5-9 5-9-5 9-5Zm-9 9 9 5 9-5M3 16l9 5 9-5" /></>,
    analysis: <><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></>,
    stars: <><circle cx="6" cy="17" r="2.2" /><circle cx="13" cy="6" r="2.4" /><circle cx="19" cy="18" r="2.2" /><path d="M7.6 15.2 11.7 8M14.3 8l3.5 8.1" /></>,
    settings: <><path d="m9 3-1 3-3 1-2 3 2 2-1 3 2 3 3-1 3 2 3-2 3 1 2-3-1-3 2-2-2-3-3-1-1-3Z" /><circle cx="12" cy="11" r="3" /></>,
  };
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {shapes[kind]}
    </svg>
  );
}

export function FoundationOverview({
  active,
  projects,
  currentProjectId,
  selectedEnterpriseId,
  onEnterpriseChange,
  onResolvedEnterpriseName,
  refreshToken,
  preferredCaseId,
  onOpenFoundation,
  onOpenCase,
  onCreateCase,
  onOpenProjectMap,
  onOpenSettings,
}: FoundationOverviewProps) {
  const desk = useWorkspaceDeskData({
    active,
    refreshToken,
    preferredCaseId,
    selectedEnterpriseId,
    currentProjectId,
    onResolvedEnterpriseName,
  });

  if (desk.caseAccessState === 'loading') {
    return (
      <div className="workspace-home-scroll">
        <section className="desk-home" aria-busy="true">
          <p role="status">正在读取工作区记录…</p>
          <button type="button" className="text-button" onClick={onOpenProjectMap}>打开项目地图</button>
        </section>
      </div>
    );
  }

  const model = buildWorkspaceHomeModel({
    caseAccessState: desk.caseAccessState,
    caseAccessMessage: desk.caseAccessMessage,
    enterpriseName: desk.enterpriseName,
    cases: desk.cases,
    projectLinks: desk.projectLinks,
    focusCaseId: preferredCaseId,
    focusDetail: desk.focusDetail,
    projects,
    goals: desk.goals,
    boardActions: desk.boardActions,
    foundations: desk.foundations,
  });

  const isCaseRestricted = model.caseAccessState === 'forbidden' || model.caseAccessState === 'unavailable';
  const renderCard = (item: HomeFoundationTile) => {
    const meta = FOUNDATION_NOTES[item.id];
    return (
      <button
        key={item.id}
        type="button"
        className="fi-row"
        onClick={() => onOpenFoundation(item.id)}
      >
        <span className="fi-module-icon" aria-hidden="true">
          <FoundationGlyph kind={item.id} />
        </span>
        <span className="fi-module">
          <strong>{item.title}</strong>
          <span>{meta.desc}</span>
          <small>{meta.cadence} · {item.detail}</small>
        </span>
        <span className={`dh-pill ${item.tone}`}>{item.status}</span>
        <span className="fi-end" aria-hidden="true">›</span>
      </button>
    );
  };

  return (
    <div className="workspace-home-scroll">
      <section className="desk-home fi-page" role="region" aria-label="基础建设总览">
        <header className="fi-head">
          <div>
            <div className="fi-kicker">
              {desk.enterprises.length > 1 ? (
                <label className="dh-enterprise-inline">
                  <span className="sr-only">当前企业</span>
                  <select
                    aria-label="当前企业"
                    value={desk.enterpriseUnselected ? '' : desk.activeEnterpriseId}
                    onChange={event => onEnterpriseChange?.(event.target.value)}
                  >
                    {desk.enterpriseUnselected && <option value="">尚未明确企业</option>}
                    {desk.enterprises.map(ent => (
                      <option key={ent.id} value={ent.id}>{ent.name}</option>
                    ))}
                  </select>
                </label>
              ) : (
                <span>{model.enterpriseName}</span>
              )}
              <span aria-hidden="true"> · </span>经营工作区
            </div>
            <h1>基础建设总览</h1>
            <p className="fi-lead">在需要时维护战略、目标和企业资产，日常工作从 Decision Case 开始。</p>
          </div>
          <div className="dh-head-actions">
            <button type="button" className="text-button" disabled={desk.loading} onClick={desk.reload}>
              {desk.loading ? '正在刷新…' : '刷新'}
            </button>
          </div>
        </header>

        <div className="fi-layout">
          <div className="fi-register">
            <section aria-labelledby="fi-management">
              <header>
                <h2 id="fi-management">战略与目标</h2>
                <p>从经营方向到阶段结果</p>
              </header>
              {model.foundations.slice(0, 2).map(renderCard)}
            </section>

            <section aria-labelledby="fi-assets">
              <header>
                <h2 id="fi-assets">企业资产</h2>
                <p>持续积累业务口径与分析方法</p>
              </header>
              {model.foundations.slice(2).map(renderCard)}
            </section>
          </div>

          <aside className="fi-context" aria-label="相关工作">
            <div className="fi-case-context">
              <span className="fi-context-label">
                <FoundationGlyph kind="stars" /> Decision Case
              </span>
              <h2>
                {isCaseRestricted
                  ? model.caseAccessState === 'forbidden'
                    ? 'Case 记录无读取权限'
                    : 'Case 记录暂不可读取'
                  : model.focusCase
                    ? model.focusCase.title
                    : '从业务问题开始'}
              </h2>
              <p>
                {isCaseRestricted
                  ? model.caseAccessMessage || '当前身份无法读取 Case，仍可前往项目地图独立开展工作。'
                  : model.focusCase
                    ? '在 Case 中查看已采用的目标与策略，通过复盘把结果带回目标管理。'
                    : '先为当前事项明确目标 G 和具体策略 S。年度目标建立后，可回到原 Case 关联准确版本。'}
              </p>
              {isCaseRestricted ? (
                <button type="button" className="dh-primary-cta" onClick={onOpenProjectMap}>
                  打开项目地图
                </button>
              ) : model.focusCase ? (
                <button type="button" className="dh-primary-cta" onClick={() => onOpenCase(model.focusCase!.id)}>
                  打开当前 Case
                </button>
              ) : (
                <button type="button" className="dh-primary-cta" onClick={onCreateCase}>
                  新建 Case
                </button>
              )}
            </div>

            <div className="fi-setting-context">
              <span className="fi-module-icon" aria-hidden="true">
                <FoundationGlyph kind="settings" />
              </span>
              <div>
                <h3>工作区设置</h3>
                <p>管理模型、能力连接和资产包。</p>
                <button type="button" className="text-button" onClick={event => onOpenSettings(event.currentTarget)}>
                  打开设置
                </button>
              </div>
            </div>
          </aside>
        </div>
      </section>
    </div>
  );
}
