import { useEffect, useRef, useState } from "react";
import type { GoalVersion } from "../strategy-goals-types.ts";
import type {
  GoalReviewDraft as ReviewDraft,
  GoalWorkspaceView,
} from "../strategy-goal-decomposition-types.ts";
import {
  BusinessRoleConversation,
  type BusinessRoleRequest,
} from "./BusinessRoleConversation.tsx";
import * as api from "./strategy-goals-client.ts";

export function GoalReviewDraft({
  goal,
  workspace,
  period,
  disabled,
  onSaved,
  onNext,
}: {
  goal: GoalVersion;
  workspace: GoalWorkspaceView;
  period: string;
  disabled: boolean;
  onSaved: () => Promise<void>;
  onNext: (reviewId: string, ids: string[]) => Promise<void>;
}) {
  const [reviewWorkspace, setReviewWorkspace] = useState(workspace);
  useEffect(() => {
    let active = true;
    void api
      .getWorkspace(goal.goalId)
      .then((ws) => {
        if (active) setReviewWorkspace(ws);
      })
      .catch((f) => {
        if (active) setError(api.goalError(f));
      });
    return () => {
      active = false;
    };
  }, [goal.goalId, workspace]);
  const [draft, setDraft] = useState<ReviewDraft>();
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [request, setRequest] = useState<BusinessRoleRequest>();
  const lastGenerated = useRef("");
  const revisionSerial = useRef(0);
  const inFlight = useRef(false);
  const current = useRef(draft);
  current.current = draft;
  const alive = useRef(true);
  const storage = `optracall.goal.review:${goal.goalId}:${period}`;
  const plans = reviewWorkspace.gsaPlans.filter(
    (p) => p.formalTarget.period === period,
  );
  const lastPlan = plans.at(-1);
  const checks = reviewWorkspace.checks.filter((c) =>
    plans.some((p) => p.planVersion === c.gsaPlanVersion),
  );
  useEffect(() => {
    alive.current = true;
    void api
      .readReviewDraft(goal.goalId, period)
      .then(({ draft: saved }) => {
        if (!alive.current) return;
        let cached: ReviewDraft | undefined;
        try {
          cached =
            JSON.parse(sessionStorage.getItem(storage) ?? "null") ?? undefined;
        } catch {}
        const restored = cached?.revision === saved.revision ? cached : saved;
        setDraft(restored);
        setDirty(restored !== saved);
      })
      .catch((f) => {
        if (alive.current) setError(api.goalError(f));
      });
    return () => {
      alive.current = false;
    };
  }, [goal.goalId, period, storage]);
  function update(next: ReviewDraft) {
    revisionSerial.current++;
    setError("");
    setDraft(next);
    setDirty(true);
    try {
      sessionStorage.setItem(storage, JSON.stringify(next));
    } catch {}
  }
  async function save() {
    const value = current.current;
    if (!value || inFlight.current || disabled) return;
    const serial = revisionSerial.current;
    inFlight.current = true;
    setSaving(true);
    try {
      const { draft: saved } = await api.saveReviewDraft(goal.goalId, {
        ...value,
        expectedRevision: value.revision,
      });
      if (!alive.current) return;
      setDraft((latest) =>
        latest
          ? {
              ...latest,
              revision: saved.revision,
              conclusions:
                serial === revisionSerial.current
                  ? saved.conclusions
                  : latest.conclusions,
            }
          : saved,
      );
      setDirty(serial !== revisionSerial.current);
      if (serial === revisionSerial.current) sessionStorage.removeItem(storage);
    } catch (f) {
      if (alive.current) setError(api.goalError(f));
    } finally {
      inFlight.current = false;
      if (alive.current) setSaving(false);
    }
  }
  useEffect(() => {
    if (!dirty || saving || error || disabled) return;
    const timer = setTimeout(() => void save(), 450);
    return () => clearTimeout(timer);
  }, [draft, dirty, saving, error, disabled]);
  // The persisted evidence keys prevent repeat generation when a period is reopened.
  const evidenceIdentity = JSON.stringify([
    lastPlan?.contentSha256,
    checks.map((c) => c.checkId),
    draft?.actualSourceRef,
    draft?.actualFinalValue,
    draft?.closingReport,
  ]);
  useEffect(() => {
    if (!draft || !lastPlan || disabled || running || dirty || saving) return;
    let active = true;
    void crypto.subtle
      .digest("SHA-256", new TextEncoder().encode(evidenceIdentity))
      .then((buffer) => {
        const key = Array.from(new Uint8Array(buffer), (n) =>
          n.toString(16).padStart(2, "0"),
        ).join("");
        if (
          !active ||
          lastGenerated.current === key ||
          draft.evidenceKeys.includes(key)
        )
          return;
        lastGenerated.current = key;
        setRunning(true);
        setRequest({
          id: crypto.randomUUID(),
          text: "请根据本期末版正式目标、已选结账材料、阶段检查与相关 Case，先起草带原证据和适用范围的复盘结论。优先用检查编号作为 sourceRef。保留事实与待验证点，结论交由负责人取舍。",
          reviewRequest: {
            period,
            actualFinalValue: draft.actualFinalValue,
            actualSourceRef: draft.actualSourceRef,
            ...(draft.closingReport
              ? { closingReport: draft.closingReport }
              : {}),
          },
        });
      });
    return () => {
      active = false;
    };
  }, [
    evidenceIdentity,
    draft,
    disabled,
    running,
    dirty,
    saving,
    lastPlan,
    period,
  ]);
  if (!draft) return <p role="status">{error || "正在读取复盘草稿…"}</p>;
  const selected = draft.conclusions.filter((c) => c.selected && !c.discarded);
  const setConclusion = (
    id: string,
    patch: Partial<ReviewDraft["conclusions"][number]>,
  ) =>
    update({
      ...draft,
      conclusions: draft.conclusions.map((c) => {
        if (c.id !== id) return c;
        const changed = { ...c, ...patch };
        if (
          changed.originalScope &&
          changed.originalScope !== changed.applicableScope
        ) {
          changed.targetScopeSameAsOriginal = false;
          changed.classification = "hypothesis-unverified";
        }
        return changed;
      }),
    });
  const record = async (next: boolean) => {
    if (dirty || saving || disabled) return;
    setSaving(true);
    setError("");
    try {
      const { review } = await api.recordCycleReview(goal.goalId, {
        operationId: crypto.randomUUID(),
        period,
        actualFinalValue: draft.actualFinalValue,
        actualSourceRef: draft.actualSourceRef,
        conclusions: draft.conclusions.filter((c) => !c.discarded),
      });
      await onSaved();
      if (next)
        await onNext(
          review.reviewId,
          selected.map((c) => c.id),
        );
      setNotice(
        next
          ? "已将选定结论及原证据交给 Agent 起草下一期。"
          : "复盘已保存，按本期末版正式目标评估。",
      );
    } catch (f) {
      setError(api.goalError(f));
    } finally {
      if (alive.current) setSaving(false);
    }
  };
  return (
    <div className="gm-card" aria-label="Agent 复盘草稿">
      <strong>Agent 先拟复盘结论</strong>
      <p>
        本期末版 GSA v{lastPlan?.planVersion} · {lastPlan?.formalTarget.value}
        {lastPlan?.formalTarget.unit}。期初 {plans[0]?.formalTarget.value}
        {plans[0]?.formalTarget.unit} 留作备忘。
      </p>
      <div className="gm-form-grid">
        <label className="case-field">
          期末结账实绩
          <input
            className="gm-input"
            type="number"
            step="any"
            value={draft.actualFinalValue ?? ""}
            disabled={disabled}
            onChange={(e) =>
              update({
                ...draft,
                actualFinalValue:
                  e.target.value === "" ? null : Number(e.target.value),
              })
            }
          />
        </label>
        <label className="case-field">
          结账凭证引用
          <input
            className="gm-input"
            value={draft.actualSourceRef}
            disabled={disabled}
            onChange={(e) =>
              update({ ...draft, actualSourceRef: e.target.value })
            }
          />
        </label>
        <label className="case-field">
          结账材料原文
          <textarea
            className="gm-input"
            rows={3}
            maxLength={12000}
            value={draft.closingReport ?? ""}
            disabled={disabled}
            onChange={(e) =>
              update({ ...draft, closingReport: e.target.value })
            }
          />
        </label>
      </div>
      <p role="status">
        {saving ? "正在保存复盘草稿…" : dirty ? "改稿待保存" : "复盘草稿已保存"}
        {running ? " · Agent 正在起草…" : ""}
      </p>
      {error && (
        <div role="alert">
          <p>{error}</p>
          <button
            className="secondary-button"
            onClick={() => {
              setError("");
              void save();
            }}
          >
            重试保存复盘草稿
          </button>
        </div>
      )}
      {notice && <p role="status">{notice}</p>}
      {draft.conclusions.map((c) => (
        <article
          className="gm-card"
          key={c.id}
          aria-label={`复盘结论 ${c.title}`}
        >
          <p>
            原证据 {c.sourceRef} · 原范围 {c.originalScope ?? c.applicableScope}
          </p>
          {c.discarded ? (
            <>
              <p>已舍弃 · {c.title}</p>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() => setConclusion(c.id, { discarded: false })}
              >
                恢复此结论
              </button>
            </>
          ) : (
            <>
              <label className="case-field">
                结论标题
                <input
                  className="gm-input"
                  value={c.title}
                  disabled={disabled}
                  onChange={(e) =>
                    setConclusion(c.id, { title: e.target.value })
                  }
                />
              </label>
              <label className="case-field">
                结论摘要
                <textarea
                  className="gm-input"
                  value={c.summary}
                  disabled={disabled}
                  onChange={(e) =>
                    setConclusion(c.id, { summary: e.target.value })
                  }
                />
              </label>
              <label className="case-field">
                适用范围
                <input
                  className="gm-input"
                  value={c.applicableScope}
                  disabled={disabled}
                  onChange={(e) =>
                    setConclusion(c.id, { applicableScope: e.target.value })
                  }
                />
              </label>
              <p>
                {c.classification === "confirmed-evidence"
                  ? "已核验结论"
                  : "待验证假设"}
              </p>
              <label>
                <input
                  type="checkbox"
                  checked={c.selected}
                  disabled={disabled}
                  onChange={(e) =>
                    setConclusion(c.id, { selected: e.target.checked })
                  }
                />{" "}
                带入下一期
              </label>
              <button
                className="text-button"
                disabled={disabled}
                onClick={() =>
                  setConclusion(c.id, { discarded: true, selected: false })
                }
              >
                舍弃此结论
              </button>
            </>
          )}
        </article>
      ))}
      <div className="sg-row">
        <button
          className="secondary-button"
          disabled={disabled || saving || dirty}
          onClick={() => void record(false)}
        >
          保存到期复盘记录
        </button>
        <button
          className="primary-button"
          disabled={disabled || saving || dirty || !selected.length}
          onClick={() => void record(true)}
        >
          用选中结论起草下一期
        </button>
      </div>
      {request && (
        <details>
          <summary>复盘 Agent 对话与状态</summary>
          <BusinessRoleConversation
            owner={{
              role: "goal",
              goalId: goal.goalId,
              version: goal.version,
              analysisVariant: "goal-review",
            }}
            request={request}
            readOnly={disabled}
            showInlineTitle={false}
            onRunning={setRunning}
            onFailure={setNotice}
            onResult={(detail, id) => {
              const value = current.current;
              if (!value || !alive.current || id !== request?.id) return;
              const basis = request.reviewRequest;
              if (
                basis &&
                (basis.period !== value.period ||
                  basis.actualSourceRef !== value.actualSourceRef ||
                  basis.actualFinalValue !== value.actualFinalValue ||
                  (basis.closingReport ?? "") !== (value.closingReport ?? ""))
              )
                return;
              const suggestion = detail.reviewSuggestions?.find(
                (s) => s.requestId === id,
              );
              if (!suggestion) {
                setNotice("Agent 尚未形成可用结论，可查看原对话并继续讨论。");
                return;
              }
              const existing = new Set(
                value.conclusions.map((c) => c.sourceRef),
              );
              const additions = suggestion.conclusions
                .filter((c) => !existing.has(c.sourceRef))
                .map((c) => ({
                  ...c,
                  targetScopeSameAsOriginal:
                    c.targetScopeSameAsOriginal !== false &&
                    c.originalScope === c.applicableScope,
                  classification: (c.evidenceMature &&
                  c.causalVerified &&
                  c.targetScopeSameAsOriginal !== false &&
                  c.originalScope === c.applicableScope
                    ? "confirmed-evidence"
                    : "hypothesis-unverified") as ReviewDraft["conclusions"][number]["classification"],
                  discarded: false,
                  selected: false,
                }));
              update({
                ...value,
                evidenceKeys: [...value.evidenceKeys, lastGenerated.current],
                conclusions: [...value.conclusions, ...additions],
              });
            }}
          />
        </details>
      )}
    </div>
  );
}
