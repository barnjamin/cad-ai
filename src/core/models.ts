import type { ModelDefinition } from './types';

export const FALLBACK_MODELS: ModelDefinition[] = [
  {
    id: 'google/gemini-2.5-pro-preview',
    name: 'Gemini 2.5 Pro',
    provider: 'Google',
    description: 'Strong multimodal reasoning and tool use',
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'anthropic/claude-opus-4.1',
    name: 'Claude Opus 4.1',
    provider: 'Anthropic',
    description: 'High quality CAD reasoning and code generation',
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'openai/gpt-5',
    name: 'GPT-5',
    provider: 'OpenAI',
    description: 'Reliable tool use and OpenSCAD generation',
    supportsTools: true,
    supportsVision: true,
  },
  {
    id: 'deepseek/deepseek-v4-pro',
    name: 'DeepSeek V4 Pro',
    provider: 'DeepSeek',
    description: 'Long-context model; text only',
    supportsTools: true,
    supportsVision: false,
  },
];

export const DEFAULT_MODEL_ID = FALLBACK_MODELS[0].id;

export const EXAMPLE_PROMPTS = [
  'A small desk organizer with 3 pen holes and a phone slot',
  'A rounded planter pot with drainage holes and a matching saucer',
  'A wall-mount headphone hook with two screw holes',
  'A simple gear with 24 teeth and a 6mm center bore',
];
