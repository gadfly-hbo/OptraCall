// Public management UI with synthetic native records; every request is read-only.
import { chromium } from '/Users/bendandebaba/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'rolldown';

const evidence = '.local/studio-phase2-implementation/ui/unassigned-browser';
const label = process.env.STUDIO_UNASSIGNED_EVIDENCE || String(Date.now());
await mkdir(evidence, { recursive: true });
await mkdir('output/playwright/studio-phase2', { recursive: true });
const entryPath = resolve(evidence, 'entry.tsx'), bundlePath = resolve(evidence, 'bundle.js');
await writeFile(entryPath, `import {createElement,useState} from 'react';
import {createRoot} from 'react-dom/client';
import {StudioPage} from ${JSON.stringify(resolve('src/host/ui/StudioPage.tsx'))};
import {EnterpriseMaterialsPage} from ${JSON.stringify(resolve('src/host/ui/EnterpriseMaterialsPage.tsx'))};
const mode=new URLSearchParams(location.search).get('mode');
function Harness(){const [target,setTarget]=useState(mode==='derived'?{kind:'methods',id:'method-b',version:2}:undefined);return mode==='categories'?createElement(EnterpriseMaterialsPage,{embedded:true,allowedIds:['mat-a'],onBack(){},onMetrics(){},onRequirements(){}}):createElement(StudioPage,{projects:[{id:'p1',name:'A分析项目',archivedAt:null,tasks:[]}],currentProjectId:'p1',onOpenTask(){},initialProfessionalTarget:target,onProfessionalTargetConsumed(){setTarget(undefined)}})}
createRoot(document.getElementById('root')).render(createElement(Harness));`);
await build({ input: entryPath, platform: 'browser', output: { format: 'esm', file: bundlePath }, plugins: [{ name: 'css-boundary', resolveId(id) { if (id.endsWith('.css')) return '\0css:' + id + '.js'; }, load(id) { if (id.startsWith('\0css:')) return ''; } }] });
const bundle = await readFile(bundlePath);
const server = createServer((request, response) => { response.setHeader('content-type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html'); response.end(request.url === '/bundle.js' ? bundle : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/bundle.js"></script></html>'); });
await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
const browser = await chromium.launch({ headless: true, executablePath: '/Users/bendandebaba/Library/Caches/ms-playwright/chromium_headless_shell-1212/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const requests = [], errors = [], results = [];
const enterprises = ['ea', 'eb'].map(id => ({ id, name: id === 'ea' ? 'A企业' : 'B企业', revision: 1, createdAt: '2026-11-12' }));
const fields = { title: '待核资料准确修订', category: '待核类别', body: '待核资料原修订正文', source: '合成来源', owner: '', scope: '原适用范围', effectiveTime: '原业务期间', sourceFileId: null };
const material = { id: 'mat-u', version: 1, enabled: true, activeRevisionId: 'rev-u', draft: { ...fields, title: '后续工作稿', body: '后续工作稿正文' }, revisions: [{ ...fields, revisionId: 'rev-u', number: 1, createdAt: '2026-11-12', bodyPath: '/synthetic/rev-u', bodySha256: 'a'.repeat(64) }], files: [] };
const metric = { name: 'unassigned_metric', display_name: '待核指标', definition: '待核指标计算口径', type: 'simple', provenance: { origin: 'manual' }, caliber_switches: {}, dimensions: [], time_grains: [], owner_role: '合成审核人' };
const metricDocument = { package: { id: 'metric-u', version: '1.0.0' }, metrics: [metric], scenarios: [] };
const metricEntry = { id: 'metric-u', version: '1.0.0', namespace: 'synthetic', packageFingerprint: 'a'.repeat(64), contentFingerprint: 'b'.repeat(64), publishedAt: '2026-11-12', publishedBy: '合成审核人', metricNames: [metric.name], scenarioIds: [] };
const methodDetail = id => {
  const version = { methodId: id, version: 2, title: id === 'method-b' ? '派生归属历史方法' : '待核方法准确版本', origin: 'other', savedAt: '2026-11-12', contentSha256: 'c'.repeat(64), content: { conditions: '合成问题', logic: '原方法准确逻辑', judgment: '', limits: '保留原适用限制' }, sources: [] };
  return { id, selectedVersion: 2, latestVersion: 2, publishedVersion: 2, governanceRevision: 0, governance: [], versions: [version], publications: [{ version: 2, contentSha256: version.contentSha256 }] };
};
const unassigned = [{ authority: 'enterprise', id: 'mat-u', version: 'rev-u', title: '待核资料', status: 'unassigned' }, { authority: 'sap-metric', id: 'metric-u', version: '1.0.0', title: '待核指标', status: 'unassigned' }, { authority: 'sap-method', id: 'method-u', version: '2', title: '待核方法', status: 'unassigned' }];
let failure;
try {
  for (const mode of ['categories', 'preview', 'derived']) {
    const page = await browser.newPage({ viewport: { width: 1300, height: 1000 } }); page.setDefaultTimeout(5000); page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname; requests.push({ mode, path, method: request.method() });
      const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
      if (path === '/api/studio/enterprises') return json({ enterprises, projectAssignments: [{ projectId: 'p1', enterpriseId: 'ea' }], caseAssignments: [], assetAssignments: [] });
      if (path === '/api/studio/systems') return json({ systems: [] });
      if (path === '/api/studio/foundation') { const id = url.searchParams.get('enterpriseId'); return json({ enterprise: enterprises.find(item => item.id === id), systems: [], items: mode === 'derived' && id === 'eb' ? [{ authority: 'sap-method', id: 'method-b', version: '2', title: '派生归属历史方法', status: 'formal-history', enterpriseId: 'eb' }] : [], unassigned }); }
      if (path === '/api/enterprise-materials') return json({ storeId: 'synthetic-store', materials: [{ id: 'mat-a', title: 'A资料', category: 'A类别', scope: 'A范围', enabled: true, revisionCount: 1, updatedAt: '2026-11-12' }, { id: 'mat-b', title: 'B资料', category: 'B类别', scope: 'B范围', enabled: true, revisionCount: 1, updatedAt: '2026-11-12' }, { id: 'mat-u', title: '待核资料', category: '待核类别', scope: '', enabled: true, revisionCount: 1, updatedAt: '2026-11-12' }] });
      if (path === '/api/enterprise-materials/mat-u') return json({ material });
      if (path === '/api/metric-factory/library') return json({ entries: [metricEntry] });
      if (path === '/api/metric-factory/library/metric-u/1.0.0') return json({ entry: metricEntry, document: metricDocument });
      if (path === '/api/sap/methods') return json({ methods: [] });
      if (path === '/api/sap/methods/method-u/versions/2') return json({ method: methodDetail('method-u') });
      if (path === '/api/sap/methods/method-b/versions/2') return json({ method: methodDetail('method-b') });
      throw new Error(`unexpected synthetic route ${path}`);
    });
    await page.goto(`http://127.0.0.1:${server.address().port}/?mode=${mode}`);
    if (mode === 'categories') {
      await page.getByRole('button', { name: 'A资料', exact: true }).waitFor();
      assert.deepEqual(await page.getByLabel('资料类别', { exact: true }).locator('option').allTextContents(), ['全部类别', 'A类别']);
    } else if (mode === 'preview') {
      await page.locator('.studio-unassigned > summary').click();
      for (const item of unassigned) {
        await page.locator('.studio-unassigned .studio-record').filter({ hasText: item.title }).getByRole('button', { name: '查看准确原文', exact: true }).click();
        const modal = page.getByRole('dialog', { name: `待核资产原文 · ${item.title}`, exact: true });
        if (item.authority === 'enterprise') { await page.waitForFunction(() => document.querySelector('textarea')?.value === '待核资料原修订正文'); assert.equal(await modal.locator('textarea').getAttribute('readonly'), ''); assert.equal(await modal.getByLabel('查看资料版本').inputValue(), 'rev-u'); }
        if (item.authority === 'sap-metric') await modal.getByText('待核指标计算口径', { exact: true }).waitFor();
        if (item.authority === 'sap-method') await modal.getByText('原方法准确逻辑', { exact: true }).waitFor();
        assert.equal(await modal.getByRole('button', { name: /新建|保存|发布此版本|启用|派生|记录版本问题/ }).count(), 0);
        assert.match(await modal.innerText(), /查看不关联企业/);
        await modal.getByRole('button', { name: '未决定，返回', exact: true }).click();
        await modal.waitFor({ state: 'hidden' });
      }
    } else {
      await page.getByRole('heading', { name: '派生归属历史方法', exact: true }).waitFor();
      assert.equal(await page.getByLabel('当前企业', { exact: true }).inputValue(), 'eb');
      assert(requests.some(item => item.mode === mode && item.path === '/api/sap/methods/method-b/versions/2'));
      assert(!requests.some(item => item.mode === mode && item.path === '/api/sap/methods/method-b'));
    }
    results.push({ mode, result: 'PASS' });
    await page.screenshot({ path: `output/playwright/studio-phase2/unassigned-${label}-${mode}.png`, fullPage: true });
    await page.close();
  }
  assert(requests.every(item => item.method === 'GET'), 'Inspection, ownership resolution and cancellation never write or associate');
  assert.deepEqual(errors, []);
} catch (error) { failure = error; }
finally { await writeFile(`${evidence}/${label}.json`, JSON.stringify({ result: failure ? 'FAIL' : 'PASS', results, requests, errors, failure: failure?.stack }, null, 2)); await browser.close(); await new Promise(resolveClosed => server.close(resolveClosed)); }
if (failure) throw failure;
console.log(JSON.stringify({ result: 'PASS', results, requests: requests.length, writes: 0 }));
