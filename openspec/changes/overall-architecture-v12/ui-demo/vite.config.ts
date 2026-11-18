import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

export const codeRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const demoRoot = fileURLToPath(new URL('./', import.meta.url));
const outputRoot = path.join(codeRoot, '.local/v12-preparation');
const demoModule = '/openspec/changes/overall-architecture-v12/ui-demo/v12-ui.tsx';
const hashes = {
  'src/host/ui/App.tsx': '9f6928b8a0fb5733ad35b7153e8269d27049fbfb9cb73dfcfe8a0fa35f085129',
  'src/host/ui/StrategyGoalsPage.tsx': '85b1bfb18859806a82253aba8bc412cb184335e13473e1013b72222a6f0ebe2d',
};
const sha256 = (code: string) => createHash('sha256').update(code).digest('hex');
function once(code: string, anchor: string, replacement: string, label: string): string {
  const count = code.split(anchor).length - 1;
  if (count !== 1) throw new Error(`Demo transform refused: ${label}; expected one anchor, got ${count}`);
  return code.replace(anchor, replacement);
}
const appPatches: { label: string; anchor: string; replacement: string }[] = [
  { label: 'settings view union', anchor: "type SettingsView = 'settings'", replacement: "type SettingsView = 'usage-purpose' | 'settings'" },
  { label: 'demo-only initial view', anchor: 'useState<AppView>(() => new URL', replacement: "useState<AppView>(() => DEMO_START_GOALS ? 'goals' : new URL" },
  { label: 'settings membership', anchor: "'connection-settings', 'capability-plans'].includes(view)", replacement: "'connection-settings', 'capability-plans', 'usage-purpose'].includes(view)" },
  { label: 'demo initial goal mounting', anchor: 'const [goalMounted, setGoalMounted] = useState(false);', replacement: 'const [goalMounted, setGoalMounted] = useState(DEMO_START_GOALS);' },
  { label: 'usage tab in original settings', anchor: '<div className="catalog-tabs settings-tabs" role="group" aria-label="设置分类">', replacement: '<div className="catalog-tabs settings-tabs" role="group" aria-label="设置分类">{DEMO_PROPOSED && <button type="button" className={view === \'usage-purpose\' ? \'active\' : undefined} aria-pressed={view === \'usage-purpose\'} aria-controls="settings-purpose-panel" onClick={() => openSettingsView(\'usage-purpose\')}>使用用途</button>}' },
  { label: 'usage settings content', anchor: '<div id="settings-model-panel" hidden={view !== \'settings\'}>', replacement: '<div id="settings-purpose-panel" hidden={view !== \'usage-purpose\'}>{DEMO_PROPOSED && view === \'usage-purpose\' && <V12PurposeSettings />}</div><div id="settings-model-panel" hidden={view !== \'settings\'}>' },
  { label: 'freeze project entrance purpose', anchor: 'onStartProject={goal => { setGoalForProject(goal);', replacement: 'onStartProject={async goal => { if (DEMO_PROPOSED) { try { await v12RememberEntrance(goal); } catch { setGlobalError(\'原目标准确版本暂不可核对，未替换用途或进入新项目。\'); return; } } setGoalForProject(goal);' },
  { label: 'freeze Case entrance purpose', anchor: 'onOpenCase={goal => { setGoalForCase(goal);', replacement: 'onOpenCase={async goal => { if (DEMO_PROPOSED) { try { await v12RememberEntrance(goal); } catch { setGlobalError(\'原目标准确版本暂不可核对，未替换用途或进入Case。\'); return; } } setGoalForCase(goal);' },
  { label: 'original Task context attachment', anchor: "const chatContent = active && activeTask ? <div className={`chat-page ${messages.length || current?.streaming || current?.optimistic ? 'has-messages' : ''}`}>", replacement: "const chatContent = active && activeTask ? <div className={`chat-page ${messages.length || current?.streaming || current?.optimistic ? 'has-messages' : ''}`}>{DEMO_PROPOSED && <V12TaskContext projectId={active.id} taskId={activeTask.id} />}" },
];
function transformApp(code: string) {
  for (const patch of appPatches) code = once(code, patch.anchor, patch.replacement, patch.label);
  return `import { DEMO_PROPOSED, DEMO_START_GOALS, V12PurposeSettings, V12TaskContext, v12RememberEntrance } from '${demoModule}';\n${code}`;
}
function transformGoals(code: string) {
  code = once(code, "[view, setView] = useState<'bsc' | 'gsa' | 'history'>('bsc')", "[view, setView] = useState<'bsc' | 'gsa' | 'history'>(DEMO_PROPOSED ? 'gsa' : 'bsc')", 'GSA daily default');
  code = once(code, '[selectedVersion, setSelectedVersion] = useState<number | null>(null)', '[selectedVersion, setSelectedVersion] = useState<number | null>(DEMO_PROPOSED ? 1 : null)', 'demo exact adopted v1 selection');
  const originalTabs = code.split('\n').find(line => line.includes('<nav className="sg-tabs"'))!;
  code = once(code, originalTabs, `    {DEMO_PROPOSED ? <nav className="sg-tabs" aria-label="目标工作视图"><button type="button" aria-current={view === 'gsa' ? 'page' : undefined} onClick={() => setView('gsa')}>GSA承接</button><button type="button" aria-current={view === 'history' ? 'page' : undefined} onClick={() => setView('history')}>版本与反馈</button><details className="v12-optional-tools"><summary>按需工具{view === 'bsc' ? ' · BSC已展开' : ''}</summary><button type="button" className="text-button" aria-current={view === 'bsc' ? 'page' : undefined} onClick={() => setView('bsc')}>BSC／战略目标关系</button><p className="sg-muted">同一批目标、关系与准确历史，不新建另一份目标。</p></details></nav> : <>${originalTabs.trim()}</>}
    {DEMO_PROPOSED && <V12StrategyDiscussion active={active} index={index} selected={value} onAdopted={async ref => { await refresh(); setSelectedId(ref.goalId); setSelectedVersion(ref.version); setView('gsa'); setNotice('原目标记录已更新，GSA与下游入口引用本次准确采用版本。'); }} />}`, 'optional BSC and discussion in original page');
  const bscField = code.split('\n').find(line => line.includes('label="BSC归属／目标关系视角（可选）"'))!;
  code = once(code, bscField, `    {DEMO_PROPOSED ? <details><summary>BSC 视角（可选）</summary>${bscField.trim()}</details> : <>${bscField.trim()}</>}`, 'optional BSC editor field');
  code = once(code, "if (fields.scopeKind === 'department' && !enterprises.some(x => x.id === fields.enterpriseId)) return;", "if (!DEMO_PROPOSED && fields.scopeKind === 'department' && !enterprises.some(x => x.id === fields.enterpriseId)) return;", 'unknown department parent demo');
  code = once(code, "...(fields.scopeKind === 'department' ? { enterpriseId: fields.enterpriseId } : {})", "...(fields.scopeKind === 'department' && fields.enterpriseId ? { enterpriseId: fields.enterpriseId } : {})", 'omit unknown enterprise');
  code = once(code, "fields.scopeKind === 'department' ? '部门所属的原企业' : '当前企业'", "fields.scopeKind === 'department' ? (DEMO_PROPOSED ? '上层组织（已知时引用，可选）' : '部门所属的原企业') : '当前企业'", 'department parent label');
  code = once(code, '<select id={`${id}-enterprise`} required disabled={disabled}', '<select id={`${id}-enterprise`} required={!DEMO_PROPOSED || fields.scopeKind !== \'department\'} disabled={disabled}', 'optional department parent select');
  code = once(code, '<option value="">请选择已明确的企业</option>', '<option value="">{DEMO_PROPOSED && fields.scopeKind === \'department\' ? \'上层未知 · 仍可开展\' : \'请选择已明确的企业\'}</option>', 'unknown department option');
  code = once(code, '这是用户声明的部门职责；企业沿原Studio目录，未创建组织机构权威。旧记录缺少企业归属时，请在本次修订明确。', "{DEMO_PROPOSED ? '这是本次声明的部门／业务模块职责；上层未知时保持未知，不强建组织，也不自动取得企业资料权限。' : '这是用户声明的部门职责；企业沿原Studio目录，未创建组织机构权威。旧记录缺少企业归属时，请在本次修订明确。'}", 'department scope explanation');
  return `import { DEMO_PROPOSED, V12StrategyDiscussion } from '${demoModule}';\n${code}`;
}
export default defineConfig({
  root: codeRoot,
  plugins: [{
    name: 'optracall-v12-review-only', enforce: 'pre',
    configResolved() {
      for (const [file, expected] of Object.entries(hashes)) { const source = fs.readFileSync(path.join(codeRoot, file), 'utf8'); if (sha256(source) !== expected) throw new Error(`Demo source baseline mismatch: ${file}`); }
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = new URL(request.url || '/', 'http://127.0.0.1');
        if (url.pathname.startsWith('/api')) { response.statusCode = 503; response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ code: 'demo_endpoint_not_implemented', message: 'Pure UI demo; no Host proxy or real API.' })); return; }
        if (url.pathname === '/') request.url = '/openspec/changes/overall-architecture-v12/ui-demo/index.html' + url.search;
        next();
      });
    },
    transform(source, id) {
      const file = path.relative(codeRoot, id.split('?')[0]);
      if (!(file in hashes)) return null;
      if (sha256(source) !== hashes[file as keyof typeof hashes]) throw new Error(`Demo transform input hash mismatch: ${file}`);
      const transformed = file.endsWith('/App.tsx') ? transformApp(source) : transformGoals(source);
      fs.mkdirSync(outputRoot, { recursive: true });
      fs.writeFileSync(path.join(outputRoot, `demo-transform-${path.basename(file)}.json`), JSON.stringify({ file, sourceSha256: sha256(source), transformedSha256: sha256(transformed), sourceModified: false, kind: 'review-only Vite memory transform', appPatchLabels: file.endsWith('/App.tsx') ? appPatches.map(patch => patch.label) : undefined }, null, 2) + '\n');
      return { code: transformed, map: null };
    },
  }, react()],
  server: { host: '127.0.0.1', port: 43127, strictPort: true, proxy: {}, fs: { allow: [codeRoot] }, watch: { ignored: ['**/.local/**'] }, headers: { 'Content-Security-Policy': "connect-src 'self' ws://127.0.0.1:*; form-action 'none'; frame-src 'none'; object-src 'none'" } },
  preview: { host: '127.0.0.1', port: 43128, strictPort: true, proxy: {} },
  build: { outDir: path.join(outputRoot, 'demo-dist'), emptyOutDir: false, rollupOptions: { input: path.join(demoRoot, 'index.html') } },
});
