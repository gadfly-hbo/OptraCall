import { GoalFigures } from "./GoalJourneyViews.tsx";
import { useEffect, useRef, useState } from "react";
import type { GoalVersion } from "../strategy-goals-types.ts";
import type {
  GoalReviewDraft as ReviewDraft,
  GoalWorkspaceView,
} from "../strategy-goal-decomposition-types.ts";
import {
  BusinessRoleConversation,
  readPendingBusinessRoleRequest,
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
  const [closingOpen,setClosingOpen]=useState<boolean|null>(null);
  const [editing,setEditing]=useState<{id:string;title:string;summary:string;applicableScope:string}|null>(null);
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState<ReviewDraft>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [running, setRunning] = useState(false);
  const [request, setRequest] = useState<BusinessRoleRequest>();
  const lastGenerated = useRef("");
  const requestEvidenceKey = useRef<string|undefined>(undefined);
  const revisionSerial = useRef(0);
  const inFlight = useRef(false);
  const current = useRef(draft);
  current.current = draft;
  const alive = useRef(true);
  const storage = `optracall.goal.review:${goal.goalId}:${period}`;
  const reviewOwner = {role:"goal",goalId:goal.goalId,version:goal.version,analysisVariant:"goal-review"} as const;
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
        const restored = cached ?? saved;
        setDraft(restored);
        setDirty(restored !== saved);
        if (cached && cached.revision !== saved.revision) {
          setConflict(saved);
          setError(
            "远端复盘已有新修订，本地改稿、舍弃和勾选已保留，请核对两份内容。",
          );
        }
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
    if (!conflict) setError("");
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
      if (!alive.current) {
        try {
          const cached = JSON.parse(
            sessionStorage.getItem(storage) ?? "null",
          ) as ReviewDraft | null;
          if (cached?.revision === value.revision)
            sessionStorage.setItem(
              storage,
              JSON.stringify({ ...cached, revision: saved.revision }),
            );
        } catch {}
        return;
      }
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
      setConflict(undefined);
      setDirty(serial !== revisionSerial.current);
      if (serial === revisionSerial.current) sessionStorage.removeItem(storage);
      else if (current.current)
        sessionStorage.setItem(
          storage,
          JSON.stringify({ ...current.current, revision: saved.revision }),
        );
    } catch (f) {
      if (alive.current) setError(api.goalError(f));
      if (
        f instanceof api.StrategyGoalsRequestError &&
        f.code === "review_draft_conflict"
      ) {
        try {
          const remote = await api.readReviewDraft(goal.goalId, period);
          if (alive.current) setConflict(remote.draft);
        } catch {}
      }
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
        const original=readPendingBusinessRoleRequest(reviewOwner);
        if(original?.reviewRequest){
          if(request?.id===original.id)return;
          let originalKey:string|undefined;
          try{
            const saved=JSON.parse(sessionStorage.getItem(storage+'.generation')??'null');
            if(saved?.requestId===original.id&&typeof saved.evidenceKey==='string'&&/^[a-f0-9]{64}$/.test(saved.evidenceKey))originalKey=saved.evidenceKey;
          }catch{}
          lastGenerated.current=originalKey??key;
          requestEvidenceKey.current=originalKey;
          setRunning(true);
          setRequest(original);
          return;
        }
        lastGenerated.current = key;
        requestEvidenceKey.current=key;
        setRunning(true);
        const id=crypto.randomUUID();
        try{sessionStorage.setItem(storage+'.generation',JSON.stringify({requestId:id,evidenceKey:key}));}catch{}
        setRequest({
          id,
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
    request,
    goal.goalId,
    goal.version,
    storage,
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
        ...(draft.closingReport ? { closingReport: draft.closingReport } : {}),
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
    <div className="gj-review-draft" aria-label="Agent 复盘草稿">
      <GoalFigures items={[
        {label:'最后生效正式目标',value:lastPlan?`${lastPlan.formalTarget.value}${lastPlan.formalTarget.unit}`:'待核',note:`本期 GSA v${lastPlan?.planVersion??'待核'}`},
        {label:'期初承诺 · 仅作备忘',value:plans[0]?`${plans[0].formalTarget.value}${plans[0].formalTarget.unit}`:'待核',note:'保留原承诺，不改写历史检查'},
        {label:'期末结账实绩',value:draft.actualFinalValue==null?'待补':`${draft.actualFinalValue}${lastPlan?.formalTarget.unit??''}`,note:draft.actualFinalValue==null||!lastPlan?'结账凭证待补':`与末版目标差额 ${Number((draft.actualFinalValue-lastPlan.formalTarget.value).toFixed(4))}${lastPlan.formalTarget.unit}`}]}/>

      <details className="gj-details" open={closingOpen??(!draft.actualSourceRef&&!draft.closingReport)} onToggle={event=>setClosingOpen(event.currentTarget.open)}><summary>查看或补充期末结账资料</summary>
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
      </details><div className="gj-section-heading"><div><h3>Agent 复盘结论</h3><p>核对原证据与适用范围，再选定要带入下一期的结论。</p></div><div className="gj-review-state"><strong>已选 {selected.length} 项</strong><small role="status">{saving?"正在保存…":dirty?"改稿待保存":"草稿已保存"}{running?" · Agent 正在起草…":""}</small></div></div>
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
      {conflict && (
        <section className="gm-card" aria-label="复盘保存冲突对照">
          <strong>核对本地与远端复盘</strong>
          <p>本地改稿保留在原框。远端新增结论会一起带入，原证据继续保留。</p>
          <details>
            <summary>查看远端内容</summary>
            {conflict.conclusions.map((c) => (
              <p key={c.id}>
                {c.title} · {c.summary} ·{" "}
                {c.discarded ? "已舍弃" : c.selected ? "已选入下期" : "未选"}
              </p>
            ))}
          </details>
          <button
            className="secondary-button"
            disabled={disabled || saving}
            onClick={() => {
              const local = current.current;
              if (!local) return;
              try {
                sessionStorage.setItem(
                  storage + ".conflict",
                  JSON.stringify(local),
                );
              } catch {
                setError(
                  "本地备份保存失败，原改稿仍在原框，请恢复存储后重试。",
                );
                return;
              }
              const ids = new Set(local.conclusions.map((c) => c.id));
              const merged = {
                ...local,
                revision: conflict.revision,
                evidenceKeys: [
                  ...new Set([...local.evidenceKeys, ...conflict.evidenceKeys]),
                ],
                conclusions: [
                  ...local.conclusions,
                  ...conflict.conclusions.filter((c) => !ids.has(c.id)),
                ],
              };
              setConflict(undefined);
              setError("");
              update(merged);
            }}
          >
            已核对，保留本地取舍并合入远端新增结论
          </button>
        </section>
      )}
      {notice && <p role="status">{notice}</p>}
      {draft.conclusions.filter(c=>!c.discarded).map(c=><article className="gj-conclusion" key={c.id} aria-label={`复盘结论 ${c.title}`}>
        <div className="gj-section-heading"><h4>{c.title}</h4><span className={`sg-badge ${c.classification==='confirmed-evidence'?'':'pending'}`}>{c.classification==='confirmed-evidence'?'已核验结论':'待验证假设'}</span></div>
        {editing?.id===c.id?<div className="gj-conclusion-editor">
          <label className="case-field">结论标题<input className="gm-input" value={editing.title} disabled={disabled} onChange={e=>setEditing({...editing,title:e.target.value})}/></label>
          <label className="case-field">结论摘要<textarea className="gm-input" value={editing.summary} disabled={disabled} onChange={e=>setEditing({...editing,summary:e.target.value})}/></label>
          <label className="case-field">适用范围<input className="gm-input" value={editing.applicableScope} disabled={disabled} onChange={e=>setEditing({...editing,applicableScope:e.target.value})}/></label>
          <div className="sg-row"><button className="secondary-button" disabled={disabled||!editing.title.trim()||!editing.summary.trim()||!editing.applicableScope.trim()} onClick={()=>{setConclusion(c.id,{title:editing.title,summary:editing.summary,applicableScope:editing.applicableScope});setEditing(null);}}>保存这项修改</button><button className="text-button" onClick={()=>setEditing(null)}>取消修改</button></div>
        </div>:<><p>{c.summary}</p><p className="sg-muted">适用范围 · {c.applicableScope}</p></>}
        <details className="gj-details"><summary>查看原证据与原范围</summary><p>原证据 {c.sourceRef}</p><p>原范围 {c.originalScope??c.applicableScope}</p></details>
        <div className="gj-conclusion-actions"><label className="gm-checkbox"><input type="checkbox" checked={c.selected} disabled={disabled||Boolean(editing)} onChange={e=>setConclusion(c.id,{selected:e.target.checked})}/>带入下一期</label><div className="sg-row"><button className="text-button" disabled={disabled||Boolean(editing)} onClick={()=>setEditing({id:c.id,title:c.title,summary:c.summary,applicableScope:c.applicableScope})}>修改结论</button><button className="text-button" disabled={disabled||Boolean(editing)} onClick={()=>setConclusion(c.id,{discarded:true,selected:false})}>舍弃此结论</button></div></div>
      </article>)}
      {!draft.conclusions.some(c=>!c.discarded)&&<p className="gj-empty">{running?'Agent 正在根据结账材料与阶段记录整理结论…':'结论尚未形成，可补充结账资料或查看下方 Agent 对话。'}</p>}
      {draft.conclusions.some(c=>c.discarded)&&<details className="gj-details"><summary>已舍弃的结论 ({draft.conclusions.filter(c=>c.discarded).length})</summary>{draft.conclusions.filter(c=>c.discarded).map(c=><div className="gj-conclusion" key={c.id}><strong>{c.title}</strong><p>{c.summary}</p><p className="sg-muted">{c.sourceRef} · {c.originalScope??c.applicableScope}</p><button className="text-button" disabled={disabled} onClick={()=>setConclusion(c.id,{discarded:false})}>恢复此结论</button></div>)}</details>}
      <div className="sg-row">
        <button
          className="secondary-button"
          disabled={disabled || saving || dirty || Boolean(editing)}
          onClick={() => void record(false)}
        >
          保存到期复盘记录
        </button>
        <button
          className="primary-button"
          disabled={disabled || saving || dirty || Boolean(editing) || !selected.length}
          onClick={() => void record(true)}
        >
          用选中结论起草下一期（{selected.length}）
        </button>
      </div>
      {request && (
        <details>
          <summary>复盘 Agent 对话与状态</summary>
          <BusinessRoleConversation
            owner={reviewOwner}
            request={request}
            readOnly={disabled}
            showInlineTitle={false}
            onRunning={setRunning}
            onFailure={setNotice}
            onResult={(detail, id) => {
              const value = current.current;
              if (!value || !alive.current || id !== request?.id) return;
              try{
                const saved=JSON.parse(sessionStorage.getItem(storage+'.generation')??'null');
                if(saved?.requestId===id)sessionStorage.removeItem(storage+'.generation');
              }catch{}
              const basis = request.reviewRequest;
              if (
                basis &&
                (basis.period !== value.period ||
                  basis.actualSourceRef !== value.actualSourceRef ||
                  basis.actualFinalValue !== value.actualFinalValue ||
                  (basis.closingReport ?? "") !== (value.closingReport ?? ""))
              ){
                lastGenerated.current="";
                return;
              }
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
                evidenceKeys: requestEvidenceKey.current
                  ? [...new Set([...value.evidenceKeys,requestEvidenceKey.current])]
                  : value.evidenceKeys,
                conclusions: [...value.conclusions, ...additions],
              });
            }}
          />
        </details>
      )}
    </div>
  );
}
