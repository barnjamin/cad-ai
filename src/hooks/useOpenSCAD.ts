import { useState, useCallback, useRef, useEffect } from 'react';
import type { WorkerMessage, WorkerResponseMessage } from '../worker/types';
import { WorkerMessageType } from '../worker/types';
import OpenSCADError from '../lib/OpenSCADError';

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (error: Error) => void;
};

export function useOpenSCAD() {
  const [isCompiling, setIsCompiling] = useState(false);
  const [error, setError] = useState<OpenSCADError | Error | undefined>();
  const [isError, setIsError] = useState(false);
  const [output, setOutput] = useState<Blob | undefined>();
  const [offOutput, setOffOutput] = useState<Blob | undefined>();
  const workerRef = useRef<Worker | null>(null);
  const pendingRequestsRef = useRef<Map<string, PendingRequest>>(new Map());

  const getWorker = useCallback(() => {
    if (!workerRef.current) {
      workerRef.current = new Worker(new URL('../worker/worker.ts', import.meta.url), {
        type: 'module',
      });
    }
    return workerRef.current;
  }, []);

  const eventHandler = useCallback((event: MessageEvent<WorkerResponseMessage>) => {
    const { id, type, err } = event.data;

    if (id && pendingRequestsRef.current.has(String(id))) {
      const pending = pendingRequestsRef.current.get(String(id))!;
      pendingRequestsRef.current.delete(String(id));
      if (err) {
        pending.reject(new Error(err.message || 'Worker operation failed'));
      } else {
        pending.resolve(event.data.data);
      }
      return;
    }

    if (type === WorkerMessageType.PREVIEW) {
      if (err) {
        setError(err);
        setIsError(true);
        setOutput(undefined);
        setOffOutput(undefined);
      } else {
        const data = event.data.data as {
          output?: Uint8Array;
          fileType?: string;
          extraOutputs?: Record<string, Uint8Array>;
        } | null;
        if (data?.output) {
          const blob = new Blob([toArrayBuffer(data.output)], {
            type: data.fileType === 'stl' ? 'model/stl' : 'image/svg+xml',
          });
          setOutput(blob);
          const offBytes = data.extraOutputs?.off;
          setOffOutput(
            offBytes ? new Blob([toArrayBuffer(offBytes)], { type: 'text/plain' }) : undefined,
          );
          setIsError(false);
          setError(undefined);
        }
      }
      setIsCompiling(false);
    }
  }, []);

  useEffect(() => {
    const worker = getWorker();
    worker.addEventListener('message', eventHandler);

    return () => {
      worker.removeEventListener('message', eventHandler);
      workerRef.current?.terminate();
      workerRef.current = null;
      pendingRequestsRef.current.forEach((pending) => {
        pending.reject(new Error('Worker terminated'));
      });
      pendingRequestsRef.current.clear();
    };
  }, [eventHandler, getWorker]);

  const sendRequest = useCallback(
    <T,>(message: WorkerMessage & { id: string }): Promise<T> => {
      const worker = getWorker();
      return new Promise<T>((resolve, reject) => {
        pendingRequestsRef.current.set(message.id, { resolve, reject });
        const transfer: Transferable[] = [];
        const maybeContent = (message.data as { content?: ArrayBuffer }).content;
        if (maybeContent instanceof ArrayBuffer) {
          transfer.push(maybeContent);
        }
        worker.postMessage(message, transfer);
      });
    },
    [getWorker],
  );

  const writeFile = useCallback(
    async (path: string, content: Blob | File): Promise<void> => {
      const arrayBuffer = await content.arrayBuffer();
      const requestId = `fs-write-${crypto.randomUUID()}`;
      await sendRequest<boolean>({
        id: requestId,
        type: WorkerMessageType.FS_WRITE,
        data: {
          path,
          content: arrayBuffer,
          type: content.type,
        },
      });
    },
    [sendRequest],
  );

  const compileScad = useCallback(
    (code: string) => {
      setIsCompiling(true);
      setError(undefined);
      setIsError(false);
      const worker = getWorker();
      const message: WorkerMessage = {
        type: WorkerMessageType.PREVIEW,
        data: { code, params: [], fileType: 'stl' },
      };
      worker.postMessage(message);
    },
    [getWorker],
  );

  const exportStl = useCallback(
    async (code: string): Promise<Blob> => {
      const requestId = `export-${crypto.randomUUID()}`;
      const data = await sendRequest<{
        output: Uint8Array;
        fileType: string;
      }>({
        id: requestId,
        type: WorkerMessageType.EXPORT,
        data: { code, params: [], fileType: 'stl' },
      });

      return new Blob([toArrayBuffer(data.output)], { type: 'model/stl' });
    },
    [sendRequest],
  );

  return {
    compileScad,
    exportStl,
    writeFile,
    isCompiling,
    output,
    offOutput,
    error,
    isError,
  };
}

function toArrayBuffer(uint8: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(uint8.byteLength);
  copy.set(uint8);
  return copy.buffer;
}
