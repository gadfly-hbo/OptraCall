import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

/** Engineering setup boundary; never exposed to Agent tools or HTTP input. */
export async function extractPortablePython({ archive, root, sha256, bytes }) {
  const contents = await readFile(archive);
  if (contents.length !== bytes || createHash('sha256').update(contents).digest('hex') !== sha256) throw new Error('analysis_python_distribution_drift');
  const helper = fileURLToPath(new URL('./extract-analysis-python.py', import.meta.url));
  const result = spawnSync('/usr/bin/python3', ['-I', '-B', helper, path.resolve(archive), path.resolve(root), sha256, String(bytes)], { encoding: 'utf8', timeout: 60_000, env: { PATH: '/usr/bin:/bin', PYTHONDONTWRITEBYTECODE: '1' } });
  if (result.status !== 0) throw new Error(result.stderr || 'analysis_python_extract_failed');
  return JSON.parse(result.stdout);
}
