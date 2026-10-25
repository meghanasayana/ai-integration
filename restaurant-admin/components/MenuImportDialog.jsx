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
const MAX_MB = 30;   // must match MAX_FILE_BYTES in backend fileSupport.js

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
  const [combos, setCombos] = useState([]);        // combo boxes found in the file
  const [comboPicked, setComboPicked] = useState({});  // index -> boolean
  const [comboPrices, setComboPrices] = useState({});  // index -> typed-in price
  const [portionLabels, setPortionLabels] = useState({}); // index -> label per price
  const [clearing, setClearing] = useState(null);   // null | counts | 'working'
  const inputRef = useRef(null);

  const reset = useCallback(() => {
    setStage('pick'); setFile(null); setError(null); setPlan(null);
    setMeta(null); setSelected({}); setPrices({}); setReport(null);
    setMode('file'); setPastedText(''); setListFilter('all');
    setCombos([]); setComboPicked({}); setComboPrices({}); setPortionLabels({});
    setClearing(null);
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

      // Two unlabelled prices are Regular and Special. Filled in here, shown
      // on the card, and ticked - the dish is no longer something to decide.
      const guessedLabels = {};
      extracted.entries.forEach((entry, n) => {
        const printed =
          typeof entry.price === 'string' && entry.price.includes('/')
            ? entry.price.split('/').map((p) => p.trim()).filter(Boolean)
            : [];
        if (printed.length === 2) {
          guessedLabels[n] = ['Regular', 'Special'];
          initial[n] = true;
        }
      });
      setPortionLabels(guessedLabels);
      setSelected(initial);

      // Combos found in the same file. A combo whose price could not be read
      // starts unticked, so nothing is saved at a guessed price.
      const found = res.data.combos ?? [];
      setCombos(found);
      const comboInitial = {};
      found.forEach((combo, i) => { comboInitial[i] = !combo.needsReview; });
      setComboPicked(comboInitial);

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

      // Two unlabelled prices are Regular and Special. Filled in here, shown
      // on the card, and ticked - the dish is no longer something to decide.
      const guessedLabels = {};
      extracted.entries.forEach((entry, n) => {
        const printed =
          typeof entry.price === 'string' && entry.price.includes('/')
            ? entry.price.split('/').map((p) => p.trim()).filter(Boolean)
            : [];
        if (printed.length === 2) {
          guessedLabels[n] = ['Regular', 'Special'];
          initial[n] = true;
        }
      });
      setPortionLabels(guessedLabels);
      setSelected(initial);

      // Combos found in the same file. A combo whose price could not be read
      // starts unticked, so nothing is saved at a guessed price.
      const found = res.data.combos ?? [];
      setCombos(found);
      const comboInitial = {};
      found.forEach((combo, i) => { comboInitial[i] = !combo.needsReview; });
      setComboPicked(comboInitial);

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

  /**
   * The prices a flagged dish printed, as a list.
   *
   * The parser refuses to decide what "280 / 320" means and hands back exactly
   * what the menu printed. Only the restaurant knows, so the labels are asked
   * for here rather than guessed anywhere.
   */
  const pricesOf = (entry) =>
    typeof entry.price === 'string' && entry.price.includes('/')
      ? entry.price.split('/').map((p) => p.trim()).filter(Boolean)
      : [];

  /**
   * Labels assumed for a dish whose prices carry none.
   *
   * Two prices on a menu like this are Regular and Special, which the
   * restaurant confirmed. The assumption is filled in rather than applied
   * behind your back: both labels sit in editable boxes on the card, so a
   * menu that means Half and Full is two keystrokes away. Only the names are
   * assumed - both prices are kept exactly as printed.
   */
  const defaultLabelsFor = (entry) =>
    pricesOf(entry).length === 2 ? ['Regular', 'Special'] : null;

  // Label sets a menu actually uses, offered as one click.
  const LABEL_SETS = {
    2: [['Regular', 'Special'], ['Half', 'Full'], ['Small', 'Large']],
    3: [['Quarter', 'Half', 'Full'], ['Small', 'Medium', 'Large']],
  };

  const setLabelsFor = (index, labels) =>
    setPortionLabels((all) => ({ ...all, [index]: labels }));

  /** Give every flagged dish in the same category the same labels. */
  const applyLabelsToCategory = (index, labels) => {
    if (!plan) return;
    const category = plan.entries[index].categoryName;
    const count = labels.length;

    setPortionLabels((all) => {
      const next = { ...all };
      plan.entries.forEach((entry, j) => {
        if (entry.categoryName === category && pricesOf(entry).length === count) {
          next[j] = labels;
        }
      });
      return next;
    });
  };

  /* ------------------------------------------------- clearing the menu */

  const askToClear = async () => {
    try {
      const res = await api.get('/api/restaurant/menu-import/summary');
      setClearing(res.data);
    } catch {
      toast.error('Could not check what is on the menu.');
    }
  };

  const clearMenu = async () => {
    setClearing('working');
    try {
      const res = await api.delete('/api/restaurant/menu-import/all', {
        data: { confirm: true },
      });
      const { dishes, categories, combos } = res.data.removed;
      toast.success(`Removed ${dishes} dishes, ${categories} categories, ${combos} combos`);
      setClearing(null);
      onImported?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'The menu could not be cleared.');
      setClearing(null);
    }
  };

  const chosenEntries = () => {
    if (!plan) return [];
    return plan.entries
      .map((entry, i) => ({ entry, i }))
      .filter(({ i }) => selected[i])
      .map(({ entry, i }) => {
        // Labels typed in here turn "280 / 320" into real portions.
        const printed = pricesOf(entry);
        const labels = portionLabels[i];
        const labelled =
          printed.length > 1 && labels && labels.length === printed.length
            ? printed.map((price, n) => ({ portion: labels[n], price }))
            : null;

        return {
        name: entry.name,
        categoryName: entry.categoryName,
        price: labelled ? null : (prices[i] !== undefined && prices[i] !== '' ? prices[i] : entry.price),
        portions: labelled || entry.portions,
        // Whether the dish is vegetarian, worked out from its name and section.
        // Without this the server never receives it and every imported dish
        // falls back to the column default, which marks cakes non-vegetarian.
        isVeg: entry.isVeg,
        };
      });
  };

  const chosenCombos = () =>
    combos
      .map((combo, i) => ({ combo, i }))
      .filter(({ i }) => comboPicked[i])
      .map(({ combo, i }) => ({
        name: combo.name,
        price: comboPrices[i] !== undefined && comboPrices[i] !== '' ? comboPrices[i] : combo.price,
        lines: combo.lines,
        isVeg: combo.isVeg,
        sortOrder: combo.sortOrder,
      }))
      .filter((combo) => combo.price !== null && combo.price !== undefined && combo.price !== '');

  const handleImport = async () => {
    const entries = chosenEntries();
    const pickedCombos = chosenCombos();

    if (entries.length === 0 && pickedCombos.length === 0) {
      toast.error('Nothing is selected to import.');
      return;
    }

    setStage('saving');
    try {
      const res = await api.post('/api/restaurant/menu-import/commit', {
        entries,
        combos: pickedCombos,
      });
      setReport(res.data.summary);
      setStage('done');

      const added = res.data.summary.created + (res.data.summary.combosCreated ?? 0);
      const changed = res.data.summary.updated + (res.data.summary.combosUpdated ?? 0);
      toast.success(`${added} added, ${changed} updated`);
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

            {/* Emptying the menu before a fresh import. Kept here because
                this is where you are when you decide the last one was wrong,
                and kept visually quiet because there is no undo. */}
            <div className="mt-4 pt-3 border-t border-slate-200">
              {clearing === null && (
                <button
                  type="button"
                  onClick={askToClear}
                  className="text-xs font-semibold text-rose-700 hover:text-rose-800 hover:underline"
                >
                  Clear the whole menu first
                </button>
              )}

              {clearing === 'working' && (
                <p className="text-xs text-slate-600">Clearing…</p>
              )}

              {clearing && clearing !== 'working' && (
                <div className="rounded-xl border border-rose-200 bg-rose-50 p-3">
                  <p className="text-xs font-semibold text-rose-900">
                    Delete {clearing.dishes} dishes, {clearing.categories} categories
                    and {clearing.combos} combos?
                  </p>
                  <p className="text-[11px] text-rose-800 mt-0.5">
                    This cannot be undone.
                  </p>
                  <div className="flex gap-2 mt-2">
                    <button
                      type="button"
                      onClick={clearMenu}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700"
                    >
                      Yes, clear it
                    </button>
                    <button
                      type="button"
                      onClick={() => setClearing(null)}
                      className="text-xs font-semibold px-3 py-1.5 rounded-lg border border-slate-300 text-slate-700 hover:bg-slate-100"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
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
              {/* Combos are their own kind of thing: one price for a set of
                  items, where a line may offer a choice. They go to the
                  combos section of the menu, not into a dish category. */}
              {combos.length > 0 && (
                <div className="rounded-xl border border-violet-200 bg-violet-50/60 p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-violet-700">
                      {combos.length} combo{combos.length === 1 ? '' : 's'} found
                    </p>
                    <button
                      type="button"
                      className="text-xs font-semibold text-violet-700 hover:underline"
                      onClick={() => {
                        const allOn = combos.every((_, i) => comboPicked[i]);
                        const next = {};
                        combos.forEach((_, i) => { next[i] = !allOn; });
                        setComboPicked(next);
                      }}
                    >
                      {combos.every((_, i) => comboPicked[i]) ? 'Clear all' : 'Select all'}
                    </button>
                  </div>

                  {combos.map((combo, i) => {
                    const typed = comboPrices[i];
                    const needsPrice = combo.price === null || combo.price === undefined;

                    return (
                      <div
                        key={`combo-${combo.name}-${i}`}
                        className="rounded-lg border border-violet-200 bg-white p-2.5 flex gap-3"
                      >
                        <input
                          type="checkbox"
                          className="mt-1 w-4 h-4 accent-violet-600 flex-shrink-0"
                          checked={!!comboPicked[i]}
                          aria-label={`Import ${combo.name}`}
                          onChange={(e) =>
                            setComboPicked((picked) => ({ ...picked, [i]: e.target.checked }))
                          }
                        />

                        <div className="min-w-0 flex-1">
                          <div className="flex items-baseline justify-between gap-3">
                            <p className="font-semibold text-sm text-slate-900 truncate">
                              {combo.name}
                            </p>
                            {needsPrice ? (
                              <input
                                type="number"
                                inputMode="numeric"
                                placeholder="price"
                                value={typed ?? ''}
                                onChange={(e) =>
                                  setComboPrices((prev) => ({ ...prev, [i]: e.target.value }))
                                }
                                className="w-20 rounded border border-amber-300 px-1.5 py-0.5 text-sm text-right"
                              />
                            ) : (
                              <span className="text-sm font-bold text-slate-700">
                                &#8377;{combo.price}
                              </span>
                            )}
                          </div>

                          <ul className="mt-1 space-y-0.5">
                            {combo.lines.map((line, n) => (
                              <li key={n} className="text-xs text-slate-600">
                                &bull; {line}
                              </li>
                            ))}
                          </ul>

                          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                            <span
                              className={cn(
                                'px-1.5 py-0.5 rounded text-[10px] font-bold',
                                combo.isVeg
                                  ? 'bg-emerald-100 text-emerald-700'
                                  : 'bg-rose-100 text-rose-700',
                              )}
                            >
                              {combo.isVeg ? 'VEG' : 'NON-VEG'}
                            </span>
                            {combo.page && (
                              <span className="text-[10px] text-slate-400">page {combo.page}</span>
                            )}
                            {combo.reason && (
                              <span className="text-[10px] font-semibold text-amber-700">
                                {combo.reason}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {visibleEntries.length === 0 && combos.length === 0 && (
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

                      {/* Two or more prices with nothing on the menu to say
                          what they are. The parser will not guess; you say it
                          once and it applies to the whole section. */}
                      {pricesOf(entry).length > 1 && (() => {
                        const printed = pricesOf(entry);
                        const chosen = portionLabels[i] || [];
                        const sets = LABEL_SETS[printed.length] || [];

                        return (
                          <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50/70 p-2">
                            <p className="text-[11px] font-semibold text-amber-900">
                              What do these prices mean?
                            </p>

                            <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                              {printed.map((price, n) => (
                                <span key={n} className="flex items-center gap-1">
                                  <input
                                    type="text"
                                    placeholder="label"
                                    value={chosen[n] ?? ''}
                                    onChange={(e) => {
                                      const next = [...printed.map((_, k) => chosen[k] ?? '')];
                                      next[n] = e.target.value;
                                      setLabelsFor(i, next);
                                    }}
                                    className="w-20 h-7 rounded border border-amber-300 px-1.5 text-xs"
                                  />
                                  <span className="text-xs font-bold text-slate-700">&#8377;{price}</span>
                                </span>
                              ))}
                            </div>

                            {sets.length > 0 && (
                              <div className="flex flex-wrap gap-1.5 mt-1.5">
                                {sets.map((set) => (
                                  <button
                                    key={set.join('/')}
                                    type="button"
                                    onClick={() => setLabelsFor(i, set)}
                                    className="text-[11px] px-2 py-0.5 rounded-full bg-white border border-amber-300
                                               text-amber-900 hover:bg-amber-100"
                                  >
                                    {set.join(' / ')}
                                  </button>
                                ))}
                              </div>
                            )}

                            {chosen.length === printed.length && chosen.every(Boolean) && (
                              <button
                                type="button"
                                onClick={() => applyLabelsToCategory(i, chosen)}
                                className="mt-1.5 text-[11px] font-semibold text-amber-900 underline"
                              >
                                Use these for every dish in {entry.categoryName}
                              </button>
                            )}
                          </div>
                        );
                      })()}

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
              {report.combosCreated > 0 && <Stat label="combos added" value={report.combosCreated} tone="violet" />}
              {report.combosUpdated > 0 && <Stat label="combos updated" value={report.combosUpdated} tone="sky" />}
              {report.combosRejected > 0 && <Stat label="combos skipped" value={report.combosRejected} tone="amber" />}
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
