export type ModelId = string;
export type AiProviderId = 'openrouter' | 'llama-cpp';

export type ParameterPrimitive = string | number | boolean;
export type ParameterValue =
  | ParameterPrimitive
  | string[]
  | number[]
  | boolean[];

export type ParameterType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'string[]'
  | 'number[]'
  | 'boolean[]';

export type ParameterOption = {
  value: string | number;
  label: string;
};

export type ParameterRange = {
  min?: number;
  max?: number;
  step?: number;
};

export type CadParameter = {
  name: string;
  displayName: string;
  value: ParameterValue;
  defaultValue: ParameterValue;
  type: ParameterType;
  description?: string;
  group?: string;
  range?: ParameterRange;
  options?: ParameterOption[];
  maxLength?: number;
};

export type CadArtifactSource =
  | 'assistant-generated'
  | 'assistant-repaired'
  | 'user-edited';

export type CadArtifact = {
  id: string;
  title: string;
  version: string;
  code: string;
  codeHash: string;
  parameters: CadParameter[];
  source: CadArtifactSource;
  intentText?: string;
  updatedAt: number;
};

export type ToolCallState = {
  id: string;
  name: string;
  status: 'pending' | 'error';
};

export type Attachment = {
  id: string;
  name: string;
  mediaType: string;
  dataUrl: string;
};

export type ArtifactCompileReport = {
  artifactId: string;
  codeHash: string;
  status: 'success' | 'error';
  errorMessage?: string;
  stdErr?: string[];
  fileType?: 'stl' | 'svg';
  generatedAt: number;
};

export type NormalizedCompileError = {
  summary: string;
  line?: number;
  column?: number;
  relevantStdErr: string[];
};

export type RepairAttemptState = {
  artifactId: string;
  codeHash: string;
  attempts: number;
  status: 'idle' | 'repairing' | 'failed' | 'succeeded';
  statusMessage?: string;
  lastError?: string;
  startedAt?: number;
  completedAt?: number;
};

export type MessageContent = {
  text?: string;
  modelId?: ModelId;
  artifact?: CadArtifact;
  attachments?: Attachment[];
  toolCalls?: ToolCallState[];
  docsContext?: string;
  error?: string;
  repairState?: RepairAttemptState;
};

export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  content: MessageContent;
  createdAt: number;
};

export type ModelPricing = {
  input: string;
  output: string;
};

export type ModelDefinition = {
  id: ModelId;
  name: string;
  provider: string;
  description: string;
  supportsTools: boolean;
  supportsVision: boolean;
  pricing?: ModelPricing;
};
