# RENZA — AI Menu Import: Progress Checkpoint

**Last updated:** 2026-10-10
**Status:** In progress. Core extraction logic built and unit-tested. AI image
reading NOT yet verified end to end.

> Read this document first, then inspect the actual repository state before
> changing anything. Do not assume any item below is still true without
> checking.

---

## 1. Project

AI-powered menu import, integrated into the **existing** RENZA restaurant
management website. Not a rebuild, not a separate app.

An administrator uploads a menu image or PDF. The AI extracts dish names,
categories, prices and portion options. Validation prevents invented prices and
unsafe matches. After the admin reviews and confirms, records are imported into
the development database without duplicates, and the existing customer-facing
menu displays them correctly.

Must support: single-price dishes; quarter / half / full; small / medium /
large; half plate / full plate; piece counts; varied column layouts; multiple
categories; multi-page PDFs; and ambiguous prices that require human review.

Uses the existing local Ollama setup. No paid AI services. Existing website
functionality must be preserved.

---

## 2. Strict safety requirements

These are not suggestions. They apply to every future session.

- Work only in the local development project.
- **Never access or modify the live website or the production database.**
- The local `backend/.env` currently points at a **Neon cloud PostgreSQL
  database** (`*.neon.tech`). Treat it as production.
- Do **not** run Prisma commands (`db push`, `migrate`, `studio`, `db:seed`)
  or any database write until a separate local development database has been
  created and verified.
- Preserve all uncommitted changes. Do not reset, clean, revert or stash.
- Do not run destructive Git commands. Avoid commands that write the Git index
  where possible (see the `index.lock` note below).
- Never expose `.env` secrets in output, logs or chat.
- **Do not claim a feature or test works unless it has actually been run and
  observed.**

---

## 3. What has been done

### Inspection (complete)

- Backend (`backend/`) and admin frontend (`restaurant-admin/`) inspected.
- Branch: `ai-integration`. Last commit: "Add AI integration with Ollama".
- Git reports ~127 modified files, but only **6 have real content changes** —
  the rest is CRLF line-ending churn. The 6 are:
  `backend/prisma/schema.prisma`, `restaurant-admin/app/(app)/menu/page.jsx`,
  `restaurant-admin/package.json`, `backend/src/controllers/ai.controller.js`,
  and two `package-lock.json` files. **All must be preserved.**
- `backend/.env` contains **only** `DATABASE_URL`. Missing: `JWT_SECRET`,
  `PORT`, `FRONTEND_URL`, `BACKEND_URL`, `CUSTOMER_URL`, `CLOUDINARY_*`,
  `SUPER_ADMIN_*`.
- `JWT_SECRET` has **no fallback** (`auth.controller.js` line 42), so local
  login currently fails regardless of the database.
- `middleware/auth.js` calls `prisma.user.findUnique` on **every** request.
  Therefore **no authenticated endpoint can be tested without a database.**
- There is **no `prisma/migrations/` folder** — the project uses `db push`,
  which applies schema changes directly to whatever `DATABASE_URL` points at.
- Relevant schema (unchanged, no migration needed):
  - `FoodItem` — `name`, `price` (Decimal, **NOT NULL**), `categoryId`,
    `isAvailable`, `sortOrder`
  - `FoodItemPortion` — `portion`, `price`, with
    `@@unique([foodItemId, portion])` (this is what makes duplicate-safe
    portion import possible)
- Existing AI route: `POST /ai/test`, authenticated + restaurant-admin gated,
  calls `http://localhost:11434/api/generate` with model `qwen3-vl:4b`.
  Text only; no image handling.
- `middleware/upload.js` rejects PDFs and caps files at 5MB. It is shared with
  dish-photo uploads and **must not be widened**; menu import needs its own
  multer config.

### Built — new files only, nothing existing modified

```
backend/src/services/menuImport/
├── price.js              Price parsing: ₹190, 190/-, 1,250, 190.00
├── portion.js            Portion aliases -> canonical (Quarter/1/4/¼ -> quarter)
├── dishName.js           Name normalisation + similarity detection
├── validateAiOutput.js   Structural validation of model JSON (hand-written)
├── buildImportPlan.js    Extraction -> reviewable plan with warnings
├── prompt.js             The extraction instruction
├── ollama.js             Local Ollama client
├── fileSupport.js        Type/size limits (15MB, 20 pages)
├── pdfText.js            PDF text extraction (needs pdf-parse)
├── index.js              Pipeline orchestrator
└── __tests__/menuImport.test.js
backend/scripts/menu-ai-test.js    CLI harness, no DB and no login required
```

**None of these touch Prisma or the database.**

### Tested — actually run and observed

```
node --test backend/src/services/menuImport/__tests__/menuImport.test.js
=> 25 tests, 25 pass, 0 fail
```

Covers: price formats; refusal of unreadable, negative and merged prices;
portion aliases; piece counts; unfamiliar portion names; quarter/half/full
tables; base-price derivation; mixed single-price and portioned dishes;
multiple categories; ambiguous unlabelled prices; missing prices; duplicate
portions; duplicate dishes in one upload; similar-but-different names; file
type, size and empty-file rejection.

These tests found one real bug: a dish with no readable price was being marked
`ready` and would have hit the NOT NULL constraint on `FoodItem.price`. Fixed,
with a test holding it.

### Environment facts confirmed

- `qwen3-vl:4b` and `qwen3-vl:8b` are both installed.
- Ollama API responds at `http://localhost:11434` (`/api/tags` OK).
- `ollama run qwen3-vl:4b "Reply with OK"` returns `OK` for both models.
- **The model runs on CPU** (reported from `ollama ps`). This is the dominant
  performance constraint.

### The blocking problem

A direct image diagnostic against Ollama returned **HTTP 200** but an **empty
`response` field**:

| Measurement | Value |
| --- | --- |
| Total | 329.5 s |
| Prompt / image evaluation | 241.4 s |
| Generation | 61.3 s |
| Visible response | **empty** |

Generation ran for 61 seconds, so tokens *were* produced — they are not in
`response`.

**Leading hypothesis (not yet confirmed):** `qwen3-vl` is a reasoning
("thinking") model. The reasoning block consumed the entire `num_predict: 150`
budget before the visible answer began. Expect `done_reason: "length"` and a
populated `thinking` field. This is a documented Ollama issue with the qwen3
family:
- https://github.com/sipeed/picoclaw/issues/966
- https://github.com/ollama/ollama/issues/14798

**Known weakness in our own code:** `ollama.js` reads only `payload.response`.
An empty string passes its `typeof` check, flows into `validateAiOutput('')`,
fails `JSON.parse`, and reports *"The AI did not return a readable menu. Try a
clearer photo."* — which is misleading advice. The client also ignores
`thinking`, `done_reason`, `eval_count` and any `error` field.

---

## 4. NOT done — do not assume otherwise

Unless a future inspection proves otherwise, all of the following are
**incomplete and unverified**:

- Full menu extraction from a real image — **never succeeded**
- `pdf-parse` dependency — **not installed**; PDF path untested
- Upload endpoint — **does not exist**
- Admin upload UI — **does not exist**
- Database import (create / update dishes, categories, portions) — **not built**
- Duplicate prevention against existing database rows — **not built**
- Customer-menu end-to-end verification — **not done**
- Local development database — **does not exist**

---

## 5. Current stopping point

We were preparing a **cropped** menu image to make diagnostics fast, because
each full-size run costs roughly four minutes of prompt evaluation.

- `Test-Path "$HOME\Downloads\menu-crop.jpg"` returned `False`
- A directory listing showed only `menu.jpg` in Downloads
- The crop was never created; the filename issue was not resolved

So the diagnostic was run against the full-size `menu.jpg`, not a crop.

---

## 6. Next session — in this order

1. **Read this document, then inspect the real repository state.** Confirm the
   file list in section 3, the Git state, and that `.env` still points at Neon.
   Do not trust this document over what you observe.
2. **Do not repeat completed setup.** The modules and tests exist. The models
   are installed. Ollama works.
3. **Resume at the failed image diagnostic. Do not assume `menu-crop.jpg`
   exists** — check first, and create it if needed.
4. **Determine why `response` is empty.** Re-run the direct Ollama call with
   `num_predict` raised to ~1500, save the full raw JSON, and inspect every
   field: `done`, `done_reason`, `eval_count`, `response`, `thinking`, `error`.
5. **Prove the model actually reads the image**, not just that it responds:
   - Crop test: run the same prompt on two different regions; answers should
     differ and match each region.
   - Null test: run it on an image with no menu. If it confidently lists
     dishes, it is hallucinating and every extracted price is suspect.
6. If reasoning tokens are the cause, try an instruct-only tag
   (`qwen3-vl:4b-instruct` / `qwen3-vl:8b-instruct`) via the
   `OLLAMA_VISION_MODEL` environment variable — no code change needed.
7. Measure how `prompt_eval_duration` scales with image size, and decide a
   realistic per-image budget before building the UI around it.
8. Only then continue the feature, in safe phases: upload endpoint ->
   admin UI -> local database -> import -> duplicate prevention ->
   customer menu.

---

## 7. Useful commands

All are read-only or local-only. None touch the database.

```powershell
# Run the unit tests
cd "$HOME\Downloads\RENZA-restaurant\backend"
node --test src/services/menuImport/__tests__/menuImport.test.js

# Try the extractor on a file (no DB, no login)
$env:OLLAMA_TIMEOUT_MS = "1800000"
node scripts/menu-ai-test.js "C:\path\to\menu.jpg"

# Switch model without editing any file
$env:OLLAMA_VISION_MODEL = "qwen3-vl:8b-instruct"

# Check Ollama
ollama list
ollama ps                       # PROCESSOR column: GPU or CPU
Get-Content "$env:LOCALAPPDATA\Ollama\server.log" -Tail 60
```

**Note on Git:** a `git status` run from the Claude-side shell previously left
a stale `.git/index.lock` that could not be removed automatically. If Git
reports *"Unable to create index.lock: File exists"*, close any editor or Git
GUI, confirm no `git` process is running, and delete that zero-byte file
manually.

---

## 8. Environment variables this feature reads

Both are optional and have defaults. Neither is in `.env`; set them in the
PowerShell session when needed.

| Variable | Default | Purpose |
| --- | --- | --- |
| `OLLAMA_HOST` | `http://localhost:11434` | Ollama address |
| `OLLAMA_VISION_MODEL` | `qwen3-vl:4b` | Model used for extraction |
| `OLLAMA_TIMEOUT_MS` | `180000` | Request ceiling — too low for CPU inference |

---

## Session update — 12 Oct 2026

### The PDF bug is found and fixed

**Root cause.** The PDF text layer was fine. The problem was reading order:
a designed menu is drawn column by column, so plain text extraction returned
every dish name first, then every price as a separate block. The prices were
present but the name/price pairing was gone, which left the AI nothing to do
but guess. Guessed prices are worse than a failed import.

Ruled out, with evidence, on a PDF built to reproduce the failure:
- every `getText()` layout option (`cellSeparator`, `cellThreshold`,
  `lineThreshold`) — these cannot re-sort text that arrives out of order
- `getTable()` — returns 0 tables, because a designed menu has no ruled lines

**Fix.** New file `backend/src/services/menuImport/pdfLayout.js`. Every text
item in a PDF carries its own x/y position; the module ignores draw order and
rebuilds rows from position. It also splits each page at its vertical
whitespace gutters, because this menu places independent sections side by side
and grouping by y alone merged two unrelated sections onto one line.

The column split is validated, not trusted: a menu's own name/price gap is
also a vertical gutter, and splitting there would separate every name from
every price and recreate the original bug. A split is rejected unless each
substantial block still contains both words and numbers.

### Measured on the real menu (Kareem Nawab.pdf, 12 pages)

| | rows | name+price rows | interleaved rows |
|---|---|---|---|
| without column split | 356 | 287 | 95 |
| with column split    | 422 | 307 | **32** |

Interleaving down 66%. Row count rises because section headings ("Soup",
"Grill Chicken") become their own rows instead of being merged into a dish
row, which is why the percentage reads lower while the number of correctly
paired rows goes up.

### Also fixed

`ollama.js` reported "Could not reach the local AI service" for *every*
connection failure, including a connection dropping mid-request. It now
distinguishes refused / address unresolved / dropped mid-request / other, and
logs the real error code to the backend terminal.

### Added this session

- `backend/src/services/menuImport/pdfLayout.js` — position-based extraction
- `backend/scripts/diagnose-pdf-rows.js` — read-only; no DB, no AI
- `backend/test-fixtures/Kareem Nawab.pdf` — real-menu test fixture

`pdfjs-dist@5.4.296` is already installed as a pdf-parse dependency and is
used directly. It is NOT yet declared in `package.json` — see next steps.

### NOT done yet — do not assume these work

1. `pdfText.js` still returns flat text. **The upload flow does not use
   `pdfLayout.js` yet.** Only the diagnostic script does.
2. The AI prompt has not been updated for tab-separated rows.
3. `pdfjs-dist` not declared in `backend/package.json`.
4. Backend has not been restarted since `num_ctx: 16384` was added
   (`ollama ps` still showed `CONTEXT 4096`).
5. Feature 2 (admin assistant) safety layer is built and tested — 32 tests —
   but no prompt, no route, no UI. Nothing is connected.
6. `menu.controller.js` still omits `portions`, so multi-portion dishes would
   show only their base price on the customer menu.
7. No import has been run end to end through the UI.

### Next session, in order

1. Declare the dependency: `npm install pdfjs-dist@5.4.296` in `backend/`.
2. Wire `pdfLayout.js` into `pdfText.js`; keep flat text as the fallback when
   the pairing score is poor.
3. Update the prompt for tab-separated rows: first cell is the dish name, a
   header row above names the portions, a `-` means that portion is not sold.
4. Restart the backend, import the PDF through the UI, check the preview
   carefully before confirming.
5. Then feature 2, then `portions` on the customer menu.

### Honest status on images

The image path has still never succeeded on this machine: 241.4s prompt
evaluation plus 61.3s generation on 100% CPU, returning an empty response.
The PDF route avoids vision entirely and costs a fraction as much, so it is
the realistic demo path. Do not claim the image path works.

---

## Session update — 13 Oct 2026

### The model works, and a serious flaw was caught

First successful extraction on this machine. `qwen2.5:3b` (text-only) read page
5 in **138.4s** — 1169 input tokens in 42.1s, 370 output tokens in 79.1s — and
returned 17 dishes with correct prices.

**But the page held 30 dish rows in two sections.** It returned the first 17,
reported `done_reason=stop`, and said "0 needing review". All 13 Mutton Main
Course dishes were silently dropped, and the result looked complete.

Fixed by `verifyCoverage.js`: the rows sent are known, so coverage is checked
rather than trusted. Below 95% of dish rows coming back, the page is re-asked
for only the rows left out; anything still missing is reported as a failure
with the raw row text, never dropped quietly.

Two of my own bugs also found and fixed:
- `test-one-page.js` never loaded `.env`, so it used the 180s default instead
  of the configured 30 minutes and reported a working model as a timeout.
- The rows path used the **vision** model for plain text. `OLLAMA_TEXT_MODEL`
  now selects a text-only model; vision is only used for actual images.
- `MenuImportDialog` collapsed every failure into "try another file", hiding
  precise server errors. It now shows what actually happened.

### New feature: menu assistant on the admin menu page

Answers questions about the menu — "what all are vegan", "foods under 250",
"non veg starters", "cheapest dishes", "something not too spicy".

**Read-only by construction.** `src/services/menuQuery/` contains no create,
update, delete or raw query. The restaurant comes from the signed-in session,
never from the question, so no phrasing reaches another restaurant's data.

Two routes to an answer:
- **rules** (`filter.js`) — instant, no model. Covers price bounds, diets,
  spice, sections, cheapest/most expensive.
- **local AI** (`prompt.js`) — used only when the rules recognise nothing. It
  returns a ~30-token JSON filter, not a menu, so it stays quick on CPU.

Either way the database supplies every name and price. The model never says
what the menu contains. The screen shows which route answered and the exact
filter used, so an answer can be checked rather than trusted.

Files: `services/menuQuery/{filter,runQuery,answer,prompt,ask}.js`,
`controllers/menuAssistant.controller.js`, `routes/menuAssistant.routes.js`,
`components/MenuAssistantPanel.jsx`. `src/index.js` +2 lines, CRLF preserved.
Menu page +4 lines. Her existing in-progress AI dialog untouched.

### Tests: 109 passing

| suite | tests |
|---|---|
| menuImport | 25 |
| pdfLayout | 8 |
| verifyCoverage | 6 |
| menuQuery/filter | 15 |
| menuQuery/query | 13 |
| menuQuery/ask | 10 |
| adminAssistant | 32 |

### Still NOT done

1. The assistant has not been exercised against the real database through the
   browser. Tests use a stub Prisma client.
2. No full 12-page import has been run end to end.
3. `menu.controller.js` still omits `portions` on the customer menu.
4. Feature 2 (admin assistant that makes changes) remains unconnected.

### Honest note on "AI"

Rules answer the common questions; the model handles the rest. Do not describe
the rules path as AI. The accurate description is: layout reconstruction and a
rule-based filter doing the reliable work, a local AI model handling
interpretation when the wording is unusual, and the database — never the
model — supplying every fact.

---

## Session update — 13 Oct 2026 (later)

### Working, verified through the browser

**Paste text import.** Import from file → Paste text tab. Parses menu lines
directly, no model, in milliseconds. Verified end to end in the browser: 12
dishes from a real section, portions correct, nothing asking for a price.

**PDF import, about 4 seconds** for the whole 12-page menu: 331 entries, 286
ready, 45 flagged for review. Previously ~25 minutes.

**Menu assistant** on the admin menu page. Questions like "foods under 250",
"what all are vegan", "cheapest dishes" are answered instantly from the
database with no model; the local AI is used only when the wording is
unusual. Results render as dish cards with photo, price, portion chips and
dietary badges. Read-only by construction.

### The key design decision

Position reconstruction (pdfLayout.js) recovers which price belongs to which
dish. Once a row reads "Chicken Masala <TAB> 220" there is no judgement left,
so parseRows.js reads it directly. Output generation on this machine runs at
about 4.7 tokens a second, so having a model retype a 12-page menu as JSON
cost around half an hour; parsing it costs seconds.

The model still handles what it is actually better at: an unlabelled
"110 / 140", a price column containing words, photographs. Past
MENU_IMPORT_AI_LEFTOVER_LIMIT (12) unreadable rows, those rows go to the
review list instead of the model, because waiting minutes to be asked about
44 rows is worse than being shown them.

**Do not describe the parser as AI.** The accurate description: layout
reconstruction and a rule-based parser do the reliable bulk, a local AI model
handles ambiguity and photographs, and the database - never the model -
supplies every fact.

### Bugs found and fixed this session

Silent data loss, the worst class, found three times:
- Review-list rows were added to the merge input one category at a time, but
  the merge skips anything that is not a list. All 44 unreadable rows were
  discarded while every log line read correctly.
- "7 Up 60" was dropped: the name test demanded three consecutive letters.
- "Slash Suffix 240/-" was dropped: "/-" was not a recognised price, and
  unreadable rows were then filtered out of the review list as well.

Wrong results:
- Portion labels were read from the second cell onward, so "Quarter Half Full"
  lost Quarter and shifted every price one column left.
- A fix for that made "Quarter Half Full" into a category; labels now require
  two or more portion words, since "Veg" and "Full" alone are real headings.
- "1,250" parsed as two prices. "Rs. 230" was not recognised.
- "Half Kg", "250ml", "Single Scoop" were not portion labels, so every cake
  and bottled drink was wrongly sent to review.
- A dash in a merged cell ("Paneer Mandi 1100 570 -") lost the whole dish.
- A null entry from a remote list crashed the photo scorer.

My own process failures, recorded because they cost real time:
- Edited files while a 25-minute import was running; nodemon restarted the
  server and killed it. Twice.
- test-one-page.js did not load .env, so a 30-minute timeout was really 3
  minutes and a working model was reported as a failure.
- The import dialog collapsed every error into "try another file", hiding
  precise server messages.
- Told her "incorrect password" proved the database was up. It did not; the
  database was down. scripts/doctor.js now checks rather than infers.

### Tests: 143 passing

menuImport 26, parseRows 24, pdfLayout 8, verifyCoverage 6, menuQuery
filter 15 / query 13 / ask 10, dishPhotos score 9, adminAssistant 32.

### Parked, wired to nothing

`src/services/dishPhotos/score.js` scores whether a found photo matches a dish
name, rejecting wrong subjects outright (a lift for "7 Up", an album cover for
"Death By Chocolate") and returning nothing rather than a wrong photo. No API
client, no route, no UI, no schema change. Agreed design when resumed: one
switch, off by default; on means permission to attach; it only ever fills an
empty photo and never replaces one she added. Blocked on a sample response -
api.openverse.org is unreachable from both the cloud sandbox and the local
Linux VM, so her Windows side must fetch it.

### Still not done

1. No full 12-page import has been confirmed through the browser.
2. menu.controller.js still omits `portions`, so multi-portion dishes show
   only their base price on the customer menu.
3. Feature 2 (admin assistant that makes changes) - safety layer built and
   tested, 32 tests, nothing connected.
4. Photographs of menus remain slow: the vision model on a CPU takes minutes
   and that cannot be fixed without a GPU or a smaller image.

### Daily startup

1. `docker start renza-dev-db` - the container stops when the machine sleeps
   and does not restart itself.
2. Terminal 1: `cd backend` then `npm run dev`
3. Terminal 2: `cd restaurant-admin` then `npm run dev` (port 3002)
4. Ollama app open, if the AI paths are needed
5. `node scripts/doctor.js` checks all of the above and names the fix

Login: owner@renza.local / LocalDev2026!

---

## Session update — 13 Oct 2026 (evening): the veg/non-veg bug

### What she reported

Clicking "Non veg starters" in the menu assistant returned Black Forest cake.

### Three bugs behind it

**1. The wrong section was searched.** "Veg Starters" is a substring of
"non veg starters", and the category matcher took the FIRST match, so a
question about non-vegetarian starters searched the vegetarian section.
Category matching now ignores punctuation, requires whole words, and takes the
LONGEST match, so "Non-Veg Starters" beats "Veg Starters".

**2. Every imported dish was recorded non-vegetarian.** The import never set
`isVeg` and the column defaults to false, so cakes, lassi and mojitos all
counted as non-vegetarian. `dietFromName.js` now infers it from the dish name,
and from the section when the name says nothing ("Black Forest" means nothing
alone; under "Cakes" it is clear). Each decision is flagged in the review list
with its reason. When neither says anything the dish is left unset rather than
asserting a diet the menu never printed.

**3. Nearly shipped: "Non-Veg Starters" marked dishes VEGETARIAN.** The section
name contains the phrase "veg starters", so the section hint matched it.
Marking meat as vegetarian is the one error here with real consequences, since
people avoid meat for religious and ethical reasons. Negated sections are now
checked first and settle the answer, with a test asserting "Non-Veg Starters"
can never read as vegetarian.

### Rules the diet inference holds to

- A meat word in the name wins unconditionally over any vegetarian signal.
- Egg is non-vegetarian, the convention on Indian menus.
- A section is only a hint when the name says nothing, and never when the
  section is a negation or contains a meat word.
- Unclear means unset, not a guess.
- On import, the flag is set only on dishes being CREATED. An existing dish is
  never changed, because there is no column recording whether a person set it,
  so a re-import must not flip a flag someone set by hand.

### scripts/fix-diet.js

Fills in the flag for dishes imported before this existed. Dry run by default:
prints what it would change and writes nothing. `--apply` writes. Localhost
guarded, touches only `isVeg`, never deletes.

Run against the 39 dishes in the local database: 28 marked vegetarian, 1 left
alone (Plain Dum Biryani), 10 already correct. All 28 verified correct by eye.

Note: those 10 non-veg dishes were correct **by accident** - false is the
column default, not a decision. "No change needed" there does not mean
verified.

### Known gap, deliberate

"What all are vegan" returns nothing, correctly: vegan is a separate flag and
nothing sets it. Paneer, lassi and shakes are vegetarian but not vegan, and no
dish name reliably indicates vegan. Telling a vegan that a milkshake is vegan
is worse than returning nothing, so this is not inferred. Set it by hand on the
few that qualify if the question is needed for a demo.

### Tests: 157 passing

menuImport 26, parseRows 24, dietFromName 9, pdfLayout 8, verifyCoverage 6,
menuQuery filter 20 / query 13 / ask 10, dishPhotos score 9,
adminAssistant 32.

### Verified working on the local machine

- `curl http://localhost:5000/api/health` -> ok
- `node scripts/doctor.js` -> all checks PASS: database localhost, 1
  restaurant, 2 users, 14 categories, 39 dishes; Ollama running with
  qwen2.5:3b and qwen3-vl:4b installed
- Paste import, PDF import (~4s for 12 pages), menu assistant with dish cards

---

## Session update — 15 Oct 2026: images, and a cluster of layout bugs

### Images now work without the vision model

`imageOcr.js` reads a PNG or JPG with tesseract.js, which reports WHERE each
word sits - the same thing pdfjs gives for a PDF. So an image becomes another
source of positioned words and flows into the parser that already worked:

    PDF   -> pdfjs      -> words + positions -+
                                              +-> columns -> rows -> parse
    Image -> tesseract  -> words + positions -+

Seconds instead of the several minutes the vision model took on a CPU. The
vision model remains the automatic fallback when OCR finds no dishes.

One coordinate detail: an image measures y downwards, a PDF upwards. The y
values are negated in the adapter; without that the menu reads bottom-up.

Needs `npm install tesseract.js`, and an internet connection on first run to
download about 15MB of language data, which is then cached.

### Bugs found by testing a real one-page menu

**Only 2 dishes imported from a clean menu.** The menu had names far left and
prices far right, leaving a wide empty middle, which the column splitter read
as the gutter between two side-by-side sections. It split names away from
prices, and the only dishes that survived were those with a number inside the
name: "Chicken 65" imported as "Chicken" priced 65.

The guard meant to prevent this only asked whether a block contained words
somewhere and numbers somewhere - and a column of names including "Chicken 65"
passes both while pairing nothing. It now requires a share of rows carrying a
name AND its price together (`MIN_BLOCK_PAIRING`).

**"Chicken 65" lost its price even unsplit.** The name cell was being mined for
trailing digits. It is now only mined when no other cell in the row carried a
price, so "Pepper Barbeque Chicken 450 250 160" in a lone cell still splits
correctly.

**Biryani lost its Half and Full prices.** Not a biryani problem: once OCR
mistakes were tolerated, the heading "Dish" came within one letter of "Fish",
which genuinely IS a portion label on menus priced by meat. Three labels for
two price columns, no match, both prices dropped. Table headings - Dish, Item,
Name, Price, Rate - are now never portion labels.

**"Ful" and "FuII".** Reading a photo, l / I / 1 are the same few pixels.
`ocrCanon` folds those shapes together before comparing, so the whole family
matches, and `canonicalPortion` writes the label back correctly spelled -
a customer never sees "Ful".

Guardrail: the correction only fires within one edit of a real label, on words
of four letters or more. "Egg" stays a dish. Missing a label is better than
inventing one.

**The restaurant's own name imported as a dish.** A widely spaced title arrives
as several cells with no price, which looked like a dish whose price could not
be read. Capitals plus no digits anywhere is now a heading.

**The browser never sent the veg flag.** Found while adding the review filter:
`chosenEntries` did not include `isVeg`, so every dish imported through the UI
landed non-vegetarian whatever the inference decided - quietly recreating the
Black Forest bug on every future import.

### Review list filter

The counts at the top of the review screen are now buttons: All / ready / need
review. Clicking "45 need review" shows only those. Ticks and typed prices are
keyed by position in the FULL list, so filtering never renumbers them - getting
that wrong would silently move every tick onto a different dish.

### Tests: 174 passing

menuImport 26 · parseRows 32 · pdfLayout 9 · verifyCoverage 6 · dietFromName 9 ·
imageOcr 8 · menuQuery filter 20 / query 13 / ask 10 · dishPhotos score 9 ·
adminAssistant 32

### Confirmed working in the browser this session

- The 12-page PDF imports end to end (307 dishes, ~4 seconds)
- A photographed one-page menu imports via OCR
- Paste import
- The menu assistant with dish cards

### Still not done

1. `menu.controller.js` omits `portions`, so multi-portion dishes show only
   their base price on the CUSTOMER menu.
2. Feature 2 (an assistant that makes changes) - safety layer and 32 tests, but
   nothing connected.
3. Automatic dish photos - scoring built and tested, nothing wired.
4. Nothing deployed. Live site and production database untouched.

---

# 24–25 October 2026 — combos, and why 154 dishes were missing

## Combos

Asked for after a page of the Taj menu turned out to be eight combo boxes:
one price for a set of items, with some lines offering a choice.

**Decided first, before any code:** the menu only displays — there is no
ordering anywhere in the schema — so a combo needs no cart and no option
state. The card shows the choices and the diner tells the waiter. Combos get
their own section rather than sitting among the dish categories.

**Lines are stored exactly as printed.** The tempting thing is to split on
slashes, but `Veg/Panner/Mushroom/BabyCorn/Gobi Fried Rice/Noodles` is not six
options: it is five fillings times two bases, ten plates. A naive split
produces "Gobi Fried Rice" and a stray "Noodles". Printing what the menu
prints is never wrong.

**New files:** `comboBlocks.js` (parsing one box), `comboBoxes.js` (finding
the boxes by position), `comboExtract.js` (a pass over the file),
`services/combos/validate.js` and `importCombos.js`, `combo.controller.js`,
`components/ComboCard.jsx`.

### Three things that bit, in order

1. **Flat text merges the grid.** A combo page is two boxes across and four
   down, so plain extraction puts "Combo - 1" and "Combo - 2" on one line and
   neither is recognised. Fixed by finding each title's x/y and letting it
   claim the lines below it in its own column.

2. **The dish parser ate the combo page.** First real upload produced a dish
   called "Combo" priced at 8 — from "Combo - 8" — and the items inside the
   boxes scattered across the review list. The combo pass now runs *first* and
   reports which pages it claimed; those pages are removed before the dish
   parser sees them. A page belongs to one or the other, never both.

3. **I fixed the PDF path and she was uploading a photo.** The tell was in her
   own paste: "Mugual i!" and "Corindar Chicken (0)" are OCR misreads, which
   the PDF text path cannot produce. The combo pass existed only in the PDF
   branch. Now wired to OCR as well, which reports word positions already.
   Two further photo-only problems appeared: the page heading "Special Combo
   Taj" became a ninth empty box called "Combo", and Combo 4's number was read
   onto the next line so the title came out as plain "Combo". Both handled —
   a numberless title is dropped when the page numbers its combos, and a
   leading bare number is absorbed back into the title.

**Honest limit of the photo path:** on this menu it reads all eight combos and
not one price. The prices sit inside decorative orange circles and OCR returns
nothing from them. It also garbles items — "Rytha Gra", "Altam", and Combo 3
loses "Rice/Noodles". The PDF gives all eight with every price. Use the PDF.

## The 154 missing dishes

She uploaded the full menu and ~130 entries came back needing review, most of
them saying "No price could be read" for dishes that plainly had prices. The
backend log settled it:

```
parsed directly: 501 dishes in 34 categories, 28 to review, 91 for the model
91 unreadable row(s) sent to the review list rather than the model
```

85 of those 91 rows looked like this:

```
Cream of Tomato Soup | 140 | Cream of Mutton Soup | 170
Prawn - 65           | 240 | Nawabi Panner Masala | 210
```

Two columns merged into one row. Two bugs in `pdfLayout.js`, both general:

1. **Only the widest gaps were tried.** `splitIntoBlocks` ranked gutters by
   width and tried the widest first, then the widest two. On a menu row the
   gap between a dish name and its price is routinely wider than the gap
   between the two columns — page 7 offered a 62pt gap at x=207 (name to
   price) and a 40pt gap at x=286 (the real divider). The wide one was tried,
   correctly rejected because it leaves a block with no prices in it, and the
   narrow one was never tried on its own at all. Now every gutter is tried
   alone before any combination. **501 → 600 dishes.**

2. **One wide item closed the gutter.** `findGutters` marked a band covered if
   any item crossed it, so a heading printed across the page — or one dish
   name longer than its column — merged both columns. It now tolerates
   crossings by up to 5% of the page's items. Swept 3/5/6/8%: 5% is where it
   plateaus. **600 → 655 dishes, unparsed 39 → 14.**

Three tests added for the patterns rather than for this file: a name-to-price
gap wider than the gutter, a heading spanning both columns, and a genuinely
single-column page that must be left alone.

## Sizes written into the dish name

28 dishes were flagged "two or more prices with no portion labels" — mostly
`Piri Piri Tandoori Chi. (F/H/Q)` against `510/300/200`. The label was in the
name all along. `labelsFromName` in `portion.js` reads `(F/H/Q)`, `(F/H)`,
`(S/M/L)` and `(Full/Half)`, and refuses anything where a part is not a size:
`(B/L)` is bone and boneless, `(5 Pcs)` is a quantity, `(F/F)` is a misread.
17 dishes now import with real Full/Half/Quarter portions. **Ambiguous 28 → 11.**

The 11 that remain were checked against the printed page by eye. `Handi
parotta spl · Chicken · 280/320` has no label anywhere on page 2. The parser
is right to refuse; only the restaurant can say.

## Limits that were quietly wrong

- Upload capped at 15MB. The menu is 22.2MB. Raised to 30MB — in both the
  backend and the admin page, which had its own copy of the number and would
  have rejected the file before it left the browser.
- Commit capped at 500 entries. The menu parses to 655. Raised to 2000, and
  the error now names the count and the limit instead of saying "too many".
- The import transaction ran under Prisma's **5-second** default and could
  never have finished 655 dishes; it would have failed with the transaction
  already closed and told the admin only that nothing was saved. Raised to ten
  minutes, still a single transaction so a failure leaves the menu untouched.
  Found by looking rather than by her hitting it.

## Tests: 238 passing

combos validate 20 · comboBlocks 24 · comboBoxes 9 · parseRows 40 ·
pdfLayout 12 · and the rest unchanged.

## KNOWN BROKEN — category headings printed on two lines

Confirmed with a full category dump, not yet fixed:

```
  14  Veg Soup                    <- should be about 18
   2  Hot & Sour Veg /Mushroom /  <- a dish name read as a category heading
  21  Noodles)                    <- tail of "Rice ( Non - Veg / Noodles)"
  44  (Non-Veg)                   <- tail of "Indian Masala (Non-Veg)"
  21  Starters                    <- tail of "Special Non-Veg Starters"
   8  Gobi     4  Baby Corn       <- fragments of one heading
  10  Special
```

Only the last line of a wrapped heading becomes the category name, and a long
dish name that wraps is promoted to a heading and steals the dishes beneath it.

**Agreed next, in this order:**

1. Join wrapped headings, and stop a wrapping dish name becoming one. That
   alone should fix six of the broken categories.
2. Review in two stages — the categories found, with counts, then the dishes
   under each. A flat list of 655 dishes hides a category holding the wrong
   number; a list of 40 categories does not.

## Not verified

The import has still never been watched saving to the database. Everything
above is measured on parsing, the test suite, and the backend log.
