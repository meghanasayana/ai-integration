'use client';

/**
 * Menu assistant: ask a question, get the matching dishes.
 *
 * Read-only. The endpoint behind it has no write path, so no question can
 * change a dish. Every name, price and image shown here is read from the
 * database; the model, when it is used, only decides what to search for.
 *
 * Results are shown as dish cards rather than a list of names, because on a
 * menu screen the answer to "what is under 250" is the food, not its label.
 */

import { useState } from 'react';
import Image from 'next/image';
import { Sparkles, Search, Zap, Brain, AlertCircle, UtensilsCrossed } from 'lucide-react';
import { Button } from '@/components/ui/button';
import api from '@/lib/api';
import { cn } from '@/lib/utils';

/**
 * Uploaded images are stored as a path, not a URL, so they need the backend
 * prefix - the same resolution the menu list does. Anything that still is not
 * absolute is left out rather than handed to next/image, which throws on a
 * relative src and would take the whole panel down with it.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000';

function imageSrc(item) {
  const raw = item.imageUrl || item.image || item.topViewImageUrl;
  if (!raw) return null;
  if (raw.startsWith('http')) return raw;
  if (raw.startsWith('/')) return `${API_URL}${raw}`;
  return null;
}

const EXAMPLES = [
  'What all are vegan',
  'Foods under 250',
  'Non veg starters',
  'Cheapest dishes',
  'Something not too spicy',
];

/** Prisma Decimal, number or string -> a number. */
function toNumber(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') return Number(value);
  if (typeof value.toNumber === 'function') return value.toNumber();
  return Number(value);
}

function money(value) {
  const n = toNumber(value);
  if (n === null || !Number.isFinite(n)) return '-';
  return '₹' + (Number.isInteger(n) ? n : n.toFixed(2));
}

function DishCard({ item }) {
  const portions = (item.portions || []).filter((p) => p.isAvailable !== false);
  const src = imageSrc(item);

  return (
    <div
      className={cn(
        'flex gap-3 p-2.5 rounded-xl border bg-white',
        item.isAvailable ? 'border-slate-200' : 'border-slate-200 opacity-60',
      )}
    >
      <div className="relative w-14 h-14 rounded-lg overflow-hidden bg-slate-100 flex-shrink-0 grid place-items-center">
        {src ? (
          <Image src={src} alt="" fill sizes="56px" className="object-cover" />
        ) : (
          <UtensilsCrossed className="w-5 h-5 text-slate-300" aria-hidden="true" />
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-start justify-between gap-2">
          <p className="text-xs font-bold text-slate-900 truncate">{item.name}</p>
          {portions.length === 0 && (
            <p className="text-xs font-black text-slate-900 flex-shrink-0">{money(item.price)}</p>
          )}
        </div>

        {portions.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {portions.map((p) => (
              <span
                key={p.portion}
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 text-slate-700"
              >
                {p.portion} {money(p.price)}
              </span>
            ))}
          </div>
        )}

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {item.category?.name && (
            <span className="text-[10px] text-slate-500">{item.category.name}</span>
          )}
          {item.isVegan ? (
            <span className="text-[10px] font-bold text-green-700">vegan</span>
          ) : item.isVeg ? (
            <span className="text-[10px] font-bold text-green-700">veg</span>
          ) : null}
          {item.isJain && <span className="text-[10px] font-bold text-amber-700">Jain</span>}
          {item.isGlutenFree && <span className="text-[10px] font-bold text-sky-700">GF</span>}
          {item.spicyLevel >= 3 && <span className="text-[10px] font-bold text-red-600">spicy</span>}
          {!item.isAvailable && (
            <span className="text-[10px] font-bold text-slate-500">sold out</span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function MenuAssistantPanel() {
  const [question, setQuestion] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  const run = async (asked) => {
    const text = (asked ?? question).trim();
    if (text === '' || busy) return;

    setQuestion(text);
    setBusy(true);
    setError(null);
    setResult(null);

    try {
      const res = await api.post('/api/restaurant/menu-assistant/ask', { question: text });
      setResult(res.data);
    } catch (err) {
      // Say what actually happened rather than a generic apology.
      const served = err.response?.data?.error;
      if (served) setError(served);
      else if (err.response) setError(`The server returned ${err.response.status}.`);
      else setError(`No reply from the server: ${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  const items = result?.items || [];

  return (
    <div className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200/80 shadow-xs">
      <div className="flex items-center gap-2">
        <span className="grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-orange-500 to-teal-600">
          <Sparkles className="w-4 h-4 text-white" />
        </span>
        <div>
          <h3 className="text-sm font-black text-slate-900 tracking-tight">Ask about the menu</h3>
          <p className="text-[11px] text-slate-500">
            Answers come from your menu data. Nothing here changes a dish.
          </p>
        </div>
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); run(); }}
        className="mt-3.5 flex flex-col sm:flex-row gap-2"
      >
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="e.g. veg dishes under 200"
            maxLength={300}
            className="w-full h-10 pl-9 pr-3 text-xs rounded-xl border border-slate-300 bg-white
                       text-slate-900 placeholder:text-slate-400
                       focus:outline-none focus:ring-2 focus:ring-orange-500/40 focus:border-orange-400"
          />
        </div>
        <Button
          type="submit"
          disabled={busy || question.trim() === ''}
          className="h-10 justify-center bg-gradient-to-r from-orange-500 to-teal-600
                     hover:from-orange-600 hover:to-teal-700 text-white font-bold
                     rounded-xl px-5 text-xs shadow-sm"
        >
          {busy ? 'Looking…' : 'Ask'}
        </Button>
      </form>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => run(example)}
            disabled={busy}
            className="text-[11px] font-semibold px-2.5 py-1 rounded-lg border border-slate-200
                       text-slate-600 hover:border-orange-300 hover:text-orange-700
                       disabled:opacity-50 transition-colors"
          >
            {example}
          </button>
        ))}
      </div>

      {error && (
        <div
          role="alert"
          className="mt-3.5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5"
        >
          <AlertCircle className="w-4 h-4 text-red-600 mt-px flex-shrink-0" />
          <p className="text-xs text-red-700">{error}</p>
        </div>
      )}

      {result && (
        <div className="mt-3.5 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          <div className="flex items-start justify-between gap-3">
            <p className="text-xs font-bold text-slate-900">{result.answer.headline}</p>

            <span
              className={cn(
                'flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md flex-shrink-0',
                result.via === 'rules'
                  ? 'bg-teal-100 text-teal-800'
                  : 'bg-violet-100 text-violet-800',
              )}
              // Named plainly: an instant answer did not need the model, and
              // pretending otherwise would misrepresent how this works.
              title={
                result.via === 'rules'
                  ? 'Understood directly from the wording, no AI model needed'
                  : 'The local AI model worked out what to search for'
              }
            >
              {result.via === 'rules'
                ? <><Zap className="w-3 h-3" /> instant</>
                : <><Brain className="w-3 h-3" /> local AI</>}
            </span>
          </div>

          {items.length > 0 && (
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {items.map((item) => (
                <DishCard key={item.id} item={item} />
              ))}
            </div>
          )}

          {/* The filter and timing still come back from the API for debugging,
              but they are developer detail and do not belong on the screen. */}
        </div>
      )}
    </div>
  );
}
