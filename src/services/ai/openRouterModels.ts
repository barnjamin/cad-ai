import { FALLBACK_MODELS } from '../../core/models';
import type { ModelDefinition } from '../../core/types';

const OPENROUTER_MODELS_URL =
  import.meta.env.VITE_OPENROUTER_MODELS_URL ?? 'https://openrouter.ai/api/v1/models';

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

export async function fetchOpenRouterModels(signal?: AbortSignal) {
  const response = await fetch(OPENROUTER_MODELS_URL, {
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

  return models.filter(supportsTools).map(toModelDefinition).sort(compareModels);
}

function toModelDefinition(model: OpenRouterModelApi): ModelDefinition {
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

function compareModels(left: ModelDefinition, right: ModelDefinition) {
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
