export type ConfigurationInput = { name: string; provider: 'openai-compatible'; baseUrl: string; model: string; apiKey?: string };
export type RuntimeConfiguration = Omit<ConfigurationInput, 'apiKey'> & { revision: number; apiKey: string; api?: 'openai-completions' | 'anthropic-messages'; sdkProvider?: string };
