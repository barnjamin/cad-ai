import OpenScadError from './OpenScadError';
import { OpenScadRuntime } from './openScadRuntime';
import { OpenScadWorkerMessageType } from './workerTypes';
import type {
  OpenScadWorkerRequest,
  OpenScadWorkerResponse,
  WorkerFileRequest,
  WorkerMessage,
  WorkerResponseMessage,
} from './workerTypes';

const runtime = new OpenScadRuntime();

self.onmessage = async (event: MessageEvent<WorkerMessage & { id?: string }>) => {
  const { id, type, data } = event.data;

  try {
    let responseData: OpenScadWorkerResponse | WorkerFileRequest | boolean | null = null;

    switch (type) {
      case OpenScadWorkerMessageType.PREVIEW:
        responseData = await runtime.preview(data as OpenScadWorkerRequest);
        break;
      case OpenScadWorkerMessageType.EXPORT:
        responseData = await runtime.exportFile(data as OpenScadWorkerRequest);
        break;
      case OpenScadWorkerMessageType.FS_READ:
        responseData = await runtime.readFile(data as WorkerFileRequest);
        break;
      case OpenScadWorkerMessageType.FS_WRITE:
        responseData = await runtime.writeFile(data as WorkerFileRequest);
        break;
      case OpenScadWorkerMessageType.FS_UNLINK:
        responseData = await runtime.unlinkFile(data as WorkerFileRequest);
        break;
      default:
        throw new Error(`Unsupported worker message type: ${String(type)}`);
    }

    const response: WorkerResponseMessage = {
      id,
      type,
      data: responseData,
    };

    self.postMessage(response);
  } catch (error) {
    const normalizedError =
      error instanceof OpenScadError
        ? ({
            name: error.name,
            message: error.message,
            code: error.code,
            stdErr: error.stdErr,
          } as OpenScadError)
        : error instanceof Error
          ? error
          : new Error('Unknown worker error');

    const response: WorkerResponseMessage = {
      id,
      type,
      data: null,
      err: normalizedError,
    };

    self.postMessage(response);
  }
};
