# RENZA AI features — start here

One page. Everything else is in `AI_MENU_IMPORT_PROGRESS.md` (long, chronological,
every bug and why it happened).

Last updated: 13 October 2026. Local development only. **Nothing is deployed and
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

## Tests: 157 passing

menuImport 26 · parseRows 24 · dietFromName 9 · pdfLayout 8 · verifyCoverage 6 ·
menuQuery filter 20 / query 13 / ask 10 · dishPhotos score 9 · adminAssistant 32

---

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
