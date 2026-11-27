// Focused browser regression for W04, using controlled read-only Host responses.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import * as XLSX from 'xlsx';

const repo = fileURLToPath(new URL('../', import.meta.url));
const bundle = await build({
  stdin: {
    resolveDir: repo, loader: 'tsx', contents: `
      import { createRoot } from 'react-dom/client';
      import { TaskReportDesk } from './src/host/ui/TaskReportDesk';
      createRoot(document.getElementById('mount')).render(<TaskReportDesk {...window.deskProps} />);
    `,
  },
  write: false, bundle: true, jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
});

const projectId = randomUUID(), taskId = randomUUID(), caseId = randomUUID(), citationId = randomUUID();
const datasetId = randomUUID(), inputVersionId = randomUUID();
const hash = value => createHash('sha256').update(value).digest('hex');
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['数量'], [2]]), '数据');
const bytes = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' });
const version = { projectId, datasetId, inputVersionId, sourcePath: '010_raw/input.xlsx', sha256: hash(bytes), bytes: bytes.length };
const path = '060_reports/经营报告.md';
const reports = ['A', 'B'].map(text => ({
  relativePath: path, sha256: hash(text), textStatus: 'utf8', reviewable: true, current: text === 'B',
}));
const citation = {
  projectId, citationId, report: { originalPath: path, sha256: reports[0].sha256, bytes: 1 },
  selections: [{ datasetId, inputVersionId, descriptionRevisionId: null }],
  attachments: [], declaration: 'A 版数据来源',
};
const record = { id: caseId, title: '仅关联 A 版的 Case', revision: 1, status: 'analyzing' };
const artifact = { caseId, projectId, taskId, availability: 'available', relativePath: path, observedSha256: reports[0].sha256 };

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || undefined, args: ['--no-sandbox'],
});
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  let downloads = 0;
  await page.route('http://localhost:4173/**', async route => {
    const url = new URL(route.request().url()), endpoint = url.pathname;
    if (endpoint === '/') {
      const props = JSON.stringify({ projectId, taskId, projectName: '项目', taskName: '分析任务' });
      return route.fulfill({ contentType: 'text/html', body:
        '<meta charset="utf-8"><div id="mount"></div><script>window.deskProps=' + props + '</script><script src="/app.js"></script>',
      });
    }
    if (endpoint === '/app.js') return route.fulfill({ contentType: 'text/javascript', body: bundle.outputFiles[0].text });
    if (endpoint.endsWith('/candidates')) return route.fulfill({ json: { reports, preselected: reports[0], basisFiles: [] } });
    if (endpoint.endsWith('/files/content')) return route.fulfill({ body: url.searchParams.get('expectedSha256') === reports[0].sha256 ? 'A' : 'B' });
    if (endpoint.endsWith('/data-context')) {
      return route.fulfill({ json: { citations: [citation], datasets: [{ dataset: { datasetId }, descriptions: [], versions: [version] }] } });
    }
    if (endpoint.endsWith('/citations/' + citationId)) return route.fulfill({ json: { record: citation } });
    if (endpoint.endsWith('/versions/' + inputVersionId + '/evidence')) {
      downloads++;
      return downloads === 1
        ? route.fulfill({ status: 409, json: { code: 'evidence_version_changed', message: '固定原件版本不一致' } })
        : route.fulfill({ body: bytes });
    }
    if (endpoint === '/api/cases/storage') return route.fulfill({ json: { state: 'ready' } });
    if (endpoint === '/api/cases') return route.fulfill({ json: { cases: [record], projectLinks: [{ projectId, caseId }] } });
    if (endpoint === '/api/cases/' + caseId) return route.fulfill({ json: { case: record, artifacts: [artifact] } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.goto('http://localhost:4173/');
  await page.getByRole('button', { name: /依据 \d+，input.xlsx/ }).click();
  const source = page.getByRole('region', { name: '选中依据的原文及版本' });
  const download = source.getByRole('button', { name: '下载这份固定 XLSX 原件' });
  await download.click();
  await source.getByRole('alert').filter({ hasText: '固定原件版本不一致' }).waitFor();
  const meta = await source.locator('dl').innerText();
  for (const value of [projectId, citationId, version.sourcePath, version.sha256]) assert.ok(meta.includes(value));
  const file = page.waitForEvent('download');
  await download.click();
  assert.equal((await file).suggestedFilename(), 'input.xlsx');
  assert.equal(downloads, 2);
  assert.deepEqual(errors, []);

  await page.getByRole('button', { name: /^关联 Case/ }).click();
  const linked = page.getByRole('region', { name: '本版报告关联 Case' });
  await linked.getByText(record.title).waitFor();
  const picker = page.getByRole('combobox', { name: '切换已保存报告版本' });
  await picker.selectOption(path + '#' + reports[1].sha256);
  await linked.getByText(/暂未查到/).waitFor();
  assert.equal(await linked.getByText(record.title).count(), 0);
  await picker.selectOption(path + '#' + reports[0].sha256);
  await linked.getByText(record.title).waitFor();
  console.log('PASS W04 fixed workbook download failure/retry and report-version-specific Case associations');
} finally {
  await browser.close();
}
