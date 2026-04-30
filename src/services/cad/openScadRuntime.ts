import { BlobReader, Uint8ArrayWriter, ZipReader } from '@zip.js/zip.js';
import openscad from '../../vendor/openscad-wasm/openscad.js';
import { OPENSCAD_LIBRARY_MANIFEST } from './libraryManifest';
import OpenScadError from './OpenScadError';
import WorkspaceFile from './WorkspaceFile';
import type {
  OpenScadWorkerRequest,
  OpenScadWorkerResponse,
  WorkerFileRequest,
} from './workerTypes';

const FONTS_CONFIGURATION = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig></fontconfig>`;

type OpenScadInstance = Awaited<ReturnType<typeof openscad>>;

let cachedDefaultFont: ArrayBuffer | undefined;

export class OpenScadRuntime {
  private log: { stdErr: string[]; stdOut: string[] } = { stdErr: [], stdOut: [] };
  private workspaceFiles: WorkspaceFile[] = [];

  async preview(data: OpenScadWorkerRequest): Promise<OpenScadWorkerResponse> {
    const parameterArgs = this.serializeParameters(data.params);
    const stlPreview = await this.execute(
      data.code,
      data.fileType,
      parameterArgs.concat(['--backend=manifold', '--enable=lazy-union', '--enable=roof']),
      [{ path: '/out.off', key: 'off' }],
    );

    if (stlPreview.log.stdErr.includes('Current top level object is not a 3D object.')) {
      const svgPreview = await this.execute(
        data.code,
        'svg',
        parameterArgs.concat([
          '--export-format=svg',
          '--backend=manifold',
          '--enable=lazy-union',
          '--enable=roof',
        ]),
      );

      if (svgPreview.exitCode === 0) {
        return svgPreview;
      }

      stlPreview.log.stdErr.push(...svgPreview.log.stdErr);
      stlPreview.log.stdOut.push(...svgPreview.log.stdOut);
    }

    return stlPreview;
  }

  async exportFile(data: OpenScadWorkerRequest): Promise<OpenScadWorkerResponse> {
    const parameterArgs = this.serializeParameters(data.params).concat([
      '--export-format=binstl',
      '--enable=manifold',
      '--enable=fast-csg',
      '--enable=lazy-union',
    ]);

    return this.execute(data.code, data.fileType, parameterArgs);
  }

  async writeFile(data: WorkerFileRequest) {
    this.workspaceFiles = this.workspaceFiles.filter((file) => file.path !== data.path);

    if (!data.content) {
      return true;
    }

    let workspaceFile: WorkspaceFile;
    if (data.content instanceof ArrayBuffer) {
      workspaceFile = new WorkspaceFile([data.content], data.path, {
        path: data.path,
        type: data.type ?? 'application/octet-stream',
      });
    } else if (data.content instanceof File) {
      workspaceFile = new WorkspaceFile([data.content], data.content.name || data.path, {
        path: data.path,
        type: data.content.type ?? 'application/octet-stream',
      });
    } else {
      return false;
    }

    workspaceFile.path = workspaceFile.path ?? data.path;
    this.workspaceFiles.push(workspaceFile);
    return true;
  }

  async readFile(data: WorkerFileRequest): Promise<WorkerFileRequest> {
    const file = this.workspaceFiles.find((entry) => entry.path === data.path);
    return { path: data.path, content: file };
  }

  async unlinkFile(data: WorkerFileRequest) {
    this.workspaceFiles = this.workspaceFiles.filter((file) => file.path !== data.path);
    return true;
  }

  private async execute(
    code: string,
    fileType: string,
    parameterArgs: string[],
    extraOutputs: Array<{ path: string; key: string }> = [],
  ): Promise<OpenScadWorkerResponse> {
    const startedAt = Date.now();
    this.log = { stdErr: [], stdOut: [] };

    const inputPath = '/input.scad';
    const outputPath = `/out.${fileType}`;
    const instance = await this.getInstance();

    instance.FS.writeFile(inputPath, code);
    if (!this.pathExists(instance, '/libraries')) {
      instance.FS.mkdir('/libraries');
    }

    await this.mountReferencedLibraries(instance, code);

    const args = [
      inputPath,
      '-o',
      outputPath,
      ...extraOutputs.flatMap(({ path }) => ['-o', path]),
      ...parameterArgs,
    ];

    let exitCode: number;
    try {
      exitCode = instance.callMain(args);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `OpenSCAD exited with an error: ${error.message}`
          : 'OpenSCAD exited with an error',
      );
    }

    if (exitCode !== 0) {
      throw new OpenScadError(
        this.log.stdErr.join('\n') || 'OpenSCAD failed',
        String(exitCode),
        this.log.stdErr,
      );
    }

    let output: Uint8Array;
    try {
      output = instance.FS.readFile(outputPath, { encoding: 'binary' });
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `OpenSCAD cannot read created file: ${error.message}`
          : 'OpenSCAD cannot read created file',
      );
    }

    const mountedExtras: Record<string, Uint8Array> = {};
    for (const { path, key } of extraOutputs) {
      try {
        mountedExtras[key] = instance.FS.readFile(path, { encoding: 'binary' });
      } catch {
        // optional output
      }
    }

    return {
      fileType,
      output,
      exitCode,
      duration: Date.now() - startedAt,
      log: this.log,
      extraOutputs: Object.keys(mountedExtras).length > 0 ? mountedExtras : undefined,
    };
  }

  private async getInstance(): Promise<OpenScadInstance> {
    const instance = await openscad({
      noInitialRun: true,
      print: this.createLogger('stdOut'),
      printErr: this.createLogger('stdErr'),
    });

    await this.ensureFonts(instance);

    for (const file of this.workspaceFiles) {
      if (!file.path) continue;
      const directory = file.path.split('/').slice(0, -1).join('/');
      if (directory && !this.pathExists(instance, directory)) {
        this.createDirectoryRecursive(instance, directory);
      }
      const bytes = await file.arrayBuffer();
      instance.FS.writeFile(file.path, new Int8Array(bytes));
    }

    return instance;
  }

  private async ensureFonts(instance: OpenScadInstance) {
    try {
      if (!cachedDefaultFont) {
        const response = await fetch(`${import.meta.env.BASE_URL}Geist-Regular.ttf`);
        cachedDefaultFont = await response.arrayBuffer();
      }

      this.createDirectoryRecursive(instance, 'fonts');
      instance.FS.writeFile('/fonts/fonts.conf', FONTS_CONFIGURATION);
      instance.FS.writeFile('/fonts/Geist-Regular.ttf', new Int8Array(cachedDefaultFont));
    } catch (error) {
      console.error('Failed to initialize OpenSCAD fonts', error);
    }
  }

  private async mountReferencedLibraries(instance: OpenScadInstance, code: string) {
    const mountedLibraries = new Set<string>();

    for (const library of OPENSCAD_LIBRARY_MANIFEST) {
      if (!code.includes(library.name) || mountedLibraries.has(library.name)) {
        continue;
      }

      mountedLibraries.add(library.name);
      try {
        const response = await fetch(library.url);
        const archiveBlob = await response.blob();
        const entries = await new ZipReader(new BlobReader(archiveBlob)).getEntries();

        await Promise.all(
          entries
            .filter((entry) => entry.directory === false)
            .map(async (entry) => {
              const writer = new Uint8ArrayWriter();
              if (!entry.getData) throw new Error('Missing archive reader');
              const bytes = await entry.getData(writer);
              const path = `/libraries/${library.name}/${entry.filename}`;
              const directory = path.split('/').slice(0, -1).join('/');

              if (directory && !this.pathExists(instance, directory)) {
                this.createDirectoryRecursive(instance, directory);
              }

              instance.FS.writeFile(path, new Int8Array(bytes));
            }),
        );
      } catch (error) {
        console.error(`Failed to import OpenSCAD library ${library.name}`, error);
      }
    }
  }

  private serializeParameters(params: OpenScadWorkerRequest['params']) {
    return params
      .map(({ name, type, value }) => {
        if (type === 'string' && typeof value === 'string') {
          return `-D${name}=${this.escapeShellString(value)}`;
        }

        if (type === 'number[]' && Array.isArray(value)) {
          return `-D${name}=[${value.join(',')}]`;
        }

        if (type === 'string[]' && Array.isArray(value)) {
          return `-D${name}=[${value.map((item) => this.escapeShellString(String(item))).join(',')}]`;
        }

        if (type === 'boolean[]' && Array.isArray(value)) {
          return `-D${name}=[${value.join(',')}]`;
        }

        return `-D${name}=${String(value)}`;
      })
      .filter(Boolean);
  }

  private createLogger(type: 'stdErr' | 'stdOut') {
    return (text: string) => {
      this.log[type].push(text);
    };
  }

  private pathExists(instance: OpenScadInstance, path: string) {
    try {
      instance.FS.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  private createDirectoryRecursive(instance: OpenScadInstance, path: string) {
    const parts = path.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      currentPath += `/${part}`;
      if (!this.pathExists(instance, currentPath)) {
        instance.FS.mkdir(currentPath);
      }
    }
  }

  private escapeShellString(value: string) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
}
