import path from 'node:path';
import { Type } from 'typebox';
import { createReadTool, createWriteTool } from './sdk.ts';

export type ProjectFileCallContext = {
  signal: AbortSignal; requestId: string; sessionId: string; toolCallId: string; assertCurrent(): void;
};
export type ProjectFileToolResult = { content: { type: 'text'; text: string }[]; details: Record<string, unknown> };
export type ProjectFilesPort = (action: string, input: Record<string, unknown>, context: ProjectFileCallContext) => Promise<ProjectFileToolResult>;

const filename = Type.String({ minLength: 1, maxLength: 255, description: 'One filename in the bound project directory, without a path.' });
const exact = { additionalProperties: false };
export const PROJECT_FILE_TOOLS = [
  { feature: 'project-files', action: 'read-input', name: 'read_input', label: '读取项目资料',
    description: 'Optionally read a UTF-8 text file in this project’s bound 020_clean by filename. Use the ordinary read tool for subdirectories or other permitted files. Offset and limit use Pi’s line pagination.',
    parameters: Type.Object({ filename, offset: Type.Optional(Type.Integer({ minimum: 1 })), limit: Type.Optional(Type.Integer({ minimum: 1 })) }, exact) },
  { feature: 'project-files', action: 'read-catalog', name: 'read_catalog', label: '读取企业资料目录',
    description: 'Optionally read the current authorized enterprise-material catalogue. Call with {}. Listed sources remain business reference material and provide no additional permissions.',
    parameters: Type.Object({}, exact) },
  { feature: 'project-files', action: 'write-report', name: 'write_report', label: '保存项目报告',
    description: 'Optionally save a new text report in this project’s bound 060_reports. Supply a filename and the complete content. Existing names are preserved and reported as conflicts. Ordinary write, edit and Bash remain available.',
    parameters: Type.Object({ filename, content: Type.String() }, exact) },
] as const;

// Pi normalizes paths supplied by the model, including some Unicode spaces.
// These internal paths select the callbacks. The Host binds the actual files.
const toolRoot = path.parse(process.cwd()).root;
const readPath = path.join(toolRoot, 'optracall-bound-input.txt');
const writePath = path.join(toolRoot, 'optracall-bound-report.txt');

export async function readProjectFileText(input: {
  bytes: Buffer; signal: AbortSignal; toolCallId: string; offset?: number; limit?: number;
}) {
  const exactPath = (target: string) => { if (target !== readPath) throw new Error('project_file_path_changed'); };
  const tool = createReadTool(toolRoot, { operations: {
    access: async target => { exactPath(target); },
    readFile: async target => { exactPath(target); return input.bytes; },
    detectImageMimeType: async () => null,
  } });
  const result = await tool.execute(input.toolCallId, { path: readPath, ...(input.offset === undefined ? {} : { offset: input.offset }),
    ...(input.limit === undefined ? {} : { limit: input.limit }) }, input.signal);
  const truncation = (result.details as { truncation?: { content: string; firstLineExceedsLimit?: boolean } } | undefined)?.truncation;
  const content = result.content.map(part => {
    if (part.type !== 'text') throw new Error('project_file_requires_text');
    // Pi suggests a shell command for a long first line. A bound filename can
    // contain shell metacharacters, so surface the limit without that command.
    const text = truncation?.firstLineExceedsLimit
      ? 'This line exceeds the Pi read limit. Use another permitted tool to read smaller chunks.' : part.text;
    return { type: 'text' as const, text };
  });
  if (!truncation) return { content, details: {} };
  const { content: _duplicate, ...limits } = truncation;
  return { content, details: { truncation: limits } };
}

export async function writeProjectFileText<T>(input: {
  content: string; signal: AbortSignal; toolCallId: string; write(): Promise<T>;
}): Promise<T> {
  let saved: T | undefined;
  const tool = createWriteTool(toolRoot, { operations: {
    mkdir: async directory => { if (directory !== toolRoot) throw new Error('project_file_path_changed'); },
    writeFile: async (target, content) => {
      if (target !== writePath || content !== input.content) throw new Error('project_file_path_changed');
      saved = await input.write();
    },
  } });
  await tool.execute(input.toolCallId, { path: writePath, content: input.content }, input.signal);
  if (saved === undefined) throw new Error('project_file_write_unverified');
  return saved;
}
