import type { ArtifactCompileReport, CadArtifact, ConversationMessage } from '../../core/types.ts';

export type FeedbackLoopCase = {
  id: string;
  prompt: string;
};

export type GenerateArtifactInput = {
  promptText: string;
  conversation: ConversationMessage[];
  baseCode?: string;
  error?: string;
  source?: CadArtifact['source'];
};

export type FeedbackLoopDependencies = {
  generateArtifact: (input: GenerateArtifactInput) => Promise<CadArtifact>;
  compileArtifact: (artifact: CadArtifact) => Promise<ArtifactCompileReport>;
  now?: () => number;
};

export type FeedbackLoopRunOptions = {
  maxRepairs?: number;
};

export type FeedbackLoopAttempt = {
  artifact?: Pick<CadArtifact, 'id' | 'title' | 'code' | 'codeHash' | 'source'>;
  compileReport?: ArtifactCompileReport;
  repairPrompt?: string;
  generationError?: string;
};

export type FeedbackLoopCaseResult = {
  id: string;
  prompt: string;
  attempts: FeedbackLoopAttempt[];
  finalStatus: 'pass' | 'fail';
};
