export interface GoalDraftChange {
  path: string;
  before?: unknown;
  after?: unknown;
}

/** Preserve the user's actual edits when asking the Agent to reconcile a stale draft. */
export function goalDraftChanges(
  before: unknown,
  after: unknown,
  path = "",
): GoalDraftChange[] {
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  if (
    before &&
    after &&
    typeof before === "object" &&
    typeof after === "object" &&
    Array.isArray(before) === Array.isArray(after)
  ) {
    if (
      Array.isArray(before) &&
      Array.isArray(after) &&
      before.length !== after.length
    ) {
      return [{ path, before, after }];
    }
    const left = before as Record<string, unknown>;
    const right = after as Record<string, unknown>;
    return [...new Set([...Object.keys(left), ...Object.keys(right)])].flatMap(
      (key) =>
        goalDraftChanges(
          left[key],
          right[key],
          `${path}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`,
        ),
    );
  }
  return [{ path, before, after }];
}
