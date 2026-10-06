import type { ExtractReply } from '../workers/extractWorkbook.worker.ts';

/**
 * Reads the hours workbook in a Web Worker and resolves to the gzipped extract
 * the import endpoints accept (`kind=extract`). Rejects when the browser cannot
 * (no Worker / CompressionStream) or the read fails — e.g. a low-memory PC; the
 * caller then uploads the file itself, which is slower but gives the same result.
 * Aborting terminates the worker.
 */
export function extractInBrowser(file: File, signal: AbortSignal): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof Worker === 'undefined' || typeof CompressionStream === 'undefined') {
      reject(new Error('in-browser extraction is not supported here'));
      return;
    }
    if (signal.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const worker = new Worker(new URL('../workers/extractWorkbook.worker.ts', import.meta.url), { type: 'module' });
    const finish = () => {
      worker.terminate();
      signal.removeEventListener('abort', onAbort);
    };
    const onAbort = () => {
      finish();
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort);
    worker.onmessage = (e: MessageEvent<ExtractReply>) => {
      finish();
      if (e.data.ok) resolve(e.data.gz);
      else reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
      finish();
      reject(new Error(e.message || 'workbook worker failed'));
    };
    worker.postMessage({ file });
  });
}
