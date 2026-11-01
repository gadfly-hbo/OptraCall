import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, rmSync } from 'node:fs';
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

  return {
    async create(input: Record<string, unknown>) {
      const id = bodyText(input, 'id', 70);
      if (!deckIdPattern.test(id)) throw fault(400, 'invalid_deck_id', 'deck 标识需形如 deck-xxx。');
      const store = storeOf(id);
      const meta = store.register({
        sourcePptx: bodyText(input, 'sourcePptx', 1000),
        title: bodyText(input, 'title', 200),
        reportPath: bodyText(input, 'reportPath', 1000),
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
      const outDir = bodyText(input, 'outDir', 1000);
      if (!path.isAbsolute(outDir)) throw fault(400, 'invalid_out_dir', '导出目录必须是绝对路径。');
      return { status: 200, value: store.exportFinal({ outDir, fileName: typeof input.fileName === 'string' ? input.fileName : undefined }) };
    },
    async turn(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId);
      store.meta();
      const text = bodyText(input, 'text', 4000);
      const requestId = bodyText(input, 'requestId', 80);
      const deckDir = path.dirname(store.deckPath);
      const turnRecord = path.join(deckDir, 'last-turn.json');
      const before = existsSync(store.deckPath) ? createHash('sha256').update(readFileSync(store.deckPath)).digest('hex') : '';
      if (existsSync(turnRecord)) rmSync(turnRecord);
      const started = Date.now();
      const reply = await options.sessions.run(deckDir, { text, requestId });
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
        snapshot = store.snapshot({ pages, summary: text.slice(0, 200), diffs });
      }
      return { status: 200, value: { reply: reply.text, snapshot, elapsedMs: Date.now() - started } };
    },
    async stopSession(deckId: string) {
      const store = storeOf(deckId);
      store.meta();
      await options.sessions.stop(path.dirname(store.deckPath));
      return { status: 200, value: { stopped: true } };
    },
    mapFault(error: unknown): RefinerApiFault {
      if (error instanceof RefinerApiFault) return error;
      if (error instanceof DeckFault) {
        const status = error.code === 'PAGE_LOCKED' ? 409 : error.code.endsWith('NOT_FOUND') ? 404 : error.code === 'DECK_EXISTS' ? 409 : 400;
        return fault(status, error.code.toLowerCase(), error.message);
      }
      return fault(500, 'internal', '内部错误。');
    },
  };
}
