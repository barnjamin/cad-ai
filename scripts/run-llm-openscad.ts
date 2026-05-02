import fs from 'node:fs/promises';
import path from 'node:path';
import { compileOpenScad } from '../src/tools/compileOpenScad.ts';
import { hashProgram } from '../src/tools/hashProgram.ts';
import { generateOpenScadWithOpenAiCompatibleApi, listOpenAiCompatibleModels, pickDefaultModel } from '../src/llm/openAiCompatibleClient.ts';
import { readLlmEnv } from '../src/llm/env.ts';

const prompt = process.argv.slice(2).join(' ').trim() || 'Create a small parametric box with a centered cylindrical hole.';
const llm = readLlmEnv();
const baseUrl = llm.baseUrl;
const maxTokens = llm.maxTokens;
const models = await listOpenAiCompatibleModels(baseUrl, llm.apiKey);
const loaded = models.filter((model) => model.status?.value === 'loaded').map((model) => model.id);
const model = llm.modelId ?? pickDefaultModel(models);

if (!model) {
  throw new Error(`No models available at ${baseUrl}`);
}

console.log('LLM base URL:', baseUrl.replace(/\/$/, ''));
console.log('Loaded models:', loaded.length ? loaded.join(', ') : '(none reported as loaded)');
console.log('Selected model:', model);
console.log('Prompt:', prompt);
console.log('Max tokens:', maxTokens);
console.log('---');

const result = await generateOpenScadWithOpenAiCompatibleApi({
  prompt,
  model,
  baseUrl,
  maxTokens,
  apiKey: llm.apiKey ?? undefined,
});

const artifactDir = path.resolve(process.cwd(), '.artifacts');
const codeHash = hashProgram(result.code || result.raw || prompt);
const outputPath = path.join(artifactDir, `${codeHash}.scad`);
await fs.mkdir(artifactDir, { recursive: true });
await fs.writeFile(outputPath, result.code, 'utf8');

console.log('Validation:', result.validation.ok ? 'ok' : 'fail');
if (!result.validation.ok) {
  console.log('Validation issues:', result.validation.issues.join(' | '));
}
console.log('Saved code to:', outputPath);
console.log('--- CODE ---');
console.log(result.code);

const compile = await compileOpenScad({ code: result.code, cwd: process.cwd() });
console.log('--- COMPILE ---');
console.log(JSON.stringify(compile, null, 2));
