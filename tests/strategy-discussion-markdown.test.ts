import assert from 'node:assert/strict';
import test, { after } from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import type { NativeMessage } from '../src/host/ui/project-types.ts';

const server = createServer({ configFile: false, logLevel: 'silent', server: { middlewareMode: true, hmr: false, watch: null } });
after(async () => { await (await server).close(); });

async function transcript(messages: NativeMessage[], streaming?: string) {
  const { StrategyDiscussionTranscript } = await (await server).ssrLoadModule('/src/host/ui/StrategyDiscussionPanel.tsx');
  return renderToStaticMarkup(createElement(StrategyDiscussionTranscript, { messages, streaming }));
}

test('strategic discussion formats the same Markdown in saved and live Agent replies', async () => {
  const text = '## 季度判断\n\n先确定**对照口径**，再选方向。请按**「新规划」**推进，目标低于**3.5%**上限。\n\n- 核对样本\n- 记录差异\n\n| 方向 | 线索 |\n| --- | --- |\n| 服务 | 交接记录 |';
  const saved = await transcript([{ role: 'assistant', content: [{ type: 'text', text }] }]);
  const live = await transcript([], text);
  for (const html of [saved, live]) {
    assert.match(html, /<h[1-6]>季度判断<\/h[1-6]>/);
    assert.match(html, /<strong>对照口径<\/strong>，/);
    assert.match(html, /按<strong>「新规划」<\/strong>推进，目标低于<strong>3\.5%<\/strong>上限/);
    assert.match(html, /<ul><li>核对样本<\/li><li>记录差异<\/li><\/ul>/);
    assert.match(html, /<table\b[^>]*>[\s\S]*<th\b[^>]*>方向<\/th>[\s\S]*<td\b[^>]*>交接记录<\/td>[\s\S]*<\/table>/);
    assert.doesNotMatch(html, /## 季度判断|\*\*对照口径\*\*/);
  }
});

test('an unfinished table is readable plain text until its separator arrives', async () => {
  const header = '| 方向 | 线索 |';
  const partial = await transcript([], `## 进度\n\n${header}`);
  assert.match(partial, /<h[1-6]>进度<\/h[1-6]>/);
  assert.ok(partial.includes(header));
  assert.doesNotMatch(partial, /<table\b/);
  assert.match(await transcript([], `${header}\n| --- | --- |\n| 服务 | 交接记录 |`), /<table\b/);
});

test('user words remain literal and Agent formatting only creates allowed links and elements', async () => {
  const words = '## 用户原话\n**保留标记**';
  const text = '**对照说明**\n\n<b>原样保留</b>\n\n![样图](https://example.test/picture.png)\n\n[公开资料](https://example.test/reference) [本机路径](/internal) [其他协议](data:text/plain,placeholder)';
  const html = await transcript([{ role: 'user', originalUserText: words, content: '内部上下文' }, { role: 'assistant', content: text }]);
  assert.ok(html.includes(`<p>${words}</p>`));
  assert.doesNotMatch(html, /内部上下文/);
  assert.match(html, /<strong>对照说明<\/strong>/);
  assert.match(html, /&lt;b&gt;原样保留&lt;\/b&gt;/);
  assert.match(html, /样图/);
  assert.match(html, /<a\b[^>]*href="https:\/\/example\.test\/reference"[^>]*rel="[^"]*noreferrer[^"]*"[^>]*>公开资料<\/a>/);
  assert.doesNotMatch(html, /<(?:b|img)\b|href="(?:data:|\/internal)/);
});
