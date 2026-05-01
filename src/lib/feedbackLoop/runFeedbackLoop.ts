import type { ArtifactCompileReport, ConversationMessage } from '../../core/types.ts';
import { formatCompileErrorForRepair, normalizeCompileError } from '../../services/cad/compileFeedback.ts';
import type {
  FeedbackLoopCase,
  FeedbackLoopCaseResult,
  FeedbackLoopDependencies,
  FeedbackLoopRunOptions,
} from './types.ts';

export async function runFeedbackLoopCase(
  testCase: FeedbackLoopCase,
  deps: FeedbackLoopDependencies,
  options: FeedbackLoopRunOptions = {},
): Promise<FeedbackLoopCaseResult> {
  const maxRepairs = Math.max(0, options.maxRepairs ?? 1);
  const conversation = createConversation(testCase.prompt);
  const attempts: FeedbackLoopCaseResult['attempts'] = [];

  let currentArtifact;
  try {
    currentArtifact = await deps.generateArtifact({
      promptText: testCase.prompt,
      conversation,
      source: 'assistant-generated',
    });
  } catch (error) {
    attempts.push({
      generationError: error instanceof Error ? error.message : 'Initial generation failed.',
    });
    return { id: testCase.id, prompt: testCase.prompt, attempts, finalStatus: 'fail' };
  }

  for (let repairIndex = 0; repairIndex <= maxRepairs; repairIndex += 1) {
    const compileReport = await deps.compileArtifact(currentArtifact);
    const attempt = {
      artifact: pickArtifact(currentArtifact),
      compileReport,
    } satisfies FeedbackLoopCaseResult['attempts'][number];
    attempts.push(attempt);

    if (compileReport.status === 'success') {
      return { id: testCase.id, prompt: testCase.prompt, attempts, finalStatus: 'pass' };
    }

    if (repairIndex >= maxRepairs) {
      return { id: testCase.id, prompt: testCase.prompt, attempts, finalStatus: 'fail' };
    }

    const normalizedError = normalizeCompileError(compileReport);
    if (!normalizedError) {
      return { id: testCase.id, prompt: testCase.prompt, attempts, finalStatus: 'fail' };
    }

    const repairPrompt = formatCompileErrorForRepair(normalizedError, currentArtifact.code);
    attempts[attempts.length - 1] = {
      ...attempt,
      repairPrompt,
    };

    try {
      currentArtifact = await deps.generateArtifact({
        promptText: testCase.prompt,
        conversation,
        baseCode: currentArtifact.code,
        error: repairPrompt,
        source: 'assistant-repaired',
      });
    } catch (error) {
      attempts.push({
        generationError: error instanceof Error ? error.message : 'Repair generation failed.',
      });
      return { id: testCase.id, prompt: testCase.prompt, attempts, finalStatus: 'fail' };
    }
  }

  return { id: testCase.id, prompt: testCase.prompt, attempts, finalStatus: 'fail' };
}

export async function runFeedbackLoopEvaluation(
  cases: FeedbackLoopCase[],
  deps: FeedbackLoopDependencies,
  options: FeedbackLoopRunOptions = {},
) {
  const results: FeedbackLoopCaseResult[] = [];

  for (const testCase of cases) {
    results.push(await runFeedbackLoopCase(testCase, deps, options));
  }

  return results;
}

function createConversation(prompt: string): ConversationMessage[] {
  return [
    {
      id: crypto.randomUUID(),
      role: 'user',
      createdAt: Date.now(),
      content: {
        text: prompt,
      },
    },
  ];
}

function pickArtifact(artifact: {
  id: string;
  title: string;
  code: string;
  codeHash: string;
  source: string;
}) {
  return {
    id: artifact.id,
    title: artifact.title,
    code: artifact.code,
    codeHash: artifact.codeHash,
    source: artifact.source,
  };
}

export function summarizeFeedbackLoopResults(results: FeedbackLoopCaseResult[]) {
  return results.map((result) => {
    const firstCompile = result.attempts.find((attempt) => attempt.compileReport)?.compileReport;
    const lastCompile = [...result.attempts].reverse().find((attempt) => attempt.compileReport)?.compileReport;
    const lastGenerationError = [...result.attempts]
      .reverse()
      .find((attempt) => attempt.generationError)?.generationError;

    return {
      id: result.id,
      finalStatus: result.finalStatus,
      initialCompile: firstCompile?.status ?? 'invalid',
      finalCompile: lastCompile?.status ?? (lastGenerationError ? 'invalid' : '-'),
      repairs: Math.max(result.attempts.filter((attempt) => attempt.repairPrompt).length, 0),
      error: lastGenerationError ?? lastCompile?.errorMessage ?? '',
    };
  });
}

export function makeCompileReport(
  artifactId: string,
  codeHash: string,
  status: ArtifactCompileReport['status'],
  init: Partial<ArtifactCompileReport> = {},
): ArtifactCompileReport {
  return {
    artifactId,
    codeHash,
    status,
    generatedAt: Date.now(),
    ...init,
  };
}
