import { useEffect, useRef, useState } from "react";
import type { BusinessRoleOwner } from "../business-role-types.ts";
import type { GsaPlannedAction } from "../strategy-goal-decomposition-types.ts";
import {
  BusinessRoleConversation,
  type BusinessRoleRequest,
} from "./BusinessRoleConversation.tsx";

const fields = ["summary", "checkpoint", "observationBasis"] as const;

export function GoalPlanAssistance({
  owner,
  action,
  ready,
  disabled,
  onChange,
}: {
  owner: BusinessRoleOwner;
  action: GsaPlannedAction;
  ready: boolean;
  disabled: boolean;
  onChange: (action: GsaPlannedAction) => void;
}) {
  const [request, setRequest] = useState<BusinessRoleRequest>();
  const [running, setRunning] = useState(false);
  const [note, setNote] = useState("");
  const [undo, setUndo] = useState<{
    before: GsaPlannedAction;
    after: GsaPlannedAction;
  }>();
  const current = useRef(action);
  current.current = action;
  const captured = useRef<
    | { id: string; before: GsaPlannedAction; mode: "recommend" | "optimize" }
    | undefined
  >(undefined);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  function start(mode: "recommend" | "optimize") {
    if (disabled || running || !ready) return;
    const id = crypto.randomUUID();
    captured.current = { id, before: structuredClone(action), mode };
    setNote("");
    setRunning(true);
    setRequest({
      id,
      text:
        mode === "recommend"
          ? "请根据当前 G/S 推荐本行计划 A、阶段检查点和观察依据。保留已有文字，只补空项。"
          : "请基于本行手填要点优化计划，保留全部数额、单位、期限、范围、先后关系、否定条件和禁用资料。",
      planRequest: { mode, row: action },
    });
  }
  return (
    <div className="gm-plan-assistance">
      <div className="sg-row">
        <button
          type="button"
          className="secondary-button"
          disabled={
            disabled ||
            running ||
            !ready ||
            fields.every((k) => action[k]?.trim())
          }
          onClick={() => start("recommend")}
        >
          让 Agent 推荐计划 A
        </button>
        <button
          type="button"
          className="secondary-button"
          disabled={
            disabled ||
            running ||
            !ready ||
            !fields.some((k) => action[k]?.trim())
          }
          onClick={() => start("optimize")}
        >
          Agent 一键优化计划
        </button>
        {undo && (
          <button
            type="button"
            className="text-button"
            disabled={disabled}
            onClick={() => {
              const restored = { ...action };
              for (const key of fields)
                if (action[key] === undo.after[key])
                  restored[key] = undo.before[key] ?? "";
              onChange(restored);
              setUndo(undefined);
              setNote("已撤销本次建议，后续手改保留。");
            }}
          >
            撤销本次建议
          </button>
        )}
      </div>
      {!ready && (
        <p className="sg-muted">先补齐当前 G 和 S，即可推荐或优化计划 A。</p>
      )}
      {note && <p role="status">{note}</p>}
      {request && (
        <details className="gm-plan-assistance-record">
          <summary>计划建议的对话与状态</summary>
          <BusinessRoleConversation
            owner={owner}
            request={request}
            readOnly={disabled}
            showInlineTitle={false}
            onRunning={setRunning}
            onFailure={setNote}
            onResult={(detail, id) => {
              const original = captured.current;
              if (!alive.current || disabled || !original || original.id !== id)
                return;
              const suggestion = detail.planSuggestions?.find(
                (p) => p.requestId === id && p.rowId === action.id,
              );
              if (!suggestion) {
                setNote("本次未返回可填写的计划建议，可以继续手填或重试。");
                return;
              }
              const before = current.current;
              const next = { ...before };
              for (const key of fields) {
                if (before[key] !== original.before[key]) continue;
                if (original.mode === "recommend" && before[key]?.trim())
                  continue;
                next[key] = suggestion.plan[key] ?? "";
              }
              onChange(next);
              setUndo({ before, after: next });
              setNote(suggestion.note || "建议已填入原框，可继续修改并确认。");
            }}
          />
        </details>
      )}
    </div>
  );
}
