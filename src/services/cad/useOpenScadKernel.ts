import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import OpenScadError from './OpenScadError';
import { OpenScadWorkerMessageType } from './workerTypes';
import type {
  OpenScadWorkerResponse,
  WorkerMessage,
  WorkerResponseMessage,
} from './workerTypes';

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export function useOpenScadKernel() {
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<OpenScadError | Error>();
  const [previewData, setPreviewData] = useState<OpenScadWorkerResponse | null>(null);
  const workerRef = useRef<Worker | null>(null);
  const pendingRequestsRef = useRef(new Map<string, PendingRequest>());
  const activePreviewRequestIdRef = useRef<string | null>(null);

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    }

    return workerRef.current;
  }, []);

  useEffect(() => {
    const worker = getWorker();

    const handleMessage = (event: MessageEvent<WorkerResponseMessage>) => {
      const requestId = event.data.id;
      if (requestId === undefined) return;

      const pendingRequest = pendingRequestsRef.current.get(String(requestId));
      if (!pendingRequest) return;

      pendingRequestsRef.current.delete(String(requestId));
      if (event.data.err) {
        pendingRequest.reject(event.data.err);
        return;
      }

      pendingRequest.resolve(event.data.data);
    };

    worker.addEventListener('message', handleMessage);
    return () => {
      worker.removeEventListener('message', handleMessage);
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRequestsRef.current.forEach((request) => request.reject(new Error('Worker terminated')));
      pendingRequestsRef.current.clear();
    };
  }, [getWorker]);

  const sendRequest = useCallback(
    <T,>(message: WorkerMessage & { id: string }) => {
      const worker = getWorker();
      return new Promise<T>((resolve, reject) => {
        pendingRequestsRef.current.set(message.id, { resolve, reject });

        const transferable: Transferable[] = [];
        const maybeContent = (message.data as { content?: ArrayBuffer }).content;
        if (maybeContent instanceof ArrayBuffer) {
          transferable.push(maybeContent);
        }

        worker.postMessage(message, transferable);
      });
    },
    [getWorker],
  );

  const compileScad = useCallback(
    (code: string) => {
      const requestId = `preview-${crypto.randomUUID()}`;
      activePreviewRequestIdRef.current = requestId;
      setIsCompiling(true);
      setError(undefined);

      void sendRequest<OpenScadWorkerResponse>({
        id: requestId,
        type: OpenScadWorkerMessageType.PREVIEW,
        data: {
          code,
          params: [],
          fileType: 'stl',
        },
      })
        .then((response) => {
          if (activePreviewRequestIdRef.current !== requestId) return;
          setPreviewData(response);
          setError(undefined);
        })
        .catch((nextError: Error) => {
          if (activePreviewRequestIdRef.current !== requestId) return;
          setPreviewData(null);
          setError(normalizeWorkerError(nextError));
        })
        .finally(() => {
          if (activePreviewRequestIdRef.current === requestId) {
            setIsCompiling(false);
          }
        });
    },
    [sendRequest],
  );

  const exportStl = useCallback(
    async (code: string) => {
      const response = await sendRequest<OpenScadWorkerResponse>({
        id: `export-${crypto.randomUUID()}`,
        type: OpenScadWorkerMessageType.EXPORT,
        data: {
          code,
          params: [],
          fileType: 'stl',
        },
      });

      return new Blob([cloneArrayBuffer(response.output)], { type: 'model/stl' });
    },
    [sendRequest],
  );

  const output = useMemo(() => {
    if (!previewData?.output) return undefined;
    return new Blob([cloneArrayBuffer(previewData.output)], {
      type: previewData.fileType === 'stl' ? 'model/stl' : 'image/svg+xml',
    });
  }, [previewData]);

  const offOutput = useMemo(() => {
    const offBytes = previewData?.extraOutputs?.off;
    if (!offBytes) return undefined;
    return new Blob([cloneArrayBuffer(offBytes)], { type: 'text/plain' });
  }, [previewData]);

  return {
    compileScad,
    exportStl,
    isCompiling,
    output,
    offOutput,
    compileLog: previewData?.log,
    fileType: previewData?.fileType as 'stl' | 'svg' | undefined,
    error,
    isError: Boolean(error),
  };
}

function normalizeWorkerError(error: Error) {
  if (error instanceof OpenScadError) return error;
  const maybeOpenScadError = error as OpenScadError;
  if (maybeOpenScadError?.name === 'OpenScadError' && Array.isArray(maybeOpenScadError.stdErr)) {
    return new OpenScadError(
      maybeOpenScadError.message,
      maybeOpenScadError.code,
      maybeOpenScadError.stdErr,
    );
  }
  return error;
}

function cloneArrayBuffer(value: Uint8Array) {
  const copy = new Uint8Array(value.byteLength);
  copy.set(value);
  return copy.buffer;
}
