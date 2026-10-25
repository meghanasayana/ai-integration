/**
 * Finding combo boxes on a page by where they sit, not by reading order.
 *
 * A combo page is usually a grid of boxes: two across, several down. Flat
 * text extraction reads straight across the page, so "Combo - 1" and
 * "Combo - 2" land on the same line and the items underneath interleave.
 * Working from the position of each title fixes that: a title claims the
 * items below it, in its own column, until the next title.
 */

const Y_TOLERANCE_RATIO = 0.6
const COLUMN_GAP_RATIO = 0.8

const median = (numbers) => {
  if (numbers.length === 0) return 0
  const sorted = numbers.slice().sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Group items into rows of cells, keeping each cell's horizontal position.
 *
 * This mirrors groupIntoRows in pdfLayout, which throws the positions away
 * because the dish parser does not need them. A grid of boxes does.
 */
const rowsWithPosition = (items) => {
  if (!items || items.length === 0) return []

  const lineHeight = median(items.map((i) => i.height)) || 10
  const yTolerance = lineHeight * Y_TOLERANCE_RATIO
  const columnGap = lineHeight * COLUMN_GAP_RATIO

  // PDF y grows upwards, so descending y reads top-down.
  const sorted = items.slice().sort((a, b) => b.y - a.y || a.x - b.x)

  const bands = []
  for (const item of sorted) {
    const band = bands[bands.length - 1]
    if (band && Math.abs(band.y - item.y) <= yTolerance) {
      band.items.push(item)
    } else {
      bands.push({ y: item.y, items: [item] })
    }
  }

  return bands.map((band) => {
    const ordered = band.items.sort((a, b) => a.x - b.x)
    const cells = []
    let current = null

    for (const item of ordered) {
      const width = item.width != null ? item.width : item.text.length * item.height * 0.5
      if (current && item.x - current.endX <= columnGap) {
        current.text += (item.x - current.endX > 0.1 ? ' ' : '') + item.text
        current.endX = item.x + width
      } else {
        current = { text: item.text, x: item.x, endX: item.x + width }
        cells.push(current)
      }
    }

    return { y: band.y, cells }
  })
}

/**
 * Work out the columns of the grid from where the titles sit.
 *
 * Titles in the same column share a left edge, give or take. Anything closer
 * together than a quarter of the page is the same column.
 */
const columnsFromTitles = (titles, pageWidth) => {
  if (titles.length === 0) return []

  const tolerance = (pageWidth || 595) / 4
  const centres = []

  for (const title of titles.slice().sort((a, b) => a.x - b.x)) {
    const last = centres[centres.length - 1]
    if (last && title.x - last.sum / last.count <= tolerance) {
      last.sum += title.x
      last.count += 1
    } else {
      centres.push({ sum: title.x, count: 1 })
    }
  }

  return centres.map((c) => c.sum / c.count)
}

/** Which column does an x belong to? The nearest one. */
const columnOf = (x, columnCentres) => {
  let best = 0
  let bestDistance = Infinity
  columnCentres.forEach((centre, index) => {
    const distance = Math.abs(x - centre)
    if (distance < bestDistance) {
      bestDistance = distance
      best = index
    }
  })
  return best
}

/**
 * Split a page's positioned items into boxes: { title, lines }.
 *
 * `isTitle` decides what starts a box, so the caller keeps control of which
 * words count as a combo.
 */
const boxesFromItems = (items, pageWidth, isTitle) => {
  const rows = rowsWithPosition(items)

  const titles = []
  for (const row of rows) {
    for (const cell of row.cells) {
      if (isTitle(cell.text)) titles.push({ text: cell.text, x: cell.x, y: row.y })
    }
  }

  if (titles.length === 0) return []

  const columnCentres = columnsFromTitles(titles, pageWidth)

  // One open box per column: a title claims everything beneath it in its own
  // column until the next title comes along.
  const open = new Array(columnCentres.length).fill(null)
  const boxes = []

  for (const row of rows) {
    for (const cell of row.cells) {
      const column = columnOf(cell.x, columnCentres)

      if (isTitle(cell.text)) {
        const box = { title: cell.text, lines: [], column, y: row.y, x: cell.x }
        boxes.push(box)
        open[column] = box
      } else if (open[column]) {
        open[column].lines.push(cell.text)
      }
      // A cell above the first title in its column is a page heading. Dropped.
    }
  }

  // Numbered boxes are read in their printed order. A grid puts "Combo - 8"
  // higher on the page than "Combo - 7" whenever the box above it is taller,
  // so position alone would hand back the wrong order.
  const numbers = boxes.map((box) => {
    const match = box.title.match(/(\d{1,2})\s*$/)
    return match ? Number(match[1]) : null
  })

  if (numbers.every((n) => n !== null) && new Set(numbers).size === numbers.length) {
    return boxes
      .map((box, index) => ({ box, number: numbers[index] }))
      .sort((a, b) => a.number - b.number)
      .map((entry) => entry.box)
  }

  // Otherwise read down the page, then across.
  return boxes.sort((a, b) => b.y - a.y || a.x - b.x)
}

module.exports = { rowsWithPosition, columnsFromTitles, columnOf, boxesFromItems, median }
