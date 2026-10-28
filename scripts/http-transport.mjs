import { Agent, fetch, Headers, Request, Response, FormData, install, setGlobalDispatcher } from 'undici';
import metadata from 'undici/package.json' with { type: 'json' };

export function configureHttpTransport() {
  if (metadata.version !== '8.12.2') throw new Error('Unexpected HTTP transport version.');
  const dispatcher = new Agent({ connect: { timeout: 10_000 }, headersTimeout: 30_000, bodyTimeout: 30_000 });
  setGlobalDispatcher(dispatcher);
  install();
  if (globalThis.fetch !== fetch || globalThis.Headers !== Headers || globalThis.Request !== Request || globalThis.Response !== Response || globalThis.FormData !== FormData) throw new Error('HTTP transport globals are not isolated.');
  return { version: metadata.version, close: () => dispatcher.close() };
}
