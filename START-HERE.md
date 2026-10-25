# RENZA AI features — start here

One page. Everything else is in `AI_MENU_IMPORT_PROGRESS.md` (long, chronological,
every bug and why it happened).

Last updated: 25 October 2026. Local development only. **Nothing is deployed and
the live site and Neon production database were never touched.**

---

## Start the project

```powershell
docker start renza-dev-db                              # stops when the machine sleeps
cd C:\Users\SAYANA\Downloads\RENZA-restaurant\backend
npm run dev                                            # terminal 1, port 5000
```

```powershell
cd C:\Users\SAYANA\Downloads\RENZA-restaurant\restaurant-admin
npm run dev                                            # terminal 2, port 3002
```

Open the Ollama app if the AI paths are needed. Then:

```powershell
node scripts/doctor.js      # checks database, login, Ollama, both models
```

Admin site: http://localhost:3002 — `owner@renza.local` / `LocalDev2026!`

---

## What was built

**1. Menu import** — Menu page → *Import from file*. Two ways in:

- **Paste text** tab: paste menu lines, read in milliseconds.
- **Upload**: PDF (~4 seconds for 12 pages) or a photo (slow, see below).

Then a review screen: confident entries pre-ticked, doubtful ones unticked with a
reason. **Nothing is written until you confirm.** Re-importing the same menu
updates rather than duplicating, and never deletes.

**2. Menu assistant** — a panel on the Menu page. Ask "foods under 250", "what all
are vegan", "non veg starters", "cheapest dishes". Answers instantly from the
database and shows real dish cards. Read-only: no question can change a dish.

---

## How it actually works

The hard part of reading a menu is knowing which price belongs to which dish. A
designed PDF draws a whole column at a time, so plain text extraction gives every
dish name and then every price, with the pairing lost.

`pdfLayout.js` rebuilds each row from the x/y position of every word, so
`Chicken Masala → 220` comes back intact. `parseRows.js` then reads those rows
directly — no model. The local AI handles only what needs judgement: an
unlabelled "110 / 140", a price column with words in it, photographs.

**Why:** output generation on this machine runs at about 4.7 tokens a second, so
having a model retype a 12-page menu as JSON took around half an hour. Parsing
the same rows takes seconds.

**Describe it accurately:** layout reconstruction and a rule-based parser do the
reliable bulk, a local AI model handles ambiguity and photographs, and the
database — never the model — supplies every price. Do not call the parser AI.

---

## Useful commands

```powershell
node scripts/doctor.js                   # is everything running?
node scripts/diagnose-pdf-rows.js "x.pdf"   # how a PDF reconstructs, read-only
node scripts/test-one-page.js 5 qwen2.5:3b  # ask the model about one page
node scripts/fix-diet.js                 # veg flags, dry run (--apply to write)
node --test src/services/menuImport/__tests__/parseRows.test.js
```

---

## Tests: 238 passing

menuImport 26 · parseRows 24 · dietFromName 9 · pdfLayout 8 · verifyCoverage 6 ·
menuQuery filter 20 / query 13 / ask 10 · dishPhotos score 9 · adminAssistant 32

---

---

## Added 24-25 October 2026

### Combos

A combo is one price for a set of items, where a line may be a choice
("Chicken Biriyani / Mugual Biriyani / Chicken 65 Biriyani"). Scanzaa only
displays menus, so the card shows the choices and the diner tells the waiter.

- `combos` and `combo_lines` tables. A line holds its choices as a list: one
  entry is a fixed item, several are alternatives. `note` carries "2 pcs".
- Admin API under `/api/restaurant/combos`, and combos are served with the
  public menu.
- **The importer finds them by itself.** A combo page is a grid of boxes, so
  flat text reads straight across and merges them. `comboBoxes.js` finds each
  title by its position and gives it the lines below it in its own column.
  Any page that produced combos is then skipped by the dish parser - without
  that, "Combo - 8" became a dish called "Combo" costing 8.
- Detected words: Combo, Meal, Thali, Platter, Set Menu, Family Pack, Saver.
- Lines are stored exactly as printed. A slash is not always a simple choice:
  "Veg/Panner/Mushroom/BabyCorn/Gobi Fried Rice/Noodles" is two choices
  multiplied together, and guessing reads worse than the menu itself.
- Works on photographs too, but badly on this one: the prices sit inside
  decorative circles and OCR reads nothing from them. **Use the PDF.**

### Column splitting, which was losing 154 dishes

Two bugs in `pdfLayout.js`, both general to two-column menus:

1. **The widest gap was tried first and nothing else.** On a menu row the gap
   between a dish name and its price is often wider than the gap between the
   columns. That widest gap was correctly rejected - it tears names from
   prices - and the real column gutter, being narrower, was never tried at
   all. Now every gutter is tried on its own before combinations.
2. **One wide item closed the gutter entirely.** A heading printed across the
   page, or one dish name longer than its column, marked the whole band as
   occupied. A gutter now tolerates crossings by up to 5% of the page's items.

### Sizes printed inside the dish name

`Piri Piri Tandoori Chi. (F/H/Q)` beside `510/300/200` is one dish in three
sizes. `labelsFromName` in `portion.js` reads `(F/H/Q)`, `(F/H)`, `(S/M/L)`
and written-out `(Full/Half)`. Every part must be a size or the name is left
alone: `(B/L)` is bone and boneless, `(5 Pcs)` is a quantity. Half a match is
a guess, and a guess here sells a full plate at the quarter price.

### Limits raised

- Upload 15MB to 30MB. The Taj menu is 22MB; 15MB turned away an ordinary file.
- Import 500 to 2000 entries per commit.
- The import transaction ran under Prisma's 5-second default and could never
  have finished 655 dishes. Now 10 minutes, still one transaction so a failure
  leaves the menu untouched.

### Measured on the 13-page Taj menu

|                            | before | after |
|----------------------------|--------|-------|
| dishes read with a price   | 501    | 655   |
| rows unreadable            | 91     | 14    |
| unlabelled multiple prices | 28     | 11    |
| review list                | 119    | 25    |

The 11 are genuinely unlabelled on the printed page - "Handi parotta spl
Chicken 280/320" with nothing saying which is which. Only the restaurant knows.

### KNOWN BROKEN: category headings on two lines

Confirmed, not yet fixed. Only the last line of a wrapped heading becomes the
category, and a long dish name that wraps is mistaken for a heading and steals
the dishes under it:

```
  14  Veg Soup                    <- should be about 18
   2  Hot & Sour Veg /Mushroom /  <- a dish name read as a category
  21  Noodles)                    <- tail of "Rice ( Non - Veg / Noodles)"
  44  (Non-Veg)                   <- tail of "Indian Masala (Non-Veg)"
  21  Starters                    <- tail of "Special Non-Veg Starters"
```

Agreed next step: review in two stages - the categories found first, then the
dishes under each - so a category holding the wrong number of dishes is
obvious instead of buried in a flat list of 655.

## Files

Backend, `src/services/menuImport/`:
`pdfLayout.js` (position-based rows) · `parseRows.js` (reads rows, no model) ·
`pdfText.js` · `dietFromName.js` · `verifyCoverage.js` · `mergePages.js` ·
`buildImportPlan.js` · `importToDatabase.js` (the only file that writes) ·
`ollama.js` · `prompt.js` · `price.js` · `portion.js` · `dishName.js` ·
`validateAiOutput.js` · `fileSupport.js` · `index.js`

`src/services/menuQuery/` — the assistant: `filter.js` · `runQuery.js`
(read-only) · `answer.js` · `prompt.js` · `ask.js`

`src/services/dishPhotos/score.js` — photo matching. **Wired to nothing.**

Routes and controllers: `menuImport.*`, `menuAssistant.*`.
Admin UI: `components/MenuImportDialog.jsx`, `components/MenuAssistantPanel.jsx`.

---

## Not done — do not claim these work

1. **The full 12-page PDF has never been confirmed through the browser.** It works
   when run directly. Nobody has watched it happen in the UI.
2. `menu.controller.js` does not send `portions`, so multi-portion dishes show
   only their base price on the **customer** menu.
3. Feature 2 — an assistant that *makes* changes — has its safety layer built and
   32 tests passing, but no prompt, no route, no UI. Nothing connected.
4. **Menu photographs are slow and always will be here.** The vision model on a
   CPU takes minutes. Not fixable without a GPU or much smaller images.
5. "What all are vegan" returns nothing, correctly: vegan is a separate flag
   nothing sets, and guessing it from a dish name would be wrong to do.
6. Automatic dish photos: scoring built and tested, nothing else. Agreed design —
   one switch, off by default, only ever fills an empty photo. Blocked on a
   sample API response.

---

## Going live

Not started, and not advisable before the submission. This repo's remote is
`github.com/meghanasayana/ai-integration` on branch `ai-integration` — a personal
repo, **not** the one the live site deploys from.

Two unknowns to resolve with a senior first: which repository the live site builds
from, and who deploys it. No database migration is needed — only existing columns
were used. The catch: the AI talks to Ollama on this laptop, which a server cannot
reach, so photo import and the assistant's unusual-wording fallback would not work
in production. Everything else would.

Full steps are in `AI_MENU_IMPORT_PROGRESS.md`.
