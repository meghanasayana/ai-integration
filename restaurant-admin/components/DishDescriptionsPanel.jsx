'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Sparkles, Square, Check, Wand2 } from 'lucide-react';
import api from '@/lib/api';
import toast from 'react-hot-toast';

/**
 * Writing descriptions for dishes that have none.
 *
 * Runs on the server after an import, not during one: this machine generates
 * about 4.7 tokens a second, so a full menu is an hour of work. Each dish is
 * saved as it is written, so stopping costs nothing already done.
 *
 * A dish the model does not recognise is left blank on purpose. An invented
 * description reads as fact to someone with an allergy.
 */
export default function DishDescriptionsPanel({ onChanged }) {
  const [pending, setPending] = useState(null);
  const [pendingList, setPendingList] = useState([]);
  const [drafts, setDrafts] = useState({});
  const [saving, setSaving] = useState(null);
  const [ideas, setIdeas] = useState({});
  const [job, setJob] = useState(null);
  const [provider, setProvider] = useState(null);
  const timer = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.get('/api/restaurant/descriptions/status');
      setPending(res.data.pending);
      setPendingList(res.data.pendingList || []);
      setJob(res.data.job);
      setProvider(res.data.provider);
      return res.data.job;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    refresh();
    return () => clearInterval(timer.current);
  }, [refresh]);

  // Poll only while something is running.
  useEffect(() => {
    clearInterval(timer.current);
    if (!job?.running) {
      return undefined;
    }
    timer.current = setInterval(async () => {
      const latest = await refresh();
      if (latest && !latest.running) {
        clearInterval(timer.current);
        onChanged?.();
      }
    }, 2500);
    return () => clearInterval(timer.current);
  }, [job?.running, refresh, onChanged]);

  const start = async () => {
    try {
      const res = await api.post('/api/restaurant/descriptions/start');
      setJob(res.data.job);
      toast.success('Writing descriptions. You can keep working.');
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not start.');
      refresh();
    }
  };

  const stop = async () => {
    try {
      await api.post('/api/restaurant/descriptions/stop');
      toast('Stopping after the current dish.');
      refresh();
    } catch {
      toast.error('Could not stop it.');
    }
  };

  /**
   * Ask for a few ways of describing one dish.
   *
   * The automatic pass throws a line away when it runs long or phrases itself
   * badly, so a dish the model knew perfectly well ends up blank. This asks
   * again for three and shows all of them, each marked with whatever is wrong
   * with it, so a person decides rather than a word count.
   */
  const askSuggestions = async (dish) => {
    setIdeas((all) => ({ ...all, [dish.id]: { loading: true, options: [] } }));
    try {
      const res = await api.post(`/api/restaurant/descriptions/${dish.id}/suggest`);
      setIdeas((all) => ({
        ...all,
        [dish.id]: { loading: false, known: res.data.known, options: res.data.options || [] },
      }));
    } catch (err) {
      setIdeas((all) => ({ ...all, [dish.id]: { loading: false, options: [] } }));
      toast.error(err.response?.data?.error || 'Could not get any suggestions.');
    }
  };

  /** Save one description written by hand, and take that dish off the list. */
  const saveOne = async (dish) => {
    // _text is set when an option was tapped: setDrafts has not applied yet
    // at that point, so the chosen line is handed over directly.
    const text = String(dish._text ?? drafts[dish.id] ?? '').trim();
    if (text === '') return;

    setSaving(dish.id);
    try {
      await api.patch(`/api/restaurant/descriptions/${dish.id}`, { description: text });
      setPendingList((list) => list.filter((d) => d.id !== dish.id));
      setPending((n) => Math.max(0, (n ?? 1) - 1));
      setDrafts((all) => {
        const next = { ...all };
        delete next[dish.id];
        return next;
      });
      onChanged?.();
    } catch (err) {
      toast.error(err.response?.data?.error || 'Could not save that.');
    } finally {
      setSaving(null);
    }
  };

  if (pending === null) return null;

  const running = job?.running;

  /**
   * How long the rest will take, measured rather than assumed.
   *
   * A fixed seconds-per-dish guess was wrong twice over: it counted only the
   * words the model writes and ignored the time spent reading the prompt.
   * Once a few dishes are done the job knows its own speed, so use that and
   * fall back to a conservative 17 seconds only before there is anything to
   * measure.
   */
  const elapsedMs = job?.startedAt ? Date.now() - new Date(job.startedAt).getTime() : 0;
  // Before anything has been measured, guess from which provider is set up:
  // this machine manages about one dish every 17 seconds, a hosted endpoint
  // roughly one a second once the library has taken its share.
  const guess = provider?.fast ? 1 : 17;
  const perDish = job?.done > 2 ? elapsedMs / job.done / 1000 : guess;
  const remaining = running ? job.total - job.done : pending;
  const totalMinutes = Math.round((remaining * perDish) / 60);

  const howLong =
    totalMinutes >= 90
      ? `about ${(totalMinutes / 60).toFixed(1)} hours`
      : `about ${Math.max(1, totalMinutes)} minute${totalMinutes === 1 ? '' : 's'}`;

  // After a run, what is left is what the model would not guess at. Before
  // one, it is simply everything not yet written. The wording says which.
  const hasRun = Boolean(job && !running && job.total > 0);

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3 flex flex-wrap items-center gap-3">
      <Sparkles className="w-4 h-4 text-orange-500 flex-shrink-0" aria-hidden="true" />

      <div className="min-w-0 flex-1">
        {running ? (
          <>
            <p className="text-sm font-semibold text-slate-900">
              Writing descriptions — {job.done} of {job.total}
            </p>
            <p className="text-[11px] text-slate-500 truncate">
              {job.written} written ({job.fromLibrary} instant, {job.fromModel} by AI)
              &middot; {job.skipped} left blank &middot; {howLong} left
              {job.current ? ` · now: ${job.current}` : ''}
            </p>
          </>
        ) : (
          <>
            <p className="text-sm font-semibold text-slate-900">
              {pending === 0
                ? 'Every dish has a description'
                : `${pending} dish${pending === 1 ? '' : 'es'} without a description`}
            </p>
            <p className="text-[11px] text-slate-500">
              {pending === 0
                ? 'Nothing to write.'
                : hasRun
                  ? 'The AI did not recognise these. Write them below — each saves as you go.'
                  : provider?.fast
                    ? `Roughly ${howLong}. Dishes it does not recognise are left blank.`
                    : `Roughly ${howLong} on this machine — leave it running. Dishes it does not recognise are left blank.`}
            </p>
          </>
        )}

        {!running && provider && !provider.fast && pending > 0 && (
          <p className="text-[11px] text-slate-400 mt-0.5">
            Running on this laptop. Setting DESCRIPTION_API_KEY in the backend
            .env switches it to a hosted service and makes it minutes instead.
          </p>
        )}

        {job?.stoppedBecause && !running && (
          <p className="text-[11px] text-amber-700 mt-0.5">Stopped: {job.stoppedBecause}</p>
        )}
      </div>

      {running ? (
        <button
          type="button"
          onClick={stop}
          className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg
                     border border-slate-300 text-slate-700 hover:bg-slate-100"
        >
          <Square className="w-3 h-3" aria-hidden="true" />
          Stop
        </button>
      ) : (
        pending > 0 && (
          <button
            type="button"
            onClick={start}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-500 text-white hover:bg-orange-600"
          >
            {hasRun ? 'Try again' : 'Write them'}
          </button>
        )
      )}

      {/*
        Every dish still without a description, named, with somewhere to write
        it. The whole list is here however long it is - a menu where the AI
        recognised little needs all of them, because that is the only way to
        finish it - and it scrolls rather than pushing the menu off the page.
      */}
      {!running && pendingList.length > 0 && (
        <div className="w-full border-t border-slate-100 pt-2 mt-1">
          <p className="text-[11px] font-semibold text-slate-600 mb-1.5">
            Write {pendingList.length === 1 ? 'this one' : `these ${pendingList.length}`} yourself
          </p>

          <div className="max-h-72 overflow-y-auto pr-1 space-y-1.5">
            {pendingList.map((dish) => (
              <div key={dish.id}>
              <div className="flex items-start gap-2">
                <div className="w-40 flex-shrink-0 pt-1.5">
                  <p className="text-xs font-medium text-slate-800 leading-tight">{dish.name}</p>
                  {dish.category && (
                    <p className="text-[10px] text-slate-400 leading-tight">{dish.category}</p>
                  )}
                </div>

                <textarea
                  rows={1}
                  value={drafts[dish.id] || ''}
                  onChange={(e) => setDrafts((all) => ({ ...all, [dish.id]: e.target.value }))}
                  onKeyDown={(e) => {
                    // Enter saves, so a whole list can be typed straight
                    // through. Shift+Enter still makes a new line.
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      saveOne(dish);
                    }
                  }}
                  placeholder="One line: what it is, how it is made."
                  className="flex-1 min-w-0 text-xs rounded-lg border border-slate-200 px-2 py-1.5
                             resize-y focus:outline-none focus:ring-1 focus:ring-orange-400"
                />

                <button
                  type="button"
                  onClick={() => askSuggestions(dish)}
                  disabled={ideas[dish.id]?.loading}
                  title="Ask the AI for a few versions to choose from"
                  className="flex-shrink-0 mt-0.5 flex items-center gap-1 text-[11px] font-semibold
                             px-2 py-1.5 rounded-lg border border-slate-300 text-slate-700
                             hover:bg-slate-100 disabled:text-slate-400"
                >
                  <Wand2 className="w-3 h-3" aria-hidden="true" />
                  {ideas[dish.id]?.loading ? '…' : 'Ideas'}
                </button>

                <button
                  type="button"
                  onClick={() => saveOne(dish)}
                  disabled={saving === dish.id || !(drafts[dish.id] || '').trim()}
                  className="flex-shrink-0 mt-0.5 flex items-center gap-1 text-[11px] font-semibold
                             px-2 py-1.5 rounded-lg bg-slate-900 text-white
                             disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <Check className="w-3 h-3" aria-hidden="true" />
                  {saving === dish.id ? '…' : 'Save'}
                </button>
              </div>

              {/*
                What the AI would have written, for a person to choose between.
                A line that is a few words over the house style is shown with
                that said plainly rather than hidden - the admin knows the dish
                and can take it or trim it. Tapping one saves it.
              */}
              {ideas[dish.id] && !ideas[dish.id].loading && (
                <div className="ml-42 pl-0 mt-1 mb-2 space-y-1">
                  {ideas[dish.id].options.length === 0 ? (
                    <p className="text-[10px] text-slate-400 italic">
                      The AI does not know this dish — write it yourself.
                    </p>
                  ) : (
                    <>
                      <p className="text-[10px] text-slate-400">Tap one to use it:</p>
                      {ideas[dish.id].options.map((option, i) => (
                        <button
                          key={i}
                          type="button"
                          onClick={() => {
                            setDrafts((all) => ({ ...all, [dish.id]: option.text }));
                            saveOne({ ...dish, _text: option.text });
                          }}
                          className="block w-full text-left text-[11px] rounded-lg border
                                     border-slate-200 px-2 py-1.5 hover:border-orange-400
                                     hover:bg-orange-50"
                        >
                          <span className="text-slate-700">{option.text}</span>
                          {option.note && (
                            <span className="block text-[10px] text-amber-700 mt-0.5">{option.note}</span>
                          )}
                        </button>
                      ))}
                    </>
                  )}
                </div>
              )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
