import type {
  GoalPlanRequest,
  GoalReviewRequest,
} from "./strategy-discussion-types.ts";
import { StrategyDiscussionFault } from "./strategy-discussion-store.ts";

function object(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
export function assistanceText(
  value: unknown,
  limit: number,
  allowEmpty = false,
): string {
  if (
    typeof value !== "string" ||
    value.length > limit ||
    value.includes("\0") ||
    (!allowEmpty && !value.trim())
  ) {
    throw new StrategyDiscussionFault("invalid_goal_assistance", 400);
  }
  return value;
}
export function parsePlanRequest(value: unknown): GoalPlanRequest {
  if (
    !object(value) ||
    !["recommend", "optimize"].includes(String(value.mode)) ||
    !object(value.row)
  ) {
    throw new StrategyDiscussionFault("invalid_goal_assistance", 400);
  }
  return {
    mode: value.mode as GoalPlanRequest["mode"],
    row: {
      id: assistanceText(value.row.id, 120),
      summary: assistanceText(value.row.summary, 4000, true),
      checkpoint: assistanceText(value.row.checkpoint ?? "", 2000, true),
      observationBasis: assistanceText(
        value.row.observationBasis ?? "",
        2000,
        true,
      ),
    },
  };
}
export function parseReviewRequest(value: unknown): GoalReviewRequest {
  if (
    !object(value) ||
    !(
      value.actualFinalValue === null ||
      (typeof value.actualFinalValue === "number" &&
        Number.isFinite(value.actualFinalValue))
    )
  ) {
    throw new StrategyDiscussionFault("invalid_goal_assistance", 400);
  }
  return {
    period: assistanceText(value.period, 100),
    actualFinalValue: value.actualFinalValue as number | null,
    actualSourceRef: assistanceText(value.actualSourceRef, 500, true),
    ...(value.closingReport === undefined
      ? {}
      : { closingReport: assistanceText(value.closingReport, 12000, true) }),
  };
}
