import type { BoardProjectSummary, BoardReportView, BoardView } from '../api/routes.ts';
import type { BoardItemRecord, BoardItemView, BoardTaskRecord, BoardTaskView, ExtractionRecord, TaskFeedbackRecord } from '../types.ts';

export type { BoardProjectSummary, BoardReportView, BoardView, BoardItemView, BoardTaskView };

const messages: Record<string, string> = {
  extraction_busy: '该报告已有进行中的抽取，请等待完成或停止后再试。',
  configuration_required: '请先在模型设置中选择并配置模型。',
  report_not_utf8: '报告不是有效的 UTF-8 文本，无法抽取。',
  invalid_report_path: '仅支持 060_reports 下的报告文件。',
  invalid_dismiss_reason: '驳回必须填写至少 2 个字符的理由。',
  item_already_dismissed: '该建议已驳回，不能直接改为采纳；可重新抽取或人工补充。',
  invalid_item_decision: '该建议已有决策，请刷新核对后再操作。',
  task_requires_adoption: '只有已采纳的建议才能添加行动任务。',
  item_not_found: '未找到该建议条目，请刷新看板。',
  task_not_found: '未找到该行动任务，请刷新看板。',
  extraction_not_found: '未找到该抽取记录，请刷新看板。',
  project_archived: '项目已归档，请先恢复后继续操作。',
  invalid_feedback: '反馈需包含执行与否和 1–5 的整数评分。',
  invalid_text: '输入内容不完整、为空或超过长度限制。',
};
export class BoardRequestError extends Error {
  constructor(readonly code: string, readonly status: number) { super(messages[code] ?? '决策看板请求未完成，请检查输入或本地服务后重试。'); }
}
async function request<T>(route: string, method: 'GET' | 'POST' = 'GET', input?: unknown): Promise<T> {
  const response = await fetch(`/api/decision-board${route ? `/${route}` : ''}`, { method, credentials: 'omit', mode: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json', 'x-optracall-client': '1' }, ...(input === undefined ? {} : { body: JSON.stringify(input) }) });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new BoardRequestError(String((result as { code?: string }).code ?? 'board_request_failed'), response.status);
  return result as T;
}

export const readBoard = () => request<BoardView>('');
export const extractReport = (projectId: string, path: string) => request<{ extraction: ExtractionRecord }>('reports/extract', 'POST', { projectId, path });
export const stopExtraction = (extractionId: string) => request<{ extraction: ExtractionRecord }>(`extraction/${encodeURIComponent(extractionId)}/stop`, 'POST', {});
export const adoptItem = (id: string) => request<{ item: BoardItemRecord }>(`items/${encodeURIComponent(id)}/adopt`, 'POST', {});
export const dismissItem = (id: string, reason: string) => request<{ item: BoardItemRecord }>(`items/${encodeURIComponent(id)}/dismiss`, 'POST', { reason });
export const addManualItem = (input: { projectId: string; title: string; rationale: string; expectedImpact?: string; priority?: string }) => request<{ item: BoardItemRecord }>('items', 'POST', input);
export const addTask = (itemId: string, input: { title: string; owner?: string; dueDate?: string; priority?: string; note?: string }) => request<{ task: BoardTaskRecord }>(`items/${encodeURIComponent(itemId)}/tasks`, 'POST', input);
export const setTaskStatus = (taskId: string, status: string) => request<{ task: BoardTaskRecord }>(`tasks/${encodeURIComponent(taskId)}/status`, 'POST', { status });
export const saveFeedback = (taskId: string, input: { adopted: boolean; outcome: string; metricDelta: string; review: string; score: number }) => request<{ feedback: TaskFeedbackRecord }>(`tasks/${encodeURIComponent(taskId)}/feedback`, 'POST', input);
