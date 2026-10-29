import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';

export type UiBuild = { schema: 1; version: string; commit: string; tree: string; builtAt: string; dirty: boolean; files: { path: string; bytes: number; sha256: string }[] };
const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function validName(name: unknown): name is string { return typeof name === 'string' && name.length > 0 && !name.includes('\\') && !name.includes('\0') && !path.isAbsolute(name) && name.split('/').every(part => Boolean(part) && !part.startsWith('.')); }

// Only the stamped build is served. Business files and the source tree never
// enter this asset map; loading bytes once also keeps a running build stable.
export async function loadStaticUi(directory: string) {
  const root = await fs.realpath(directory), manifestPath = path.join(root, 'optracall-build.json');
  const stat = await fs.lstat(manifestPath); if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 262144) throw new Error('Invalid UI build manifest.');
  const build = JSON.parse(await fs.readFile(manifestPath, 'utf8')) as UiBuild;
  if (build.schema !== 1 || typeof build.version !== 'string' || !/^[a-f0-9]{40}$/.test(build.commit) || !/^[a-f0-9]{40}$/.test(build.tree) || !Number.isFinite(Date.parse(build.builtAt)) || typeof build.dirty !== 'boolean' || !Array.isArray(build.files)) throw new Error('Invalid UI build identity.');
  const assets = new Map<string, Buffer>();
  for (const file of build.files) {
    if (!validName(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/.test(file.sha256) || assets.has(file.path)) throw new Error('Invalid UI asset record.');
    const target = await fs.realpath(path.join(root, file.path)), relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative) || !(await fs.stat(target)).isFile()) throw new Error('UI asset escapes its build.');
    const bytes = await fs.readFile(target); if (bytes.length !== file.bytes || hash(bytes) !== file.sha256) throw new Error('UI build content changed.'); assets.set(file.path, bytes);
  }
  if (!assets.has('index.html')) throw new Error('UI index is missing.');
  return { build, serve(request: IncomingMessage, response: ServerResponse, url: URL) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return false;
    let name: string; try { name = decodeURIComponent(url.pathname).slice(1); } catch { return false; }
    if (name === '') name = 'index.html';
    if (!validName(name)) return false;
    if (!assets.has(name) && !path.extname(name) && request.headers.accept?.includes('text/html')) name = 'index.html';
    const bytes = assets.get(name); if (!bytes) return false;
    response.writeHead(200, { 'Content-Type': types[path.extname(name)] ?? 'application/octet-stream', 'Content-Length': bytes.length, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : bytes); return true;
  } };
}
