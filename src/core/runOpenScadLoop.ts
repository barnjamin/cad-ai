import * as v from 'valibot';
import path from 'node:path';
import type { CandidateProgram, ModelSpec, OpenScadAgentResponse, OpenScadRequest } from './types';
import { compileOpenScad } from '../tools/compileOpenScad';
import { hashProgram } from '../tools/hashProgram';
import { renderViews } from '../tools/renderViews';

type SessionLike = {
  skill(name: string, options: Record<string, unknown>): Promise<unknown>;
};

const SPEC_SCHEMA = v.object({
  summary: v.string(),
  primitives: v.array(v.string()),
  constraints: v.array(v.string()),
  acceptanceChecks: v.array(v.string()),
  preserve: v.optional(v.array(v.string())),
  assumptions: v.optional(v.array(v.string())),
});

const CANDIDATE_SCHEMA = v.object({
  code: v.string(),
  rationale: v.string(),
  expectedFeatures: v.array(v.string()),
});

const CRITIQUE_SCHEMA = v.object({
  pass: v.boolean(),
  score: v.number(),
  issues: v.array(v.string()),
  suggestedEdits: v.array(v.string()),
  summary: v.string(),
});

export async function runOpenScadLoop(args: {
  session: SessionLike;
  request: OpenScadRequest;
  model: string;
  cwd: string;
}): Promise<OpenScadAgentResponse> {
  const warnings: string[] = [];
  const attempts: OpenScadAgentResponse['attempts'] = [];

  const spec = (await args.session.skill('specify', {
    role: 'openscad-coder',
    args: {
      mode: args.request.mode,
      prompt: args.request.userPrompt,
      currentCode: args.request.currentCode ?? '',
    },
    result: SPEC_SCHEMA,
  })) as ModelSpec;

  let candidate = await generateCandidate(args.session, args.request, spec);
  let compileOutcome = await compileCandidateWithRepair({
    session: args.session,
    request: args.request,
    spec,
    candidate,
    cwd: args.cwd,
    attemptStartIndex: attempts.length + 1,
  });

  attempts.push(...compileOutcome.attempts);
  candidate = compileOutcome.candidate;

  if (!compileOutcome.compile.available) {
    warnings.push(compileOutcome.compile.summary);
    return {
      ok: true,
      mode: args.request.mode,
      model: args.model,
      spec,
      finalCode: candidate.code,
      attempts,
      summary: 'Generated OpenSCAD code, but compile validation is unavailable on this machine.',
      warnings,
    };
  }

  if (!compileOutcome.compile.ok) {
    return {
      ok: false,
      mode: args.request.mode,
      model: args.model,
      spec,
      attempts,
      summary: 'The agent exhausted the compile repair budget without producing a validated program.',
      warnings,
      failureReason: compileOutcome.compile.summary,
    };
  }

  let renderOutcome = await renderAndCritiqueCandidate({
    session: args.session,
    request: args.request,
    spec,
    candidate,
    compile: compileOutcome.compile,
    cwd: args.cwd,
  });

  attempts[attempts.length - 1] = {
    ...attempts[attempts.length - 1],
    render: renderOutcome.render,
    critique: renderOutcome.critique,
  };

  if (!renderOutcome.render.available) {
    warnings.push(renderOutcome.render.summary);
    return {
      ok: true,
      mode: args.request.mode,
      model: args.model,
      spec,
      finalCode: candidate.code,
      attempts,
      summary: 'Generated and compile-validated OpenSCAD code. Visual validation is unavailable on this machine.',
      warnings,
    };
  }

  if (!renderOutcome.render.ok) {
    warnings.push(renderOutcome.render.summary);
  }

  let visualRepairCount = 0;
  while (renderOutcome.critique && !renderOutcome.critique.pass && visualRepairCount < 2) {
    visualRepairCount += 1;

    const revisedCandidate = await repairVisualCandidate(
      args.session,
      args.request,
      spec,
      candidate,
      renderOutcome.critique,
      renderOutcome.render,
      args.cwd,
    );

    if (hashProgram(revisedCandidate.code) === hashProgram(candidate.code)) {
      warnings.push('Visual repair produced unchanged code; stopping early.');
      break;
    }

    candidate = revisedCandidate;
    compileOutcome = await compileCandidateWithRepair({
      session: args.session,
      request: args.request,
      spec,
      candidate,
      cwd: args.cwd,
      attemptStartIndex: attempts.length + 1,
    });
    attempts.push(...compileOutcome.attempts);
    candidate = compileOutcome.candidate;

    if (!compileOutcome.compile.ok) {
      return {
        ok: false,
        mode: args.request.mode,
        model: args.model,
        spec,
        attempts,
        summary: 'Visual repair produced candidates, but the agent exhausted the compile repair budget afterward.',
        warnings,
        failureReason: compileOutcome.compile.summary,
      };
    }

    renderOutcome = await renderAndCritiqueCandidate({
      session: args.session,
      request: args.request,
      spec,
      candidate,
      compile: compileOutcome.compile,
      cwd: args.cwd,
    });

    attempts[attempts.length - 1] = {
      ...attempts[attempts.length - 1],
      render: renderOutcome.render,
      critique: renderOutcome.critique,
    };

    if (!renderOutcome.render.available) {
      warnings.push(renderOutcome.render.summary);
      break;
    }

    if (!renderOutcome.render.ok) {
      warnings.push(renderOutcome.render.summary);
    }
  }

  if (!renderOutcome.critique?.pass) {
    warnings.push('Visual critique still reports possible mismatches after the bounded visual repair loop.');
  }

  return {
    ok: compileOutcome.compile.ok,
    mode: args.request.mode,
    model: args.model,
    spec,
    finalCode: candidate.code,
    attempts,
    summary: renderOutcome.critique?.pass
      ? 'Generated, compile-validated, rendered, and visually reviewed OpenSCAD code.'
      : 'Generated and compile-validated OpenSCAD code, but visual critique found possible mismatches.',
    warnings,
  };
}

async function generateCandidate(session: SessionLike, request: OpenScadRequest, spec: ModelSpec) {
  const skillName = request.mode === 'create' ? 'generate' : 'revise';
  const args = request.mode === 'create'
    ? { prompt: request.userPrompt, spec }
    : { prompt: request.userPrompt, spec, currentCode: request.currentCode ?? '' };

  const candidate = (await session.skill(skillName, {
    role: 'openscad-coder',
    args,
    result: CANDIDATE_SCHEMA,
  })) as CandidateProgram;

  return normalizeCandidate(candidate);
}

async function compileCandidateWithRepair(args: {
  session: SessionLike;
  request: OpenScadRequest;
  spec: ModelSpec;
  candidate: CandidateProgram;
  cwd: string;
  attemptStartIndex: number;
}) {
  const attempts: OpenScadAgentResponse['attempts'] = [];
  let candidate = args.candidate;
  let compile = await compileOpenScad({ code: candidate.code, cwd: args.cwd });

  attempts.push({
    index: args.attemptStartIndex,
    codeHash: hashProgram(candidate.code),
    compile,
  });

  let repairCount = 0;
  while (compile.available && !compile.ok && repairCount < 2) {
    repairCount += 1;
    candidate = await repairCandidate(args.session, args.request, args.spec, candidate, compile);
    compile = await compileOpenScad({ code: candidate.code, cwd: args.cwd });
    attempts.push({
      index: args.attemptStartIndex + attempts.length,
      codeHash: hashProgram(candidate.code),
      compile,
    });
  }

  return {
    candidate,
    compile,
    attempts,
  };
}

async function renderAndCritiqueCandidate(args: {
  session: SessionLike;
  request: OpenScadRequest;
  spec: ModelSpec;
  candidate: CandidateProgram;
  compile: { outputPath?: string };
  cwd: string;
}) {
  const render = await renderViews({
    code: args.candidate.code,
    cwd: args.cwd,
    stlPath: args.compile.outputPath,
  });

  if (!render.available) {
    return { render, critique: undefined };
  }

  const critique = (await args.session.skill('critique-visual', {
    role: 'openscad-critic',
    args: {
      prompt: args.request.userPrompt,
      spec: args.spec,
      currentCode: args.candidate.code,
      renderSummary: render.summary,
      renderOk: render.ok,
      renderStderr: render.stderr,
      views: render.views.map((view) => ({
        ...view,
        relativePath: path.relative(args.cwd, view.imagePath),
      })),
    },
    result: CRITIQUE_SCHEMA,
  })) as OpenScadAgentResponse['attempts'][number]['critique'];

  return { render, critique };
}

async function repairCandidate(
  session: SessionLike,
  request: OpenScadRequest,
  spec: ModelSpec,
  candidate: CandidateProgram,
  compile: { summary: string; stderr: string[] },
) {
  const repaired = (await session.skill('repair-compile', {
    role: 'openscad-coder',
    args: {
      prompt: request.userPrompt,
      spec,
      currentCode: candidate.code,
      compileSummary: compile.summary,
      stderr: compile.stderr,
    },
    result: CANDIDATE_SCHEMA,
  })) as CandidateProgram;

  return normalizeCandidate(repaired);
}

async function repairVisualCandidate(
  session: SessionLike,
  request: OpenScadRequest,
  spec: ModelSpec,
  candidate: CandidateProgram,
  critique: NonNullable<OpenScadAgentResponse['attempts'][number]['critique']>,
  render: OpenScadAgentResponse['attempts'][number]['render'],
  cwd: string,
) {
  const repaired = (await session.skill('revise', {
    role: 'openscad-coder',
    args: {
      prompt: request.userPrompt,
      spec,
      currentCode: candidate.code,
      critiqueSummary: critique.summary,
      critiqueIssues: critique.issues,
      suggestedEdits: critique.suggestedEdits,
      views: (render?.views ?? []).map((view) => ({
        ...view,
        relativePath: path.relative(cwd, view.imagePath),
      })),
    },
    result: CANDIDATE_SCHEMA,
  })) as CandidateProgram;

  return normalizeCandidate(repaired);
}

function normalizeCandidate(candidate: CandidateProgram): CandidateProgram {
  return {
    ...candidate,
    code: stripCodeFences(candidate.code).trim(),
  };
}

function stripCodeFences(code: string) {
  return code
    .replace(/^```(?:openscad|scad)?\s*/i, '')
    .replace(/```\s*$/i, '');
}
