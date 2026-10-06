import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { api, type WorkbookUpload } from '../api/client.ts';
import { keys } from '../api/hooks.ts';
import { extractInBrowser } from './extractInBrowser.ts';

/**
 * The workbook upload in progress — reading the file in this browser, then the
 * server building the review. It lives at module level, not in the Import
 * screen, so switching to another tab does not kill it (client feedback round 4
 * #2): coming back shows it still running, or the finished review. Once the
 * server has the draft it also survives a page refresh (it is server-side).
 */
export type ImportJob =
  | { phase: 'idle' }
  | { phase: 'reading'; stage: 'extract' | 'server' | 'upload'; since: number; fileName: string }
  | { phase: 'failed'; message: string };

let job: ImportJob = { phase: 'idle' };
let ctl: AbortController | null = null;
const listeners = new Set<() => void>();

function set(next: ImportJob) {
  job = next;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useImportJob(): ImportJob {
  return useSyncExternalStore(subscribe, () => job);
}

/** Reads `file`, uploads it as the user's pending import, and caches the resulting draft. */
export async function startImport(file: File, qc: QueryClient, failedText: string): Promise<void> {
  ctl?.abort();
  const mine = new AbortController();
  ctl = mine;
  const since = Date.now();
  set({ phase: 'reading', stage: 'extract', since, fileName: file.name });
  try {
    let upload: WorkbookUpload;
    try {
      upload = { kind: 'extract', blob: await extractInBrowser(file, mine.signal) };
      set({ phase: 'reading', stage: 'server', since, fileName: file.name });
    } catch (e) {
      if (mine.signal.aborted) return;
      // An old browser, or a PC short on memory: send the file itself — slower,
      // same result (the server extracts it with the same code).
      console.warn('[import] reading the workbook in the browser failed; uploading the file', e);
      upload = { kind: 'file', file };
      set({ phase: 'reading', stage: 'upload', since, fileName: file.name });
    }
    const draft = await api.imports.draft.create(upload, file.name);
    if (mine.signal.aborted) {
      // Cancelled while the server was building it: discard what it stored.
      await api.imports.draft.cancel().catch(() => {});
      return;
    }
    qc.setQueryData(keys.importDraft, draft);
    set({ phase: 'idle' });
  } catch (e) {
    if (mine.signal.aborted) return;
    set({ phase: 'failed', message: e instanceof Error ? e.message : failedText });
  } finally {
    if (ctl === mine) ctl = null;
  }
}

/** Stops an upload in progress (the in-browser read is terminated; a draft the server finishes is discarded). */
export function cancelImport() {
  ctl?.abort();
  ctl = null;
  set({ phase: 'idle' });
}

export function clearImportError() {
  if (job.phase === 'failed') set({ phase: 'idle' });
}
