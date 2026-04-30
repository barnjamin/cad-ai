export type Model = string;
export type AiProviderId = 'openrouter' | 'llama-cpp';

export type ParameterOption = { value: string | number; label: string };
export type ParameterRange = { min?: number; max?: number; step?: number };
export type ParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export type Parameter = {
  name: string;
  displayName: string;
  value: string | boolean | number | string[] | number[] | boolean[];
  defaultValue: string | boolean | number | string[] | number[] | boolean[];
  type?: ParameterType;
  description?: string;
  group?: string;
  range?: ParameterRange;
  options?: ParameterOption[];
  maxLength?: number;
};

export type ParametricArtifact = {
  title: string;
  version: string;
  code: string;
  parameters: Parameter[];
};

export type ToolCall = {
  name: string;
  status: 'pending' | 'error';
  id?: string;
};

export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
};

export type MessageContent = {
  text?: string;
  model?: Model;
  artifact?: ParametricArtifact;
  attachments?: Attachment[];
  toolCalls?: ToolCall[];
  error?: string;
};

export type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: MessageContent;
  createdAt: number;
};

export type ModelPricing = {
  input: string;
  output: string;
};

export type ModelConfig = {
  id: string;
  name: string;
  provider: string;
  description: string;
  supportsTools: boolean;
  supportsVision: boolean;
  pricing?: ModelPricing;
};

export const PARAMETRIC_MODELS: ModelConfig[] = [
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
