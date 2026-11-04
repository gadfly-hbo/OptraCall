import path from 'node:path';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { Type } from 'typebox';
import { defineTool, parseFrontmatter, type Skill } from './sdk.ts';

export type SubagentRole = { name: string; description: string; prompt: string; baseDir: string; tools?: string[] };
const identifier = /^[a-z0-9][a-z0-9_-]{0,99}$/;

/** Discover data belonging to skills already selected by the SDK, never executable extensions. */
export function discoverSubagentRoles(skills: readonly Skill[]) {
  const roles = new Map<string, SubagentRole>(), rejected = new Set<string>();
  for (const skill of skills) {
    if (!identifier.test(skill.name)) continue;
    try {
      const baseDir = realpathSync(skill.baseDir), directory = path.join(baseDir, 'agents');
      if (!lstatSync(directory).isDirectory() || realpathSync(directory) !== directory) continue;
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
        try {
          const file = path.join(directory, entry.name), stat = lstatSync(file);
          if (!stat.isFile() || stat.nlink !== 1 || stat.size > 128 * 1024 || realpathSync(file) !== file) continue;
          const { frontmatter, body } = parseFrontmatter<Record<string, unknown>>(readFileSync(file, 'utf8'));
          if (typeof frontmatter.name !== 'string' || !identifier.test(frontmatter.name) || typeof frontmatter.description !== 'string' || !frontmatter.description.trim() || !body.trim()) continue;
          const name = `${skill.name}/${frontmatter.name}`;
          if ('model' in frontmatter || 'cwd' in frontmatter || 'agentDir' in frontmatter) { rejected.add(name); roles.delete(name); continue; }
          let tools: string[] | undefined;
          if (frontmatter.tools !== undefined) {
            const values = typeof frontmatter.tools === 'string' ? frontmatter.tools.split(',').map(value => value.trim()).filter(Boolean) : frontmatter.tools;
            if (!Array.isArray(values) || values.some(value => typeof value !== 'string' || !/^[A-Za-z0-9_]+$/.test(value))) { rejected.add(name); roles.delete(name); continue; }
            tools = [...new Set(values as string[])];
          }
          if (rejected.has(name)) continue;
          if (roles.has(name)) { rejected.add(name); roles.delete(name); continue; }
          roles.set(name, { name, description: frontmatter.description, prompt: body, baseDir, ...(tools ? { tools } : {}) });
        } catch { /* A malformed role is not executable and cannot replace a valid role. */ }
      }
    } catch { /* Missing or unreadable agents directory contributes no roles. */ }
  }
  return [...roles.values()].sort((a, b) => a.name.localeCompare(b.name));
}

const job = Type.Object({ agent: Type.String(), task: Type.String({ minLength: 1 }) }, { additionalProperties: false });
const schema = Type.Object({
  agent: Type.Optional(Type.String()), task: Type.Optional(Type.String({ minLength: 1 })),
  tasks: Type.Optional(Type.Array(job, { minItems: 1, maxItems: 8 })),
  chain: Type.Optional(Type.Array(job, { minItems: 1, maxItems: 8 })),
}, { additionalProperties: false });
export type SubagentResult = { agent: string; outcome: 'completed' | 'failed' | 'cancelled'; text: string };

/** Foreground delegation only. The SDK still owns every model/tool loop. */
export function createSubagentTool(roles: readonly SubagentRole[], run: (role: SubagentRole, task: string, signal?: AbortSignal) => Promise<SubagentResult>) {
  return defineTool({
    name: 'subagent', label: '子 Agent',
    description: `Delegate a task to isolated Pi sessions using the same model and permitted tools. Supply exactly one of agent+task, tasks (parallel), or chain (sequential; {previous} inserts the prior result). All children finish before this tool returns; cancellation follows the parent. Available roles: ${roles.map(role => `${role.name}: ${role.description}`).join('; ') || 'none (install an approved skill with agents/*.md)'}.`,
    parameters: schema,
    execute: async (_id, params, signal) => {
      const modeCount = Number(params.agent !== undefined || params.task !== undefined) + Number(params.tasks !== undefined) + Number(params.chain !== undefined);
      if (modeCount !== 1 || ((params.agent !== undefined || params.task !== undefined) && (!params.agent || !params.task))) throw new Error('subagent_invalid_mode');
      const jobs = params.tasks ?? params.chain ?? [{ agent: params.agent!, task: params.task! }];
      // Validate the whole request before creating a child or contacting any Provider.
      const selected = jobs.map(item => { const role = roles.find(role => role.name === item.agent); if (!role) throw new Error('subagent_role_unavailable'); return { ...item, role }; });
      const execute = async (item: typeof selected[number], task: string): Promise<SubagentResult> => {
        if (signal?.aborted) return { agent: item.agent, outcome: 'cancelled', text: '' };
        return run(item.role, task, signal);
      };
      let results: SubagentResult[];
      if (params.chain) {
        results = [];
        for (const item of selected) {
          const result = await execute(item, item.task.replaceAll('{previous}', () => results.at(-1)?.text ?? ''));
          results.push(result);
          if (result.outcome !== 'completed') break;
        }
      } else {
        // allSettled keeps the parent occupied even when an independent branch fails.
        const settled = await Promise.allSettled(selected.map(item => execute(item, item.task)));
        results = settled.map((result, index) => result.status === 'fulfilled' ? result.value : { agent: selected[index].agent, outcome: signal?.aborted ? 'cancelled' : 'failed', text: 'Subagent execution did not complete.' });
      }
      const data = { mode: params.chain ? 'chain' : params.tasks ? 'parallel' : 'single', results };
      return { content: [{ type: 'text' as const, text: JSON.stringify(data) }], details: data, ...(results.some(result => result.outcome !== 'completed') ? { isError: true } : {}) };
    },
  });
}
