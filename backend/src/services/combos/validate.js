/**
 * Turning whatever the admin form sent into clean combo rows.
 *
 * Kept apart from the controller so it can be tested without a database:
 * this is the part that decides what a combo actually means, and it is the
 * part most likely to be handed something odd.
 */

const MAX_LINES = 12
const MAX_OPTIONS = 12
const MAX_TEXT = 120

/**
 * A line is one row of the combo card. `options` holds its choices: a single
 * entry is a fixed inclusion ("Fresh Lime Juice"), several are alternatives
 * the diner picks between. `note` carries a quantity such as "2 pcs".
 *
 * Accepts either { options: [...], note } or a plain string for a fixed line.
 * Also accepts a string with slashes — "Chicken Biriyani / Mugual Biriyani" —
 * because that is how the printed menu writes a choice, and it is what the
 * menu importer will hand us.
 */
const sanitiseLines = (raw) => {
  if (!Array.isArray(raw)) {
    throw new Error('lines must be an array')
  }
  if (raw.length === 0) {
    throw new Error('a combo needs at least one line')
  }
  if (raw.length > MAX_LINES) {
    throw new Error(`a combo cannot have more than ${MAX_LINES} lines`)
  }

  return raw.map((line, index) => {
    const position = index + 1

    let rawOptions
    if (typeof line === 'string') {
      rawOptions = line.split('/')
    } else if (Array.isArray(line?.options)) {
      rawOptions = line.options
    } else {
      throw new Error(`line ${position}: options must be an array`)
    }

    const options = []
    for (const option of rawOptions) {
      const text = String(option ?? '').trim()
      if (!text) continue
      if (text.length > MAX_TEXT) {
        throw new Error(`line ${position}: "${text.slice(0, 30)}…" is too long`)
      }
      // A menu repeats itself; the same option twice on one line is a typo.
      if (!options.some((existing) => existing.toLowerCase() === text.toLowerCase())) {
        options.push(text)
      }
    }

    if (options.length === 0) {
      throw new Error(`line ${position}: needs at least one option`)
    }
    if (options.length > MAX_OPTIONS) {
      throw new Error(`line ${position}: more than ${MAX_OPTIONS} options`)
    }

    const rawNote = typeof line === 'string' ? '' : String(line?.note ?? '')
    const note = rawNote.trim().slice(0, MAX_TEXT) || null

    return { options, note, sortOrder: index }
  })
}

/** The combo itself: name, price and flags. Throws with a readable message. */
const sanitiseCombo = (body) => {
  const name = String(body?.name ?? '').trim()
  if (!name) {
    throw new Error('name is required')
  }
  if (name.length > MAX_TEXT) {
    throw new Error('name is too long')
  }

  // Rupees, as typed. Strings are accepted because form fields send strings.
  const price = Number(body?.price)
  if (!Number.isFinite(price)) {
    throw new Error('price must be a number')
  }
  if (price < 0) {
    throw new Error('price cannot be negative')
  }

  return {
    name,
    price,
    description: String(body?.description ?? '').trim() || null,
    isVeg: body?.isVeg === true,
    isAvailable: body?.isAvailable !== false,
    sortOrder: Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : 0,
  }
}

/** How a line reads on the menu card: "A or B or C (2 pcs)". */
const lineToText = (line) => {
  const joined = (line?.options ?? []).join(' or ')
  return line?.note ? `${joined} (${line.note})` : joined
}

module.exports = { sanitiseLines, sanitiseCombo, lineToText, MAX_LINES, MAX_OPTIONS }
