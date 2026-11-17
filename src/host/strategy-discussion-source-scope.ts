import type { StrategyDiscussion, StrategyDiscussionSource } from './strategy-discussion-types.ts';

export function discussionSourceMode(discussion: Pick<StrategyDiscussion, 'sourceScope'>): 'project-background' | 'selected-only' {
  return discussion.sourceScope?.mode ?? 'selected-only';
}

/** Same original resource across versions, never a new permission or a content matcher. */
function resource(source: StrategyDiscussionSource): unknown[] {
  const target = source.target;
  switch (target.kind) {
    case 'project-document': return [target.kind, target.projectId, target.path];
    case 'data-description': return [target.kind, target.projectId, target.datasetId];
    case 'enterprise': return [target.kind, target.storeId, target.materialId];
    case 'sap-method': return [target.kind, target.methodId];
    case 'task-report': return [target.kind, target.projectId, target.taskId, target.relativePath];
    case 'task-native-reply': return [target.kind, target.projectId, target.taskId, target.requestId, target.messageId];
    case 'source': {
      const original = target.source;
      if (original && typeof original === 'object' && !Array.isArray(original)) {
        const ref = original as Record<string, unknown>;
        if (ref.type === 'enterprise' && typeof ref.storeId === 'string' && typeof ref.materialId === 'string') return ['enterprise', ref.storeId, ref.materialId];
      }
      return ['exact', source.id];
    }
    // Immutable citation/explicit-source locators keep their original exact identity.
    default: return ['exact', source.id];
  }
}

export function isDiscussionSourceExcluded(discussion: Pick<StrategyDiscussion, 'sourceScope'>, source: StrategyDiscussionSource): boolean {
  const identity = JSON.stringify(resource(source));
  return Boolean(discussion.sourceScope?.excludedSources?.some(excluded => excluded.id === source.id || JSON.stringify(resource(excluded)) === identity));
}
