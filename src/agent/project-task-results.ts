import { Type } from 'typebox';
import type { ProjectPlanDelivery } from '../host/project-plan-host.ts';
import type { ProjectTaskResultsPort, ProjectTaskResultsContext } from '../host/project-task-results-types.ts';
export type ProjectTaskResultsCallContext = ProjectTaskResultsContext & { projectPlan: ProjectPlanDelivery };
export type ProjectTaskResultsRunPort = (action: Parameters<ProjectTaskResultsPort>[0], input: Record<string, unknown>, context: ProjectTaskResultsCallContext) => ReturnType<ProjectTaskResultsPort>;
export const PROJECT_TASK_RESULTS_TOOL = {
  feature: 'project-task-results', action: 'read', name: 'read_project_task_results', label: '读取本项目准确任务成果',
  description: '按已确认项目范围查询与读取原Task准确成果，辅助项目综合和交叉核对。find仅查原native报告绑定元信息；当前无准确结果时可用waitMs进行最多30000ms的本次有界等候，超时/仍运行保持未知，不唤醒源Task或新建会话，可taskId筛选并用cursor翻页；read使用find返回的准确id和offset/limit按UTF16分页。没有报告、仍运行、失败、取消、版本变化及权限不足照实保留，不代表Task完成、专业正确或已综合。单Task只读自身，多Task只读本次确认参与者，不可传路径或跨项目。具体协作顺序、方法和判断由你决定。',
  parameters: Type.Object({ waitMs: Type.Optional(Type.Integer({ minimum: 0, maximum: 30000 })), action: Type.Union([Type.Literal('find'), Type.Literal('read')]), taskId: Type.Optional(Type.String()), cursor: Type.Optional(Type.String()), id: Type.Optional(Type.String()), offset: Type.Optional(Type.Integer({ minimum: 0 })), limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 16000 })) }, { additionalProperties: false }),
} as const;
