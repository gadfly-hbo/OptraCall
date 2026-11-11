import test from 'node:test';
import assert from 'node:assert/strict';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';

const server = await createServer({ root: fileURLToPath(new URL('..', import.meta.url)), configFile: false,
  cacheDir: path.join(tmpdir(), 'optracall-report-calculation-ui-cache'), optimizeDeps: { noDiscovery: true },
  server: { middlewareMode: true, watch: null }, appType: 'custom', oxc: { jsx: { runtime: 'automatic' } },
});
const { ReportCalculationReview } = await server.ssrLoadModule('/src/host/ui/ReportCalculationReview.tsx').finally(() => server.close());

function render(outcome: string, states = ['provided'], sourceStatus?: string) {
  return renderToStaticMarkup(createElement(ReportCalculationReview, { projectId: 'project', taskId: 'task', value: {
    contract: 'foreground-report-calculation-v1', requestId: 'request', toolCallId: 'call', outcome,
    ...(sourceStatus ? { sourceStatus } : {}),
    receipt: { schemaVersion: 1, type: 'optracall.report-calculation-materials', claim: 'fixed-packet-prepared',
      sha256: 'a'.repeat(64), reviewId: 'review', owner: { projectId: 'project', taskId: 'task', requestId: 'request', sessionId: 'parent' },
      materials: states.map((state, index) => ({ id: index ? `data-${index}` : 'report', kind: index ? 'data' : 'report',
        locator: { path: index ? `020_clean/source-${index}.csv` : '060_reports/initial.md' }, state,
        rangeUtf16: { start: 0, end: state === 'truncated' ? 7 : 12, total: 12 },
      })),
    },
  } }));
}

test('RCR04/09: a prepared packet is displayed as preparation even when the run completed or never started', () => {
  for (const outcome of ['unknown', 'completed', 'failed', 'cancelled']) {
    const html = render(outcome);
    assert.match(html, /已准备的材料与范围/);
    assert.match(html, /此准备回执本身未核实实际提供范围/);
    assert.match(html, /材料是否被阅读或理解未获证明/);
    assert.match(html, /查看固定初稿/);
    assert.doesNotMatch(html, /实际提供的材料与范围|已提供|被复核初稿/);
  }
  assert.match(render('completed'), /意见已交回/);
  assert.match(render('unknown'), /复核状态未知/);
});

test('RCR04: legacy partial, missing and metadata packet states keep their exact preparation range', () => {
  const html = render('completed', ['provided', 'truncated', 'unavailable', 'version-conflict', 'metadata']);
  for (const label of ['已准备', '部分准备', '未准备', '版本冲突', '仅准备元数据']) assert.ok(html.includes(label));
  assert.match(html, /字符 0–7 \/ 12（UTF-16）/);
  assert.match(html, /此准备回执本身未核实实际提供范围/);
  assert.doesNotMatch(html, /部分提供|仅提供元数据|已提供/);
});

test('RCR05: revoked prepared source details remain hidden', () => {
  const html = render('completed', ['provided'], 'unavailable');
  assert.match(html, /原始材料当前不可读取/);
  assert.doesNotMatch(html, /060_reports\/initial.md|查看固定初稿|已准备的材料与范围/);
});

test('RCR09: legacy records without a packet retain only their recorded run outcome', () => {
  const html = renderToStaticMarkup(createElement(ReportCalculationReview, { projectId: 'project', taskId: 'task', value: {
    contract: 'foreground-report-calculation-v1', requestId: 'legacy-request', outcome: 'completed',
  } }));
  assert.match(html, /意见已交回/);
  assert.doesNotMatch(html, /已准备|已提供|实际提供|查看固定初稿/);
});
