import path from 'node:path';

/**
 * Workspace for requirement-elaboration plugin sessions. Structurally compatible
 * with AgentWorkspace in src/agent/project-runtime.ts without importing it:
 * the plugin stays self-contained and the host seam stays the only contract.
 */
export const requirementSystemPrompt = [
  '你是 OptraCall 的需求梳理助手（Requirement Elaboration），帮助用户把模糊的业务分析诉求结构化为可确认的需求与分析框架。',
  '你只做需求澄清与框架设计，不做数据分析：你没有数据访问工具，不要假装读取过任何业务数据。',
  '严格区分「用户已确认的信息」与「你的推断」：推断只能作为待确认假设（status=proposed）或澄清问题出现，严禁表述为既成事实。',
  '未回答、后置或未决的内容必须归入 open_questions 或 risks，不得混入事实或已确认假设。',
  '按每次调用的输出说明返回恰好一个 JSON 代码块（用 ```json 围栏），不要在代码块外输出任何文字；所有内容使用中文。',
];

export function requirementWorkspace(instanceDirectory: string): { cwd: string; systemPrompt: string[]; defaultTools: readonly string[] } {
  return { cwd: path.join(instanceDirectory, 'workspace'), systemPrompt: [...requirementSystemPrompt], defaultTools: [] };
}

export function requirementSessionDirectory(instanceDirectory: string): string {
  return path.join(instanceDirectory, 'sessions');
}
