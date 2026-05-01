import { getEnvValue } from '../../core/env';
import type { AiProviderId } from '../../core/types';

export type AiProviderDefinition = {
  id: AiProviderId;
  name: string;
  requiresApiKey: boolean;
  modelsUrl: string;
  chatCompletionsUrl: string;
  endpointDisplay: string;
};

const LLAMA_CPP_BASE_URL = getEnvValue('VITE_LLAMACPP_BASE_URL', 'http://192.168.4.220:8080/');
const OPENROUTER_BASE_URL = getEnvValue('VITE_OPENROUTER_BASE_URL', 'https://openrouter.ai/api/v1/');

export const DEFAULT_PROVIDER_ID: AiProviderId = 'openrouter';

export const AI_PROVIDERS: AiProviderDefinition[] = [
  {
    id: 'openrouter',
    name: 'OpenRouter',
    requiresApiKey: true,
    modelsUrl: joinUrl(OPENROUTER_BASE_URL, 'models'),
    chatCompletionsUrl: joinUrl(OPENROUTER_BASE_URL, 'chat/completions'),
    endpointDisplay: OPENROUTER_BASE_URL.replace(/\/$/, ''),
  },
  {
    id: 'llama-cpp',
    name: 'llama.cpp',
    requiresApiKey: false,
    modelsUrl: joinUrl(LLAMA_CPP_BASE_URL, 'v1/models'),
    chatCompletionsUrl: joinUrl(LLAMA_CPP_BASE_URL, 'v1/chat/completions'),
    endpointDisplay: joinUrl(LLAMA_CPP_BASE_URL, 'v1').replace(/\/$/, ''),
  },
];

export function getAiProvider(providerId: AiProviderId) {
  return AI_PROVIDERS.find((provider) => provider.id === providerId) ?? AI_PROVIDERS[0];
}

function joinUrl(baseUrl: string, path: string) {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}
