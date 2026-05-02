export type OpenScadRequest = {
  mode: 'create' | 'revise';
  userPrompt: string;
  currentCode?: string;
};

export type ModelSpec = {
  summary: string;
  primitives: string[];
  constraints: string[];
  acceptanceChecks: string[];
  preserve?: string[];
  assumptions?: string[];
};

export type CandidateProgram = {
  code: string;
  rationale: string;
  expectedFeatures: string[];
};

export type CompileResult = {
  ok: boolean;
  available: boolean;
  summary: string;
  stderr: string[];
  outputPath?: string;
};

export type RenderedView = {
  name: 'front' | 'top' | 'right' | 'iso';
  imagePath: string;
};

export type RenderResult = {
  ok: boolean;
  available: boolean;
  summary: string;
  views: RenderedView[];
  stderr: string[];
};

export type AttemptRecord = {
  index: number;
  codeHash: string;
  compile: CompileResult;
  render?: RenderResult;
  critique?: {
    pass: boolean;
    score: number;
    issues: string[];
    suggestedEdits: string[];
    summary: string;
  };
};

export type OpenScadAgentResponse = {
  ok: boolean;
  mode: 'create' | 'revise';
  model: string;
  spec: ModelSpec;
  finalCode?: string;
  attempts: AttemptRecord[];
  summary: string;
  warnings: string[];
  failureReason?: string;
};
