import { constants } from 'node:fs';
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export type ModelApi = 'openai-completions' | 'anthropic-messages';
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ModelConfiguration = {
  id: string;
  name: string;
  provider: string;
  api: ModelApi;
  baseUrl: string;
  model: string;
  revision: number;
  thinkingLevel?: ThinkingLevel;
};
export type PublicModelConfiguration = ModelConfiguration & { hasApiKey: boolean };
export type RuntimeModelConfiguration = ModelConfiguration & { apiKey: string };

export const TARGET_MODELS: readonly Readonly<ModelConfiguration>[] = Object.freeze([
  { id: 'minimax-m3', name: 'MiniMax M3', provider: 'minimax-cn', api: 'anthropic-messages', baseUrl: 'https://api.minimaxi.com/anthropic', model: 'MiniMax-M3', revision: 0 },
  { id: 'minimax-m31-flash', name: 'MiniMax M3.1 Flash', provider: 'minimax-cn', api: 'anthropic-messages', baseUrl: 'https://api.minimaxi.com/anthropic', model: 'MiniMax-M3.1-Flash', revision: 0 },
  { id: 'deepseek-flash', name: 'DeepSeek Flash', provider: 'deepseek', api: 'openai-completions', baseUrl: 'https://api.deepseek.com', model: 'deepseek-flash', revision: 0 },
  { id: 'mimo-v26-pro', name: 'MiMo V2.6 Pro', provider: 'xiaomi-token-plan-cn', api: 'openai-completions', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.6-pro', revision: 0 },
  { id: 'mimo-v26-flash', name: 'MiMo V2.6 Flash', provider: 'xiaomi-token-plan-cn', api: 'openai-completions', baseUrl: 'https://token-plan-cn.xiaomimimo.com/v1', model: 'mimo-v2.6-flash', revision: 0 },
].map(value => Object.freeze(value as ModelConfiguration)));

type Credentials = Record<string, { type: 'api_key'; key: string }>;
type Settings = { schema: 1; selectedId: string | null; profiles: ModelConfiguration[]; versions: ModelConfiguration[] };
type ConfigurationPair = { settings: Settings; auth: Credentials };
type ConfigurationJournal = { schema: 1; before: ConfigurationPair };
const journalFile = '.configuration-transaction.json';

export class ConfigurationStoreError extends Error {
  readonly code: string;
  readonly fields: Record<string, string>;
  constructor(code: string, fields: Record<string, string> = {}) {
    super(code === 'configuration_required' ? '请先配置此模型的凭据。' : '模型配置未能保存或读取，请检查配置。');
    this.code = code; this.fields = fields;
  }
}

function record(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }
function validKey(value: unknown): value is string { return typeof value === 'string' && value.length > 0 && value.length <= 8192 && !/[\r\n]/.test(value); }
function validId(value: unknown): value is string { return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value); }
const thinkingLevels = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

function parseProfile(value: unknown): ModelConfiguration {
  if (!record(value)) throw new ConfigurationStoreError('configuration_corrupt');
  const fields: Record<string, string> = {};
  const text = (key: string): string => typeof value[key] === 'string' ? value[key].trim() : '';
  const name = text('name'), provider = text('provider'), api = text('api'), baseUrl = text('baseUrl'), model = text('model');
  if (!validId(value.id)) fields.id = '配置标识无效。';
  if (!name || name.length > 80) fields.name = '请输入不超过 80 字的配置名称。';
  if (!validId(provider)) fields.provider = 'Provider 标识无效。';
  if (api !== 'openai-completions' && api !== 'anthropic-messages') fields.api = '请选择有效的模型协议。';
  if (!model || model.length > 200 || /\s/.test(model)) fields.model = '请输入不含空白的模型名称，最多 200 字。';
  try {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || baseUrl.length > 2000) throw new Error();
  } catch { fields.baseUrl = '请输入 HTTP(S) 地址，不包含账户、查询参数或片段。'; }
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) fields.revision = '配置版本无效。';
  if (value.thinkingLevel !== undefined && !thinkingLevels.has(String(value.thinkingLevel))) fields.thinkingLevel = '思考级别无效。';
  if (Object.keys(fields).length) throw new ConfigurationStoreError('invalid_configuration', fields);
  return { id: value.id as string, name, provider, api: api as ModelApi, baseUrl, model, revision: value.revision as number, ...(value.thinkingLevel === undefined ? {} : { thinkingLevel: value.thinkingLevel as ThinkingLevel }) };
}

function parseSettings(value: unknown): Settings {
  if (!record(value) || value.schema !== 1 || !Array.isArray(value.profiles) || !Array.isArray(value.versions) || (value.selectedId !== null && !validId(value.selectedId))) throw new ConfigurationStoreError('configuration_corrupt');
  const profiles = value.profiles.map(parseProfile), versions = value.versions.map(parseProfile);
  if (new Set(profiles.map(profile => profile.id)).size !== profiles.length || (value.selectedId !== null && !profiles.some(profile => profile.id === value.selectedId))) throw new ConfigurationStoreError('configuration_corrupt');
  return { schema: 1, selectedId: value.selectedId as string | null, profiles, versions };
}

function parseCredentials(value: unknown): Credentials {
  if (!record(value)) throw new ConfigurationStoreError('configuration_corrupt');
  const credentials: Credentials = {};
  for (const [provider, credential] of Object.entries(value)) {
    if (!validId(provider) || !record(credential) || credential.type !== 'api_key' || !validKey(credential.key)) throw new ConfigurationStoreError('configuration_corrupt');
    credentials[provider] = { type: 'api_key', key: credential.key };
  }
  return credentials;
}

function parseJournal(value: unknown): ConfigurationJournal {
  if (!record(value) || value.schema !== 1 || !record(value.before) || Object.keys(value).some(key => !['schema', 'before'].includes(key)) || Object.keys(value.before).some(key => !['settings', 'auth'].includes(key))) throw new ConfigurationStoreError('configuration_journal_corrupt');
  try { return { schema: 1, before: { settings: parseSettings(value.before.settings), auth: parseCredentials(value.before.auth) } }; }
  catch { throw new ConfigurationStoreError('configuration_journal_corrupt'); }
}

async function syncDirectory(directory: string): Promise<void> {
  const handle = await open(directory, constants.O_RDONLY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isDirectory()) throw new ConfigurationStoreError('configuration_write_failed'); await handle.sync(); }
  finally { await handle.close(); }
}

async function regularOrMissing(file: string): Promise<void> {
  try { const entry = await lstat(file); if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1) throw new ConfigurationStoreError('configuration_write_failed'); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
}

async function readJson(file: string): Promise<unknown | undefined> {
  let handle;
  try {
    handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    const entry = await handle.stat();
    if (!entry.isFile() || entry.nlink !== 1) throw new ConfigurationStoreError('configuration_corrupt');
    return JSON.parse(await handle.readFile('utf8')) as unknown;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new ConfigurationStoreError('configuration_corrupt');
  } finally { await handle?.close(); }
}

async function atomicJson(file: string, value: unknown): Promise<void> {
  const temporary = path.join(path.dirname(file), `.config-${randomUUID()}.tmp`);
  let handle;
  try {
    await regularOrMissing(file);
    handle = await open(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    await handle.chmod(0o600);
    await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`);
    await handle.sync(); await handle.close(); handle = undefined;
    await rename(temporary, file); await syncDirectory(path.dirname(file));
  } catch { throw new ConfigurationStoreError('configuration_write_failed'); }
  finally { await handle?.close(); await unlink(temporary).catch(() => {}); }
}

export class ConfigurationStore {
  readonly dataRoot: string;
  readonly authPath: string;
  readonly settingsPath: string;
  #journalPath: string;
  #settings: Settings = { schema: 1, selectedId: null, profiles: TARGET_MODELS.map(value => ({ ...value })), versions: [] };
  #credentials: Credentials = {};
  #ready = false;
  #gate = Promise.resolve();

  constructor(options: { dataRoot: string }) {
    this.dataRoot = path.resolve(options.dataRoot);
    this.authPath = path.join(this.dataRoot, 'auth.json');
    this.settingsPath = path.join(this.dataRoot, 'settings.json');
    this.#journalPath = path.join(this.dataRoot, journalFile);
  }
  async init(): Promise<void> {
    this.#ready = false;
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 });
    if (!(await lstat(this.dataRoot)).isDirectory()) throw new ConfigurationStoreError('configuration_corrupt');
    await chmod(this.dataRoot, 0o700);
    await this.#recover();
    const [settings, auth] = await Promise.all([readJson(this.settingsPath), readJson(this.authPath)]);
    if (settings !== undefined) this.#settings = parseSettings(settings);
    if (auth !== undefined) this.#credentials = parseCredentials(auth);
    if (settings === undefined) await atomicJson(this.settingsPath, this.#settings);
    else await chmod(this.settingsPath, 0o600);
    if (auth === undefined) await atomicJson(this.authPath, this.#credentials);
    else await chmod(this.authPath, 0o600);
    this.#ready = true;
  }
  async #removeJournal(): Promise<void> {
    await regularOrMissing(this.#journalPath);
    await unlink(this.#journalPath);
    await syncDirectory(this.dataRoot);
  }
  async #recover(): Promise<void> {
    const value = await readJson(this.#journalPath);
    if (value === undefined) return;
    const journal = parseJournal(value);
    // Keep the journal until both old files are durable. A second crash repeats this recovery.
    await atomicJson(this.authPath, journal.before.auth);
    await atomicJson(this.settingsPath, journal.before.settings);
    await this.#removeJournal();
  }
  async #commit(settings: Settings, auth: Credentials): Promise<void> {
    // Reject file conflicts before changing credentials, including during ordinary write failures.
    await Promise.all([regularOrMissing(this.authPath), regularOrMissing(this.settingsPath)]);
    if (await readJson(this.#journalPath) !== undefined) { this.#ready = false; throw new ConfigurationStoreError('configuration_recovery_required'); }
    const journal: ConfigurationJournal = { schema: 1, before: { settings: this.#settings, auth: this.#credentials } };
    try {
      // The directory sync inside atomicJson makes the undo record durable before either target.
      await atomicJson(this.#journalPath, journal);
      await atomicJson(this.authPath, auth);
      await atomicJson(this.settingsPath, settings);
      // Removing and syncing this record is the commit point; only then may a caller see success.
      await this.#removeJournal();
    } catch {
      this.#ready = false;
      try {
        // unlink may have succeeded before its directory sync failed. Restore the undo record
        // before rollback so an interrupted rollback remains recoverable on the next startup.
        if (await readJson(this.#journalPath) === undefined) await atomicJson(this.#journalPath, journal);
        await this.#recover(); this.#ready = true;
      } catch { /* Preserve the journal and refuse requests until a later successful recovery. */ }
      throw new ConfigurationStoreError('configuration_write_failed');
    }
  }
  #assertReady(): void { if (!this.#ready) throw new ConfigurationStoreError('configuration_not_initialized'); }
  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#gate.then(operation); this.#gate = result.then(() => {}, () => {}); return result;
  }
  #public(value: ModelConfiguration): PublicModelConfiguration { return { ...value, hasApiKey: Boolean(this.#credentials[value.provider]) }; }
  list(): PublicModelConfiguration[] { this.#assertReady(); return this.#settings.profiles.map(value => this.#public(value)); }
  read(id?: string): PublicModelConfiguration | null {
    this.#assertReady(); const value = this.#settings.profiles.find(value => value.id === (id ?? this.#settings.selectedId)); return value ? this.#public(value) : null;
  }
  save(input: unknown): Promise<PublicModelConfiguration> {
    return this.#mutate(async () => {
      this.#assertReady();
      if (!record(input)) throw new ConfigurationStoreError('invalid_configuration');
      const current = typeof input.id === 'string' ? this.#settings.profiles.find(value => value.id === input.id) : this.#settings.profiles.find(value => value.provider === input.provider && value.model === input.model);
      if (input.id !== undefined && !current) throw new ConfigurationStoreError('configuration_not_found');
      const id = current?.id ?? randomUUID();
      const provider = input.provider === 'openai-compatible' ? current?.provider ?? `custom-${id}` : input.provider;
      const candidate = parseProfile({ ...input, id, provider, api: input.api ?? (input.provider === 'openai-compatible' ? 'openai-completions' : current?.api), revision: (current?.revision ?? 0) + 1 });
      const native = TARGET_MODELS.find(value => value.provider === candidate.provider);
      if (native && (candidate.baseUrl !== native.baseUrl || candidate.api !== native.api)) throw new ConfigurationStoreError('invalid_configuration', { baseUrl: '原生 Provider 线路固定；其他线路请另建自定义配置。' });
      if (this.#settings.profiles.some(value => value.provider === candidate.provider && value.id !== candidate.id && (value.baseUrl !== candidate.baseUrl || value.api !== candidate.api))) throw new ConfigurationStoreError('invalid_configuration', { baseUrl: '同一 Provider 必须使用相同线路。' });
      const supplied = typeof input.apiKey === 'string' ? input.apiKey.trim() : '';
      const canKeep = current && current.provider === candidate.provider && current.baseUrl === candidate.baseUrl && current.api === candidate.api;
      const key = supplied || (canKeep || native ? this.#credentials[candidate.provider]?.key ?? '' : '');
      if (!validKey(key)) throw new ConfigurationStoreError('invalid_configuration', { apiKey: '首次配置或更换服务地址时，请输入有效密钥。' });
      const nextCredentials: Credentials = { ...this.#credentials, [candidate.provider]: { type: 'api_key', key } };
      const siblings = this.#settings.profiles.filter(value => value.id !== id);
      const activated = siblings.filter(value => value.provider === candidate.provider && value.revision === 0);
      const nextSettings: Settings = { schema: 1, selectedId: this.#settings.selectedId ?? id, profiles: [...siblings.map(value => activated.includes(value) ? { ...value, revision: 1 } : value), candidate], versions: [...this.#settings.versions, ...activated, ...(current ? [current] : [])] };
      await this.#commit(nextSettings, nextCredentials);
      this.#credentials = nextCredentials; this.#settings = nextSettings;
      return this.#public(candidate);
    });
  }
  snapshot(id?: string, revision?: number): Readonly<RuntimeModelConfiguration> | null {
    this.#assertReady(); const selectedId = id ?? this.#settings.selectedId;
    if (!selectedId) return null;
    const current = this.#settings.profiles.find(value => value.id === selectedId);
    const profile = revision === undefined || current?.revision === revision ? current : this.#settings.versions.find(value => value.id === selectedId && value.revision === revision);
    if (!profile) throw new ConfigurationStoreError('configuration_not_found');
    if (this.#settings.profiles.some(value => value.provider === profile.provider && (value.baseUrl !== profile.baseUrl || value.api !== profile.api))) throw new ConfigurationStoreError('configuration_changed');
    const apiKey = this.#credentials[profile.provider]?.key;
    if (!apiKey) throw new ConfigurationStoreError('configuration_required');
    return Object.freeze({ ...profile, apiKey });
  }
  clear(provider?: string): Promise<void> {
    return this.#mutate(async () => {
      this.#assertReady();
      if (provider !== undefined && !validId(provider)) throw new ConfigurationStoreError('invalid_configuration');
      const next: Credentials = provider === undefined ? {} : { ...this.#credentials };
      if (provider !== undefined) delete next[provider];
      await this.#commit(this.#settings, next); this.#credentials = next;
    });
  }
  select(id: string): Promise<PublicModelConfiguration> {
    return this.#mutate(async () => {
      this.#assertReady(); const value = this.read(id);
      if (!value) throw new ConfigurationStoreError('configuration_not_found');
      const next: Settings = { ...this.#settings, selectedId: id };
      await this.#commit(next, this.#credentials); this.#settings = next;
      return value;
    });
  }
}
