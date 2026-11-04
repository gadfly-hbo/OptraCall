import { chromium } from '/Users/bendandebaba/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';

const base = '.local/fourbase-modules/m5/implementation';
const fixture = JSON.parse(await readFile(`${base}/live/ready.json`, 'utf8'));
const seed = JSON.parse(await readFile(`${base}/live/unknown-reason-seed.json`, 'utf8'));
const label = process.env.M5_UI_EVIDENCE || 'unknown-reason-check';
assert.equal(new URL(fixture.uiUrl).hostname, '127.0.0.1');
assert(fixture.dataRoot.includes('/.local/fourbase-modules/m5/implementation/live/fixture/'));
assert.equal(seed.records.length, 2);
assert(seed.records.every(record => record.revision > 1 && record.changeReason === null));
await mkdir(`${base}/ui`, { recursive: true });
await mkdir('output/playwright/m5-product', { recursive: true });
const source = await readFile('src/host/ui/CaseDecisionsPanel.tsx');
const browser = await chromium.launch({ headless: true, executablePath: '/Users/bendandebaba/Library/Caches/ms-playwright/chromium_headless_shell-1212/chrome-headless-shell-mac-arm64/chrome-headless-shell' });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(5000);
const errors = [], writes = [], observations = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => { if (request.method() !== 'GET' && request.url().includes('/api/')) writes.push({ url: request.url(), method: request.method() }); });
let failure;
try {
  await page.goto(fixture.uiUrl);
  await page.getByRole('button', { name: seed.caseTitle, exact: true }).click();
  const detail = page.getByRole('dialog', { name: seed.caseTitle, exact: true });
  for (const record of seed.records) {
    const card = detail.locator(`[data-record-id="${record.recordId}"]`);
    await card.waitFor();
    assert.equal(Number(await card.getAttribute('data-revision')), record.revision);
    const summaryExplainsUnknown = (await card.innerText()).includes('变更说明：作者未说明');
    await card.getByRole('button', { name: '来源与版本', exact: true }).click();
    const sourceDialog = page.getByRole('dialog', { name: '来源与版本', exact: true });
    await sourceDialog.getByText(record.payload.statement ?? record.payload.proposal, { exact: true }).waitFor();
    const detailExplainsUnknown = (await sourceDialog.innerText()).includes('变更说明：作者未说明');
    observations.push({ kind: record.kind, recordId: record.recordId, revision: record.revision, summaryExplainsUnknown, detailExplainsUnknown });
    await page.screenshot({ path: `output/playwright/m5-product/${label}-${record.kind}.png`, fullPage: true });
    await page.keyboard.press('Escape');
    await sourceDialog.waitFor({ state: 'hidden' });
  }
  assert.deepEqual(observations.map(value => [value.summaryExplainsUnknown, value.detailExplainsUnknown]), [[true, true], [true, true]], 'Both actual hypothesis and strategy revision summary/detail must disclose the missing author explanation');
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, [], 'Viewing unknown explanations never writes or asks the model to invent a reason');
} catch (error) { failure = error; }
finally {
  await writeFile(`${base}/ui/${label}.json`, JSON.stringify({ result: failure ? 'FAIL' : 'PASS', sourceSha256: createHash('sha256').update(source).digest('hex'), caseId: seed.caseId, observations, errors, writes, failure: failure?.stack }, null, 2));
  await browser.close();
}
if (failure) throw failure;
console.log(JSON.stringify({ result: 'PASS', assertions: 4, observations, writes: 0 }));
