import fs from 'node:fs/promises';
import path from 'node:path';
import { compileOpenScad } from '../src/tools/compileOpenScad.ts';
import { hashProgram } from '../src/tools/hashProgram.ts';
import { generateOpenScadWithLlamaCpp, listLlamaCppModels, pickDefaultModel } from '../src/llm/llamaCppClient.ts';

const prompt = process.argv.slice(2).join(' ').trim() || 'Create a small parametric box with a centered cylindrical hole.';
const baseUrl = process.env.VITE_LLAMACPP_BASE_URL ?? 'http://192.168.4.220:8080/';

const maxTokens = Number(process.env.LLAMACPP_MAX_TOKENS ?? '1024');
const models = await listLlamaCppModels(baseUrl);
const loaded = models.filter((model) => model.status?.value === 'loaded').map((model) => model.id);
const model = process.env.LLAMACPP_MODEL_ID ?? pickDefaultModel(models);

if (!model) {
  throw new Error(`No llama.cpp models available at ${baseUrl}`);
}

console.log('llama.cpp base URL:', baseUrl.replace(/\/$/, ''));
console.log('Loaded models:', loaded.length ? loaded.join(', ') : '(none reported as loaded)');
console.log('Selected model:', model);
console.log('Prompt:', prompt);
console.log('Max tokens:', maxTokens);
console.log('---');

const result = await generateOpenScadWithLlamaCpp({
  prompt,
  model,
  baseUrl,
  maxTokens,
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
