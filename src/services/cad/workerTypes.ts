import type { CadParameter } from '../../core/types';
import WorkspaceFile from './WorkspaceFile';

export const enum OpenScadWorkerMessageType {
  PREVIEW = 'preview',
  EXPORT = 'export',
  FS_READ = 'fs.read',
  FS_WRITE = 'fs.write',
  FS_UNLINK = 'fs.unlink',
}

export type OpenScadWorkerRequest = {
  code: string;
  fileType: string;
  params: CadParameter[];
};

export type OpenScadWorkerResponse = {
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

export type WorkerFileRequest = {
  path: string;
  content?: WorkspaceFile | ArrayBuffer;
  type?: string;
};

export type WorkerMessage = {
  id?: string | number;
  type: OpenScadWorkerMessageType;
  data: OpenScadWorkerRequest | WorkerFileRequest;
};

export type WorkerResponseMessage = {
  id?: string | number;
  type: OpenScadWorkerMessageType;
  data: OpenScadWorkerResponse | WorkerFileRequest | boolean | null;
  err?: Error;
};
