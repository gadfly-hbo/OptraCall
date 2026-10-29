import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createServer } from 'vite';
import fs from 'node:fs/promises';
import { manualSections } from '../src/host/ui/help-content.ts';
import { manualMarkdown } from '../src/host/ui/help-document.ts';

test('HELP-01: the existing topbar exposes a semantic help action', async t => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'window');
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    location: { href: 'http://127.0.0.1:4173/?project=render-only' }, innerWidth: 1440,
    matchMedia: () => ({ matches: false }),
  } });
  const server = await createServer({ server: { middlewareMode: true, hmr: false, watch: null }, logLevel: 'silent' });
  t.after(async () => { await server.close(); if (original) Object.defineProperty(globalThis, 'window', original); else Reflect.deleteProperty(globalThis, 'window'); });
  const { App } = await server.ssrLoadModule('/src/host/ui/App.tsx');
  const html = renderToStaticMarkup(createElement(App));
  const topbar = html.slice(html.indexOf('<header'), html.indexOf('</header>'));
  assert.match(topbar, /<button[^>]*aria-label="帮助"[^>]*>.*?帮助<\/button>/s);
  assert.doesNotMatch(topbar, /<span[^>]*>Pi Agent<\/span>/);
});

test('HELP-02: the portable manual covers the actual trial and keeps private runtime material out', async () => {
  const text = manualMarkdown();
  assert.equal(new Set(manualSections.map(section => section.id)).size, manualSections.length);
  for (const topic of ['Case', 'Session', '010_draw', '020_clean', '060_reports', '按此 Case 继续', 'reviewed_by', '部分达标', '未接入', '需求梳理', 'RAP', 'stale', '附带需求契约']) assert.ok(text.includes(topic), topic);
  for (const section of manualSections) {
    assert.ok(section.title && section.summary && section.blocks.length, section.id);
    for (const block of section.blocks) if (block.kind === 'table') for (const row of block.rows) assert.equal(row.length, block.headers.length, section.id);
  }
  assert.match(text, /人工.*情景/, 'Artificial future feedback must remain explicitly described');
  assert.doesNotMatch(text, /\/Users\/|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  assert.equal(await fs.readFile(new URL('../docs/user-manual.md', import.meta.url), 'utf8'), text, 'Generated documentation and the downloaded manual must not drift');
});
