import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { GoalDecompositionError } from './strategy-goal-decomposition-validation.ts';

export interface ApprovedGoalSkillSpec {
  id: 'target-forecast' | 'roi-forecast' | 'coupon-forecast' | 'data-analysis';
  version: string;
  sha256: string;
  scopeNote: string;
  scripts: Readonly<Record<string, { commands: readonly string[] }>>;
}

export const APPROVED_GOAL_ANALYSIS_SKILLS: readonly ApprovedGoalSkillSpec[] = [
  {
    id: 'target-forecast',
    version: '2.0.0',
    sha256: '7833935188e4aec9712f97ffbab276dcb484c2a159dbf58f45ddb4b986ea45ce',
    scopeNote: '仅适用于净支付 GMV、月份与情景推演口径，不强加到库存约束或全部线下净销售目标。',
    scripts: {
      'forecast.py': { commands: ['run'] },
    },
  },
  {
    id: 'roi-forecast',
    version: '2.0.0',
    sha256: 'e5c7989d31bc9149e783e1ea8867592ca89138c9eee62c1949fd76669605b082',
    scopeNote: '适用于投放 ROI 与增量贡献情景测算。',
    scripts: {
      'roi.py': { commands: ['run'] },
    },
  },
  {
    id: 'coupon-forecast',
    version: '2.0.0',
    sha256: '9c404e31004cd7a8f3e4705481c49308919a3c536b800244f6b15e953bc35944',
    scopeNote: '适用于优惠券增量贡献与对比测算。',
    scripts: {
      'coupon.py': { commands: ['compare'] },
    },
  },
  {
    id: 'data-analysis',
    version: '2.0.0-candidate.1',
    sha256: '05402899ac630de257799686828ae4b8a5f2ec1056427f711cc79a9eaf6ce0f6',
    scopeNote: '通用分析方法参考文档（只读）。',
    scripts: {},
  },
];

export const GOAL_SKILL_MANIFEST_FINGERPRINT = createHash('sha256')
  .update(JSON.stringify(APPROVED_GOAL_ANALYSIS_SKILLS.map(s => [s.id, s.version, s.sha256, Object.keys(s.scripts)])))
  .digest('hex');

export function computeSkillPackageSha256(skillMdPath: string): string {
  const root = path.dirname(skillMdPath);
  const entries: [string, string][] = [];
  let bytes = 0;
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))) {
      if (['.git', 'node_modules', '.DS_Store', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache'].includes(entry.name) || entry.name.endsWith('.pyc')) {
        continue;
      }
      const target = path.join(directory, entry.name);
      const stat = lstatSync(target);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory())) {
        throw new GoalDecompositionError('goal_skill_package_unsafe', 403);
      }
      if (stat.isDirectory()) {
        visit(target);
        continue;
      }
      bytes += stat.size;
      if (entries.length >= 1000 || bytes > 32 * 1024 * 1024) {
        throw new GoalDecompositionError('goal_skill_package_budget_exceeded', 413);
      }
      entries.push([
        path.relative(root, target).split(path.sep).join('/'),
        createHash('sha256').update(readFileSync(target)).digest('hex'),
      ]);
    }
  };
  visit(root);
  return createHash('sha256').update(JSON.stringify(entries)).digest('hex');
}

export function resolveApprovedGoalSkill(codeRoot: string, skillId: string): { spec: ApprovedGoalSkillSpec; root: string; skillMd: string } {
  const spec = APPROVED_GOAL_ANALYSIS_SKILLS.find(s => s.id === skillId);
  if (!spec) throw new GoalDecompositionError('goal_skill_not_approved', 403);
  const root = path.resolve(codeRoot, 'extensions/analysis-assets', spec.id);
  const skillMd = path.join(root, 'SKILL.md');
  const actualSha = computeSkillPackageSha256(skillMd);
  if (actualSha !== spec.sha256) {
    throw new GoalDecompositionError('goal_skill_fingerprint_mismatch', 409, { expected: spec.sha256, actual: actualSha });
  }
  return { spec, root, skillMd };
}

export function readApprovedGoalSkillFile(codeRoot: string, skillId: string, relPath = 'SKILL.md'): {
  skill: string;
  version: string;
  sha256: string;
  path: string;
  content: string;
  scopeNote: string;
} {
  const { spec, root } = resolveApprovedGoalSkill(codeRoot, skillId);
  const normalized = path.posix.normalize(relPath.replaceAll('\\', '/')).replace(/^\/+/, '');
  if (!normalized || normalized.includes('..') || (normalized !== 'SKILL.md' && !normalized.startsWith('references/'))) {
    throw new GoalDecompositionError('goal_skill_path_not_authorized', 403);
  }
  const target = path.resolve(root, normalized);
  if (!target.startsWith(root + path.sep) && target !== path.join(root, 'SKILL.md')) {
    throw new GoalDecompositionError('goal_skill_path_not_authorized', 403);
  }
  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    throw new GoalDecompositionError('goal_skill_file_not_found', 404);
  }
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) {
    throw new GoalDecompositionError('goal_skill_file_unavailable', 403);
  }
  const content = readFileSync(target, 'utf8');
  return {
    skill: spec.id,
    version: spec.version,
    sha256: spec.sha256,
    path: normalized,
    content: content.slice(0, 24000),
    scopeNote: spec.scopeNote,
  };
}

/**
 * Execute an approved, fingerprint-verified Skill Python script with structured JSON input
 * inside the goal's isolated workspace. No arbitrary shell, paths, or code injection.
 * Bound strictly to the caller's AbortSignal and timeout.
 */
export async function runApprovedGoalSkillScript(options: {
  codeRoot: string;
  workspaceRoot: string;
  skillId: string;
  scriptName: string;
  command: string;
  scriptInput: Record<string, unknown>;
  signal: AbortSignal;
  timeoutMs?: number;
}): Promise<{
  skill: string;
  script: string;
  command: string;
  skillSha256: string;
  engineVersion: string;
  inputDigest: string;
  outputSha256: string;
  executedAt: string;
  result: unknown;
}> {
  options.signal.throwIfAborted();
  const { spec, root } = resolveApprovedGoalSkill(options.codeRoot, options.skillId);
  const scriptRule = spec.scripts[options.scriptName];
  if (!scriptRule || !scriptRule.commands.includes(options.command)) {
    throw new GoalDecompositionError('goal_skill_script_not_approved', 403);
  }
  if (!options.scriptInput || typeof options.scriptInput !== 'object' || Array.isArray(options.scriptInput)) {
    throw new GoalDecompositionError('invalid_goal_script_input', 400);
  }
  const inputJson = JSON.stringify(options.scriptInput);
  if (Buffer.byteLength(inputJson) > 512 * 1024) {
    throw new GoalDecompositionError('goal_script_input_too_large', 413);
  }
  const scriptPath = path.resolve(root, 'scripts', options.scriptName);
  if (!scriptPath.startsWith(path.join(root, 'scripts') + path.sep)) {
    throw new GoalDecompositionError('goal_skill_script_not_approved', 403);
  }
  const runDir = path.join(options.workspaceRoot, 'script-runs', randomUUID());
  mkdirSync(runDir, { recursive: true, mode: 0o700 });
  const inputFile = path.join(runDir, 'input.json');
  const outputFile = path.join(runDir, 'output.json');
  writeFileSync(inputFile, inputJson, { mode: 0o600 });

  const timeoutMs = options.timeoutMs ?? 20_000;
  try {
    await new Promise<void>((resolve, reject) => {
      const child = execFile(
        'python3',
        [scriptPath, options.command, '--input', inputFile, '-o', outputFile],
        {
          cwd: runDir,
          timeout: timeoutMs,
          maxBuffer: 2 * 1024 * 1024,
          env: { PATH: process.env.PATH ?? '/usr/bin:/bin', PYTHONNOUSERSITE: '1', LC_ALL: 'C.UTF-8', LANG: 'C.UTF-8' },
        },
        (error, _stdout, stderr) => {
          options.signal.removeEventListener('abort', onAbort);
          if (options.signal.aborted) {
            reject(new GoalDecompositionError('goal_script_cancelled', 499));
            return;
          }
          if (error) {
            reject(new GoalDecompositionError('goal_script_execution_failed', 422, { stderr: String(stderr || error.message).slice(0, 1000) }));
            return;
          }
          resolve();
        },
      );
      const onAbort = () => {
        try { child.kill('SIGKILL'); } catch { /* ignore */ }
      };
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    });
    options.signal.throwIfAborted();
    const rawOutput = readFileSync(outputFile);
    if (rawOutput.length > 2 * 1024 * 1024) {
      throw new GoalDecompositionError('goal_script_output_too_large', 413);
    }
    const outputSha256 = createHash('sha256').update(rawOutput).digest('hex');
    const parsed = JSON.parse(rawOutput.toString('utf8')) as Record<string, unknown>;
    const engineVersion = typeof parsed.engine_version === 'string' ? parsed.engine_version : `${spec.id}@${spec.version}`;
    const inputDigest = typeof parsed.input_digest === 'string'
      ? parsed.input_digest
      : createHash('sha256').update(inputJson).digest('hex').slice(0, 16);
    return {
      skill: spec.id,
      script: options.scriptName,
      command: options.command,
      skillSha256: spec.sha256,
      engineVersion,
      inputDigest,
      outputSha256,
      executedAt: new Date().toISOString(),
      result: parsed,
    };
  } finally {
    try { rmSync(runDir, { recursive: true, force: true }); } catch { /* best-effort workspace cleanup */ }
  }
}
