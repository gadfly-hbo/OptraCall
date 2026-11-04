import type { PersonalContextHistory, PersonalContextHistoryEntry } from '../personal-context-history.ts';
import { request } from './personal-retention-client.ts';
export type { PersonalContextHistoryEntry };
export type PersonalContextHistoryResult = PersonalContextHistory;
export const readPersonalContextHistory = (projectId: string, taskId: string) => request<PersonalContextHistoryResult>(`/api/projects/${encodeURIComponent(projectId)}/tasks/${encodeURIComponent(taskId)}/personal-context`);
