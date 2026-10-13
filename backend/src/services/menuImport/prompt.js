'use strict'

/**
 * The extraction instruction sent to the model.
 *
 * Two rules do most of the work here:
 *
 *  - When several prices sit under column headings ("Quarter | Half | Full"),
 *    the model must emit one portion per price, using the heading as the label.
 *
 *  - When several prices appear with NO heading, the model must put them in
 *    `price` as the raw text, e.g. "110 / 140". Our validator then flags that
 *    as ambiguous. This is deliberate: it is far safer for the model to hand
 *    back what it saw than to decide for itself that 110 means "half".
 */

const SCHEMA_EXAMPLE = `{
  "categories": [
    {
      "name": "Starters",
      "items": [
        { "name": "Chicken 65", "price": "190" },
        {
          "name": "Grill Chicken",
          "portions": [
            { "label": "Quarter", "price": "140" },
            { "label": "Half", "price": "200" },
            { "label": "Full", "price": "420" }
          ]
        },
        { "name": "Chicken Soup", "price": "110 / 140" }
      ]
    }
  ]
}`

const INSTRUCTION = `You are reading a restaurant menu and converting it to JSON.

Return ONLY a JSON object in exactly this shape:

${SCHEMA_EXAMPLE}

Rules you must follow:

1. Copy dish names exactly as printed. Do not correct spelling, expand
   abbreviations, or translate. "Pepper Grill" and "Peri Peri Grill" are
   different dishes.

2. Use the menu's own section headings as category names (Starters, Soups,
   Grills, Biryani, Desserts and so on). If a dish sits under no heading,
   use the category name "Uncategorised".

3. If a dish has ONE price, put it in "price" as printed.

4. If a dish has SEVERAL prices under column headings such as
   Quarter / Half / Full, or Small / Medium / Large, output one entry in
   "portions" per price and use the column heading as "label". Match each
   price to the correct column by its horizontal position.

5. If a dish has SEVERAL prices and you CANNOT tell what each one means,
   do NOT guess. Put them all in "price" as one string exactly as printed,
   for example "110 / 140".

6. Never invent a dish, a price, a portion or a category. If something is
   unreadable, leave "price" out entirely rather than estimating.

7. Include the currency digits only. Drop symbols like the rupee sign.

Return the JSON object and nothing else. No explanation, no markdown fences.`

function buildImagePrompt() {
  return INSTRUCTION
}

function buildTextPrompt(menuText) {
  return `${INSTRUCTION}

The menu text extracted from the document follows between the markers.
Work only from this text.

<<<MENU
${menuText}
MENU`
}

/**
 * Prompt for text rebuilt from item positions (see pdfLayout.js). The rows
 * carry real structure, so the model is told how to read it rather than left
 * to infer it:
 *
 *  - a tab is a cell boundary, and the first cell is the dish name
 *  - a row of labels applies to the rows beneath it, which is how a menu
 *    prints Quarter / Half / Full, Dry / Gravy or Chicken / Mutton
 *  - a dash means that portion is not sold, which is not the same as free
 *
 * It also warns about two artefacts of real menus: several prices landing in
 * one cell when the columns sit close together, and decorative section text
 * printed sideways down the page appearing as an extra cell.
 */
function buildRowsPrompt(rowsText) {
  return `${INSTRUCTION}

The menu below was rebuilt from the document's layout. Cells on a line are
separated by TAB characters. Read it as a table.

How to read these rows:

A. The FIRST cell on a line is the dish name. Later cells are its prices.

B. A line whose cells are words rather than numbers is a heading line. When
   those words are portion labels - Quarter, Half, Full, Small, Medium,
   Large, Dry, Gravy, Chicken, Mutton - they label the price columns for
   every dish line below, in the same left-to-right order, until the next
   heading line. A heading line may also start with the section name, as in
   "Arabian Mandi<TAB>Full<TAB>Half<TAB>Quarter": there the section is
   "Arabian Mandi" and the three price columns are Full, Half and Quarter.

C. A dash ("-") in a price column means that portion is NOT sold. Leave that
   portion out. Never record it as price 0.

D. Several prices sometimes land in ONE cell, like "400 220 140". When a
   heading line gave you that many labels, map them in that same order. If
   the count does not match the labels, do not guess: put the cell's text in
   "price" exactly as it is.

E. Some lines carry a decorative word printed sideways down the page, such as
   "BIRYANI" or "TANDOOR", which repeats the section name. If a line has such
   a word before the dish name, ignore it and treat the next cell as the name.

F. Lines that are a title, a tagline or a phone number are not dishes. Skip
   them.

<<<MENU
${rowsText}
MENU`
}

module.exports = { buildImagePrompt, buildTextPrompt, buildRowsPrompt, INSTRUCTION }
