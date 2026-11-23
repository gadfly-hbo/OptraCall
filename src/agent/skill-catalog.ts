import path from 'node:path';
import { readFileSync, readdirSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadSkills, getAgentDir } from './sdk.ts';
export function packageIdentity(filePath: string) {
  const root = path.dirname(filePath), entries: [string, string][] = []; let bytes = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (['.git', 'node_modules', '.DS_Store', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache'].includes(entry.name) || entry.name.endsWith('.pyc')) continue;
      const target = path.join(directory, entry.name), stat = lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isFile() && !stat.isDirectory()) throw new Error('skill_package_identity_unavailable');
      if (stat.isDirectory()) { visit(target); continue; }
      bytes += stat.size;
      if (entries.length >= 1000 || bytes > 32 * 1024 * 1024) throw new Error('skill_package_identity_budget_exceeded');
      entries.push([path.relative(root, target).split(path.sep).join('/'), createHash('sha256').update(readFileSync(target)).digest('hex')]);
    }
  };
  visit(root); return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}
/** Public SDK metadata discovery only. Package identity covers instructions, references, scripts and templates.
 * Preserves the SDK's original selection order (project/user skills win over bundled same-name).
 * Project Plan capability validation depends on this order matching what the Agent actually sees. */
export function projectSkillCatalog(codeRoot: string, cwd: string, resourceRoot?: string) {
  const result = loadSkills({ cwd, agentDir: resourceRoot ?? getAgentDir(), skillPaths: [path.resolve(codeRoot, 'extensions/analysis-assets')], includeDefaults: true });
  const diagnostics = result.diagnostics.map(item => ({ type: item.type, message: item.message }));
  const skills = result.skills.flatMap(skill => {
    try { const sha256 = packageIdentity(skill.filePath); return [{ id: skill.name, title: skill.name, description: skill.description, version: `sha256:${sha256}`, sha256, filePath: skill.filePath }]; }
    catch (error) { diagnostics.push({ type: 'warning', message: `${skill.name}: ${error instanceof Error ? error.message : 'skill_package_identity_unavailable'}` }); return []; }
  });
  return { skills, diagnostics };
}

/** Exact-load a single fixed built-in skill, bypassing project/user same-name overrides.
 * Only for the "user enabled the fixed built-in version" validation and execution path. */
export function loadFixedBuiltInSkill(codeRoot: string, skillId: string, cwd: string, resourceRoot?: string) {
  const fixedPath = path.resolve(codeRoot, 'extensions/analysis-assets', skillId, 'SKILL.md');
  const result = loadSkills({ cwd, agentDir: resourceRoot ?? getAgentDir(), skillPaths: [fixedPath], includeDefaults: false });
  const skill = result.skills.find(s => s.name === skillId);
  if (!skill) return undefined;
  try { return { id: skill.name, sha256: packageIdentity(skill.filePath), filePath: skill.filePath }; }
  catch { return undefined; }
}
