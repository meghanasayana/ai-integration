'use client';

import { useCallback, useRef, useState } from 'react';
import {
  UploadCloud, FileText, Image as ImageIcon, AlertTriangle,
  CheckCircle2, Loader2, X, RotateCcw,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import api from '@/lib/api';
import toast from 'react-hot-toast';
import { cn } from '@/lib/utils';

const ACCEPTED = '.jpg,.jpeg,.png,.webp,.pdf';
const MAX_MB = 15;

/**
 * Two-step menu import: extract, then confirm.
 *
 * Nothing is saved until the admin presses Import. Entries the AI was unsure
 * about start unticked and carry the reason, so a bad read cannot reach the
 * database by someone clicking through quickly.
 */
export default function MenuImportDialog({ open, onOpenChange, onImported }) {
  const [stage, setStage] = useState('pick');       // pick | reading | review | saving | done
  const [file, setFile] = useState(null);
  const [dragging, setDragging] = useState(false);
  const [mode, setMode] = useState('file');         // file | text
  const [pastedText, setPastedText] = useState('');
  const [listFilter, setListFilter] = useState('all');  // all | review | ready
  const [error, setError] = useState(null);
  const [plan, setPlan] = useState(null);
  const [meta, setMeta] = useState(null);
  const [selected, setSelected] = useState({});     // index -> boolean
  const [prices, setPrices] = useState({});         // index -> corrected price string
  const [report, setReport] = useState(null);
  const inputRef = useRef(null);

  const reset = useCallback(() => {
    setStage('pick'); setFile(null); setError(null); setPlan(null);
    setMeta(null); setSelected({}); setPrices({}); setReport(null);
    setMode('file'); setPastedText(''); setListFilter('all');
  }, []);

  const close = (next) => {
    if (!next) reset();
    onOpenChange(next);
  };

  /* ------------------------------------------------------------ extract */

  const handleFile = async (chosen) => {
    if (!chosen) return;
    setError(null);

    if (chosen.size > MAX_MB * 1024 * 1024) {
      setError(`That file is ${(chosen.size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_MB}MB.`);
      return;
    }

    setFile(chosen);
    setStage('reading');

    const form = new FormData();
    form.append('menu', chosen);

    try {
      const res = await api.post('/api/restaurant/menu-import/extract', form);
      const extracted = res.data.plan;
      setPlan(extracted);
      setMeta(res.data.meta);

      // Confident entries start ticked. Anything needing review does not.
      const initial = {};
      extracted.entries.forEach((entry, i) => { initial[i] = entry.status === 'ready'; });
      setSelected(initial);
      setStage('review');
    } catch (err) {
      // Show what actually failed. This used to collapse every failure into
      // "try another file", which blamed the upload even when the server had
      // reported a precise reason, or had never answered at all.
      const served = err.response?.data?.error;
      const code = err.response?.data?.code;

      if (served) {
        setError(code ? `${served} (${code})` : served);
      } else if (err.response) {
        setError(`The server returned ${err.response.status} with no message.`);
      } else {
        setError(
          `No reply from the server: ${err.message}. ` +
          'It may still be working, or it may have stopped. Check the backend window.'
        );
      }

      setStage('pick');
    }
  };

  /**
   * Read pasted text instead of a file.
   *
   * The same endpoint shape, the same validation and the same review step - a
   * paste is not a shortcut past the checks, only a faster way in. Useful when
   * a long PDF would take minutes and one section would do.
   */
  const handleText = async () => {
    const text = pastedText.trim();
    if (text === '') {
      setError('Paste some menu text first.');
      return;
    }

    setError(null);
    setStage('reading');

    try {
      const res = await api.post('/api/restaurant/menu-import/extract-text', { text });
      const extracted = res.data.plan;
      setPlan(extracted);
      setMeta(res.data.meta);

      const initial = {};
      extracted.entries.forEach((entry, i) => { initial[i] = entry.status === 'ready'; });
      setSelected(initial);
      setStage('review');
    } catch (err) {
      const served = err.response?.data?.error;
      const code = err.response?.data?.code;

      if (served) setError(code ? `${served} (${code})` : served);
      else if (err.response) setError(`The server returned ${err.response.status} with no message.`);
      else setError(
        `No reply from the server: ${err.message}. ` +
        'It may still be working, or it may have stopped. Check the backend window.'
      );

      setStage('pick');
    }
  };

  /* ------------------------------------------------------------- commit */

  const chosenEntries = () => {
    if (!plan) return [];
    return plan.entries
      .map((entry, i) => ({ entry, i }))
      .filter(({ i }) => selected[i])
      .map(({ entry, i }) => ({
        name: entry.name,
        categoryName: entry.categoryName,
        price: prices[i] !== undefined && prices[i] !== '' ? prices[i] : entry.price,
        portions: entry.portions,
        // Whether the dish is vegetarian, worked out from its name and section.
        // Without this the server never receives it and every imported dish
        // falls back to the column default, which marks cakes non-vegetarian.
        isVeg: entry.isVeg,
      }));
  };

  const handleImport = async () => {
    const entries = chosenEntries();
    if (entries.length === 0) {
      toast.error('Nothing is selected to import.');
      return;
    }

    setStage('saving');
    try {
      const res = await api.post('/api/restaurant/menu-import/commit', { entries });
      setReport(res.data.summary);
      setStage('done');
      toast.success(`${res.data.summary.created} added, ${res.data.summary.updated} updated`);
      onImported?.();
    } catch (err) {
      setError(err.response?.data?.error || 'The import could not be saved.');
      setStage('review');
    }
  };

  /* --------------------------------------------------------------- view */

  const readyCount = plan ? plan.entries.filter((e) => e.status === 'ready').length : 0;
  const reviewCount = plan ? plan.entries.filter((e) => e.status !== 'ready').length : 0;

  /**
   * The entries on screen, each carrying its ORIGINAL index.
   *
   * The tick boxes and the typed-in prices are keyed by position in the full
   * list, so filtering must not renumber them - otherwise hiding the ready
   * entries would silently move every tick onto a different dish.
   */
  const visibleEntries = plan
    ? plan.entries
        .map((entry, i) => ({ entry, i }))
        .filter(({ entry }) => {
          if (listFilter === 'review') return entry.status !== 'ready';
          if (listFilter === 'ready') return entry.status === 'ready';
          return true;
        })
    : [];
  const selectedCount = Object.values(selected).filter(Boolean).length;

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent className="max-w-3xl max-h-[88vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UploadCloud className="w-5 h-5 text-orange-500" />
            Import menu from a file
          </DialogTitle>
          <DialogDescription>
            Upload a photo or PDF of your menu. Nothing is saved until you review and confirm.
          </DialogDescription>
        </DialogHeader>

        {error && (
          <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-200 bg-red-50 px-3.5 py-3 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-px flex-shrink-0" aria-hidden="true" />
            <span>{error}</span>
          </div>
        )}

        {/* ---------------------------------------------------------- pick */}
        {stage === 'pick' && (
          <div className="mb-4 flex gap-1 p-1 rounded-xl bg-slate-100">
            {[
              { id: 'file', label: 'Upload a file' },
              { id: 'text', label: 'Paste text' },
            ].map((option) => (
              <button
                key={option.id}
                type="button"
                onClick={() => { setMode(option.id); setError(null); }}
                className={cn(
                  'flex-1 text-xs font-bold py-2 rounded-lg transition-colors',
                  mode === option.id
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        )}

        {stage === 'pick' && mode === 'text' && (
          <div>
            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={10}
              maxLength={8000}
              placeholder={'Paste menu lines, one dish per line:\n\nChicken Masala 220\nKadai Chicken 230\n\nGrill Chicken   Quarter 140   Half 200   Full 420'}
              className="w-full rounded-xl border border-slate-300 bg-white p-3 text-xs
                         font-mono text-slate-900 placeholder:text-slate-400
                         focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-400"
            />
            <div className="mt-2 flex items-center justify-between gap-3">
              <p className="text-[11px] text-slate-500">
                {pastedText.length}/8000 characters &middot; a short section reads in seconds
              </p>
              <Button
                type="button"
                onClick={handleText}
                disabled={pastedText.trim() === ''}
                className="bg-gradient-to-r from-orange-500 to-teal-600 text-white font-bold rounded-xl text-xs"
              >
                Read this text
              </Button>
            </div>
            <p className="mt-3 text-[11px] text-slate-400">
              Reviewed and confirmed exactly like an uploaded file. Nothing is saved until you confirm.
            </p>
          </div>
        )}

        {stage === 'pick' && mode === 'file' && (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); handleFile(e.dataTransfer.files?.[0]); }}
            className={cn(
              'rounded-2xl border-2 border-dashed p-10 text-center transition-colors',
              dragging ? 'border-orange-400 bg-orange-50' : 'border-slate-300 bg-slate-50',
            )}
          >
            <UploadCloud className="w-10 h-10 mx-auto text-slate-400" aria-hidden="true" />
            <p className="mt-3 text-sm font-semibold text-slate-800">
              Drag a menu here, or choose a file
            </p>
            <p className="mt-1 text-xs text-slate-500">
              JPG, PNG, WebP or PDF &middot; up to {MAX_MB}MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPTED}
              className="sr-only"
              onChange={(e) => handleFile(e.target.files?.[0])}
            />
            <Button
              type="button"
              onClick={() => inputRef.current?.click()}
              className="mt-5 bg-gradient-to-r from-orange-500 to-teal-600 text-white font-bold rounded-xl"
            >
              Choose file
            </Button>
            <p className="mt-4 text-[11px] text-slate-400">
              A PDF with selectable text reads fastest. Photographs take longer.
            </p>
          </div>
        )}

        {/* ------------------------------------------------------- reading */}
        {stage === 'reading' && (
          <div className="py-12 text-center">
            <Loader2 className="w-8 h-8 mx-auto animate-spin text-orange-500" aria-hidden="true" />
            <p className="mt-4 text-sm font-semibold text-slate-800">Reading your menu…</p>
            <p className="mt-1 text-xs text-slate-500 flex items-center justify-center gap-1.5">
              {file?.type === 'application/pdf'
                ? <><FileText className="w-3.5 h-3.5" aria-hidden="true" /> {file?.name}</>
                : <><ImageIcon className="w-3.5 h-3.5" aria-hidden="true" /> {file?.name}</>}
            </p>
            <p className="mt-3 text-[11px] text-slate-400 max-w-sm mx-auto">
              Photographs are processed on this computer and can take several minutes.
              You can leave this open.
            </p>
          </div>
        )}

        {/* -------------------------------------------------------- review */}
        {(stage === 'review' || stage === 'saving') && plan && (
          <>
            {/* The counts double as filters: with 300 entries, finding the 45
                that need attention by scrolling is not realistic. */}
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <button
                type="button"
                onClick={() => setListFilter('all')}
                className={cn(
                  'px-2.5 py-1 rounded-full font-semibold transition-colors',
                  listFilter === 'all'
                    ? 'bg-slate-800 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                All {plan.entries.length}
              </button>

              <button
                type="button"
                onClick={() => setListFilter('ready')}
                className={cn(
                  'px-2.5 py-1 rounded-full font-semibold transition-colors',
                  listFilter === 'ready'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100',
                )}
              >
                {readyCount} ready
              </button>

              {reviewCount > 0 && (
                <button
                  type="button"
                  onClick={() => setListFilter('review')}
                  className={cn(
                    'px-2.5 py-1 rounded-full font-semibold transition-colors',
                    listFilter === 'review'
                      ? 'bg-amber-600 text-white'
                      : 'bg-amber-50 text-amber-700 hover:bg-amber-100',
                  )}
                >
                  {reviewCount} need review
                </button>
              )}
              {meta?.durationMs && (
                <span className="text-slate-400 ml-auto">
                  read in {(meta.durationMs / 1000).toFixed(1)}s
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto -mx-1 px-1 space-y-2 mt-1">
              {visibleEntries.length === 0 && (
                <p className="py-8 text-center text-xs text-slate-500">
                  Nothing in this view.
                </p>
              )}

              {visibleEntries.map(({ entry, i }) => {
                const blocking = entry.warnings.filter((w) => w.blocking);
                const notes = entry.warnings.filter((w) => !w.blocking);
                const needsPrice = entry.price === null;

                return (
                  <div
                    key={`${entry.name}-${i}`}
                    className={cn(
                      'rounded-xl border p-3 flex gap-3',
                      blocking.length ? 'border-amber-200 bg-amber-50/60' : 'border-slate-200 bg-white',
                    )}
                  >
                    <input
                      type="checkbox"
                      className="mt-1 w-4 h-4 accent-orange-500 flex-shrink-0"
                      checked={!!selected[i]}
                      aria-label={`Import ${entry.name}`}
                      onChange={(e) => setSelected((s) => ({ ...s, [i]: e.target.checked }))}
                    />

                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-3">
                        <p className="font-semibold text-sm text-slate-900 truncate">{entry.name}</p>
                        {!needsPrice && entry.portions.length === 0 && (
                          <span className="text-sm font-bold text-slate-700">₹{entry.price}</span>
                        )}
                      </div>

                      <p className="text-[11px] text-slate-500 mt-0.5">{entry.categoryName}</p>

                      {entry.portions.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {entry.portions.map((p) => (
                            <span key={p.portion} className="text-[11px] px-2 py-0.5 rounded-md bg-slate-100 text-slate-700">
                              {p.portion} ₹{p.price}
                            </span>
                          ))}
                        </div>
                      )}

                      {needsPrice && (
                        <label className="flex items-center gap-2 mt-2 text-xs text-slate-700">
                          Enter a price:
                          <input
                            type="text"
                            inputMode="decimal"
                            placeholder="e.g. 190"
                            value={prices[i] ?? ''}
                            onChange={(e) => setPrices((p) => ({ ...p, [i]: e.target.value }))}
                            className="w-24 h-8 rounded-lg border border-slate-300 px-2 text-sm"
                          />
                        </label>
                      )}

                      {blocking.map((w, k) => (
                        <p key={k} className="text-[11px] text-amber-800 mt-1.5 flex items-start gap-1.5">
                          <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0" aria-hidden="true" />
                          {w.message}
                        </p>
                      ))}
                      {notes.map((w, k) => (
                        <p key={k} className="text-[11px] text-slate-500 mt-1">{w.message}</p>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}

        {/* ---------------------------------------------------------- done */}
        {stage === 'done' && report && (
          <div className="py-10 text-center">
            <CheckCircle2 className="w-10 h-10 mx-auto text-emerald-500" aria-hidden="true" />
            <p className="mt-3 text-base font-bold text-slate-900">Menu imported</p>
            <div className="mt-4 inline-flex flex-wrap justify-center gap-2 text-xs">
              <Stat label="added" value={report.created} tone="emerald" />
              <Stat label="updated" value={report.updated} tone="sky" />
              <Stat label="unchanged" value={report.unchanged} tone="slate" />
              {report.categoriesCreated > 0 && <Stat label="new categories" value={report.categoriesCreated} tone="violet" />}
              {report.portionsCreated > 0 && <Stat label="portions added" value={report.portionsCreated} tone="amber" />}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2 pt-2">
          {stage === 'review' && (
            <>
              <Button variant="outline" onClick={reset} className="rounded-xl gap-1.5">
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                Choose another file
              </Button>
              <Button
                onClick={handleImport}
                disabled={selectedCount === 0}
                className="rounded-xl bg-gradient-to-r from-orange-500 to-teal-600 text-white font-bold"
              >
                Import {selectedCount} {selectedCount === 1 ? 'dish' : 'dishes'}
              </Button>
            </>
          )}

          {stage === 'saving' && (
            <Button disabled className="rounded-xl gap-2">
              <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
              Saving…
            </Button>
          )}

          {stage === 'done' && (
            <Button onClick={() => close(false)} className="rounded-xl bg-slate-900 text-white font-bold">
              Done
            </Button>
          )}

          {(stage === 'pick' || stage === 'reading') && (
            <Button variant="outline" onClick={() => close(false)} className="rounded-xl gap-1.5">
              <X className="w-3.5 h-3.5" aria-hidden="true" />
              Cancel
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    sky: 'bg-sky-50 text-sky-700',
    slate: 'bg-slate-100 text-slate-600',
    violet: 'bg-violet-50 text-violet-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <span className={cn('px-2.5 py-1 rounded-full font-semibold', tones[tone])}>
      {value} {label}
    </span>
  );
}
