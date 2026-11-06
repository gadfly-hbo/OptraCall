import tls from 'node:tls';
import { readFileSync, writeFileSync } from 'node:fs';
import { channel } from 'node:diagnostics_channel';
import { configureHttpTransport } from '../../scripts/http-transport.mjs';
import { fetch, Headers, Request, Response, FormData, getGlobalDispatcher, setGlobalDispatcher } from 'undici';

/** Synthetic-only entry: no product CA policy or global parent state is changed. */
export async function runNetworkWorker({ codeRoot, observationPath, caPath }) {
  if (caPath) tls.setDefaultCACertificates([...tls.getCACertificates('bundled'), readFileSync(caPath, 'utf8')]);
  process.umask(0o077);
  const transport = configureHttpTransport();
  const observation = {
    version: transport.version,
    globalsMatch: globalThis.fetch === fetch && globalThis.Headers === Headers && globalThis.Request === Request && globalThis.Response === Response && globalThis.FormData === FormData,
    trust: caPath ? 'bundled-plus-synthetic-ca-in-this-worker-only' : 'bundled',
    dispatches: [], responses: [], errors: [],
  };
  const save = () => writeFileSync(observationPath, JSON.stringify(observation, null, 2));
  const dispatcher = getGlobalDispatcher();
  setGlobalDispatcher(dispatcher.compose(dispatch => (options, handler) => {
    const url = new URL(String(options.origin));
    if (!['http:', 'https:'].includes(url.protocol) || url.hostname !== '127.0.0.1') throw new Error('sdk_network_fixture_disallows_non_loopback');
    observation.dispatches.push({ method: options.method, protocol: url.protocol, pathname: options.path });
    save();
    return dispatch(options, handler);
  }));
  const onError = ({ error }) => {
    observation.errors.push({ code: typeof error?.code === 'string' ? error.code : 'UNKNOWN', causeCode: typeof error?.cause?.code === 'string' ? error.cause.code : undefined });
    save();
  };
  channel('undici:request:error').subscribe(onError);
  channel('undici:request:headers').subscribe(({ request, response }) => {
    const headers = response.headers;
    let contentType;
    for (let index = 0; index + 1 < headers.length; index += 2) if (String(headers[index]).toLowerCase() === 'content-type') contentType = String(headers[index + 1]);
    observation.responses.push({ method: request.method, pathname: request.path, status: response.statusCode, contentType });
    save();
  });
  save();
  process.prependListener('message', message => {
    if (message.method === 'open') message.input.codeRoot = codeRoot;
  });
  try {
    const { runProjectSession } = await import('../../src/agent/project-session.ts');
    await runProjectSession(transport);
  } catch {
    await transport.close();
    process.exitCode = 1;
    if (process.connected) process.disconnect();
  }
}

/** Separate transport probe: it does not replace an actual SDK request above. */
export async function runHeadersProbe({ url, observationPath }) {
  const target = new URL(url);
  if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1') throw new Error('sdk_network_fixture_disallows_non_loopback');
  const transport = configureHttpTransport(), records = [];
  transport.setHttpIdleTimeoutMs(200);
  const unobserve = transport.observe(url, record => records.push(record));
  const started = Date.now();
  let failed = false;
  try { await globalThis.fetch(url, { method: 'POST', body: 'synthetic-no-headers' }); }
  catch { failed = true; }
  finally {
    unobserve();
    writeFileSync(observationPath, JSON.stringify({ failed, version: transport.version, globalsMatch: globalThis.fetch === fetch && globalThis.Headers === Headers && globalThis.Request === Request && globalThis.Response === Response && globalThis.FormData === FormData, elapsedMs: Date.now() - started, records }, null, 2));
    await transport.close();
  }
}
