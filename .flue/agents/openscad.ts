import type { FlueContext } from '@flue/sdk/client';
import { safeParse } from 'valibot';
import * as v from 'valibot';
import { runOpenScadLoop } from '../../src/core/runOpenScadLoop';
import { applyProviderApiKey, readLlmEnv } from '../../src/llm/env';

export const triggers = { webhook: true };

const DEFAULT_MODEL_ID = 'anthropic/claude-sonnet-4-6';
const DEFAULT_OPENROUTER_MODEL_ID = 'openrouter/moonshotai/kimi-k2.6';

const payloadSchema = v.pipe(
  v.object({
    mode: v.picklist(['create', 'revise']),
    prompt: v.string(),
    currentCode: v.optional(v.string()),
  }),
  v.check(
    (input) => input.mode === 'create' || Boolean(input.currentCode?.trim()),
    'currentCode is required when mode is revise',
  ),
);

export default async function ({ init, payload, env }: FlueContext) {
  const parsed = safeParse(payloadSchema, payload);
  if (!parsed.success) {
    return {
      ok: false,
      error: 'Invalid payload',
      issues: parsed.issues,
      expected: {
        create: { mode: 'create', prompt: 'Create a simple bracket with two mounting holes.' },
        revise: {
          mode: 'revise',
          prompt: 'Increase the wall thickness and add a chamfer-like top taper.',
          currentCode: 'cube([20, 20, 10], center=true);',
        },
      },
    };
  }

  const model = resolveModel(env);
  applyProviderEnv(env, model);

  const agent = await init({
    sandbox: 'local',
    model,
  });
  const session = await agent.session();

  return await runOpenScadLoop({
    session,
    request: {
      mode: parsed.output.mode,
      userPrompt: parsed.output.prompt,
      currentCode: parsed.output.currentCode,
    },
    model,
    cwd: process.cwd(),
  });
}

function resolveModel(env: FlueContext['env']) {
  const llm = readLlmEnv(env);
  if (llm.modelId) return llm.modelId;
  if (llm.apiKey) return DEFAULT_OPENROUTER_MODEL_ID;
  return DEFAULT_MODEL_ID;
}

function applyProviderEnv(env: FlueContext['env'], model: string) {
  const llm = readLlmEnv(env);
  applyProviderApiKey(model, llm.apiKey);
}
