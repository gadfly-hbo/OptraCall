import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import type { GoalPerspective, GoalRef, GoalRelation, GoalVersion, StrategyGoalRecord, StrategyGoalsIndex } from '../strategy-goals-types.ts';
import type {
  DecompositionProjectHandoffPreview,
  DecompositionPublication,
  DecompositionPublicationSummary,
  GoalWorkspaceView,
} from '../strategy-goal-decomposition-types.ts';
import type { CaseRecord } from '../case-types.ts';
import type { BoardView } from '../../../extensions/business-plugins/decision-board/api/routes.ts';
import { CaseDialog, CaseFormError, caseDate } from './CaseDialogs.tsx';
import { DownloadVersion } from './StrategyChoicePanel.tsx';
import { AnnualCases } from './AnnualCases.tsx';
import * as api from './strategy-goals-client.ts';

const perspectiveLabels: Record<GoalPerspective, string> = { profit: '营利组织', nonprofit: '非营利组织', personal: '个人' };
const scopeLabels = { enterprise: '企业', department: '部门', personal: '个人' } as const;

export function GoalSwitcherDialog({
  active,
  goals,
  selectedId,
  perspective,
  onPerspective,
  onSelect,
  onCreateNew,
  onClose,
}: {
  active: boolean;
  goals: StrategyGoalRecord[];
  selectedId: string;
  perspective: 'all' | GoalPerspective;
  onPerspective: (value: 'all' | GoalPerspective) => void;
  onSelect: (goalId: string) => void;
  onCreateNew: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const filtered = goals.filter(rec => {
    const cur = rec.versions.find(v => v.version === (rec.adoptedVersion ?? rec.currentVersion)) ?? rec.versions.at(-1)!;
    if (perspective !== 'all' && cur.perspective !== perspective) return false;
    if (!query.trim()) return true;
    const q = query.trim().toLowerCase();
    return cur.title.toLowerCase().includes(q) || cur.scope.name.toLowerCase().includes(q) || cur.responsible.toLowerCase().includes(q);
  });

  return (
    <CaseDialog
      active={active}
      title="切换目标"
      subtitle="按范围与名称查找目标；切换目标时各自未发送输入、拆解草稿与待核发布状态严格隔离。"
      className="sg-dialog gm-aux-dialog"
      busy={false}
      onClose={onClose}
    >
      <div className="gm-toolbar-row">
        <input
          type="search"
          className="gm-input"
          placeholder="搜索目标名称、范围或负责人…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <select
          className="sg-select"
          aria-label="筛选适用视角"
          value={perspective}
          onChange={e => onPerspective(e.target.value as 'all' | GoalPerspective)}
        >
          <option value="all">全部视角</option>
          {Object.entries(perspectiveLabels).map(([k, label]) => (
            <option key={k} value={k}>{label}</option>
          ))}
        </select>
        <button type="button" className="primary-button" onClick={() => { onClose(); onCreateNew(); }}>
          ＋ 新建候选目标
        </button>
      </div>
      <div className="gm-switch-list" role="list">
        {filtered.map(rec => {
          const cur = rec.versions.find(v => v.version === (rec.adoptedVersion ?? rec.currentVersion)) ?? rec.versions.at(-1)!;
          const isSelected = rec.id === selectedId;
          return (
            <button
              key={rec.id}
              type="button"
              role="listitem"
              className="sg-goal-choice gm-switch-item"
              aria-pressed={isSelected}
              onClick={() => { onSelect(rec.id); onClose(); }}
            >
              <div className="sg-row-between">
                <strong>{cur.title}</strong>
                <span className={`sg-badge ${rec.adoptedVersion ? '' : 'pending'}`}>
                  {rec.adoptedVersion ? `已采纳 v${rec.adoptedVersion}` : `候选 v${rec.currentVersion}`}
                </span>
              </div>
              <small>
                {scopeLabels[cur.scope.kind]} · {cur.scope.name} · 负责：{cur.responsible}
                {cur.dueAt ? ` · 期限 ${cur.dueAt.slice(0, 10)}` : ''}
              </small>
            </button>
          );
        })}
        {!filtered.length && <p className="sg-muted">没有匹配的目标记录。</p>}
      </div>
    </CaseDialog>
  );
}

export function VersionsAndSourcesDialog({
  active,
  record,
  selectedVersion,
  workspace,
  index,
  relations,
  feedback,
  onSelectVersion,
  onOpenRelation,
  onOpenFeedback,
  onOpenStrategyDiscussion,
  onClose,
}: {
  active: boolean;
  record: StrategyGoalRecord;
  selectedVersion: GoalVersion;
  workspace: GoalWorkspaceView | null;
  index: StrategyGoalsIndex;
  relations: GoalRelation[];
  feedback: StrategyGoalsIndex['feedback'];
  onSelectVersion: (version: number) => void;
  onOpenRelation: (relation?: GoalRelation) => void;
  onOpenFeedback: () => void;
  onOpenStrategyDiscussion?: (source: NonNullable<GoalVersion['source']>) => void;
  onClose: () => void;
}) {
  const [pubPage, setPubPage] = useState<{ total: number; offset: number; unavailableVersions: number[]; items: DecompositionPublicationSummary[] } | null>(null);
  const [inspectedPub, setInspectedPub] = useState<DecompositionPublication | null>(null);
  const [err, setErr] = useState('');
  const [loadingPub, setLoadingPub] = useState(false);

  const loadPubs = async (offset = 0) => {
    setErr('');
    setLoadingPub(true);
    try {
      const res = await api.listDecompositionPublications(record.id, offset, 10);
      setPubPage({ total: res.total, offset: res.offset, unavailableVersions: res.unavailableVersions, items: res.items });
    } catch (fault) {
      setErr(api.goalError(fault));
    } finally {
      setLoadingPub(false);
    }
  };

  useEffect(() => {
    if (active) {
      setInspectedPub(null);
      void loadPubs(0);
    }
  }, [active, record.id, workspace?.activePublicationVersion]);

  const inspectPub = async (version: number) => {
    setErr('');
    setLoadingPub(true);
    try {
      const { publication } = await api.readDecompositionPublication(record.id, version);
      setInspectedPub(publication);
    } catch (fault) {
      setErr(api.goalError(fault));
    } finally {
      setLoadingPub(false);
    }
  };

  const goalName = (ref: GoalRef) => {
    const found = index.goals.find(g => g.id === ref.goalId)?.versions.find(v => v.version === ref.version);
    return `${found?.title ?? ref.goalId.slice(0, 8)} · v${ref.version}`;
  };

  return (
    <CaseDialog
      active={active}
      title="版本与来源"
      subtitle="按当前权限读取总目标 GSA 计划、拆解正式版冻结快照及历史目标版本；导出 HTML 严格来自冻结快照，不混入当前草稿。"
      className="sg-dialog gm-aux-dialog"
      busy={loadingPub}
      onClose={onClose}
    >
      <CaseFormError error={err} />

      <section className="gm-aux-section">
        <h3>总目标 GSA 计划版本 ({workspace?.gsaPlans.length ?? 0})</h3>
        {workspace?.gsaPlans.length ? (
          <ul className="sg-history">
            {workspace.gsaPlans.slice().reverse().map(plan => (
              <li key={plan.planVersion}>
                <div className="sg-row-between">
                  <div>
                    <strong>GSA 计划 v{plan.planVersion}</strong>
                    <span className="sg-muted"> · 绑定目标 v{plan.goal.version} · {caseDate(plan.confirmedAt)} · {plan.confirmedBy}</span>
                    <p className="sg-muted">正式值：{plan.formalTarget.value}{plan.formalTarget.unit}（{plan.formalTarget.period}） · 计划 A：{plan.plannedActions.length} 条 · 说明：{plan.decision}</p>
                  </div>
                  <DownloadVersion route={`/api/strategy/goals/${record.id}/gsa-plans/${plan.planVersion}/export`} />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sg-muted">尚未确认总目标 GSA 计划。</p>
        )}
      </section>

      <section className="gm-aux-section">
        <div className="sg-row-between">
          <h3>目标拆解正式版本 ({pubPage?.total ?? workspace?.publications.length ?? 0})</h3>
          {pubPage && pubPage.total > 10 && (
            <div className="sg-row">
              <button type="button" className="text-button" disabled={loadingPub || pubPage.offset === 0} onClick={() => void loadPubs(Math.max(0, pubPage.offset - 10))}>上一页</button>
              <button type="button" className="text-button" disabled={loadingPub || pubPage.offset + 10 >= pubPage.total} onClick={() => void loadPubs(pubPage.offset + 10)}>下一页</button>
            </div>
          )}
        </div>
        {(pubPage?.unavailableVersions ?? workspace?.unavailablePublicationVersions ?? []).map(version =>
          <p className="sg-muted" key={version}>拆解正式版 v{version} · 原范围或证据目前待核。</p>)}
        {(pubPage?.items ?? workspace?.publications ?? []).length ? (
          <ul className="sg-history">
            {(pubPage?.items ?? workspace?.publications ?? []).slice().reverse().map(pub => (
              <li key={pub.version}>
                <div className="sg-row-between">
                  <div>
                    <strong>拆解正式版 v{pub.version}</strong>
                    {workspace?.activePublicationVersion === pub.version && <span className="sg-badge">当前生效</span>}
                    <p className="sg-muted">
                      发布于 {caseDate(pub.publishedAt)} · 对应 GSA 计划 v{pub.gsaPlanVersion} · 提交子目标 {pub.committedGoals.length} 条 · {pub.reason || '正式拆解发布'}
                    </p>
                  </div>
                  <div className="sg-row">
                    <button type="button" className="secondary-button" disabled={loadingPub} onClick={() => void inspectPub(pub.version)}>查看冻结快照</button>
                    <DownloadVersion route={`/api/strategy/goals/${record.id}/decomposition/publications/${pub.version}/export`} />
                  </div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sg-muted">{(pubPage?.total ?? workspace?.activePublicationVersion) ? '本页暂无可读正式版。' : '尚未发布正式拆解表。'}</p>
        )}
        {inspectedPub && (
          <div className="gm-frozen-box">
            <strong>拆解正式版 v{inspectedPub.version} 冻结快照（只读 · 指纹 {inspectedPub.snapshotSha256.slice(0, 12)}）</strong>
            <p className="sg-muted">
              正式值 {inspectedPub.snapshot.estimate.formalTargetValue}{inspectedPub.snapshot.estimate.unit} ·
              测算值 {inspectedPub.snapshot.estimate.estimatedValue ?? '部分待补'}{inspectedPub.snapshot.estimate.unit} ·
              冻结行级检查点 {inspectedPub.snapshot.frozenCheckpoints.length} 个
            </p>
            <ul>
              {inspectedPub.snapshot.rows.map(r => (
                <li key={r.rowId}>
                  {r.scopeLabel}：{r.targetValue ?? '待定'}{r.unit} · 负责 {r.responsible} · 策略 {r.strategy}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <section className="gm-aux-section">
        <h3>目标基础版本与导出 ({record.versions.length})</h3>
        <ul className="sg-history">
          {record.versions.slice().reverse().map(v => (
            <li key={v.version}>
              <div className="sg-row-between">
                <div>
                  <strong>{v.title} · v{v.version}</strong>{' '}
                  <span className={`sg-badge ${v.status === 'adopted' ? '' : 'pending'}`}>
                    {v.status === 'adopted' ? (v.version === record.adoptedVersion ? '当前采用' : '历史采用') : '候选'}
                  </span>
                  <p className="sg-muted">
                    保存于 {caseDate(v.createdAt)}{v.adoptedAt ? ` · 采纳于 ${caseDate(v.adoptedAt)}` : ''}
                    {v.formalOrigin ? ` · 来源：${v.formalOrigin.kind === 'strategy-publication' ? `正式战略发布 ${v.formalOrigin.publicationId.slice(0, 8)}` : '手动拟定例外'}` : ''}
                  </p>
                </div>
                <div className="sg-row">
                  <button type="button" className="text-button" onClick={() => { onSelectVersion(v.version); onClose(); }}>查看此版</button>
                  <DownloadVersion route={`/api/strategy/goals/${record.id}/versions/${v.version}/export`} />
                </div>
              </div>
            </li>
          ))}
        </ul>
        {selectedVersion.source?.authority === 'strategy-discussion' && onOpenStrategyDiscussion && (
          <button type="button" className="text-button" onClick={() => { onOpenStrategyDiscussion(selectedVersion.source!); onClose(); }}>
            查看原战略讨论来源
          </button>
        )}
      </section>

      <section className="gm-aux-section">
        <div className="sg-row-between">
          <h3>目标关系 ({relations.length}) 与三层反馈 ({feedback.length})</h3>
          <div className="sg-row">
            <button type="button" className="secondary-button" disabled={selectedVersion.status !== 'adopted'} onClick={() => { onClose(); onOpenRelation(); }}>记录关系</button>
            <button type="button" className="secondary-button" disabled={selectedVersion.status !== 'adopted'} onClick={() => { onClose(); onOpenFeedback(); }}>记录反馈</button>
          </div>
        </div>
        {relations.length > 0 && (
          <ul className="sg-history">
            {relations.map(rel => (
              <li key={rel.id}>
                <span>{goalName(rel.from)} → {goalName(rel.to)} · {rel.responsibility}</span>{' '}
                <button type="button" className="text-button" onClick={() => { onClose(); onOpenRelation(rel); }}>修订</button>
              </li>
            ))}
          </ul>
        )}
        {feedback.length > 0 && (
          <ul className="sg-history">
            {feedback.map(fb => (
              <li key={fb.id}>
                <strong>{fb.level}</strong>：{fb.note}（{caseDate(fb.createdAt)}）
              </li>
            ))}
          </ul>
        )}
      </section>
    </CaseDialog>
  );
}

export function RelatedDecisionsDialog({
  active,
  goal,
  cases,
  workspace,
  onInspectCase,
  onOpenCase,
  onClose,
}: {
  active: boolean;
  goal: GoalVersion;
  cases: CaseRecord[];
  workspace: GoalWorkspaceView | null;
  onInspectCase?: (caseId: string) => void;
  onOpenCase: (goal: import('../case-types.ts').CaseGoalEntry) => void;
  onClose: () => void;
}) {
  const intents = workspace?.caseDraftIntents ?? [];
  return (
    <CaseDialog
      active={active}
      title="关联决策与 Case 草稿意图"
      subtitle="查看本目标已关联的年度决策事项，以及阶段跟进或主动试点生成的独立 Case 草稿意图（均须由人确认后进入 Case 决策，不自动建案）。"
      className="sg-dialog gm-aux-dialog"
      busy={false}
      onClose={onClose}
    >
      <section className="gm-aux-section">
        <div className="sg-row-between">
          <h3>本目标独立 Case 草稿意图 ({intents.length})</h3>
          <button
            type="button"
            className="secondary-button"
            disabled={goal.status !== 'adopted'}
            onClick={() => { onClose(); onOpenCase({ goalId: goal.goalId, version: goal.version, strategy: goal.strategies?.[0] }); }}
          >
            从此目标创建正式 Case
          </button>
        </div>
        {intents.length ? (
          <ul className="sg-history">
            {intents.map(intent => {
              return (
              <li key={intent.intentId}>
                <div className="sg-row-between">
                  <strong>{intent.title}</strong>
                  <span className="sg-badge pending">
                    {intent.kind === 'proactive-pilot' ? '主动试点草稿' : '偏差跟进草稿'} · {intent.intentId}
                  </span>
                </div>
                <p className="sg-muted">
                  策略：{intent.strategy} · 绑定目标 v{intent.goalRef.version}
                  {intent.checkId ? ` · 绑定检查 ${intent.checkId}` : ''}
                  {intent.publicationRef ? ` · 拆解版 v${intent.publicationRef.version} / ${intent.publicationRef.rowId}` : ''}
                </p>
                <p>{intent.evidenceSummary}</p>
                <div className="sg-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={goal.status !== 'adopted'}
                    onClick={() => {
                      onClose();
                      onOpenCase({
                        goalId: intent.goalRef.goalId,
                        version: intent.goalRef.version,
                        strategy: intent.strategy,
                        title: intent.title,
                        goalIntent: {goalId: intent.goalId, intentId: intent.intentId},
                      });
                    }}
                  >
                    带入原证据创建正式 Case
                  </button>
                </div>
              </li>
              );
            })}
          </ul>
        ) : (
          <p className="sg-muted">尚无独立 Case 草稿意图。可在「阶段跟进」触发偏差后或直接从已采用 G+S 发起主动试点。</p>
        )}
      </section>

      {onInspectCase && (
        <section className="gm-aux-section">
          <AnnualCases records={cases} goal={goal} onOpen={caseId => { onClose(); onInspectCase(caseId); }} />
        </section>
      )}
    </CaseDialog>
  );
}

export function ExecutionHandoffDialog({
  active,
  goal,
  workspace,
  board,
  arrangementsNode,
  onStartProject,
  onOpenBoard,
  onWorkspaceChanged,
  onClose,
}: {
  active: boolean;
  goal: GoalVersion;
  workspace: GoalWorkspaceView | null;
  board?: BoardView;
  arrangementsNode?: ReactNode;
  onStartProject: (handoff?: import('../strategy-goal-decomposition-types.ts').DecompositionProjectHandoff) => void;
  onOpenBoard?: () => void;
  onWorkspaceChanged: () => Promise<void>;
  onClose: () => void;
}) {
  const activePub = workspace?.activePublication ?? null;
  const rows = activePub?.snapshot.rows ?? [];
  const checkpoints = activePub?.snapshot.frozenCheckpoints ?? [];
  const [selectedRowId, setSelectedRowId] = useState(rows[0]?.rowId ?? '');
  const [selectedCpId, setSelectedCpId] = useState('');
  const [preview, setPreview] = useState<DecompositionProjectHandoffPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    if (!active) return;
    setPreview(null);
    setErr('');
    setMsg('');
    const firstRow = rows[0]?.rowId ?? '';
    setSelectedRowId(firstRow);
    const firstCp = checkpoints.find(c => c.rowId === firstRow)?.checkpointId ?? checkpoints[0]?.checkpointId ?? '';
    setSelectedCpId(firstCp);
  }, [active, activePub?.version]);

  const rowCheckpoints = checkpoints.filter(c => c.rowId === selectedRowId);

  const runPreview = async () => {
    if (!activePub || !selectedRowId) return;
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const res = await api.previewProjectHandoff(goal.goalId, {
        publicationVersion: activePub.version,
        rowId: selectedRowId,
        ...(selectedCpId ? { checkpointId: selectedCpId } : {}),
      });
      setPreview(res);
    } catch (fault) {
      setErr(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  const runConfirm = async () => {
    if (!activePub || !selectedRowId || !preview) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.confirmProjectHandoff(goal.goalId, {
        operationId: crypto.randomUUID(),
        publicationVersion: activePub.version,
        rowId: selectedRowId,
        checkpointId: preview.checkpoint.checkpointId,
      });
      setMsg(res.replayed ? '已复核原项目承接草稿（未重复创建）。' : `已生成项目承接草稿 ${res.handoff.handoffId.slice(0, 8)}（仅项目方案草稿参考，不代表经营行动授权）。`);
      await onWorkspaceChanged();
    } catch (fault) {
      setErr(api.goalError(fault));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CaseDialog
      active={active}
      title="执行承接（基于冻结拆解正式版）"
      subtitle="严格引用拆解正式版中冻结的目标行与行级检查点，先只读预检，再由人确认生成项目承接草稿；不代表已授权经营行动。"
      className="sg-dialog gm-aux-dialog"
      busy={busy}
      onClose={onClose}
    >
      <CaseFormError error={err} />
      {msg && <p className="case-notice" role="status">{msg}</p>}

      {activePub ? (
        <section className="gm-aux-section">
          <h3>从生效拆解版 v{activePub.version} 发起项目承接</h3>
          <div className="gm-form-grid">
            <label className="case-field">
              <span>选择冻结拆解行</span>
              <select
                className="sg-select"
                value={selectedRowId}
                onChange={e => {
                  const rid = e.target.value;
                  setSelectedRowId(rid);
                  const nextCp = checkpoints.find(c => c.rowId === rid)?.checkpointId ?? '';
                  setSelectedCpId(nextCp);
                  setPreview(null);
                }}
              >
                {rows.map(r => (
                  <option key={r.rowId} value={r.rowId}>{r.scopeLabel} · {r.targetValue ?? '待定'}{r.unit}（{r.responsible}）</option>
                ))}
              </select>
            </label>
            <label className="case-field">
              <span>选择冻结行级检查点</span>
              <select
                className="sg-select"
                value={selectedCpId}
                onChange={e => { setSelectedCpId(e.target.value); setPreview(null); }}
              >
                {rowCheckpoints.map(cp => (
                  <option key={cp.checkpointId} value={cp.checkpointId}>{cp.label} · {cp.date} · {cp.targetValue ?? '待定'}{cp.unit}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="sg-row">
            <button type="button" className="secondary-button" disabled={busy || !selectedRowId} onClick={() => void runPreview()}>
              只读预检承接内容
            </button>
            {preview && (
              <button type="button" className="primary-button" disabled={busy} onClick={() => void runConfirm()}>
                确认生成项目承接草稿
              </button>
            )}
          </div>
          {preview && (
            <div className="gm-frozen-box">
              <strong>承接预检结果（零写入）</strong>
              <p>目标行：{preview.rowTitle} · 负责：{preview.responsible} · 策略：{preview.strategy}</p>
              <p>冻结检查点：{preview.checkpoint.label}（{preview.checkpoint.date} · 计划 {preview.checkpoint.targetValue ?? '待定'}{preview.checkpoint.unit} · 依据：{preview.checkpoint.evidenceSource}）</p>
              <p className="sg-muted">{preview.note}</p>
            </div>
          )}
        </section>
      ) : (
        <p className="sg-muted">尚无生效拆解正式版；您仍可直接从已采用总目标开始项目。</p>
      )}

      <section className="gm-aux-section">
        <div className="sg-row-between">
          <h3>已记录项目承接草稿 ({workspace?.handoffs.length ?? 0})</h3>
          <div className="sg-row">
            <button type="button" className="secondary-button" disabled={goal.status !== 'adopted'} onClick={() => { onClose(); onStartProject(); }}>
              从此目标开始项目
            </button>
            {onOpenBoard && board && (
              <button type="button" className="text-button" onClick={() => { onClose(); onOpenBoard(); }}>
                查看行动看板
              </button>
            )}
          </div>
        </div>
        {workspace?.handoffs.length ? (
          <ul className="sg-history">
            {workspace.handoffs.map(h => (
              <li key={h.handoffId}>
                <div className="sg-row-between">
                  <div>
                    <strong>{h.rowTitle}</strong> · 拆解版 v{h.publicationVersion} · 检查点 {h.checkpoint.label}（{h.checkpoint.date} · 计划 {h.checkpoint.targetValue ?? '待定'}{h.unit}）
                    <p className="sg-muted">GSA v{h.gsaPlanRef.planVersion} · 负责 {h.responsible} · 策略 {h.strategy} · 状态：项目方案草稿参考 · 未授权经营行动 · 记录于 {caseDate(h.createdAt)}</p>
                  </div>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={goal.status !== 'adopted'}
                    onClick={() => { onClose(); onStartProject(h); }}
                  >
                    带入冻结承接启动项目
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="sg-muted">尚无拆解行承接记录。</p>
        )}
      </section>

      {arrangementsNode && (
        <section className="gm-aux-section" aria-label="真实行动授权与看板回录记录">
          {arrangementsNode}
        </section>
      )}
    </CaseDialog>
  );
}
