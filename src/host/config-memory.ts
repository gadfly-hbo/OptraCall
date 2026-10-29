export type ConfigurationInput = { name: string; provider: 'openai-compatible'; baseUrl: string; model: string; apiKey?: string };
export type PublicConfiguration = Omit<ConfigurationInput, 'apiKey'> & { revision: number; hasApiKey: boolean };
export type RuntimeConfiguration = Omit<ConfigurationInput, 'apiKey'> & { revision: number; apiKey: string; api?: 'openai-completions' | 'anthropic-messages'; sdkProvider?: string };

export class ConfigurationError extends Error {
  readonly fields: Record<string, string>;
  constructor(fields: Record<string, string>) { super('请修正模型配置。'); this.fields = fields; }
}

export class MemoryConfiguration {
  #current: Readonly<RuntimeConfiguration> | null = null;
  #revision = 0;
  read(): PublicConfiguration | null {
    if (!this.#current) return null;
    const { apiKey: _secret, ...publicFields } = this.#current;
    return { ...publicFields, hasApiKey: true };
  }
  save(input: unknown): PublicConfiguration {
    const raw = input && typeof input === 'object' ? input as Record<string, unknown> : {};
    const text = (key: string) => typeof raw[key] === 'string' ? raw[key].trim() : '';
    const name = text('name'), model = text('model'), baseUrl = text('baseUrl');
    const fields: Record<string, string> = {};
    if (!name || name.length > 80) fields.name = '请输入不超过 80 字的配置名称。';
    if (!model || model.length > 200 || /\s/.test(model)) fields.model = '请输入不含空白的模型名称，最多 200 字。';
    if (raw.provider !== 'openai-compatible') fields.provider = '当前仅支持 OpenAI 兼容 Chat Completions。';
    try {
      const url = new URL(baseUrl);
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname || url.username || url.password || url.search || url.hash || baseUrl.length > 2000) throw new Error();
    } catch { fields.baseUrl = '请输入 HTTP(S) 地址，不包含账户、查询参数或片段。'; }
    const supplied = typeof raw.apiKey === 'string' ? raw.apiKey.trim() : '';
    const canKeep = this.#current?.baseUrl === baseUrl && this.#current.provider === raw.provider;
    const apiKey = supplied || (canKeep ? this.#current?.apiKey ?? '' : '');
    if (!apiKey || apiKey.length > 8192 || /[\r\n]/.test(apiKey)) fields.apiKey = canKeep ? '请输入有效密钥。' : '首次配置或更换服务地址时，请输入密钥。';
    if (Object.keys(fields).length) throw new ConfigurationError(fields);
    this.#current = Object.freeze({ name, provider: 'openai-compatible', baseUrl, model, apiKey, revision: ++this.#revision });
    return this.read()!;
  }
  snapshot(): Readonly<RuntimeConfiguration> | null { return this.#current; }
  clear(): void { this.#current = null; }
}
