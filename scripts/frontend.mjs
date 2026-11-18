import { build, context } from 'esbuild';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, request as httpRequest } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadStaticUi } from '../src/host/static-ui.ts';

const loopback = '127.0.0.1';
const app = 'src/host/ui/main.tsx';
const icon = 'src/host/ui/favicon.svg';
const outdir = path.resolve('dist');
const client = fileURLToPath(new URL('./frontend-reload.mjs', import.meta.url));

function renderPage(template, script, css, favicon, reload = '') {
  return template.replace('/' + app, script)
    .replace('/' + icon, favicon)
    .replace('</head>', `<link rel="stylesheet" href="${css}" />\n  </head>`)
    .replace('</body>', reload + '</body>');
}

function options(dev) {
  return {
    entryPoints: { 'assets/main': app, 'assets/favicon': icon },
    outdir, entryNames: dev ? '[dir]/[name]' : '[dir]/[name]-[hash]', assetNames: 'assets/[name]-[hash]',
    loader: { '.svg': 'copy', '.png': 'file', '.jpg': 'file', '.webp': 'file', '.woff2': 'file' },
    bundle: true, format: 'esm', jsx: 'automatic', jsxDev: dev, target: 'es2022',
    define: { 'process.env.NODE_ENV': JSON.stringify(dev ? 'development' : 'production') },
    minify: !dev, write: false, logLevel: 'warning',
  };
}

async function productionBuild() {
  const result = await build({ ...options(false), metafile: true });
  const outputs = Object.entries(result.metafile.outputs);
  const [script, { cssBundle }] = outputs.find(([, output]) => output.entryPoint === app);
  const [favicon] = outputs.find(([, output]) => output.entryPoint === icon);
  const assetUrl = filename => '/' + path.relative(outdir, filename).split(path.sep).join('/');
  const html = renderPage(await readFile('index.html', 'utf8'), assetUrl(script), assetUrl(cssBundle), assetUrl(favicon));
  // Clear superseded hashes only once the new bundle and page are ready.
  await rm(outdir, { recursive: true, force: true });
  await mkdir(path.join(outdir, 'assets'), { recursive: true });
  for (const file of result.outputFiles) await writeFile(file.path, file.contents);
  await writeFile(path.join(outdir, 'index.html'), html);
}

async function developmentAssets() {
  const config = options(true);
  const ctx = await context({
    ...config,
    entryPoints: { ...config.entryPoints, index: 'index.html', 'assets/reload': client },
    plugins: [{
      name: 'development-page',
      setup(plugin) {
        plugin.onLoad({ filter: /[/\\]index\.html$/ }, async ({ path: filename }) => ({
          contents: renderPage(await readFile(filename, 'utf8'), '/assets/main.js', '/assets/main.css', '/assets/favicon.svg',
            '<script type="module" src="/assets/reload.js"></script>\n  '),
          loader: 'copy', watchFiles: [filename],
        }));
      },
    }],
  });
  try {
    await ctx.watch();
    // Without a servedir esbuild exposes only generated outputs and its change stream.
    const { port } = await ctx.serve({ host: loopback, port: 0 });
    return { port, close: () => ctx.dispose() };
  } catch (error) {
    await ctx.dispose();
    throw error;
  }
}

// A tab opened during a broken build still needs a live connection to recover.
const buildErrorPage = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>OptraCall 开发构建失败</title><p>前端构建失败。修正终端中显示的错误后，此页会自动刷新。</p>
<script>
  const changes = new EventSource('/esbuild');
  changes.addEventListener('change', () => location.reload());
  changes.onopen = async () => {
    if ((await fetch('/assets/main.js', { method: 'HEAD' })).ok) location.reload();
  };
</script></html>`;

function proxy(request, response, port, pathname, developmentPage = false) {
  const upstream = httpRequest({
    hostname: loopback, port, path: pathname, method: request.method,
    headers: { ...request.headers, host: `${loopback}:${port}` },
  }, incoming => {
    if (developmentPage && incoming.statusCode === 503) {
      incoming.resume();
      response.writeHead(503, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
      response.end(request.method === 'HEAD' ? undefined : buildErrorPage);
      return;
    }
    response.writeHead(incoming.statusCode, incoming.headers);
    response.flushHeaders();
    incoming.on('error', () => response.destroy());
    incoming.pipe(response);
  });
  upstream.on('error', () => {
    if (response.headersSent) response.destroy();
    else { response.writeHead(502); response.end('Upstream unavailable.'); }
  });
  request.on('error', () => upstream.destroy());
  response.on('close', () => upstream.destroy());
  request.pipe(upstream);
}

function devPath(url, request) {
  if (url.pathname === '/esbuild' || url.pathname === '/index.html' || /^\/assets\/[\w.-]+$/.test(url.pathname)) return url.pathname + url.search;
  if (url.pathname === '/' || (!path.extname(url.pathname) && !url.pathname.includes('/.') && request.headers.accept?.includes('text/html'))) return '/index.html';
}

function checkedPort(value, min) {
  const port = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(port) || port < min || port > 65535) throw new Error('Invalid OptraCall port.');
  return port;
}

async function serve(mode, args) {
  const { values } = parseArgs({ args, options: { port: { type: 'string' }, host: { type: 'string' }, strictPort: { type: 'boolean' } } });
  if (values.host && ![loopback, 'localhost'].includes(values.host)) throw new Error('The OptraCall UI must use a loopback address.');
  const port = checkedPort(values.port ?? process.env.OPTRACALL_UI_PORT ?? (mode === 'dev' ? 4173 : 4174), 0);
  const hostPort = checkedPort(process.env.OPTRACALL_HOST_PORT ?? 4175, 1);
  const preview = mode === 'preview' ? await loadStaticUi(outdir) : undefined;
  const dev = mode === 'dev' ? await developmentAssets() : undefined;
  const server = createServer((request, response) => {
    const authority = request.headers.host;
    if (![loopback, 'localhost'].some(name => authority === name + ':' + server.address().port || (server.address().port === 80 && authority === name))) {
      response.writeHead(403); response.end(); return;
    }
    const target = request.url ?? '';
    if (!target.startsWith('/') || target.startsWith('//') || target.includes('\\')) {
      response.writeHead(400); response.end(); return;
    }
    const url = new URL(target, 'http://' + authority);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      proxy(request, response, hostPort, target); return;
    }
    if (request.method === 'GET' || request.method === 'HEAD') {
      if (preview?.serve(request, response, url)) return;
      if (preview && url.pathname === '/optracall-build.json') {
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
        response.end(request.method === 'HEAD' ? undefined : JSON.stringify(preview.build)); return;
      }
      const asset = dev && devPath(url, request);
      if (asset) { proxy(request, response, dev.port, asset, asset.split('?')[0] === '/index.html'); return; }
    }
    response.writeHead(404); response.end();
  });
  try {
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, loopback, resolve); });
    console.log(`OptraCall ${mode}: http://${loopback}:${server.address().port}/`);
    await new Promise(resolve => {
      const stop = () => { server.close(resolve); server.closeAllConnections(); };
      process.once('SIGINT', stop);
      process.once('SIGTERM', stop);
    });
  } finally {
    await dev?.close();
  }
}

try {
  const [mode, ...args] = process.argv.slice(2);
  if (mode === 'build' && !args.length) await productionBuild();
  else if (mode === 'dev' || mode === 'preview') await serve(mode, args);
  else throw new Error('Usage: frontend.mjs build | dev | preview');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
