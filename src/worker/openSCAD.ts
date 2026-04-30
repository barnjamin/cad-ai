import openscad from '../vendor/openscad-wasm/openscad.js';
import { ZipReader, BlobReader, Uint8ArrayWriter } from '@zip.js/zip.js';
import WorkspaceFile from '../lib/WorkspaceFile';
import type {
  FileSystemWorkerMessageData,
  OpenSCADWorkerMessageData,
  OpenSCADWorkerResponseData,
} from './types';
import OpenSCADError from '../lib/OpenSCADError';
import { libraries } from '../lib/libraries';

const fontsConf = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig></fontconfig>`;

let defaultFont: ArrayBuffer | undefined;
type OpenSCADInstance = Awaited<ReturnType<typeof openscad>>;

class OpenSCADWrapper {
  log: { stdErr: string[]; stdOut: string[] } = { stdErr: [], stdOut: [] };
  files: WorkspaceFile[] = [];

  async getInstance(): Promise<OpenSCADInstance> {
    const instance = await openscad({
      noInitialRun: true,
      print: this.logger('stdOut'),
      printErr: this.logger('stdErr'),
    });

    try {
      if (!defaultFont) {
        const fontResponse = await fetch(`${import.meta.env.BASE_URL}Geist-Regular.ttf`);
        defaultFont = await fontResponse.arrayBuffer();
      }

      this.createDirectoryRecursive(instance, 'fonts');
      instance.FS.writeFile('/fonts/fonts.conf', fontsConf);
      instance.FS.writeFile('/fonts/Geist-Regular.ttf', new Int8Array(defaultFont));
    } catch (error) {
      console.error('Error setting up fonts', error);
    }

    for (const file of this.files) {
      if (!file.path) continue;
      const path = file.path.split('/');
      path.pop();
      const dir = path.join('/');

      if (dir && !this.fileExists(instance, dir)) {
        this.createDirectoryRecursive(instance, dir);
      }

      const content = await file.arrayBuffer();
      instance.FS.writeFile(file.path, new Int8Array(content));
    }

    return instance;
  }

  fileExists(instance: OpenSCADInstance, path: string) {
    try {
      instance.FS.stat(path);
      return true;
    } catch {
      return false;
    }
  }

  createDirectoryRecursive(instance: OpenSCADInstance, path: string) {
    const parts = path.split('/').filter(Boolean);
    let currentPath = '';

    for (const part of parts) {
      currentPath += '/' + part;
      if (!this.fileExists(instance, currentPath)) {
        instance.FS.mkdir(currentPath);
      }
    }
  }

  logger = (type: 'stdErr' | 'stdOut') => (text: string) => {
    this.log[type].push(text);
  };

  async exportFile(data: OpenSCADWorkerMessageData): Promise<OpenSCADWorkerResponseData> {
    const parameters = this.serializeParameters(data.params);
    parameters.push('--export-format=binstl');
    parameters.push('--enable=manifold');
    parameters.push('--enable=fast-csg');
    parameters.push('--enable=lazy-union');
    return this.executeOpenscad(data.code, data.fileType, parameters);
  }

  async preview(data: OpenSCADWorkerMessageData): Promise<OpenSCADWorkerResponseData> {
    const parameters = this.serializeParameters(data.params);
    const render = await this.executeOpenscad(
      data.code,
      data.fileType,
      parameters.concat(['--backend=manifold', '--enable=lazy-union', '--enable=roof']),
      [{ path: '/out.off', key: 'off' }],
    );

    if (render.log.stdErr.includes('Current top level object is not a 3D object.')) {
      const svgExport = await this.executeOpenscad(
        data.code,
        'svg',
        parameters.concat([
          '--export-format=svg',
          '--backend=manifold',
          '--enable=lazy-union',
          '--enable=roof',
        ]),
      );

      if (svgExport.exitCode === 0) return svgExport;
      render.log.stdErr.push(...svgExport.log.stdErr);
      render.log.stdOut.push(...svgExport.log.stdOut);
    }

    return render;
  }

  serializeParameters(params: OpenSCADWorkerMessageData['params']) {
    return params
      .map(({ name, type, value }) => {
        let serialized: string | number | boolean = value as string | number | boolean;
        if (type === 'string' && typeof value === 'string') {
          serialized = this.escapeShell(value);
        } else if (type === 'number[]' && Array.isArray(value)) {
          serialized = `[${value.join(',')}]`;
        } else if (type === 'string[]' && Array.isArray(value)) {
          serialized = `[${value.map((item) => this.escapeShell(String(item))).join(',')}]`;
        } else if (type === 'boolean[]' && Array.isArray(value)) {
          serialized = `[${value.join(',')}]`;
        }
        return `-D${name}=${serialized}`;
      })
      .filter(Boolean);
  }

  async writeFile(data: FileSystemWorkerMessageData) {
    this.files = this.files.filter((file) => file.path !== data.path);

    if (data.content) {
      let workspaceFile: WorkspaceFile;
      if (data.content instanceof ArrayBuffer) {
        workspaceFile = new WorkspaceFile([data.content], data.path, {
          path: data.path,
          type: data.type || 'application/octet-stream',
        });
      } else if (data.content instanceof File) {
        workspaceFile = new WorkspaceFile([data.content], data.content.name || data.path, {
          path: data.path,
          type: data.content.type || 'application/octet-stream',
        });
      } else {
        return false;
      }
      workspaceFile.path = workspaceFile.path || data.path;
      this.files.push(workspaceFile);
    }

    return true;
  }

  async readFile(data: FileSystemWorkerMessageData): Promise<FileSystemWorkerMessageData> {
    const found = this.files.find((file) => file.path === data.path);
    return { path: data.path, content: found };
  }

  async unlinkFile(data: FileSystemWorkerMessageData) {
    this.files = this.files.filter((file) => file.path !== data.path);
    return true;
  }

  async executeOpenscad(
    code: string,
    fileType: string,
    parameters: string[],
    extraOutputs: { path: string; key: string }[] = [],
  ): Promise<OpenSCADWorkerResponseData> {
    const start = Date.now();
    this.log.stdErr = [];
    this.log.stdOut = [];

    const inputFile = '/input.scad';
    const outputFile = '/out.' + fileType;
    const instance = await this.getInstance();
    const importLibraries: string[] = [];

    instance.FS.writeFile(inputFile, code);
    if (!this.fileExists(instance, '/libraries')) {
      instance.FS.mkdir('/libraries');
    }

    for (const library of libraries) {
      if (!code.includes(library.name) || importLibraries.includes(library.name)) continue;
      importLibraries.push(library.name);
      try {
        const response = await fetch(library.url);
        const zip = await response.blob();
        const files = await new ZipReader(new BlobReader(zip)).getEntries();
        await Promise.all(
          files
            .filter((f) => f.directory === false)
            .map(async (f) => {
              const writer = new Uint8ArrayWriter();
              if (!f.getData) throw new Error('getData is not defined');
              const blob = await f.getData(writer);
              const path = '/libraries/' + library.name + '/' + f.filename;
              const pathParts = path.split('/');
              pathParts.pop();
              const dir = pathParts.join('/');
              if (dir && !this.fileExists(instance, dir)) {
                this.createDirectoryRecursive(instance, dir);
              }
              instance.FS.writeFile(path, new Int8Array(blob));
            }),
        );
      } catch (error) {
        console.error('Error importing library', library.name, error);
      }
    }

    const extraOutputArgs = extraOutputs.flatMap(({ path }) => ['-o', path]);
    const args = [inputFile, '-o', outputFile, ...extraOutputArgs, ...parameters];

    let exitCode: number;
    let output: Uint8Array;
    const extras: Record<string, Uint8Array> = {};

    try {
      exitCode = instance.callMain(args);
    } catch (error) {
      throw new Error(
        error instanceof Error ? `OpenSCAD exited with an error: ${error.message}` : 'OpenSCAD exited with an error',
      );
    }

    if (exitCode === 0) {
      try {
        output = instance.FS.readFile(outputFile, { encoding: 'binary' });
      } catch (error) {
        throw new Error(
          error instanceof Error ? `OpenSCAD cannot read created file: ${error.message}` : 'OpenSCAD cannot read created file',
        );
      }

      for (const { path, key } of extraOutputs) {
        try {
          extras[key] = instance.FS.readFile(path, { encoding: 'binary' });
        } catch {
          // ignore optional extra outputs
        }
      }

      return {
        fileType,
        output,
        exitCode,
        duration: Date.now() - start,
        log: this.log,
        extraOutputs: Object.keys(extras).length > 0 ? extras : undefined,
      };
    }

    throw new OpenSCADError(
      this.log.stdErr.join('\n') || 'OpenSCAD failed',
      String(exitCode),
      this.log.stdErr,
    );
  }

  escapeShell(value: string) {
    return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
}

export default OpenSCADWrapper;
