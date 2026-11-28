import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { runInNewContext } from 'node:vm';

let bundled: string | undefined;
async function mount(fetcher: typeof fetch, artifact: any, onReadState?: (state: string) => void) {
  bundled ??= (await build({ entryPoints: ['src/host/ui/DailyArtifactPreview.tsx'], bundle: true, write: false, platform: 'browser', format: 'iife', globalName: 'Preview', plugins: [{ name: 'preview-ui-test', setup(plugin) {
    plugin.onResolve({ filter: /^react(?:\/jsx-runtime)?$/ }, args => ({ path: args.path, namespace: 'hooks' }));
    plugin.onLoad({ filter: /.*/, namespace: 'hooks' }, args => ({ contents: args.path.endsWith('jsx-runtime') ? 'export const jsx=(type,props)=>({type,props});export const jsxs=jsx;export const Fragment="fragment";' : 'export const useState=v=>globalThis.hooks.state(v);export const useEffect=(f,d)=>globalThis.hooks.effect(f,d);' }));
    plugin.onResolve({ filter: /StrategyDiscussionReply\.tsx$/ }, () => ({ path: 'reply', namespace: 'reply' }));
    plugin.onLoad({ filter: /.*/, namespace: 'reply' }, () => ({ contents: 'export const StrategyDiscussionReply=props=>({type:"article",props:{children:props.text}});' }));
  } }] })).outputFiles[0].text;
  const values: any[] = [], dependencies: any[][] = [], effects: (() => void)[] = [], cleanups: (() => void)[] = [];
  let cursor = 0, tree: any;
  const hooks = {
    state(value: any) { const index = cursor++; if (!(index in values)) values[index] = value; return [values[index], (next: any) => { values[index] = next; }]; },
    effect(fn: () => any, deps: any[]) { const index = cursor++; if (!dependencies[index] || deps.some((value, n) => value !== dependencies[index][n])) { dependencies[index] = deps; effects.push(() => { cleanups[index]?.(); cleanups[index] = fn(); }); } },
  };
  const context: any = { hooks, fetch: fetcher, AbortController, URLSearchParams, TextDecoder, Response, setTimeout };
  runInNewContext(bundled, context);
  const render = () => { cursor = 0; tree = context.Preview.DailyArtifactPreview({ artifact, onReadState }); while (effects.length) effects.shift()!(); };
  render();
  const text = (node: any): string => node == null ? '' : typeof node !== 'object' ? String(node) : Array.isArray(node) ? node.map(text).join('') : typeof node.type === 'function' ? text(node.type(node.props)) : text(node.props?.children);
  return { render, async settle() { for (let n = 0; n < 4; n++) { await new Promise(resolve => setImmediate(resolve)); render(); } }, text: () => text(tree), close() { cleanups.forEach(cleanup => cleanup?.()); } };
}
const artifact = { id: 'reference-A', projectId: 'project-A', relativePath: '060_reports/original.md', observedSha256: 'a'.repeat(64), observedBytes: 80, availability: 'available' };

test('artifact source reads the original project/path/hash and never substitutes current content after conflict or denial', async () => {
  for (const status of [200, 403, 409, 503]) {
    const reads: string[] = [], writes: string[] = [], states: string[] = [];
    const ui = await mount(async (url, init) => { reads.push(String(url)); if (init?.method && init.method !== 'GET') writes.push(init.method); return new Response(status === 200 ? '# 准确原文' : 'unavailable', { status }); }, artifact, state => states.push(state));
    await ui.settle();
    assert.equal(reads.length, 1);
    const url = new URL(reads[0]!, 'http://localhost');
    assert.equal(url.pathname, '/api/projects/project-A/files/content');
    assert.equal(url.searchParams.get('path'), artifact.relativePath);
    assert.equal(url.searchParams.get('expectedSha256'), artifact.observedSha256);
    if (status === 200) assert.match(ui.text(), /准确原文/); else { assert.doesNotMatch(ui.text(), /准确原文|unavailable/); assert.match(ui.text(), /无法读取|无权读取/); }
    assert.deepEqual(states, ['loading', status === 200 ? 'ready' : status === 403 ? 'forbidden' : status === 409 ? 'changed' : 'unavailable']);
    assert.deepEqual(writes, []); ui.close();
  }
});

test('unavailable, binary and oversized source references do not request or invent a text preview', async () => {
  for (const change of [{ availability: 'changed' }, { relativePath: '060_reports/original.xlsx' }, { observedBytes: 2 * 1024 * 1024 }]) {
    let requests = 0;
    const ui = await mount(async () => { requests++; return new Response('must not be read'); }, { ...artifact, ...change });
    await ui.settle(); assert.equal(requests, 0); assert.doesNotMatch(ui.text(), /must not be read/); assert.match(ui.text(), /核对|下载/); ui.close();
  }
});

test('closing a source ignores a late original-file response', async () => {
  let complete!: (response: Response) => void;
  const ui = await mount(() => new Promise(resolve => { complete = resolve; }), artifact);
  ui.close(); complete(new Response('late private original'));
  await ui.settle(); assert.doesNotMatch(ui.text(), /late private original/);
});
