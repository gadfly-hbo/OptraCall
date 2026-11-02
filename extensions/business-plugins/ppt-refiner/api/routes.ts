import type { IncomingMessage } from 'node:http';
import { createHash, randomUUID } from 'node:crypto';
import { constants, copyFileSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, closeSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
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
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const execute = promisify(execFile);
type TurnReply = { text: string; outcome?: 'completed' | 'failed' | 'cancelled'; diagnostic?: unknown };
export type RefinerSessionLease = {
  run(turn: { text: string; requestId: string }): Promise<TurnReply>;
  commit<T>(operation: () => T | Promise<T>): Promise<T>;
  isCurrent(): boolean;
};
export type RefinerSessionFacade = {
  withSession<T>(deckDir: string, use: (lease: RefinerSessionLease) => Promise<T>): Promise<T>;
  mutate<T>(deckDir: string, use: () => T | Promise<T>): Promise<T>;
  stop(deckDir: string): Promise<void>;
  busy(deckDir: string): boolean;
};
export type RefinerAccess = {
  projectId?: string; projectName?: string; readOnly: boolean; reason?: string;
  configuration?: { id: string; revision: number }; imageInputSupported: boolean; exportDirectory?: string;
};
export type RegisteredDeckSource = { sourcePptx: string; reportPath: string; configuration: { id: string; revision: number } };
export type PptRefinerRoutesOptions = {
  deckRoot: string;
  sessions: RefinerSessionFacade;
  registerDeck<T>(input: Record<string, unknown>, use: (source: RegisteredDeckSource) => T): Promise<T>;
  resolveAccess(deckId: string): Promise<RefinerAccess>;
  readBody: (request: IncomingMessage) => Promise<Record<string, unknown>>;
  skillScriptsDir?: string; pythonPath?: string; codeRoot?: string;
};

function present(file: string) { try { lstatSync(file); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
function regularBytes(file: string): Buffer {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) throw fault(409, 'unsafe_file_path', '精修工件不是独立普通文件。');
  const fd = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const initial = fstatSync(fd), bytes = readFileSync(fd), final = fstatSync(fd), current = lstatSync(file);
    if (initial.dev !== before.dev || initial.ino !== before.ino || initial.nlink !== 1 || final.size !== initial.size || final.mtimeMs !== initial.mtimeMs || final.ctimeMs !== initial.ctimeMs || current.ino !== initial.ino || current.dev !== initial.dev || current.nlink !== 1 || bytes.length !== initial.size) throw fault(409, 'deck_changed', '工件在读取期间变化，请刷新后重试。');
    return bytes;
  } finally { closeSync(fd); }
}
const sha = (file: string) => createHash('sha256').update(regularBytes(file)).digest('hex');
const beforeFiles = (directory: string) => readdirSync(directory).filter(name => /^\.before-.+\.pptx$/.test(name));
const quarantined = (directory: string) => present(path.join(directory, '.protection-failure.json')) || beforeFiles(directory).length > 0;
function decodedTurnRecord(file: string) {
  if (!present(file)) return { pages: [], diffs: [], known: false };
  try {
    if (lstatSync(file).size > 128 * 1024) throw new Error('record too large');
    const record: unknown = JSON.parse(regularBytes(file).toString('utf8'));
    if (!object(record) || !Array.isArray(record.pages) || !record.pages.every(page => Number.isSafeInteger(page) && Number(page) >= 1 && Number(page) <= 999)
      || !Array.isArray(record.diffs) || !record.diffs.every(diff => object(diff) && Number.isSafeInteger(diff.page) && Number(diff.page) >= 1 && Number(diff.page) <= 999 && typeof diff.summary === 'string' && ['wording', 'number', 'layout', 'regenerate'].includes(String(diff.kind)) && ['covered', 'uncovered-confirmed', 'none'].includes(String(diff.anchor)))) throw new Error('invalid record');
    return { pages: record.pages as number[], diffs: record.diffs as DiffEntry[], known: true };
  } catch { return { pages: [], diffs: [], known: false }; }
}

/** Host owns project/path/configuration qualification; this adapter owns PPT I/O and receipts. */
export function createPptRefinerRoutes(options: PptRefinerRoutesOptions) {
  const storeOf = (deckId: string) => {
    if (!deckIdPattern.test(deckId)) throw fault(400, 'invalid_deck_id', 'deck 标识不合法。');
    const directory = path.join(options.deckRoot, deckId);
    if (present(directory) && (!lstatSync(directory).isDirectory() || lstatSync(directory).isSymbolicLink())) throw fault(409, 'unsafe_file_path', '精修目录不是独立普通目录。');
    return createDeckStore(directory);
  };
  const textOf = (input: Record<string, unknown>, key: string, max = 4000) => {
    const value = typeof input[key] === 'string' ? input[key].trim() : '';
    if (!value || value.length > max) throw fault(400, 'invalid_input', `字段 ${key} 为空或超长。`);
    return value;
  };
  const writable = async (deckId: string) => {
    const access = await options.resolveAccess(deckId);
    if (access.readOnly) throw fault(409, access.reason && /^[a-z_]+$/.test(access.reason) ? access.reason : 'deck_read_only', '精修来源或项目当前不允许写入；原有工件与历史保持可读。');
    return access;
  };
  const assertNotQuarantined = (directory: string) => { if (quarantined(directory)) throw fault(409, 'protection_failed', '前次保护结果尚未核定，请从版本历史显式恢复后继续；前态与失败现场已保留。'); };
  const protectionFailed = (directory: string) => present(path.join(directory, '.protection-failure.json')) || !options.sessions.busy(directory) && beforeFiles(directory).length > 0;
  const check = async (before: string, after: string, locked: readonly number[]) => {
    if (!options.codeRoot) throw fault(503, 'guard_unavailable', '精修保护脚本未配置。');
    const { stdout } = await execute(options.pythonPath ?? 'python3', [path.resolve(options.codeRoot, 'extensions/business-plugins/ppt-refiner/scripts/slide_guard.py'), 'check', '--before', before, '--after', after, '--slides', locked.join(',')], { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
    const result: unknown = JSON.parse(stdout);
    if (!object(result) || !Array.isArray(result.changedParts) || !result.changedParts.every(part => typeof part === 'string') || !Array.isArray(result.lockedPagesChanged) || !result.lockedPagesChanged.every(page => Number.isSafeInteger(page) && locked.includes(Number(page)))) throw fault(422, 'guard_invalid_result', '精修保护检查未返回有效结果。');
    return { changedParts: result.changedParts as string[], lockedPagesChanged: result.lockedPagesChanged as number[] };
  };
  const preserveFailure = (directory: string, requestId: string, before: string, reason: string) => {
    const marker = path.join(directory, '.protection-failure.json');
    if (!present(marker)) writeFileSync(marker, JSON.stringify({ requestId, before: path.basename(before), reason, at: new Date().toISOString() }), { flag: 'wx', mode: 0o600 });
  };

  const api = {
    async create(input: Record<string, unknown>) {
      const id = input.id === undefined ? `deck-${randomUUID()}` : textOf(input, 'id', 70);
      const store = storeOf(id), title = textOf(input, 'title', 200);
      if (input.configuration !== undefined) throw fault(400, 'invalid_input', '精修模型由来源项目绑定。');
      return options.registerDeck(input, source => {
        const meta = store.register({ ...source, title });
        return { status: 201, value: { meta, deckPath: store.deckPath } };
      });
    },
    async list() {
      const decks = [];
      if (existsSync(options.deckRoot)) for (const entry of readdirSync(options.deckRoot, { withFileTypes: true })) {
        if (!entry.isDirectory() || entry.isSymbolicLink() || !deckIdPattern.test(entry.name)) continue;
        const store = storeOf(entry.name);
        try { const access = await options.resolveAccess(entry.name); decks.push({ meta: store.meta(), ...access, busy: options.sessions.busy(path.dirname(store.deckPath)), protectionFailed: protectionFailed(path.dirname(store.deckPath)) }); }
        catch (error) { if (!(error instanceof DeckFault)) throw error; }
      }
      return { status: 200, value: { decks } };
    },
    async get(deckId: string) {
      const store = storeOf(deckId), directory = path.dirname(store.deckPath), access = await options.resolveAccess(deckId);
      return { status: 200, value: { meta: store.meta(), versions: store.versions(), deckPath: store.deckPath, ...access, busy: options.sessions.busy(directory), protectionFailed: protectionFailed(directory) } };
    },
    async setLock(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId), page = Number(input.page);
      if (!Number.isSafeInteger(page) || page < 1 || page > 999) throw fault(400, 'invalid_page', '页码不合法。');
      return options.sessions.mutate(path.dirname(store.deckPath), async () => { await writable(deckId); return { status: 200, value: { meta: store.setPageLocked(page, input.locked !== false) } }; });
    },
    async revert(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId), directory = path.dirname(store.deckPath), version = Number(input.version);
      if (!Number.isSafeInteger(version) || version < 1) throw fault(400, 'invalid_version', '版本号不合法。');
      const prepared = await options.sessions.mutate(directory, async () => {
        await writable(deckId);
        if (store.meta().lockedPages.length) throw new DeckFault('PAGE_LOCKED');
        if (!store.versions().some(entry => entry.version === version)) throw new DeckFault('VERSION_NOT_FOUND');
        const versions = lstatSync(path.join(directory, 'versions'));
        if (!versions.isDirectory() || versions.isSymbolicLink()) throw fault(409, 'unsafe_file_path', '版本目录不是独立普通目录。');
        const target = path.join(directory, 'versions', `v${version}.pptx`), hash = sha(target), current = sha(store.deckPath), copy = path.join(directory, `.revert-validation-${randomUUID()}.pptx`);
        copyFileSync(target, copy, constants.COPYFILE_EXCL);
        return { target, hash, current, copy };
      });
      try { await check(prepared.copy, prepared.copy, []); }
      catch { throw fault(422, 'version_invalid', '目标版本未通过工件有效性检查；当前工件与检查现场保留。'); }
      return options.sessions.mutate(directory, async () => {
        await writable(deckId);
        if (store.meta().lockedPages.length) throw new DeckFault('PAGE_LOCKED');
        if (sha(prepared.target) !== prepared.hash || sha(prepared.copy) !== prepared.hash || sha(store.deckPath) !== prepared.current) throw fault(409, 'deck_changed', '工件或目标版本已变化，请刷新版本后重试。');
        const reverted = store.revert(version).version;
        if (sha(store.deckPath) !== prepared.hash) { preserveFailure(directory, `revert-${randomUUID()}`, prepared.copy, 'restore_hash_mismatch'); throw fault(422, 'protection_failed', '版本恢复未核定，现场已保留。'); }
        for (const name of beforeFiles(directory)) renameSync(path.join(directory, name), path.join(directory, `.recovered-${name.slice(1)}-${randomUUID()}`));
        const marker = path.join(directory, '.protection-failure.json');
        if (present(marker)) renameSync(marker, path.join(directory, `.protection-resolved-${randomUUID()}.json`));
        rmSync(prepared.copy);
        return { status: 200, value: { reverted, versions: store.versions() } };
      });
    },
    async exportDeck(deckId: string, input: Record<string, unknown>) {
      if (input.outDir !== undefined) throw fault(400, 'path_not_allowed', '导出位置由来源项目确定。');
      const store = storeOf(deckId), directory = path.dirname(store.deckPath);
      return options.sessions.mutate(directory, async () => {
        const access = await writable(deckId); assertNotQuarantined(directory);
        if (!access.exportDirectory) throw fault(409, 'deck_project_unresolved', '尚未核定来源项目的报告目录。');
        return { status: 200, value: store.exportFinal({ outDir: access.exportDirectory, fileName: typeof input.fileName === 'string' ? input.fileName : `${deckId}-final.pptx` }) };
      });
    },
    async turn(deckId: string, input: Record<string, unknown>) {
      const store = storeOf(deckId), directory = path.dirname(store.deckPath), text = textOf(input, 'text'), requestId = textOf(input, 'requestId', 80);
      const selectedPage = input.page === undefined ? undefined : Number(input.page), inspect = input.mode === 'inspect';
      if (input.mode !== undefined && !['edit', 'inspect'].includes(String(input.mode))) throw fault(400, 'invalid_input', '精修模式无效。');
      if (input.visual !== undefined && (typeof input.visual !== 'boolean' || input.visual && !inspect)) throw fault(400, 'invalid_input', '视觉检查模式无效。');
      if (selectedPage !== undefined && (!Number.isSafeInteger(selectedPage) || selectedPage < 1 || selectedPage > 999)) throw fault(400, 'invalid_page', '页码不合法。');
      return options.sessions.withSession(directory, async lease => {
        const turnRecord = path.join(directory, 'last-turn.json'), started = Date.now();
        const prepared = await lease.commit(async () => {
          const access = await writable(deckId); assertNotQuarantined(directory);
          if (input.visual === true && !access.imageInputSupported) throw fault(409, 'image_input_unsupported', '当前项目模型未确认支持图像输入；仍可进行文字编辑与只读文本检查。');
          const meta = store.meta();
          if (!inspect) {
            const referenced = new Set<number>(selectedPage === undefined ? [] : [selectedPage]);
            for (const match of text.matchAll(/第\s*(\d+)\s*页|[Pp](\d+)(?![\d%])/g)) referenced.add(Number(match[1] ?? match[2]));
            for (const page of referenced) store.assertEditable(page);
          }
          const beforeHash = sha(store.deckPath), before = path.join(directory, `.before-${randomUUID()}.pptx`);
          copyFileSync(store.deckPath, before, constants.COPYFILE_EXCL);
          if (present(turnRecord)) renameSync(turnRecord, path.join(directory, `.previous-turn-${randomUUID()}.json`));
          return { meta, beforeHash, before };
        });
        const failure = async (reason: string, reply?: TurnReply) => {
          let markerRecorded = false;
          try { await lease.commit(() => { preserveFailure(directory, requestId, prepared.before, reason); markerRecorded = true; }); }
          catch { /* An orphan before-copy still quarantines the deck; never discard it to hide failed cleanup. */ }
          return { status: 422, value: { code: 'protection_failed', reply: `${reply?.text ?? ''}\n技术保护未能核定；前态和失败现场已保留，请显式恢复已存版本。`.trim(), outcome: 'failed' as const, snapshot: null, violations: [] as { page: number; restored: boolean }[], elapsedMs: Date.now() - started, protection: { status: 'unknown', markerRecorded } } };
        };
        try { await check(prepared.before, prepared.before, []); }
        catch { return failure('before_invalid'); }
        let reply: TurnReply | undefined, thrown: unknown;
        const sessionText = [inspect ? `本轮仅作${input.visual === true ? '视觉' : '只读'}检查与说明，不修改PPTX或版本记录。` : '', selectedPage === undefined ? '' : `当前选中第 ${selectedPage} 页。`, text].filter(Boolean).join('\n\n');
        try { reply = await lease.run({ text: sessionText, requestId }); } catch (error) { thrown = error; }
        let checked: { changedParts: string[]; lockedPagesChanged: number[] }, afterHash: string;
        try { afterHash = sha(store.deckPath); checked = await check(prepared.before, store.deckPath, prepared.meta.lockedPages); }
        catch { return failure('guard_failed', reply); }
        const violations = checked.lockedPagesChanged.map(page => ({ page, restored: true }));
        if (violations.length || inspect && afterHash !== prepared.beforeHash) {
          try {
            await lease.commit(() => {
              if (sha(store.deckPath) !== afterHash || sha(prepared.before) !== prepared.beforeHash) throw fault(409, 'deck_changed', '保护检查后工件又发生变化。');
              const rejected = path.join(directory, `.rejected-${randomUUID()}.pptx`), temporary = path.join(directory, `.restore-${randomUUID()}.pptx`);
              copyFileSync(store.deckPath, rejected, constants.COPYFILE_EXCL); copyFileSync(prepared.before, temporary, constants.COPYFILE_EXCL); renameSync(temporary, store.deckPath);
              if (sha(store.deckPath) !== prepared.beforeHash) throw fault(422, 'restore_failed', '保护回滚未能核定。');
              if (present(turnRecord)) renameSync(turnRecord, path.join(directory, `.rejected-turn-${randomUUID()}.json`));
              rmSync(prepared.before);
            });
          } catch { return failure('restore_failed', reply); }
          return { status: 409, value: { code: inspect ? 'inspection_changed' : 'page_locked', reply: `${reply?.text ?? ''}\n${inspect ? '只读检查发生了写入，已恢复本轮前态。' : '锁定页相关工件发生变化，整轮修改已恢复到前态。'}`.trim(), outcome: 'failed' as const, snapshot: null, violations, elapsedMs: Date.now() - started, protection: { status: 'restored' } } };
        }
        return lease.commit(() => {
          if (sha(store.deckPath) !== afterHash || sha(prepared.before) !== prepared.beforeHash) { preserveFailure(directory, requestId, prepared.before, 'deck_changed_after_guard'); throw fault(409, 'protection_failed', '检查后工件又变化，未提交成功成果。'); }
          const record = decodedTurnRecord(turnRecord);
          const snapshot = afterHash !== prepared.beforeHash ? store.snapshot({ pages: record.pages, summary: text.slice(0, 200), diffs: record.diffs, beforeSha256: prepared.beforeHash, diffsKnown: checked.changedParts.length === 0 || record.known && record.diffs.length > 0 }) : null;
          if (sha(store.deckPath) !== afterHash) { preserveFailure(directory, requestId, prepared.before, 'deck_changed_during_snapshot'); throw fault(409, 'protection_failed', '保存时工件又变化，现场已保留。'); }
          if (present(turnRecord)) { if (record.known) rmSync(turnRecord); else renameSync(turnRecord, path.join(directory, `.invalid-turn-${randomUUID()}.json`)); }
          rmSync(prepared.before);
          const mapped = thrown ? api.mapFault(thrown) : undefined, outcome = thrown ? 'failed' as const : reply?.outcome ?? 'completed';
          return { status: mapped?.status ?? (outcome === 'completed' ? 200 : outcome === 'cancelled' ? 409 : 422), value: { ...(mapped ? { code: mapped.code } : {}), reply: reply?.text ?? mapped?.message ?? '', outcome, snapshot, violations, elapsedMs: Date.now() - started, ...(reply?.diagnostic ? { diagnostic: reply.diagnostic } : {}) } };
        });
      });
    },
    async stopSession(deckId: string) { const store = storeOf(deckId); store.meta(); await options.sessions.stop(path.dirname(store.deckPath)); return { status: 200, value: { stopped: true } }; },
    async render(deckId: string) {
      const store = storeOf(deckId), directory = path.dirname(store.deckPath);
      if (!options.skillScriptsDir) throw fault(503, 'render_unavailable', '页图渲染未配置。');
      const prepared = await options.sessions.mutate(directory, async () => {
        await writable(deckId); assertNotQuarantined(directory);
        const hash = sha(store.deckPath), scratch = path.join(directory, `.render-${randomUUID()}`); mkdirSync(scratch, { mode: 0o700 });
        const source = path.join(scratch, 'deck.pptx'); copyFileSync(store.deckPath, source, constants.COPYFILE_EXCL); return { hash, scratch, source, pages: path.join(scratch, 'pages') };
      });
      try { await execute(options.pythonPath ?? 'python3', [path.join(options.skillScriptsDir, 'page_images.py'), '--deck', prepared.source, '--out', prepared.pages], { encoding: 'utf8', timeout: 120_000, maxBuffer: 4 * 1024 * 1024 }); }
      catch { throw fault(422, 'render_failed', '页图渲染失败，已有页图与检查现场保留。'); }
      return options.sessions.mutate(directory, async () => {
        await writable(deckId); assertNotQuarantined(directory);
        if (sha(store.deckPath) !== prepared.hash || sha(prepared.source) !== prepared.hash) throw fault(409, 'deck_changed', '渲染期间工件已变化，未发布过期页图。');
        const files = readdirSync(prepared.pages).filter(name => /^(slide|thumb)-\d{2,3}\.png$/.test(name)).sort();
        if (!files.length) throw fault(422, 'render_failed', '未生成可用页图。');
        for (const name of files) regularBytes(path.join(prepared.pages, name));
        const pages = path.join(directory, 'pages'); if (present(pages)) renameSync(pages, path.join(directory, `.previous-pages-${randomUUID()}`));
        renameSync(prepared.pages, pages); rmSync(prepared.scratch, { recursive: true });
        return { status: 200, value: { files } };
      });
    },
    async image(deckId: string, name: string) {
      const store = storeOf(deckId); store.meta(); await options.resolveAccess(deckId);
      if (!/^(slide|thumb)-\d{2,3}\.png$/.test(name)) throw fault(400, 'invalid_image', '页图名称不合法。');
      const pages = path.join(path.dirname(store.deckPath), 'pages');
      if (present(pages) && (!lstatSync(pages).isDirectory() || lstatSync(pages).isSymbolicLink())) throw fault(409, 'unsafe_file_path', '页图目录不是独立普通目录。');
      const file = path.join(pages, name);
      if (!present(file)) throw fault(404, 'image_not_found', '页图不存在，请先渲染。');
      return { status: 200, value: { name, dataUrl: `data:image/png;base64,${regularBytes(file).toString('base64')}` } };
    },
    mapFault(error: unknown): RefinerApiFault {
      if (error instanceof RefinerApiFault) return error;
      const code = (error as { code?: unknown } | null)?.code;
      if (error instanceof DeckFault) return fault(error.code === 'PAGE_LOCKED' || error.code === 'EXPORT_EXISTS' || error.code === 'DECK_EXISTS' ? 409 : error.code === 'EXPORT_INCOMPLETE' ? 500 : error.code.endsWith('NOT_FOUND') ? 404 : 400, error.code.toLowerCase(), error.message);
      if (typeof code === 'string' && /^[a-z_]+$/.test(code)) {
        if (code === 'path_not_allowed' || code === 'invalid_input' || code === 'invalid_project') return fault(400, code, '来源或路径不在本次项目授权范围内。');
        if (code === 'deck_not_found' || code === 'project_not_found') return fault(404, code, '精修工件或来源项目不存在。');
        if (['session_closed', 'host_closing', 'runtime_closed'].includes(code)) return fault(503, code, '服务正在关闭，请稍后重试。');
        if (['session_busy', 'project_archived', 'project_busy', 'project_required', 'project_changed', 'configuration_required', 'configuration_changed', 'generation_cancelled', 'deck_project_unresolved', 'deck_configuration_mismatch', 'unsafe_file_path'].includes(code)) return fault(409, code, '当前项目、配置或精修操作不允许此请求；请刷新核对，未自动重放。');
      }
      return fault(500, 'internal', '内部错误。');
    },
    routes: async (request: IncomingMessage, url: URL): Promise<{ status: number; value: unknown } | null> => {
      if (!url.pathname.startsWith('/api/ppt-refiner/')) return null;
      const method = request.method ?? 'GET', parts = url.pathname.slice('/api/ppt-refiner/'.length).split('/').filter(Boolean);
      try {
        if (parts[0] !== 'decks') return null;
        if (parts.length === 1) { if (method === 'POST') return await api.create(await options.readBody(request)); if (method === 'GET') return await api.list(); }
        const deckId = decodeURIComponent(parts[1] ?? '');
        if (parts.length === 2 && method === 'GET') return await api.get(deckId);
        if (parts.length === 3 && method === 'POST') {
          const input = await options.readBody(request), action = parts[2];
          if (action === 'locks') return await api.setLock(deckId, input);
          if (action === 'revert') return await api.revert(deckId, input);
          if (action === 'export') return await api.exportDeck(deckId, input);
          if (action === 'turns') return await api.turn(deckId, input);
          if (action === 'stop') return await api.stopSession(deckId);
          if (action === 'render') return await api.render(deckId);
        }
        if (parts.length === 4 && parts[2] === 'images' && method === 'GET') return await api.image(deckId, decodeURIComponent(parts[3] ?? ''));
        return null;
      } catch (error) { const mapped = api.mapFault(error); return { status: mapped.status, value: { code: mapped.code, message: mapped.message } }; }
    },
  };
  return api;
}
