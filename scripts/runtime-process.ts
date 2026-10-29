import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
export function runtimeEnvironment(source: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'TMPDIR', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ']) if (source[key]) env[key] = source[key];
  return { ...env, OPTRACALL_HOST_ISOLATED: '1', PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1', PI_TELEMETRY: '0', NODE_DISABLE_COMPILE_CACHE: '1' };
}
export function runtimeArguments(entry: string, extraReadPaths: string[] = [], access?: { dataRoot: string; projectsRoot: string }): string[] {
  if (Number(process.versions.node.split('.')[0]) < 25) throw new Error('OptraCall Host requires Node.js 25+ for network permission controls.');
  const paths = ['package.json', 'src', 'scripts', 'node_modules'].map(name => path.join(workspaceRoot, name));
  const storage = access ? [access.dataRoot, access.projectsRoot].flatMap(value => [value, path.join(value, '*')]) : [];
  return ['--permission', '--allow-net', ...[...paths, ...extraReadPaths, ...storage].map(value => `--allow-fs-read=${value}`), ...(access ? ['--allow-child-process', ...storage.map(value => `--allow-fs-write=${value}`)] : []), entry];
}
