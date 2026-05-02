import type { FlueContext } from '@flue/sdk/client';
import { safeParse } from 'valibot';
import * as v from 'valibot';
import { runOpenScadLoop } from '../../src/core/runOpenScadLoop';

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

  applyProviderEnv(env);
  const model = resolveModel(env);

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
  const explicitModel = readEnvString(env, 'FLUE_MODEL_ID');
  if (explicitModel) return explicitModel;

  const openRouterKey = readEnvString(env, 'OPENROUTER_API_KEY') ?? readEnvString(env, 'OPENROUTER_KEY');
  const openRouterModel = readEnvString(env, 'OPENROUTER_MODEL_ID') ?? readEnvString(env, 'OPENROUTER_MODEL');

  if (openRouterKey) {
    return normalizeOpenRouterModelId(openRouterModel ?? DEFAULT_OPENROUTER_MODEL_ID);
  }

  return DEFAULT_MODEL_ID;
}

function applyProviderEnv(env: FlueContext['env']) {
  const openRouterKey = readEnvString(env, 'OPENROUTER_API_KEY') ?? readEnvString(env, 'OPENROUTER_KEY');
  if (openRouterKey && !process.env.OPENROUTER_API_KEY) {
    process.env.OPENROUTER_API_KEY = openRouterKey;
  }
}

function readEnvString(env: FlueContext['env'], key: string) {
  const value = env?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function normalizeOpenRouterModelId(model: string) {
  return model.startsWith('openrouter/') ? model : `openrouter/${model}`;
}
