// Pi's nested-call summary carries arguments and terminal status, without the child result.
// Keep only original source identities so a later consumer can check its current authority.
export const taskSourceDeliveryType = 'optracall.task-source-delivery';

export function tracksTaskSource(name: string) {
  return ['read_project_task_results','read_semantic_context','read_goal_context_source',
    'find_personal_context','read_personal_context','db_sources','db_describe','db_query','db_result','db_save_description'].includes(name);
}
const object = (value: unknown): value is Record<string,unknown> => !!value && typeof value==='object' && !Array.isArray(value);
function pick(value: Record<string,unknown>, keys: string[]) {
  return Object.fromEntries(keys.filter(key=>value[key]!==undefined).map(key=>[key,value[key]]));
}
export function taskSourceDeliveryDetails(name: string, value: unknown) {
  if (!object(value)) throw new Error('task_source_delivery_missing');
  if(name === 'read_project_task_results') return pick(value,['type','action','scope','result','results']);
  if(name === 'read_semantic_context') return {
    items:Array.isArray(value.items) ? value.items.map(item=>pick(item,['state','target'])) : [],
  };
  if(name === 'read_goal_context_source') return pick(value,['goal','source','range','complete']);
  if(name === 'find_personal_context' || name === 'read_personal_context'){
    const delivery=pick(value,['type','schemaVersion','action','partial','continuation','issues']);
    return {...delivery,items:Array.isArray(value.items)?value.items.map(item=>pick(item,['target','part','extent','range','governance','sourceRef','sourceGovernance'])):undefined};
  }
  const saved=pick(value,['status','resultId','observationRef']);
  if(object(value.inputVersion)) saved.inputVersion=pick(value.inputVersion,['datasetId','inputVersionId']);
  if(object(value.description)) saved.description=pick(value.description,['descriptionRevisionId']);
  if(Array.isArray(value.sources)) saved.sources=value.sources.map(item=>pick(item,['connectionId','scope']));
  return saved;
}
