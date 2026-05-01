import { DEFAULT_MODEL_ID } from '../src/core/models.ts';
import { getEnvValue } from '../src/core/env.ts';
import { buildHeadlessParametricModelArtifact } from '../src/lib/ai/buildArtifactHeadless.ts';
import { compileArtifactWithNodeOpenScad } from '../src/lib/compiler/nodeOpenScadCompiler.ts';
import { DEFAULT_FEEDBACK_LOOP_CASES } from '../src/lib/feedbackLoop/defaultCases.ts';
import {
  runFeedbackLoopEvaluation,
  summarizeFeedbackLoopResults,
} from '../src/lib/feedbackLoop/runFeedbackLoop.ts';

const providerId = (process.env.FEEDBACK_PROVIDER_ID ?? 'openrouter') as 'openrouter' | 'llama-cpp';
const modelId = process.env.FEEDBACK_MODEL_ID ?? DEFAULT_MODEL_ID;
const apiKey = getEnvValue('VITE_OPENROUTER_API_KEY', process.env.OPENROUTER_API_KEY ?? '');
const maxRepairs = Number(process.env.FEEDBACK_MAX_REPAIRS ?? '1');
const providerRequiresApiKey = providerId === 'openrouter';
const providerName = providerId === 'llama-cpp' ? 'llama.cpp' : 'OpenRouter';
const supportsVision = false;

if (providerRequiresApiKey && !apiKey.trim()) {
  throw new Error(`Missing API key for ${providerName}. Set OPENROUTER_API_KEY or VITE_OPENROUTER_API_KEY.`);
}

const results = await runFeedbackLoopEvaluation(DEFAULT_FEEDBACK_LOOP_CASES, {
  generateArtifact: (input) =>
    buildHeadlessParametricModelArtifact({
      providerId,
      apiKey: providerRequiresApiKey ? apiKey.trim() : undefined,
      modelId,
      supportsVision,
      conversation: input.conversation,
      promptText: input.promptText,
      baseCode: input.baseCode,
      error: input.error,
      source: input.source,
    }),
  compileArtifact: compileArtifactWithNodeOpenScad,
}, {
  maxRepairs,
});

const summary = summarizeFeedbackLoopResults(results);
console.table(summary);
console.log(`Passed ${summary.filter((entry) => entry.finalStatus === 'pass').length}/${summary.length}`);

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(results, null, 2));
}

if (summary.some((entry) => entry.finalStatus !== 'pass')) {
  process.exitCode = 1;
}
