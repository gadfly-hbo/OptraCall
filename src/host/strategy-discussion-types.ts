import type { UsageContext } from './usage-context-types.ts';
import type { GoalRef, GoalSourceRef, GoalVersion } from './strategy-goals-types.ts';
import type { ProjectSnapshot } from '../agent/project-runtime.ts';
/** The native transcript is authoritative for discussion text; these are owner facts only. */
export interface StrategyMethodSelection { id:string; name:string; source?:GoalSourceRef }
export interface StrategyDiscussionSource { id:string; title:string; target:Record<string,unknown>; sha256:string; version:string|number }
/** Explicit background boundary; absence on legacy records retains selected-only behavior. */
export interface StrategyDiscussionSourceScope { mode:'project-background'|'selected-only'; excludedSources?:StrategyDiscussionSource[] }
export interface StrategyDiscussion {
 id:string; title:string; revision:number; configurationId:string; configurationRevision:number;
 usageContext?:UsageContext|null; methods:StrategyMethodSelection[]; goal?:GoalRef; projectId?:string;
 sources:StrategyDiscussionSource[]; sourceScope?:StrategyDiscussionSourceScope; sessionFile?:string; createdAt:string; updatedAt:string;
 pendingInput?:{requestId:string;text:string;expectedRevision:number};
 lastRun?:{id:string;fingerprint:string;status:'accepted'|'completed'|'cancelled'|'failed'|'unknown'};
}
/** operationId is also the stable discussion id; GET it after a lost create reply. */
export interface StrategyDiscussionCreate { operationId:string; title?:string; configurationId?:string; usageContext?:UsageContext|null; methods?:StrategyMethodSelection[]; goal?:GoalRef; projectId?:string; sources?:StrategyDiscussionSource[]; sourceScope?:StrategyDiscussionSourceScope }
export interface StrategyDiscussionUpdate { expectedRevision:number; title?:string; configurationId?:string; usageContext?:UsageContext|null; methods?:StrategyMethodSelection[]; goal?:GoalRef|null; projectId?:string|null; sources?:StrategyDiscussionSource[]; sourceScope?:StrategyDiscussionSourceScope }
export interface StrategyDiscussionDetail { discussion:StrategyDiscussion; busy:boolean; snapshot:ProjectSnapshot; goals:GoalVersion[]; goalContentHashes:Record<string,string>; replies:{text:string;source:GoalSourceRef}[]; requestReceipt?:{requestId:string;originalUserText:string;nativeEntryId:string;sessionId:string} }
export interface StrategyDiscussionMessage { requestId:string; text:string; expectedRevision:number; replacePendingRequestId?:string }

export interface StrategyDiscussionSourceDetail { source:import('./strategy-goals-types.ts').GoalDiscussionSourceRef; role:string; body:string; range:{start:number;end:number;total:number}; complete:boolean }
