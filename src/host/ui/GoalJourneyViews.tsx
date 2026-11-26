import { useState, type ReactNode } from "react";
import type { GoalVersion } from "../strategy-goals-types.ts";
import type {
  DecompositionDraftInput,
  DecompositionPublicationSnapshot,
  GsaPlannedAction,
  GsaStageCheckpoint,
  ReachabilityEstimate,
} from "../strategy-goal-decomposition-types.ts";
import { allocatedTarget } from "../strategy-goal-allocation.ts";

export function GoalFigures({
  items,
}: {
  items: { label: string; value: ReactNode; note?: ReactNode }[];
}) {
  return (
    <div className="gj-figures">
      {items.map((item) => (
        <div key={item.label}>
          <span>{item.label}</span>
          <strong>{item.value}</strong>
          {item.note && <small>{item.note}</small>}
        </div>
      ))}
    </div>
  );
}
export function GoalSource({ goal }: { goal: GoalVersion }) {
  return (
    <p className="gj-source">
      {goal.measurement.kind === "quantitative" && (
        <span>
          {goal.measurement.sapMetric.metricName} /{" "}
          {goal.measurement.sapMetric.version}
        </span>
      )}
      {goal.formalOrigin?.kind === "strategy-publication"
        ? `战略发布 ${goal.formalOrigin.publicationId} · ${goal.formalOrigin.formalGoalId}`
        : goal.formalOrigin?.kind === "manual-exception"
          ? `手动拟定 · ${goal.formalOrigin.reason}`
          : "正式值与来源待补"}
    </p>
  );
}
export function GsaWorksheet({
  goal,
  actions,
  checkpoints,
  estimate,
  missing,
  onEdit,
  onConfirm,
  disabled,
  onEstimate,
}: {
  goal: GoalVersion;
  actions: GsaPlannedAction[];
  checkpoints: GsaStageCheckpoint[];
  estimate: ReachabilityEstimate | null;
  missing: string[];
  onEdit: () => void;
  onConfirm: () => void;
  disabled: boolean;
  onEstimate: () => void;
}) {
  return (
    <div className="gj-gsa-layout">
      <section className="gj-card" aria-label="总 GSA 工作表">
        <header className="gj-card-head">
          <div>
            <h2>确认总目标 GSA</h2>
            <p>核对已带入的目标与策略，以及本期计划和检查依据。</p>
          </div>
          <span className="gm-status-pill">待确认</span>
        </header>
        {missing.length > 0 && (
          <div className="gj-note">
            <strong>补齐总 GSA 后开始拆解</strong>
            <p>待补齐 {missing.join("、")}</p>
            <button
              className="text-button"
              onClick={onEdit}
              disabled={disabled}
            >
              查看并补齐
            </button>
          </div>
        )}
        <div className="gj-gsa-row">
          <b>G</b>
          <div>
            <h3>{goal.outcome}</h3>
            <p>
              {goal.scope.name} ·{" "}
              {goal.formalOrigin?.period || goal.dueAt || "周期待补"}
              {goal.formalOrigin &&
                ` · 正式目标 ${goal.formalOrigin.targetValue}${goal.formalOrigin.unit}`}
            </p>
            <p>
              {goal.measurement.kind === "quantitative"
                ? goal.measurement.target
                : goal.measurement.criterion}
            </p>
            <GoalSource goal={goal} />
          </div>
        </div>
        <div className="gj-gsa-row">
          <b>S</b>
          <div>
            <h3>核心策略</h3>
            {goal.strategies?.length ? (
              goal.strategies.map((s, i) => <p key={i}>{s}</p>)
            ) : (
              <p>策略待补齐</p>
            )}
          </div>
        </div>
        <div className="gj-gsa-row">
          <b>A</b>
          <div>
            <h3>本期计划与检查依据</h3>
            <button
              className="text-button"
              disabled={disabled}
              onClick={onEdit}
            >
              让 Agent 推荐或优化计划 A
            </button>
            {actions
              .filter((a) => a.summary.trim())
              .map((a) => (
                <div className="gj-action" key={a.id}>
                  <strong>{a.checkpoint || "检查点待补"}</strong>
                  <div>
                    {a.summary}
                    <small>观察依据 · {a.observationBasis || "待补"}</small>
                  </div>
                </div>
              ))}
            {!actions.some((a) => a.summary.trim()) && (
              <p>添加关键行动、阶段检查点和观察依据，即可核对并进入拆解。</p>
            )}
            {checkpoints.map((p) => (
              <p key={p.id}>
                {p.label} · {p.targetDate || "检查时间待补"} ·{" "}
                {p.observationBasis || "观察依据待补"}
              </p>
            ))}
          </div>
        </div>
        <div className="gj-mobile-confirm">
          <button
            className="primary-button"
            disabled={disabled || missing.length > 0}
            onClick={onConfirm}
          >
            确认并进入拆解
          </button>
        </div>
      </section>
      <aside className="gj-aside">
        <GoalFigures
          items={[
            {
              label: "正式目标值",
              value: goal.formalOrigin
                ? `${goal.formalOrigin.targetValue}${goal.formalOrigin.unit}`
                : "待补",
              note:
                goal.formalOrigin?.kind === "strategy-publication"
                  ? "来自正式战略发布"
                  : "手动拟定",
            },
            {
              label: "可达测算值",
              value:
                estimate?.estimatedValue == null
                  ? "待测算"
                  : `${estimate.estimatedValue}${estimate.unit}`,
              note: "同期间、同范围、同口径",
            },
            {
              label: "待策略补足的差额",
              value:
                estimate?.gapValue == null
                  ? "待测算"
                  : `${estimate.gapValue}${estimate.unit}`,
              note: "分别保留正式目标与测算",
            },
          ]}
        />
        <section className="gj-card gj-card-body">
          <h3>已带入当前工作</h3>
          <p>当前目标、策略、经营范围及获准使用的资料。</p>
          <h3>确认后与 Agent 协作</h3>
          <p>
            先测算可达性，再按贡献拆解，结合产品、节假日及活动排出时间计划。
          </p>
          <h3>只处理必要的经营取舍</h3>
          <p>核对预留用途与负责人，明确补缺策略及预期贡献，再发布正式表。</p>
          <button
            className="text-button"
            onClick={onEstimate}
            disabled={disabled}
          >
            与 Agent 测算可达性
          </button>
        </section>
      </aside>
    </div>
  );
}

type Sheet = Pick<
  DecompositionDraftInput,
  | "rows"
  | "estimate"
  | "reserves"
  | "gapStrategies"
  | "views"
  | "timePlan"
  | "notes"
> &
  Partial<Pick<DecompositionPublicationSnapshot, "frozenCheckpoints">>;
const dimensionNames: Record<string, string> = {
  channel: "渠道",
  category: "品类",
  audience: "人群",
  region: "区域",
  store: "门店",
};
export function GoalPlanSheet({
  sheet,
  formalValue,
  unit,
  published = false,
  onEdit,
}: {
  sheet: Sheet;
  formalValue: number;
  unit: string;
  published?: boolean;
  onEdit?: (part: "rows" | "details" | "estimate") => void;
}) {
  const dimensions = [
    ...new Set(sheet.rows.flatMap((row) => Object.keys(row.dimensions ?? {}))),
  ];
  const [chosen, setChosen] = useState("");
  const dimension = dimensions.includes(chosen)
    ? chosen
    : (dimensions[0] ?? "");
  const granularities = [...new Set(sheet.timePlan.map((p) => p.granularity))];
  const [timeChoice, setTimeChoice] = useState("");
  const granularity = granularities.includes(
    timeChoice as (typeof granularities)[number],
  )
    ? timeChoice
    : granularities[0];
  const periods = sheet.timePlan.filter((p) => p.granularity === granularity);
  const groups = dimension
    ? [...new Set(sheet.rows.map((r) => r.dimensions?.[dimension] || "未分类"))]
    : [];
  const orderedRows = dimension
    ? groups.flatMap((group) =>
        sheet.rows.filter(
          (row) => (row.dimensions?.[dimension] || "未分类") === group,
        ),
      )
    : sheet.rows;
  const allocated = allocatedTarget(
    sheet.rows,
    sheet.estimate.metricKind,
    unit,
  );
  const reserves = sheet.reserves.reduce((sum, r) => sum + r.amount, 0);
  return (
    <div
      className="gj-sheet"
      aria-label={published ? "正式目标拆解成果" : "目标拆解成果"}
    >
      {
        <GoalFigures
          items={[
            {
              label: "正式目标值",
              value: `${formalValue}${unit}`,
              note:
                allocated == null
                  ? "按指标口径汇总"
                  : `已分配 ${allocated} + 预留 ${reserves}`,
            },
            {
              label: "可达测算值",
              value:
                sheet.estimate.estimatedValue == null
                  ? "待测算"
                  : `${sheet.estimate.estimatedValue}${unit}`,
              note: "同期间、同范围、同口径",
            },
            {
              label: "待策略补足的差额",
              value:
                sheet.estimate.gapValue == null
                  ? "待核"
                  : `${sheet.estimate.gapValue}${unit}`,
              note: onEdit ? (
                <button
                  className="text-button"
                  onClick={() => onEdit("estimate")}
                >
                  核对测算依据
                </button>
              ) : (
                "保留原测算"
              ),
            },
          ]}
        />
      }
      <div className="gj-section-heading">
        <h3>{published ? "正式责任分配" : "贡献拆解"}</h3>
        {onEdit && (
          <button className="text-button" onClick={() => onEdit("rows")}>
            调整责任分配
          </button>
        )}
      </div>
      {dimensions.length > 0 && (
        <div className="gj-view-tabs" aria-label="贡献维度">
          {dimensions.map((d) => (
            <button
              key={d}
              aria-pressed={dimension === d}
              onClick={() => setChosen(d)}
            >
              按{dimensionNames[d] || d}
            </button>
          ))}
        </div>
      )}
      {groups.length > 0 && (
        <div className="gj-group-totals">
          {groups.map((group) => {
            const rows = sheet.rows.filter(
              (r) => (r.dimensions?.[dimension] || "未分类") === group,
            );
            const total = allocatedTarget(
              rows,
              sheet.estimate.metricKind,
              unit,
            );
            return (
              <span key={group}>
                {group}{" "}
                <strong>
                  {total == null ? "按明细核对" : `${total}${unit}`}
                </strong>
              </span>
            );
          })}
        </div>
      )}
      <div className="sg-table-scroll">
        <table className="gj-result-table">
          <thead>
            <tr>
              <th>子目标 / 承接策略</th>
              <th>分配目标</th>
              <th>负责人</th>
              {published && <th>期末检查点</th>}
            </tr>
          </thead>
          <tbody>
            {orderedRows.map((row) => (
              <tr key={row.rowId}>
                <td>
                  <strong>{row.scopeLabel || row.title}</strong>
                  <small>{row.strategy}</small>
                  {row.contributionNature !== "allocation" && (
                    <small>
                      {row.contributionNature === "driver-hypothesis"
                        ? "驱动假设"
                        : row.contributionNature === "aggregation"
                          ? "汇总参考"
                          : "里程碑"}
                    </small>
                  )}
                </td>
                <td>
                  {row.targetValue == null
                    ? "待定"
                    : `${row.targetValue}${row.unit}`}
                </td>
                <td>{row.responsible}</td>
                {published && (
                  <td>
                    {(
                      sheet.frozenCheckpoints?.filter(
                        (p) => p.rowId === row.rowId,
                      ) ?? row.checkpoints
                    ).map((cp, i) => (
                      <div key={i}>
                        {cp.label} · {cp.date}
                        <small>
                          {cp.targetValue == null
                            ? "未定"
                            : `${cp.targetValue}${cp.unit}`}
                        </small>
                      </div>
                    ))}
                  </td>
                )}
              </tr>
            ))}
            {sheet.reserves.map((r) => (
              <tr key={r.id}>
                <td>
                  预留<small>{r.purpose || "用途待补"}</small>
                </td>
                <td>
                  {r.amount}
                  {r.unit}
                </td>
                <td>{r.owner || "负责人待补"}</td>
                {published && <td>按用途单列</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!sheet.rows.length && (
        <div className="gj-empty">
          <h3>生成第一份拆解草稿</h3>
          <p>向目标 Agent 发送本期业务要求，形成贡献分配与时间计划。</p>
        </div>
      )}
      <div className="gj-section-heading">
        <h3>时间计划</h3>
        {onEdit && (
          <button className="text-button" onClick={() => onEdit("details")}>
            调整计划、预留与补缺
          </button>
        )}
      </div>
      {granularities.length > 1 && (
        <div className="gj-view-tabs" aria-label="时间粒度">
          {granularities.map((g) => (
            <button
              key={g}
              aria-pressed={granularity === g}
              onClick={() => setTimeChoice(g)}
            >
              {{ day: "日计划", week: "周计划", month: "月计划" }[g]}
            </button>
          ))}
        </div>
      )}
      <div className="gj-periods">
        {periods.map((p) => (
          <div key={p.periodId}>
            <span>{p.label}</span>
            <strong>
              {p.targetValue == null ? "本期未定" : `${p.targetValue}${p.unit}`}
            </strong>
            <small>
              {p.startDate}—{p.endDate}
            </small>
            {p.status !== "planned" && (
              <small>
                {p.status === "observing" ? "观察中" : "本期未定计划"}
              </small>
            )}
            {p.constraintNote && <p>{p.constraintNote}</p>}
          </div>
        ))}
      </div>
      {!periods.length && (
        <p className="sg-muted">
          时间计划待形成，Agent 可结合产品与经营节奏补充。
        </p>
      )}
      <div className="gj-note">
        <h3>补缺策略</h3>
        <p>
          同口径可达测算{" "}
          {sheet.estimate.estimatedValue == null
            ? "待测算"
            : `${sheet.estimate.estimatedValue}${unit}`}
          ，与正式目标差额{" "}
          {sheet.estimate.gapValue == null
            ? "待核"
            : `${sheet.estimate.gapValue}${unit}`}
          。
        </p>
        {sheet.gapStrategies.map((g) => (
          <p key={g.id}>
            <strong>{g.name}</strong> · {g.strategy} · 预期贡献{" "}
            {g.expectedContribution}
            {g.unit}
          </p>
        ))}
      </div>
      <details className="gj-details">
        <summary>测算依据、贡献口径与检查点</summary>
        <p>{sheet.estimate.basis || "测算依据待补"}</p>
        {sheet.estimate.evidence.map((e, i) => (
          <p key={i}>
            {e.summary} {e.basis}
          </p>
        ))}
        {sheet.estimate.limitations?.map((s, i) => (
          <p key={i}>{s}</p>
        ))}
        {sheet.gapStrategies.map((g) => (
          <p key={g.id}>
            {g.name} · {g.nonOverlappingScope} · {g.basis}
          </p>
        ))}
        {sheet.rows.map((row) => (
          <div key={row.rowId}>
            <strong>{row.scopeLabel || row.title}</strong>
            <p>{row.basis}</p>
            {row.checkpoints.map((cp) => (
              <p key={cp.id}>
                {cp.label} · {cp.date} · {cp.evidenceSource}
              </p>
            ))}
          </div>
        ))}
        {sheet.notes && <p>{sheet.notes}</p>}
      </details>
    </div>
  );
}
