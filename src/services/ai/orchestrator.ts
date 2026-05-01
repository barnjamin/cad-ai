import { WorkerMessageType } from '../../worker/types';
import type { ArtifactCompileReport, CadArtifact } from '../../core/types';

// Singleton worker for background compilation during the agent loop
let headlessWorker: Worker | null = null;

export function getHeadlessWorker() {
  if (!headlessWorker) {
    headlessWorker = new Worker(new URL('../../worker/worker.ts', import.meta.url), { type: 'module' });
  }
  return headlessWorker;
}

export async function compileArtifactHeadless(artifact: CadArtifact): Promise<ArtifactCompileReport> {
  return new Promise((resolve) => {
    const worker = getHeadlessWorker();
    const id = `compile-${crypto.randomUUID()}`;
    
    const handler = (event: MessageEvent) => {
      const { id: responseId, err } = event.data;
      if (responseId === id) {
        worker.removeEventListener('message', handler);
        if (err) {
          resolve({
            artifactId: artifact.id,
            codeHash: artifact.codeHash,
            status: 'error',
            errorMessage: err.message,
            stdErr: err.stdErr,
            generatedAt: Date.now(),
          });
        } else {
          resolve({
            artifactId: artifact.id,
            codeHash: artifact.codeHash,
            status: 'success',
            generatedAt: Date.now(),
          });
        }
      }
    };

    worker.addEventListener('message', handler);
    worker.postMessage({
      id,
      type: WorkerMessageType.PREVIEW,
      data: { code: artifact.code, params: artifact.parameters, fileType: 'stl' }
    });
  });
}
