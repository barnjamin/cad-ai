import fs from 'node:fs/promises';
import path from 'node:path';
// @ts-expect-error vendored Emscripten bundle has no TypeScript declarations.
import openscad from '../../vendor/openscad-wasm/openscad.js';
import type { CompileResult } from '../core/types.ts';
import { hashProgram } from './hashProgram.ts';

const wasmFileUrl = new URL('../../vendor/openscad-wasm/openscad.wasm', import.meta.url);

type OpenScadInstance = Awaited<ReturnType<typeof openscad>>;

type CompilerLog = {
  stdErr: string[];
  stdOut: string[];
};

class OpenScadError extends Error {
  stdErr: string[];

  constructor(message: string, stdErr: string[]) {
    super(message);
    this.name = 'OpenScadError';
    this.stdErr = stdErr;
  }
}

let wasmBinaryPromise: Promise<Uint8Array> | null = null;
const activeLog: CompilerLog = { stdErr: [], stdOut: [] };

export async function compileOpenScad(args: { code: string; cwd: string }): Promise<CompileResult> {
  const artifactDir = path.join(args.cwd, '.artifacts');
  const codeHash = hashProgram(args.code);
  const inputPath = path.join(artifactDir, `${codeHash}.scad`);
  const outputPath = path.join(artifactDir, `${codeHash}.stl`);

  await fs.mkdir(artifactDir, { recursive: true });
  await fs.writeFile(inputPath, args.code, 'utf8');

  try {
    const output = await compileWithNodeOpenScad({
      code: args.code,
      cwd: args.cwd,
      fileType: 'stl',
    });

    await fs.writeFile(outputPath, output.binary);

    return {
      ok: true,
      available: true,
      summary: 'Compile succeeded via bundled OpenSCAD WASM.',
      stderr: output.log.stdErr,
      outputPath,
    };
  } catch (error) {
    if (error instanceof OpenScadError) {
      return {
        ok: false,
        available: true,
        summary: summarizeFailure(error.stdErr, error.message),
        stderr: error.stdErr,
        outputPath,
      };
    }

    return {
      ok: false,
      available: true,
      summary: error instanceof Error ? error.message : 'OpenSCAD WASM failed to compile the model.',
      stderr: [...activeLog.stdErr],
      outputPath,
    };
  }
}

async function compileWithNodeOpenScad(args: { code: string; cwd: string; fileType: 'stl' | 'svg' }) {
  const instance = await getInstance(args.cwd);
  resetLog();
  removeOldOutputs(instance);

  const wasmInputPath = '/input.scad';
  const wasmOutputPath = `/out.${args.fileType}`;
  instance.FS.writeFile(wasmInputPath, args.code);

  let exitCode: number;
  try {
    exitCode = instance.callMain([
      wasmInputPath,
      '-o',
      wasmOutputPath,
      '--export-format=binstl',
      '--backend=manifold',
      '--enable=lazy-union',
      '--enable=roof',
    ]);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `OpenSCAD WASM exited with an error: ${error.message}`
        : 'OpenSCAD WASM exited with an error.',
    );
  }

  if (exitCode !== 0) {
    throw new OpenScadError(activeLog.stdErr.join('\n') || 'OpenSCAD failed.', [...activeLog.stdErr]);
  }

  const binary = instance.FS.readFile(wasmOutputPath, { encoding: 'binary' });
  return {
    binary,
    log: {
      stdErr: [...activeLog.stdErr],
      stdOut: [...activeLog.stdOut],
    },
  };
}

async function getInstance(cwd: string) {
  const wasmBinary = await getWasmBinary(cwd);
  return openscad({
    noInitialRun: true,
    wasmBinary,
    print: (text: string) => {
      activeLog.stdOut.push(text);
    },
    printErr: (text: string) => {
      activeLog.stdErr.push(text);
    },
  });
}

async function getWasmBinary(_cwd: string) {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = fs.readFile(wasmFileUrl).then((buffer) => new Uint8Array(buffer));
  }

  return wasmBinaryPromise;
}

function resetLog() {
  activeLog.stdErr.length = 0;
  activeLog.stdOut.length = 0;
}

function removeOldOutputs(instance: OpenScadInstance) {
  for (const outputPath of ['/out.stl', '/out.svg', '/out.off']) {
    try {
      instance.FS.unlink(outputPath);
    } catch {
      // ignore
    }
  }
}

function summarizeFailure(stderr: string[], fallback: string) {
  return stderr.find((line) => line.trim()) ?? fallback;
}
