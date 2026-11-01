import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { createDeckStore } from '../storage/deck-store.ts';
import { DeckFault, type DiffEntry } from '../types.ts';

export class RefinerApiFault extends Error {
  readonly status: number;
  readonly code: string;
  constructor(status: number, code: string, message: string) { super(message); this.status = status; this.code = code; }
}
const fault = (status: number, code: string, message: string) => new RefinerApiFault(status, code, message);
const deckIdPattern = /^deck-[a-z0-9][a-z0-9-]{0,60}$/;

export type RefinerSessionFacade = {
  run: (deckDir: string, turn: { text: string; requestId: string }) => Promise<{ text: string }>;
  stop: (deckDir: string) => Promise<void>;
};

export type PptRefinerRoutesOptions = {
  deckRoot: string;
  sessions: RefinerSessionFacade;
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  skillScriptsDir?: string;
  pythonPath?: string;
  allowedRoots?: string[];
  codeRoot?: string;
};

const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function decodeDiffs(value: unknown): DiffEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(d => object(d) && Number.isSafeInteger(d.page) && typeof d.summary === 'string'
    && ['wording', 'number', 'layout', 'regenerate'].includes(String(d.kind))
    && ['covered', 'uncovered-confirmed', 'none'].includes(String(d.anchor))) as unknown as DiffEntry[];
}

/** Host-owned HTTP transport calls these handlers; the plugin never binds a port itself. */
export function createPptRefinerRoutes(options: PptRefinerRoutesOptions) {
  const storeOf = (deckId: string) => {
    if (!deckIdPattern.test(deckId)) throw fault(400, 'invalid_deck_id', 'deck 标识不合法。');
    return createDeckStore(path.join(options.deckRoot, deckId));
  };
  const bodyText = (input: Record<string, unknown>, key: string, max = 4000) => {
    const value = String(input[key] ?? '').trim();
    if (!value || value.length > max) throw fault(400, 'invalid_input', `字段 ${key} 为空或超长。`);
    return value;
  };
  const assertAllowedPath = (value: string) => {
    const roots = options.allowedRoots ?? [options.deckRoot];
    let real: string;
    try { real = realpathSync(value); } catch { throw fault(400, 'path_not_allowed', '路径不存在或不可读。'); }
    if (!roots.some(root => real === root || real.startsWith(root + path.sep))) throw fault(400, 'path_not_allowed', '路径不在授权目录内。');
    return real;
  };

  const assertAllowedDir = (value: string) => {
    const roots = options.allowedRoots ?? [options.deckRoot];
    const resolved = path.resolve(value);
    if (!path.isAbsolute(resolved) || !roots.some(root => resolved === root || resolved.startsWith(root + path.sep))) throw fault(400, 'path_not_allowed', '目录不在授权范围内。');
    return resolved;
  };

  const api = {
    async create(input: Record<string, unknown>) {
      const id = bodyText(input, 'id', 70);
      if (!deckIdPattern.test(id)) throw fault(400, 'invalid_deck_id', 'deck 标识需形如 deck-xxx。');
      const store = storeOf(id);
      const meta = store.register({
        sourcePptx: assertAllowedPath(bodyText(input, 'sourcePptx', 1000)),
        title: bodyText(input, 'title', 200),
        reportPath: assertAllowedPath(bodyText(input, 'reportPath', 1000)),
      });
      return { status: 201, value: { meta, deckPath: store.deckPath } };
    },
    async get(deckId: string) {
      const store = storeOf(deckId);
      return { status: 200, value: { meta: store.meta(), versions: store.versions(), deckPath: store.deckPath } };
    },
    async setLock(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId);
      const page = Number(input.page);
      if (!Number.isSafeInteger(page) || page < 1) throw fault(400, 'invalid_page', '页码不合法。');
      return { status: 200, value: { meta: store.setPageLocked(page, input.locked !== false) } };
    },
    async revert(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId);
      const version = Number(input.version);
      if (!Number.isSafeInteger(version) || version < 1) throw fault(400, 'invalid_version', '版本号不合法。');
      return { status: 200, value: { reverted: store.revert(version).version, versions: store.versions() } };
    },
    async exportDeck(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId);
      const outDir = assertAllowedDir(bodyText(input, 'outDir', 1000));
      return { status: 200, value: store.exportFinal({ outDir, fileName: typeof input.fileName === 'string' ? input.fileName : undefined }) };
    },
    async turn(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId);
      const meta = store.meta();
      const text = bodyText(input, 'text', 4000);
      const requestId = bodyText(input, 'requestId', 80);
      const selectedPage = input.page === undefined ? undefined : Number(input.page);
      if (selectedPage !== undefined && (!Number.isSafeInteger(selectedPage) || selectedPage < 1)) throw fault(400, 'invalid_page', '页码不合法。');
      // Deterministic pre-check for explicitly referenced pages; anything
      // the agent does beyond this is still gated by the scripts themselves.
      const referenced = new Set<number>(selectedPage !== undefined ? [selectedPage] : []);
      for (const m of text.matchAll(/第\s*(\d+)\s*页|[Pp](\d+)(?![\d%])/g)) referenced.add(Number(m[1] ?? m[2]));
      for (const page of referenced) store.assertEditable(page);
      const deckDir = path.dirname(store.deckPath);
      const turnRecord = path.join(deckDir, 'last-turn.json');
      const beforeCopy = path.join(deckDir, `.before-${requestId}.pptx`);
      const before = existsSync(store.deckPath) ? createHash('sha256').update(readFileSync(store.deckPath)).digest('hex') : '';
      if (existsSync(store.deckPath) && options.pythonPath) copyFileSync(store.deckPath, beforeCopy);
      if (existsSync(turnRecord)) rmSync(turnRecord);
      const started = Date.now();
      const sessionText = selectedPage !== undefined ? `当前选中第 ${selectedPage} 页。\n\n${text}` : text;
      const reply = await options.sessions.run(deckDir, { text: sessionText, requestId });
      const outcome = (reply as { outcome?: string }).outcome ?? 'completed';
      const violations: { page: number; restored: boolean }[] = [];
      if (existsSync(beforeCopy) && options.pythonPath) {
        const guardScript = path.resolve(options.codeRoot ?? '', 'extensions/business-plugins/ppt-refiner/scripts/slide_guard.py');
        const runGuard = (args: string[]) => spawnSync(options.pythonPath!, [guardScript, ...args], { encoding: 'utf-8' });
        const diff = runGuard(['diff', '--before', beforeCopy, '--after', store.deckPath]);
        if (diff.status === 0) {
          const changed = JSON.parse(diff.stdout) as string[];
          for (const part of changed) {
            const page = Number(/slide(\d+)\.xml$/.exec(part)?.[1]);
            if (meta.lockedPages.includes(page)) {
              const restore = runGuard(['restore', '--before', beforeCopy, '--after', store.deckPath, '--slides', String(page)]);
              violations.push({ page, restored: restore.status === 0 });
            }
          }
        }
        rmSync(beforeCopy, { force: true });
      }
      const after = existsSync(store.deckPath) ? createHash('sha256').update(readFileSync(store.deckPath)).digest('hex') : '';
      let snapshot = null;
      if (after && after !== before) {
        let pages: number[] = [];
        let diffs: DiffEntry[] = [];
        if (existsSync(turnRecord)) {
          try {
            const record = JSON.parse(readFileSync(turnRecord, 'utf-8'));
            if (object(record)) {
              pages = Array.isArray(record.pages) ? record.pages.filter((p: unknown) => Number.isSafeInteger(p) && (p as number) >= 1) : [];
              diffs = decodeDiffs(record.diffs);
            }
            rmSync(turnRecord);
          } catch { rmSync(turnRecord, { force: true }); }
        }
        const violationNote = violations.length ? `；锁定页违规已回滚：${violations.map(v => `P${v.page}`).join(',')}` : '';
        snapshot = store.snapshot({ pages, summary: text.slice(0, 200) + violationNote, diffs });
      }
      const status = outcome === 'completed' ? 200 : outcome === 'cancelled' ? 409 : 422;
      return { status, value: { reply: reply.text, outcome, snapshot, violations, elapsedMs: Date.now() - started } };
    },
    async stopSession(deckId: string) {
      const store = storeOf(deckId);
      store.meta();
      await options.sessions.stop(path.dirname(store.deckPath));
      return { status: 200, value: { stopped: true } };
    },
    async render(deckId: string) {
      const store = storeOf(deckId);
      store.meta();
      if (!options.skillScriptsDir) throw fault(503, 'render_unavailable', '页图渲染未配置。');
      const { spawnSync } = await import('node:child_process');
      const outDir = path.join(path.dirname(store.deckPath), 'pages');
      const proc = spawnSync(options.pythonPath ?? 'python3', [path.join(options.skillScriptsDir, 'page_images.py'), '--deck', store.deckPath, '--out', outDir], { encoding: 'utf-8' });
      if (proc.status !== 0) throw fault(422, 'render_failed', `${proc.stderr || proc.stdout}`.slice(0, 400));
      const { readdirSync } = await import('node:fs');
      return { status: 200, value: { files: readdirSync(outDir).filter(n => n.endsWith('.png')).sort() } };
    },
    async image(deckId: string, name: string) {
      const store = storeOf(deckId);
      store.meta();
      if (!/^(slide|thumb)-\d{2}\.png$/.test(name)) throw fault(400, 'invalid_image', '页图名称不合法。');
      const file = path.join(path.dirname(store.deckPath), 'pages', name);
      if (!existsSync(file)) throw fault(404, 'image_not_found', '页图不存在，请先渲染。');
      return { status: 200, value: { name, dataUrl: `data:image/png;base64,${readFileSync(file).toString('base64')}` } };
    },
    mapFault(error: unknown): RefinerApiFault {
      if (error instanceof RefinerApiFault) return error;
      if (error instanceof DeckFault) {
        const status = error.code === 'PAGE_LOCKED' ? 409 : error.code.endsWith('NOT_FOUND') ? 404 : error.code === 'DECK_EXISTS' ? 409 : 400;
        return fault(status, error.code.toLowerCase(), error.message);
      }
      return fault(500, 'internal', '内部错误。');
    },
    /** Host-style dispatcher: parse /api/ppt-refiner paths; null when not ours. */
    routes: async (request: IncomingMessage, url: URL): Promise<{ status: number; value: unknown } | null> => {
      if (!url.pathname.startsWith('/api/ppt-refiner')) return null;
      const method = request.method ?? 'GET';
      const parts = url.pathname.replace(/^\/api\/ppt-refiner\/?/, '').split('/').filter(Boolean);
      try {
        if (parts[0] !== 'decks') return null;
        if (parts.length === 1 && method === 'POST') return await api.create(await options.readBody(request));
        const deckId = decodeURIComponent(parts[1] ?? '');
        if (parts.length === 2 && method === 'GET') return await api.get(deckId);
        const action = parts[2];
        if (parts.length === 3 && method === 'POST') {
          const input = await options.readBody(request);
          if (action === 'locks') return await api.setLock(deckId, input);
          if (action === 'revert') return await api.revert(deckId, input);
          if (action === 'export') return await api.exportDeck(deckId, input);
          if (action === 'turns') return await api.turn(deckId, input);
          if (action === 'stop') return await api.stopSession(deckId);
          if (action === 'render') return await api.render(deckId);
        }
        if (parts.length === 4 && action === 'images' && method === 'GET') return await api.image(deckId, decodeURIComponent(parts[3] ?? ''));
        return null;
      } catch (error) {
        const mapped = api.mapFault(error);
        return { status: mapped.status, value: { code: mapped.code, message: mapped.message } };
      }
    },
  };
  return api;
}
