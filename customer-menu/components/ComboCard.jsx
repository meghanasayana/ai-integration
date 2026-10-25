'use client';

/**
 * One combo on the menu.
 *
 * A combo is a fixed price for a set of items, and some of those lines offer
 * a choice. The menu only displays — the diner tells the waiter which they
 * want — so the card shows the choices exactly as the printed menu writes
 * them rather than asking anyone to pick here.
 */
export default function ComboCard({ combo }) {
  const lines = Array.isArray(combo?.lines) ? combo.lines : [];

  return (
    <article className="rounded-2xl border border-[#d4b15d]/25 bg-white/[0.03] p-4 flex flex-col gap-3">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h4 className="font-display text-lg text-[#f6f2eb] font-semibold tracking-wide truncate">
            {combo.name}
          </h4>
          {combo.description ? (
            <p className="mt-0.5 text-xs text-[#f6f2eb]/60">{combo.description}</p>
          ) : null}
        </div>

        <span className="shrink-0 font-display text-lg font-bold text-[#d4b15d]">
          &#8377;{combo.price}
        </span>
      </header>

      <ul className="space-y-1.5">
        {lines.map((line, index) => {
          const options = Array.isArray(line?.options) ? line.options : [];
          const text = options.join(' or ');

          return (
            <li key={line?.id || index} className="flex gap-2 text-sm text-[#f6f2eb]/85">
              <span aria-hidden="true" className="text-[#d4b15d]/60">&bull;</span>
              <span className="min-w-0">
                {text}
                {line?.note ? (
                  <span className="text-[#f6f2eb]/50"> ({line.note})</span>
                ) : null}
              </span>
            </li>
          );
        })}
      </ul>

      <footer className="flex items-center gap-2">
        <span
          className={
            'px-1.5 py-0.5 rounded text-[10px] font-bold tracking-wide ' +
            (combo.isVeg
              ? 'bg-emerald-500/15 text-emerald-300'
              : 'bg-rose-500/15 text-rose-300')
          }
        >
          {combo.isVeg ? 'VEG' : 'NON-VEG'}
        </span>
        {combo.isAvailable === false ? (
          <span className="text-[10px] font-bold tracking-wide text-[#f6f2eb]/40">
            UNAVAILABLE
          </span>
        ) : null}
      </footer>
    </article>
  );
}
