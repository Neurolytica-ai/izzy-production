/**
 * Web Worker — reads the office's hours workbook IN THE BROWSER (client feedback
 * round 4 #1: upload in ≤60s). The workbook is 34 MB, nearly all of it padding
 * and the report history; what the import uses compresses to ~2 MB. So the
 * worker extracts that (src/lib/workbook-extract — the same code the server runs
 * on a raw upload) and gzips it, off the main thread so the page stays responsive.
 */
import { extractWorkbook } from '../../../src/lib/workbook-extract.ts';

export interface ExtractRequest {
  file: File;
}

export type ExtractReply = { ok: true; gz: Blob } | { ok: false; error: string };

const reply = (r: ExtractReply) => (self as unknown as { postMessage(m: ExtractReply): void }).postMessage(r);

self.addEventListener('message', (e: MessageEvent<ExtractRequest>) => {
  void run(e.data.file).then(reply);
});

async function run(file: File): Promise<ExtractReply> {
  try {
    const extract = extractWorkbook(new Uint8Array(await file.arrayBuffer()));
    const json = new Blob([JSON.stringify(extract)]);
    const gz = await new Response(json.stream().pipeThrough(new CompressionStream('gzip'))).blob();
    return { ok: true, gz };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
