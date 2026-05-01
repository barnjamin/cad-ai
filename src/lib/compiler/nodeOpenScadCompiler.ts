import fs from 'node:fs/promises';
import path from 'node:path';
import openscad from '../../vendor/openscad-wasm/openscad.js';
import type { ArtifactCompileReport, CadArtifact, CadParameter } from '../../core/types.ts';

type OpenScadWorkerRequest = {
  code: string;
  fileType: string;
  params: CadParameter[];
};

class OpenScadError extends Error {
  code: string;
  stdErr: string[];

  constructor(message: string, code: string, stdErr: string[]) {
    super(message);
    this.name = 'OpenScadError';
    this.code = code;
    this.stdErr = stdErr;
  }
}

type OpenScadInstance = Awaited<ReturnType<typeof openscad>>;

type CompilerLog = {
  stdErr: string[];
  stdOut: string[];
};

let wasmBinaryPromise: Promise<Uint8Array> | null = null;
const activeLog: CompilerLog = { stdErr: [], stdOut: [] };

export async function compileArtifactWithNodeOpenScad(artifact: CadArtifact): Promise<ArtifactCompileReport> {
  try {
    const response = await previewWithNodeOpenScad({
      code: artifact.code,
      fileType: 'stl',
      params: artifact.parameters,
    });

    return {
      artifactId: artifact.id,
      codeHash: artifact.codeHash,
      status: 'success',
      fileType: response.fileType as 'stl' | 'svg',
      stdErr: response.log.stdErr,
      generatedAt: Date.now(),
    };
  } catch (error) {
    if (error instanceof OpenScadError) {
      return {
        artifactId: artifact.id,
        codeHash: artifact.codeHash,
        status: 'error',
        errorMessage: error.message,
        stdErr: error.stdErr,
        generatedAt: Date.now(),
      };
    }

    return {
      artifactId: artifact.id,
      codeHash: artifact.codeHash,
      status: 'error',
      errorMessage: error instanceof Error ? error.message : 'OpenSCAD failed to compile the model.',
      stdErr: [...activeLog.stdErr],
      generatedAt: Date.now(),
    };
  }
}

export async function previewWithNodeOpenScad(data: OpenScadWorkerRequest) {
  const instance = await getInstance();
  resetLog();
  removeOldOutputs(instance);

  const inputPath = '/input.scad';
  const outputPath = `/out.${data.fileType}`;
  const parameterArgs = serializeParameters(data.params);

  instance.FS.writeFile(inputPath, data.code);

  let exitCode: number;
  try {
    exitCode = instance.callMain([
      inputPath,
      '-o',
      outputPath,
      ...parameterArgs,
      '--export-format=binstl',
      '--backend=manifold',
      '--enable=lazy-union',
      '--enable=roof',
    ]);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? `OpenSCAD exited with an error: ${error.message}`
        : 'OpenSCAD exited with an error',
    );
  }

  if (exitCode !== 0) {
    throw new OpenScadError(activeLog.stdErr.join('\n') || 'OpenSCAD failed', String(exitCode), [...activeLog.stdErr]);
  }

  const output = instance.FS.readFile(outputPath, { encoding: 'binary' });

  return {
    fileType: data.fileType,
    output,
    exitCode,
    duration: 0,
    log: {
      stdErr: [...activeLog.stdErr],
      stdOut: [...activeLog.stdOut],
    },
  };
}

async function getInstance() {
  const wasmBinary = await getWasmBinary();
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

async function getWasmBinary() {
  if (!wasmBinaryPromise) {
    wasmBinaryPromise = fs
      .readFile(path.resolve(process.cwd(), 'src/vendor/openscad-wasm/openscad.wasm'))
      .then((buffer) => new Uint8Array(buffer));
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

function serializeParameters(params: OpenScadWorkerRequest['params']) {
  return params
    .map(({ name, type, value }) => {
      if (type === 'string' && typeof value === 'string') {
        return `-D${name}=${escapeShellString(value)}`;
      }

      if (type === 'number[]' && Array.isArray(value)) {
        return `-D${name}=[${value.join(',')}]`;
      }

      if (type === 'string[]' && Array.isArray(value)) {
        return `-D${name}=[${value.map((item) => escapeShellString(String(item))).join(',')}]`;
      }

      if (type === 'boolean[]' && Array.isArray(value)) {
        return `-D${name}=[${value.join(',')}]`;
      }

      return `-D${name}=${String(value)}`;
    })
    .filter(Boolean);
}

function escapeShellString(value: string) {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}
