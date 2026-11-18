// Public React-page behavior with synthetic HTTP replies; does not run Host/Pi.
import { chromium } from '/Users/bendandebaba/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { build } from 'rolldown';
import { preparePublication } from '../extensions/business-plugins/metric-factory/sap/validate.ts';

const evidence = '.local/studio-phase2-implementation/ui/metric-unknown';
const label = process.env.STUDIO_METRIC_EVIDENCE || 'current';
const reply = process.env.STUDIO_METRIC_REPLY || 'lost';
await mkdir(evidence, { recursive: true });
await mkdir('output/playwright/studio-phase2', { recursive: true });
const entryPath = resolve(evidence, 'entry.tsx'), bundlePath = resolve(evidence, 'bundle.js');
await writeFile(entryPath, `import {createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {MetricFactoryPage} from ${JSON.stringify(resolve('extensions/business-plugins/metric-factory/ui/MetricFactoryPage.tsx'))};
window.__metricSaved=[];
createRoot(document.getElementById('root')).render(createElement(MetricFactoryPage,{embedded:true,allowedIds:[],projects:[{id:'p1',name:'合成分析项目',archivedAt:null,tasks:[]}],onOpenTask(){},onProjectsChanged(){},onBack(){},onSaved(id){window.__metricSaved.push(id)},onNavigationGuard(guard){window.__metricGuard=guard}}));`);
await build({ input: entryPath, platform: 'browser', output: { format: 'esm', file: bundlePath } });
const bundle = await readFile(bundlePath);
const server = createServer((request, response) => {
  response.setHeader('content-type', request.url === '/bundle.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/bundle.js' ? bundle : '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><div id="root"></div><script type="module" src="/bundle.js"></script></html>');
});
await new Promise(resolveListening => server.listen(0, '127.0.0.1', resolveListening));
const browser = await chromium.launch({ headless: true, executablePath: '/Users/bendandebaba/Library/Caches/ms-playwright/chromium_headless_shell-1212/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1200, height: 1000 } });
page.setDefaultTimeout(5000);
if (reply === 'storage-denied') await page.addInitScript(() => { Storage.prototype.setItem = () => { throw new DOMException('Synthetic storage denied', 'SecurityError'); }; });
const requests = [], errors = [];
page.on('pageerror', error => errors.push(error.message));
const draft = await readFile(new URL('../extensions/business-plugins/metric-factory/fixtures/membership-repurchase@1.0.0.draft.yaml', import.meta.url), 'utf8');
const prepared = preparePublication(Buffer.from(draft)), independent = preparePublication(Buffer.from(draft.replaceAll('membership-repurchase', 'independent-package')));
const document = prepared.document;
assert.match(prepared.packageFingerprint, /^sha256:[a-f0-9]{64}$/);
assert.equal(independent.document.package.id, 'independent-package');
const entry = { id: document.package.id, version: document.package.version, packageFingerprint: prepared.packageFingerprint, contentFingerprint: prepared.contentFingerprint, publishedAt: '2026-11-12', publishedBy: '早先发布者', metricNames: document.metrics.map(metric => metric.name), scenarioIds: document.scenarios.map(scenario => scenario.id) };
let independentValidation = false;
await page.route('**/api/**', async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  requests.push({ path, method: request.method(), body: request.postDataJSON() });
  const json = value => route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  if (path === '/api/metric-factory/library') return json({ entries: [] });
  if (path === '/api/projects/p1/files') return json({ files: [{ name: '020_clean', kind: 'directory', children: [{ name: 'metric.yaml', kind: 'file' }] }] });
  if (path === '/api/metric-factory/draft/validate') return json(independentValidation ? independent : prepared);
  if (path === '/api/metric-factory/publish') return reply === 'success' ? json({ entry }) : route.abort('failed');
  if (path === `/api/metric-factory/library/${entry.id}/${entry.version}`) return json({ entry, document });
  throw new Error(`unexpected synthetic route ${path}`);
});
let failure;
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.getByRole('button', { name: '审核发布', exact: true }).click();
  await page.getByLabel('项目', { exact: true }).selectOption('p1');
  await page.getByLabel('草稿文件（020_clean）').selectOption('020_clean/metric.yaml');
  await page.getByRole('button', { name: '校验草稿', exact: true }).click();
  await page.getByRole('checkbox').first().waitFor();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByLabel('审核人（reviewed_by）').fill('合成审核人');
  await page.getByRole('button', { name: '发布 1.0.0 到全局库', exact: true }).click();
  if (reply === 'storage-denied') {
    await page.getByText('本标签页无法保留发布尝试，未发送本次发布。', { exact: true }).waitFor();
    assert.equal(requests.filter(item => item.path === '/api/metric-factory/publish').length, 0);
    assert.deepEqual(await page.evaluate(() => window.__metricSaved), []);
  } else if (reply === 'success') {
    await page.waitForFunction(() => window.__metricSaved.length === 1);
    assert.deepEqual(await page.evaluate(() => window.__metricSaved), [entry.id]);
    assert.equal(await page.getByRole('region', { name: '保留的指标发布尝试', exact: true }).count(), 0);
    await page.reload();
    assert.equal(await page.getByRole('region', { name: '保留的指标发布尝试', exact: true }).count(), 0);
    assert.equal(requests.filter(item => item.path === '/api/metric-factory/publish').length, 1);
  } else {
  const review = page.getByRole('region', { name: '审核发布', exact: true });
  await review.getByText('原发布请求结果 UNKNOWN；此处仅核对准确目标是否存在，不重新发布。', { exact: true }).waitFor();
  assert.equal(requests.find(item => item.path === '/api/metric-factory/publish').body.expectedPackageFingerprint, entry.packageFingerprint, 'Publication must retain the exact package fingerprint that the user reviewed');
  await review.getByRole('button', { name: '核对准确发布版', exact: true }).click();
  await page.waitForFunction(() => window.__metricSaved.length > 0 || document.body.innerText.includes('已核准确目标') || document.body.innerText.includes('原指标主库准确目标已存在'));
  assert.deepEqual(await page.evaluate(() => window.__metricSaved), [], 'A matching target GET cannot complete the original POST or invoke enterprise association');
  assert.match(await page.locator('body').innerText(), /原指标主库准确目标已存在，企业供给资格另核；原请求仍UNKNOWN/);
  assert.doesNotMatch(await page.locator('body').innerText(), /当前可用/);
  assert.equal(await page.getByRole('button', { name: '发布 1.0.0 到全局库', exact: true }).isDisabled(), true);
  await page.getByRole('button', { name: '库总览', exact: true }).click();
  await page.getByRole('button', { name: '保留未知并离开', exact: true }).click();
  await review.waitFor({ state: 'hidden' });
  await page.getByText('保留的指标发布尝试 · 1 项 UNKNOWN', { exact: true }).click();
  const retained = page.getByRole('region', { name: '保留的指标发布尝试', exact: true });
  await retained.getByText('原尝试定位信息', { exact: true }).click();
  assert.match(await retained.innerText(), /p1/);
  assert.match(await retained.innerText(), /020_clean\/metric.yaml/);
  assert((await retained.innerText()).includes(entry.packageFingerprint));
  await page.reload();
  await page.getByText('保留的指标发布尝试 · 1 项 UNKNOWN', { exact: true }).click();
  await retained.getByRole('button', { name: '核对准确发布版', exact: true }).click();
  await retained.getByText('原指标主库准确目标已存在，企业供给资格另核；原请求仍UNKNOWN', { exact: true }).waitFor();
  await page.getByText('查看已核准确目标', { exact: true }).click();
  assert((await page.getByRole('region', { name: '已核准确指标目标' }).innerText()).includes(`${entry.id}@${entry.version}`));
  assert.doesNotMatch(await page.locator('body').innerText(), /指标已发布，草稿/);
  assert(!(await page.evaluate(() => JSON.stringify(Object.values(sessionStorage)))).includes(document.metrics[0].definition));
  await page.getByText('保留的指标发布尝试 · 1 项 UNKNOWN', { exact: true }).click();
  await page.getByRole('button', { name: '审核发布', exact: true }).click();
  await page.getByLabel('项目', { exact: true }).selectOption('p1');
  await page.getByLabel('草稿文件（020_clean）').selectOption('020_clean/metric.yaml');
  await page.getByRole('button', { name: '校验草稿', exact: true }).click();
  await page.getByRole('checkbox').first().waitFor();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  await page.getByLabel('审核人（reviewed_by）').fill('再次审核人');
  assert.equal(await page.getByRole('button', { name: '发布 1.0.0 到全局库', exact: true }).isDisabled(), true, 'A retained unknown exact version cannot be replayed');
  independentValidation = true;
  await page.getByRole('button', { name: '校验草稿', exact: true }).click();
  await page.getByRole('checkbox').first().waitFor();
  for (const checkbox of await page.getByRole('checkbox').all()) await checkbox.check();
  assert.equal(await page.getByRole('button', { name: '发布 1.0.0 到全局库', exact: true }).isEnabled(), true, 'Independent exact targets remain available for review');
  assert.equal(requests.filter(item => item.path === '/api/metric-factory/publish').length, 1);
  }
  assert.deepEqual(errors, []);
} catch (error) { failure = error; }
finally {
  await page.screenshot({ path: `output/playwright/studio-phase2/metric-unknown-${label}.png`, fullPage: true });
  await writeFile(`${evidence}/${label}.json`, JSON.stringify({ result: failure ? 'FAIL' : 'PASS', requests, errors, saved: await page.evaluate(() => window.__metricSaved), text: await page.locator('body').innerText(), failure: failure?.stack }, null, 2));
  await browser.close();
  await new Promise(resolveClosed => server.close(resolveClosed));
}
if (failure) throw failure;
console.log(JSON.stringify({ result: 'PASS', reply, writes: requests.filter(item => item.method === 'POST') }));
