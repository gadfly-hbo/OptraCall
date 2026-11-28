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
  return { setArtifact(next: any) { artifact = next; render(); }, render, async settle() { for (let n = 0; n < 4; n++) { await new Promise(resolve => setImmediate(resolve)); render(); } }, text: () => text(tree), close() { cleanups.forEach(cleanup => cleanup?.()); } };
}

const artifactA = { id: 'a', projectId: 'project-a', relativePath: '060_reports/a.txt', observedSha256: 'a'.repeat(64), observedBytes: 20, availability: 'available' };
test('independent artifact: switching original reference rejects late old content even when transport ignores abort', async () => {
  const pending = new Map<string, (value: Response) => void>();
  const states: string[] = [];
  const ui = await mount(async (url) => new Promise<Response>(resolve => pending.set(String(url), resolve)), artifactA, state => states.push(state));
  const artifactB = {...artifactA,id:'b',projectId:'project-b',relativePath:'060_reports/b.txt',observedSha256:'b'.repeat(64)};
  ui.setArtifact(artifactB);
  assert.equal(pending.size,2);
  const a = [...pending].find(([url])=>url.includes('project-a'))!; const b = [...pending].find(([url])=>url.includes('project-b'))!;
  b[1](new Response('current exact B')); await ui.settle(); assert.match(ui.text(),/current exact B/);
  a[1](new Response('late unauthorized A')); await ui.settle(); assert.match(ui.text(),/current exact B/); assert.doesNotMatch(ui.text(),/late unauthorized A/);
  assert.deepEqual(states,['loading','loading','ready']);
  ui.setArtifact({...artifactB,availability:'changed'}); await ui.settle(); assert.doesNotMatch(ui.text(),/current exact B/); assert.equal(pending.size,2);ui.close();
});
