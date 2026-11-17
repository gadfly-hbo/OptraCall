import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const codeRoot = fileURLToPath(new URL('../../../../', import.meta.url)), demoRoot = fileURLToPath(new URL('./', import.meta.url));
const outputRoot = path.join(codeRoot, '.local/v12-pm01-fix/ui-preparation');
const manifest = JSON.parse(fs.readFileSync(path.join(demoRoot, 'source-manifest.json'), 'utf8'));
const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const modulePath = '/openspec/changes/overall-architecture-v12/pm01-ui-demo/scope.tsx';
function once(source: string, old: string, replacement: string, label: string) { if (source.split(old).length !== 2) throw new Error(`Scope Demo anchor mismatch: ${label}`); return source.replace(old, replacement); }
function transformApp(source: string) {
  source = once(source, 'useState<AppView>(() => new URL', "useState<AppView>(() => 'goals' as AppView || new URL", 'initial original strategy page');
  return once(source, 'const [goalMounted, setGoalMounted] = useState(false);', 'const [goalMounted, setGoalMounted] = useState(true);', 'mount original strategy page');
}
function transformPanel(source: string) {
  const directory = '<button type="button" className="secondary-button" disabled={!projectId || locked} onClick={() => { void sourceList(); }}>查看可选背景资料</button>';
  source = once(source, directory, `{!PM01_BASELINE && <Pm01Scope projectId={projectId} locked={locked} />}${directory}`, 'scope option in original optional panel');
  const start = source.indexOf('{availableSources.map(source => <label className="strategy-source-option"');
  const end = source.indexOf('{detail && <button type="button" className="text-button" disabled={locked} onClick={() => { void control(\'close\'); }}>', start);
  if (start < 0 || end < 0) throw new Error('Scope Demo source-list anchor missing');
  const original = source.slice(start, end);
  source = source.slice(0, start) + `{PM01_BASELINE ? <>${original}</> : <Pm01SourceOptions availableSources={availableSources} sources={sources} onSourcesChange={setSources} locked={locked} />}` + source.slice(end);
  return `import { Pm01Scope, Pm01SourceOptions, isBaseline as PM01_BASELINE } from '${modulePath}';\n` + source;
}
export default defineConfig({ root: codeRoot, plugins: [{ name: 'pm01-scope-review-only', enforce: 'pre', configResolved() { for (const item of manifest.productSources) { if (sha256(fs.readFileSync(path.join(codeRoot, item.path), 'utf8')) !== item.sha256) throw new Error(`Scope Demo product baseline drift: ${item.path}`); } }, configureServer(server) { server.middlewares.use((request, response, next) => { const url = new URL(request.url || '/', 'http://127.0.0.1'); if (url.pathname.startsWith('/api')) { response.statusCode = 503; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ code: 'pure_scope_demo_no_host', synthetic: true })); return; } if (url.pathname === '/') request.url = '/openspec/changes/overall-architecture-v12/pm01-ui-demo/index.html' + url.search; next(); }); }, transform(source, id) { const name = path.relative(codeRoot, id.split('?')[0]); if (!['src/host/ui/App.tsx', 'src/host/ui/StrategyDiscussionPanel.tsx'].includes(name)) return null; const item = manifest.productSources.find((item: any) => item.path === name); if (sha256(source) !== item.sha256) throw new Error(`Scope Demo input drift: ${name}`); const transformed = name.endsWith('App.tsx') ? transformApp(source) : transformPanel(source); fs.mkdirSync(outputRoot, { recursive: true }); fs.writeFileSync(path.join(outputRoot, `transform-${path.basename(name)}.json`), JSON.stringify({ file: name, sourceSha256: item.sha256, transformedSha256: sha256(transformed), productSourceWritten: false, kind: 'Vite in-memory preview transform' }, null, 2)+'\n'); return { code: transformed, map: null }; } }, react()], server: { host: '127.0.0.1', port: 43131, strictPort: true, proxy: {}, fs: { allow: [codeRoot] }, watch: { ignored: ['**/.local/**'] }, headers: { 'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:*; form-action 'none'; frame-src 'none'; object-src 'none'" } }, build: { outDir: path.join(outputRoot, 'build'), emptyOutDir: false, rollupOptions: { input: path.join(demoRoot, 'index.html') } } });
