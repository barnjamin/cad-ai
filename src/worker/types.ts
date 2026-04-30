import type { Parameter } from '../types';
import WorkspaceFile from '../lib/WorkspaceFile';

export const enum WorkerMessageType {
  PREVIEW = 'preview',
  EXPORT = 'export',
  FS_READ = 'fs.read',
  FS_WRITE = 'fs.write',
  FS_UNLINK = 'fs.unlink',
}

export type OpenSCADWorkerMessageData = {
  code: string;
  fileType: string;
  params: Parameter[];
};

export type OpenSCADWorkerResponseData = {
  log: {
    stdErr: string[];
    stdOut: string[];
  };
  fileType: string;
  output: Uint8Array;
  exitCode: number;
  duration: number;
  extraOutputs?: Record<string, Uint8Array>;
};

export type FileSystemWorkerMessageData = {
  path: string;
  content?: WorkspaceFile | ArrayBuffer;
  type?: string;
};

export type WorkerMessage = {
  id?: string | number;
  type: WorkerMessageType;
  data:
    | OpenSCADWorkerMessageData
    | FileSystemWorkerMessageData;
};

export type WorkerResponseMessage = {
  id?: string | number;
  type: WorkerMessageType;
  data:
    | OpenSCADWorkerResponseData
    | FileSystemWorkerMessageData
    | boolean
    | null;
  err?: Error;
};
