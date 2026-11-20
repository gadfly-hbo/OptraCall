import type { StrategyDiscussion, StrategyDiscussionSource } from './strategy-discussion-types.ts';

export function discussionSourceMode(discussion: Pick<StrategyDiscussion, 'sourceScope'|'projectAttachmentLineages'>): 'project-background' | 'selected-only' {
  return discussion.sourceScope?.mode ?? 'selected-only';
}

/** Same original resource across versions, never a new permission or a content matcher. */
function resource(source: StrategyDiscussionSource): unknown[] {
  const target = source.target;
  switch (target.kind) {
    case 'strategy-attachment': return target.projectId ? ['project-document',target.projectId,target.path] : [target.kind,target.discussionId,target.fileId];
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

export function isDiscussionSourceExcluded(discussion: Pick<StrategyDiscussion, 'sourceScope'|'projectAttachmentLineages'>, source: StrategyDiscussionSource): boolean {
  const identity = JSON.stringify(resource(source));
  const lineage=(ref:StrategyDiscussionSource)=>{
    const t=ref.target;
    if(!['strategy-attachment','project-document'].includes(String(t.kind))||typeof t.uploadId!=='string')return;
    return discussion.projectAttachmentLineages?.[t.uploadId]??t.uploadId;
  };
  const original=lineage(source);
  return Boolean(discussion.sourceScope?.excludedSources?.some(excluded => excluded.id === source.id || JSON.stringify(resource(excluded)) === identity ||
    original!==undefined&&excluded.target.projectId===source.target.projectId&&lineage(excluded)===original));
}

/** Private files have immutable revisions within one discussion. Only keep earlier
 * revisions that were actually selected and replaced while this file stayed granted. */
export function privateAttachmentHistory(owner:StrategyDiscussion,nextSources:StrategyDiscussionSource[]){
  const history:Record<string,string[]>={};
  const privateFiles=(sources:StrategyDiscussionSource[])=>sources.filter(s=>s.target.kind==='strategy-attachment'&&s.target.discussionId===owner.id&&
    !s.target.projectId&&typeof s.target.fileId==='string'&&/^[a-f0-9]{64}$/.test(s.target.fileId));
  const before=privateFiles(owner.sources),after=privateFiles(nextSources);
  for(const key of new Set(after.map(s=>s.target.fileId as string))){
    const current=after.filter(s=>s.target.fileId===key),previous=before.filter(s=>s.target.fileId===key);
    const replaced=current.some(s=>!previous.some(old=>old.id===s.id));
    const permitted=new Set(owner.privateAttachmentHistory?.[key]??[]);
    for(const old of previous){
      if(replaced)permitted.add(old.id);
      else if(!current.some(s=>s.id===old.id))permitted.delete(old.id);
    }
    for(const now of current)permitted.delete(now.id);
    if(permitted.size)history[key]=[...permitted];
  }
  return Object.keys(history).length?history:undefined;
}
export function isDiscussionSourceSelected(discussion:Pick<StrategyDiscussion,'sources'|'privateAttachmentHistory'>,source:StrategyDiscussionSource):boolean{
  if(discussion.sources.some(selected=>selected.id===source.id))return true;
  const target=source.target;
  return target.kind==='strategy-attachment'&&target.projectId===undefined&&typeof target.fileId==='string'&&
    !!discussion.privateAttachmentHistory?.[target.fileId]?.includes(source.id)&&discussion.sources.some(s=>
      s.target.kind===target.kind&&s.target.discussionId===target.discussionId&&s.target.fileId===target.fileId);
}
