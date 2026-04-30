import { FALLBACK_MODELS } from '../../core/models';
import type { AiProviderId, ModelDefinition } from '../../core/types';
import { getAiProvider } from './providers';

const PREFERRED_MODEL_ORDER = new Map(FALLBACK_MODELS.map((model, index) => [model.id, index]));

type OpenRouterModelApi = {
  id: string;
  name: string;
  description?: string | null;
  context_length?: number | null;
  architecture?: {
    input_modalities?: string[];
    modality?: string;
  } | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
  } | null;
  supported_parameters?: string[];
};

type OpenRouterModelsResponse = {
  data?: OpenRouterModelApi[];
};

type OpenAiCompatibleModelApi = {
  id: string;
  owned_by?: string | null;
};

type OpenAiCompatibleModelsResponse = {
  data?: OpenAiCompatibleModelApi[];
};

export async function fetchProviderModels(providerId: AiProviderId, signal?: AbortSignal) {
  const provider = getAiProvider(providerId);

  if (providerId === 'openrouter') {
    return fetchOpenRouterModels(provider.modelsUrl, signal);
  }

  return fetchOpenAiCompatibleModels(provider.modelsUrl, provider.name, signal);
}

function getFallbackModelsForProvider(providerId: AiProviderId) {
  return providerId === 'openrouter' ? FALLBACK_MODELS : [];
}

export function getInitialModelsForProvider(providerId: AiProviderId) {
  return getFallbackModelsForProvider(providerId);
}

async function fetchOpenRouterModels(url: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load OpenRouter models: ${response.status}`);
  }

  const payload = (await response.json()) as OpenRouterModelsResponse;
  const models = Array.isArray(payload.data) ? payload.data : [];

  return models.filter(supportsTools).map(toOpenRouterModelDefinition).sort(compareOpenRouterModels);
}

async function fetchOpenAiCompatibleModels(url: string, providerName: string, signal?: AbortSignal) {
  const response = await fetch(url, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load ${providerName} models: ${response.status}`);
  }

  const payload = (await response.json()) as OpenAiCompatibleModelsResponse;
  const models = Array.isArray(payload.data) ? payload.data : [];

  return models
    .map((model) => ({
      id: model.id,
      name: model.id,
      provider: providerName,
      description: 'Local model served by an OpenAI-compatible llama.cpp endpoint. Tool support depends on the model.',
      supportsTools: true,
      supportsVision: false,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function toOpenRouterModelDefinition(model: OpenRouterModelApi): ModelDefinition {
  const supportsVision =
    model.architecture?.input_modalities?.includes('image') ||
    model.architecture?.modality?.includes('image') ||
    false;

  return {
    id: model.id,
    name: cleanModelName(model.name),
    provider: cleanProviderName(model.name, model.id),
    description: summarizeDescription(model),
    supportsTools: true,
    supportsVision,
    pricing: {
      input: formatPricePerMillion(model.pricing?.prompt),
      output: formatPricePerMillion(model.pricing?.completion),
    },
  };
}

function supportsTools(model: OpenRouterModelApi) {
  return (model.supported_parameters ?? []).includes('tools');
}

function compareOpenRouterModels(left: ModelDefinition, right: ModelDefinition) {
  const preferredLeft = PREFERRED_MODEL_ORDER.get(left.id);
  const preferredRight = PREFERRED_MODEL_ORDER.get(right.id);

  if (preferredLeft !== undefined || preferredRight !== undefined) {
    if (preferredLeft === undefined) return 1;
    if (preferredRight === undefined) return -1;
    return preferredLeft - preferredRight;
  }

  return (
    left.provider.localeCompare(right.provider) ||
    left.name.localeCompare(right.name) ||
    left.id.localeCompare(right.id)
  );
}

function cleanModelName(name: string) {
  const [, displayName] = name.split(/:(.+)/);
  return (displayName ?? name).trim();
}

function cleanProviderName(name: string, id: string) {
  const [providerName] = name.split(':');
  return (providerName || id.split('/')[0] || 'OpenRouter').trim();
}

function summarizeDescription(model: OpenRouterModelApi) {
  const firstSentence = (model.description ?? '').split(/(?<=[.!?])\s+/)[0]?.trim();
  if (firstSentence) {
    return firstSentence;
  }

  const modality =
    model.architecture?.input_modalities?.includes('image') || model.architecture?.modality?.includes('image')
      ? 'Vision-capable'
      : 'Text-only';
  const contextLength = model.context_length ? `${model.context_length.toLocaleString()} ctx` : 'tool-capable';
  return `${modality} · ${contextLength}`;
}

function formatPricePerMillion(price: string | null | undefined) {
  const numericPrice = Number(price ?? '');
  if (!Number.isFinite(numericPrice)) {
    return '—';
  }

  if (numericPrice === 0) {
    return 'Free';
  }

  const perMillion = numericPrice * 1_000_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: perMillion < 1 ? 3 : 2,
    maximumFractionDigits: perMillion < 1 ? 3 : 2,
  }).format(perMillion);
}
