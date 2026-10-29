import fs from 'node:fs/promises';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const root = process.cwd(), directory = path.join(root, 'dist');
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const info = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const files = [];
async function collect(relative = '') {
  for (const entry of await fs.readdir(path.join(directory, relative), { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'optracall-build.json') continue;
    const name = path.posix.join(relative, entry.name), target = path.join(directory, name);
    if (entry.isSymbolicLink()) throw new Error('A trial build must not contain symbolic links.');
    if (entry.isDirectory()) await collect(name);
    else if (entry.isFile()) { const bytes = await fs.readFile(target); files.push({ path: name, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }); }
    else throw new Error('A trial build must contain only regular assets.');
  }
}
await collect();
if (!files.some(file => file.path === 'index.html')) throw new Error('Build the frontend before stamping it.');
const build = { schema: 1, version: info.version, commit: git('rev-parse', 'HEAD'), tree: git('rev-parse', 'HEAD^{tree}'), builtAt: new Date().toISOString(), dirty: Boolean(git('status', '--porcelain=v1', '--untracked-files=normal')), files: files.sort((a, b) => a.path.localeCompare(b.path)) };
await fs.writeFile(path.join(directory, 'optracall-build.json'), JSON.stringify(build, null, 2) + '\n');
process.stdout.write(`Trial build: ${build.version} ${build.commit.slice(0, 7)}${build.dirty ? '+local-changes' : ''}\n`);
