const DEFAULT_LLM_BASE_URL = 'http://192.168.4.220:8080/';
const DEFAULT_LLM_MAX_TOKENS = 4096;

export type EnvLike = Record<string, string | undefined> | undefined;

export type LlmEnv = {
  baseUrl: string;
  apiKey: string | null;
  modelId: string | null;
  maxTokens: number;
};

export function readLlmEnv(env: EnvLike = process.env): LlmEnv {
  return {
    baseUrl: readEnvString(env, 'LLM_BASE_URL') ?? DEFAULT_LLM_BASE_URL,
    apiKey: readEnvString(env, 'LLM_API_KEY'),
    modelId: readEnvString(env, 'LLM_MODEL_ID'),
    maxTokens: readEnvInteger(env, 'LLM_MAX_TOKENS') ?? DEFAULT_LLM_MAX_TOKENS,
  };
}

export function buildLlmHeaders(apiKey?: string | null) {
  return {
    'Content-Type': 'application/json',
    ...(apiKey ? { Authorization: `Bearer ${apiKey}` } : {}),
  };
}

export function applyProviderApiKey(modelId: string | null | undefined, apiKey: string | null | undefined) {
  if (!modelId || !apiKey) return;

  if (modelId.startsWith('openrouter/') && !process.env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = apiKey;
  }
}

function readEnvString(env: EnvLike, key: string) {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readEnvInteger(env: EnvLike, key: string) {
  const value = readEnvString(env, key);
  if (!value) return null;

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}
