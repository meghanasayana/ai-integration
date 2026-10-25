const { sanitiseLines, sanitiseCombo } = require('./validate')

/**
 * Saving combos from an import.
 *
 * A combo is matched to an existing one by name within the same restaurant,
 * so running the same menu through twice updates rather than duplicates. The
 * match ignores case and spacing, because "Combo - 1" and "Combo -1" are the
 * same combo to everyone except a database.
 */

const key = (name) => String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

async function importCombos({ prisma, restaurantId, combos }) {
  const created = []
  const updated = []
  const rejected = []

  if (!Array.isArray(combos) || combos.length === 0) {
    return { created, updated, rejected }
  }

  const existing = await prisma.combo.findMany({
    where: { restaurantId },
    select: { id: true, name: true },
  })
  const byName = new Map(existing.map((combo) => [key(combo.name), combo.id]))

  for (const [index, raw] of combos.entries()) {
    let fields
    let lines
    try {
      fields = sanitiseCombo({ ...raw, sortOrder: raw?.sortOrder ?? index })
      lines = sanitiseLines(raw?.lines)
    } catch (err) {
      rejected.push({ name: raw?.name ?? `#${index + 1}`, reason: err.message })
      continue
    }

    const existingId = byName.get(key(fields.name))

    if (existingId) {
      await prisma.$transaction(async (tx) => {
        await tx.comboLine.deleteMany({ where: { comboId: existingId } })
        await tx.combo.update({
          where: { id: existingId },
          data: { ...fields, lines: { create: lines } },
        })
      })
      updated.push(fields.name)
    } else {
      const combo = await prisma.combo.create({
        data: { ...fields, restaurantId, lines: { create: lines } },
        select: { id: true, name: true },
      })
      byName.set(key(combo.name), combo.id)
      created.push(combo.name)
    }
  }

  return { created, updated, rejected }
}

module.exports = { importCombos, key }
