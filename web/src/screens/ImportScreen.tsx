import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api,
  ApiError,
  type DraftChoices,
  type ImportChange,
  type ImportDraft,
  type ImportPreview,
  type RemovableType,
  type Role,
  type WorkbookCommitResult,
  type WorkbookPreview,
  type WorkbookSection,
} from '../api/client.ts';
import { keys, useImportDraft } from '../api/hooks.ts';
import { ConfirmDialog } from '../components/Modal.tsx';
import { useToast } from '../components/Toast.tsx';
import { useT } from '../i18n/index.tsx';
import type { StringKey } from '../i18n/strings.ts';
import { cancelImport, clearImportError, startImport, useImportJob } from '../lib/importJob.ts';

/**
 * WP §6.5 / §9 — Excel import, preview-then-commit.
 *
 * ONE upload (Arad, 2026-09-29): the office's hours workbook, דיווח שעות.xlsm,
 * carries the four master lists and the report history ("דיווחי שעות"), and the
 * office re-uploads it as it grows.
 *
 * Client feedback round 3 (2026-09-30) #3 #4 #8 — the preview is a real review
 * step: every record that will be ADDED or UPDATED is listed (with what changes),
 * and records that are in the system but no longer in the file are offered for
 * REMOVAL, each with a checkbox. Nothing is removed unless it is ticked and the
 * summary confirmation is accepted. "Removed" = deactivated / archived / closed
 * on the server, never deleted — past reports keep pointing at them.
 *
 * Client feedback round 4 (2026-10-06):
 *   #1 the browser reads the 34 MB workbook itself and uploads ~2 MB (lib/importJob);
 *   #2 the uploaded, unapproved review is kept ON THE SERVER (one per user) — it
 *      survives switching tabs and refreshing until approved, cancelled, or
 *      expired; the user's ticks are saved with it. "Cancel this upload"
 *      discards it so another file can be uploaded.
 * (Round 4 #3, duplicating rows, briefly lived here — it belongs to the hours
 * grid and moved there on 2026-10-07.)
 * Approval re-checks the stored upload against the database (server side), so
 * what is applied is current even if the data changed while it waited.
 */

const SECTION_TITLE: Record<WorkbookSection, StringKey> = {
  departments: 'import.card.departments',
  employees: 'import.card.employees',
  projects: 'import.card.projects',
  repairs: 'import.card.repairs',
  reports: 'import.card.history',
};

/** What "remove" means per list, shown next to the removal checkboxes. */
const REMOVAL_MEANING: Record<RemovableType, StringKey> = {
  employees: 'import.remove.meaning.employees',
  projects: 'import.remove.meaning.projects',
  repairs: 'import.remove.meaning.repairs',
};

const FIELD_LABEL: Record<string, StringKey> = {
  name: 'import.field.name',
  nick: 'import.field.nick',
  active: 'import.field.active',
  contractor: 'import.field.contractor',
  client: 'import.field.client',
  overhead: 'import.field.overhead',
  archived: 'import.field.archived',
  closed: 'import.field.closed',
  num: 'import.field.num',
};

const ACCEPT = '.xlsx,.xlsm,.xls';

const REMOVABLE: RemovableType[] = ['employees', 'projects', 'repairs'];
const isRemovable = (t: WorkbookSection): t is RemovableType =>
  t === 'employees' || t === 'projects' || t === 'repairs';

/** extract = reading in this browser; server = server building the review; upload = fallback, sending the whole file. */
const STAGE_TEXT: Record<'extract' | 'server' | 'upload', StringKey> = {
  extract: 'import.stage.extract',
  server: 'import.stage.server',
  upload: 'import.readingWorkbook',
};

/**
 * Nothing starts ticked: removal is opt-in, record by record (or "remove all").
 * The first real import (2026-09-30) showed why — the office's copy of the
 * workbook was older than the app's data, and a pre-ticked list removed
 * projects and tickets that were still in use.
 */
const NO_CHOICES: DraftChoices = { remove: {}, added: [] };

function normalize(c: Partial<DraftChoices> | undefined): DraftChoices {
  return {
    remove: c?.remove ?? {},
    // Duplicating rows moved to the hours grid (client feedback 2026-10-07 — it
    // was never meant for the upload review). A pending upload saved before
    // that still carries copies; dropped here, and approval always sends the
    // local choices, so they are never applied unseen.
    added: [],
  };
}

const hhmm = (iso: string) => new Date(iso).toLocaleTimeString('he-IL', { hour: '2-digit', minute: '2-digit' });

/** Everything an import can change — refreshed after approval. */
const AFFECTED = ['employees', 'projects', 'departments', 'standard', 'repairs', 'reports', 'submittedDays', 'activity'];

export function ImportScreen({ role }: { role: Role }) {
  const t = useT();
  const toast = useToast();
  const qc = useQueryClient();
  const canImport = role === 'manager' || role === 'admin';
  const inputRef = useRef<HTMLInputElement>(null);
  const job = useImportJob();
  const draftQ = useImportDraft(canImport);
  const draft = draftQ.data ?? null;
  const [failure, setFailure] = useState<string | null>(null);
  const [done, setDone] = useState<WorkbookCommitResult | null>(null);
  const [confirming, setConfirming] = useState<'commit' | 'cancel' | null>(null);
  const [busy, setBusy] = useState(false);

  /* ---- the user's choices: mirrored locally, saved to the draft on the server */

  const [choices, setChoices] = useState<DraftChoices>(NO_CHOICES);
  const choicesRef = useRef(choices);
  choicesRef.current = choices;
  // Re-seeded only when a DIFFERENT draft arrives (a refetch of the same one
  // must not undo ticks made since the last save).
  const seededFor = useRef<string | null>(null);
  useEffect(() => {
    const id = draft?.createdAt ?? null;
    if (id !== seededFor.current) {
      seededFor.current = id;
      setChoices(normalize(draft?.choices));
    }
  }, [draft]);

  const pending = useRef<DraftChoices | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Writes unsaved choices to the server; saving also pushes the draft's expiry out. */
  const flush = async () => {
    clearTimeout(saveTimer.current);
    const next = pending.current;
    pending.current = null;
    if (!next) return;
    const saved = await api.imports.draft.saveChoices(next);
    qc.setQueryData<ImportDraft | null>(keys.importDraft, (d) =>
      d ? { ...d, choices: next, updatedAt: saved.updatedAt, expiresAt: saved.expiresAt } : d
    );
  };

  const draftGone = () => {
    qc.setQueryData(keys.importDraft, null);
    setFailure(t('import.draft.expired'));
  };

  const onSaveError = (e: unknown) => {
    if (e instanceof ApiError && e.status === 404) draftGone();
    else setFailure(e instanceof Error ? e.message : t('common.saveFailed'));
  };

  // Leaving the tab must not drop the last tick: save what is pending on unmount
  // (flush reads refs and the stable query client only, so the first render's
  // closure is fine).
  useEffect(
    () => () => {
      void flush().catch(() => {});
    },
    []
  );

  const change = (fn: (c: DraftChoices) => DraftChoices) => {
    const next = fn(choicesRef.current);
    choicesRef.current = next;
    setChoices(next);
    pending.current = next;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void flush().catch(onSaveError), 400);
  };

  /* ---- actions */

  const choose = (file: File | undefined) => {
    if (inputRef.current) inputRef.current.value = '';
    if (!file) return;
    setFailure(null);
    setDone(null);
    clearImportError();
    void startImport(file, qc, t('import.failed'));
  };

  const commit = async () => {
    setConfirming(null);
    setBusy(true);
    setFailure(null);
    try {
      // The server applies the choices it holds — make sure it has the latest.
      pending.current = choicesRef.current;
      await flush();
      const result = await api.imports.draft.commit();
      qc.setQueryData(keys.importDraft, null);
      setDone(result);
      toast.show(t('import.done', { n: result.applied }));
      for (const key of AFFECTED) void qc.invalidateQueries({ queryKey: [key] });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) draftGone();
      else setFailure(e instanceof Error ? e.message : t('import.failed'));
    } finally {
      setBusy(false);
    }
  };

  const cancelDraft = async () => {
    setConfirming(null);
    clearTimeout(saveTimer.current);
    pending.current = null;
    setFailure(null);
    try {
      await api.imports.draft.cancel();
      qc.setQueryData(keys.importDraft, null);
      toast.show(t('import.draft.cancelled'));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : t('import.failed'));
    }
  };

  /* ---- removal ticks + duplicated rows */

  const toggle = (type: RemovableType, key: number, on: boolean) =>
    change((c) => {
      const s = new Set(c.remove[type] ?? []);
      if (on) s.add(key);
      else s.delete(key);
      return { ...c, remove: { ...c.remove, [type]: [...s] } };
    });
  const setAll = (type: RemovableType, all: number[], on: boolean) =>
    change((c) => ({ ...c, remove: { ...c.remove, [type]: on ? all : [] } }));


  /* ---- derived */

  const reading = job.phase === 'reading' ? job : null;
  const preview = draft?.preview ?? null;
  const selected = useMemo(() => {
    const out = {} as Record<RemovableType, Set<number>>;
    for (const type of REMOVABLE) {
      // Only keys still offered count — a stale tick on a record that is no
      // longer a removal candidate means nothing (the server ignores it too).
      const offered = new Set((preview?.sections.find((s) => s.type === type)?.removals ?? []).map((r) => r.key));
      out[type] = new Set((choices.remove[type] ?? []).filter((k) => offered.has(k)));
    }
    return out;
  }, [preview, choices.remove]);
  const removeCount = REMOVABLE.reduce((n, type) => n + selected[type].size, 0);
  const adds = preview?.counts.new ?? 0;
  const updates = preview?.counts.updated ?? 0;
  const canCommit = adds + updates + removeCount > 0;

  return (
    <div className="card">
      {!canImport && (
        <div className="mini" style={{ marginBottom: 10 }}>
          {t('import.roleNote', { role })}
        </div>
      )}

      <div className="imp">
        <span className="ico">📒</span>
        <div>
          <div className="t">{t('import.card.workbook')}</div>
          <div className="d">{t('import.desc.workbook')}</div>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          disabled={!canImport || !!reading || !!draft || busy}
          onChange={(e) => choose(e.target.files?.[0])}
        />

        <div style={{ flexBasis: '100%' }}>
          {reading && (
            <div className="mini">
              {t(STAGE_TEXT[reading.stage])} <Elapsed since={reading.since} />{' '}
              <button className="btn sm ghost" onClick={cancelImport}>
                {t('import.stage.cancel')}
              </button>
            </div>
          )}

          {job.phase === 'failed' && (
            <div className="mini" style={{ color: '#c33' }}>
              {job.message}
            </div>
          )}
          {failure && (
            <div className="mini" style={{ color: '#c33' }}>
              {failure}
            </div>
          )}
          {draftQ.isLoading && canImport && <div className="mini">{t('common.loading')}</div>}
          {draftQ.error && (
            <div className="mini" style={{ color: '#c33' }}>
              {draftQ.error instanceof Error ? draftQ.error.message : t('common.failedToLoad')}
            </div>
          )}

          {draft && preview && (
            <div className="preview">
              <div className="imp-draft">
                <span>
                  {t('import.draft.pending', { file: draft.fileName, at: hhmm(draft.createdAt), until: hhmm(draft.expiresAt) })}
                </span>
                <button className="btn sm ghost" onClick={() => setConfirming('cancel')} disabled={busy}>
                  {t('import.draft.cancel')}
                </button>
              </div>
              <div className="mini" style={{ marginBottom: 10 }}>
                <b>{t('import.review.intro')}</b>
              </div>

              {preview.sections.map((s) => (
                <SectionReview
                  key={s.type}
                  section={s}
                  creates={s.type === 'reports' ? preview.creates : null}
                  selected={isRemovable(s.type) ? selected[s.type] : null}
                  onToggle={(key, on) => isRemovable(s.type) && toggle(s.type, key, on)}
                  onAll={(on) =>
                    isRemovable(s.type) && setAll(s.type, (s.removals ?? []).map((r) => r.key), on)
                  }
                />
              ))}


              <div className="imp-summary">
                {t('import.review.summary', { add: adds, upd: updates, rem: removeCount })}
              </div>
              <button className="btn grn sm" onClick={() => setConfirming('commit')} disabled={busy || !canCommit}>
                {busy ? t('common.working') : t('import.confirm')}
              </button>{' '}
              <button className="btn sm ghost" onClick={() => setConfirming('cancel')} disabled={busy}>
                {t('import.draft.cancel')}
              </button>
            </div>
          )}

          {done && (
            <div className="mini" style={{ color: '#137333' }}>
              {t('import.doneDetail', {
                n: done.applied,
                emp: done.removed.employees.length,
                proj: done.removed.projects.length,
                fix: done.removed.repairs.length,
              })}
            </div>
          )}
        </div>
      </div>

      {confirming === 'commit' && (
        <ConfirmDialog
          message={t('import.review.confirm', { add: adds, upd: updates, rem: removeCount })}
          confirmLabel={t('import.confirm')}
          onConfirm={() => void commit()}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming === 'cancel' && (
        <ConfirmDialog
          message={t('import.draft.cancelConfirm')}
          confirmLabel={t('import.draft.cancel')}
          onConfirm={() => void cancelDraft()}
          onCancel={() => setConfirming(null)}
        />
      )}
      {toast.node}
    </div>
  );
}

/** Seconds since `since`, ticking — so a long read visibly is still working. */
function Elapsed({ since }: { since: number }) {
  const t = useT();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span style={{ color: 'var(--muted)' }}>({t('import.elapsed', { s })})</span>;
}

/* ------------------------------------------------------------ one list */

function SectionReview({
  section,
  creates,
  selected,
  onToggle,
  onAll,
}: {
  section: ImportPreview & { type: WorkbookSection };
  creates: WorkbookPreview['creates'] | null;
  selected: Set<number> | null;
  onToggle: (key: number, on: boolean) => void;
  onAll: (on: boolean) => void;
}) {
  const t = useT();
  const c = section.counts;
  const added = section.rows.filter((r) => r.status === 'new');
  const updated = section.rows.filter((r) => r.status === 'update');
  const removals = section.removals ?? [];

  return (
    <div className="imp-section">
      <div className="t">{t(SECTION_TITLE[section.type])}</div>
      <span className="tag add">{t('import.tag.new', { n: c.new })}</span>
      <span className="tag upd">{t('import.tag.updated', { n: c.updated })}</span>
      <span className="tag same">{t('import.tag.unchanged', { n: c.unchanged })}</span>
      {removals.length > 0 && <span className="tag rem">{t('import.tag.remove', { n: removals.length })}</span>}
      {c.invalid > 0 && <span className="tag err">{t('import.tag.invalid', { n: c.invalid })}</span>}

      {creates && creates.employees + creates.projects + creates.repairs > 0 && (
        <div className="mini" style={{ margin: '4px 0' }}>
          {t('import.history.creates', { emp: creates.employees, proj: creates.projects, fix: creates.repairs })}
        </div>
      )}

      {added.length > 0 && (
        <details className="imp-list">
          <summary>{t('import.list.added', { n: c.new })}</summary>
          <ul>
            {added.map((r, i) => (
              <li key={i}>{r.label}</li>
            ))}
          </ul>
          {section.rowsTruncated > 0 && <div className="mini">{t('import.moreErrors', { n: section.rowsTruncated })}</div>}
        </details>
      )}

      {updated.length > 0 && (
        <details className="imp-list">
          <summary>{t('import.list.updated', { n: c.updated })}</summary>
          <ul>
            {updated.map((r, i) => (
              <li key={i}>
                {r.label}
                {r.changes && r.changes.length > 0 && (
                  <span className="mini"> — {r.changes.map((ch) => <ChangeText key={ch.field} change={ch} />)}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {removals.length > 0 && selected && isRemovable(section.type) && (
        <details className="imp-list rem" open>
          <summary>{t('import.list.removals', { n: removals.length })}</summary>
          <div className="mini" style={{ margin: '4px 0' }}>
            {t(REMOVAL_MEANING[section.type])}
          </div>
          <label className="mini" style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={selected.size === removals.length}
              onChange={(e) => onAll(e.target.checked)}
            />
            {t('import.remove.all', { n: selected.size, total: removals.length })}
          </label>
          <ul>
            {removals.map((r) => (
              <li key={r.key}>
                <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <input type="checkbox" checked={selected.has(r.key)} onChange={(e) => onToggle(r.key, e.target.checked)} />
                  {r.label}
                </label>
                {r.warn?.includes('newer') && <span className="imp-warn">{t('import.remove.warn.newer')}</span>}
                {r.warn?.includes('recent') && (
                  <span className="imp-warn">{t('import.remove.warn.recent', { date: r.lastReport ?? '' })}</span>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {section.errors.length > 0 && (
        <details className="imp-list err">
          <summary>{t('import.list.errors', { n: c.invalid })}</summary>
          <div style={{ maxHeight: 180, overflowY: 'auto' }}>
            {section.errors.map((e, i) => (
              <div key={i} className="mini" style={{ color: '#c5221f' }}>
                {e.row > 0 ? t('import.rowN', { n: e.row }) : ''}
                {e.reason}
              </div>
            ))}
            {section.errorsTruncated > 0 && <div className="mini">{t('import.moreErrors', { n: section.errorsTruncated })}</div>}
          </div>
        </details>
      )}
    </div>
  );
}

function ChangeText({ change }: { change: ImportChange }) {
  const t = useT();
  const show = (v: unknown) =>
    v === true ? t('common.yes') : v === false ? t('common.no') : v == null ? '—' : String(v);
  const label = FIELD_LABEL[change.field];
  return (
    <span className="imp-change">
      {label ? t(label) : change.field}: {show(change.from)} → {show(change.to)}
    </span>
  );
}
