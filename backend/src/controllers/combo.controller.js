const prisma = require('../lib/prisma')
const { sanitiseLines, sanitiseCombo } = require('../services/combos/validate')

/**
 * Combos: a fixed-price set of items. Each line of a combo holds one or more
 * options — one option is a fixed inclusion, several are alternatives the
 * diner chooses between. Scanzaa is a display menu, so nothing here records
 * what a diner picked; the card simply shows the choices.
 */

const withLines = {
  lines: { orderBy: { sortOrder: 'asc' } },
}

/** GET /api/restaurant/combos */
const listCombos = async (req, res) => {
  const combos = await prisma.combo.findMany({
    where: { restaurantId: req.user.restaurantId },
    include: withLines,
    orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
  })
  return res.json({ combos })
}

/** GET /api/restaurant/combos/:id */
const getCombo = async (req, res) => {
  const combo = await prisma.combo.findFirst({
    where: { id: req.params.id, restaurantId: req.user.restaurantId },
    include: withLines,
  })
  if (!combo) {
    return res.status(404).json({ error: 'Combo not found' })
  }
  return res.json({ combo })
}

/** POST /api/restaurant/combos */
const createCombo = async (req, res) => {
  let fields
  let lines
  try {
    fields = sanitiseCombo(req.body)
    lines = sanitiseLines(req.body?.lines)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  const combo = await prisma.combo.create({
    data: {
      ...fields,
      restaurantId: req.user.restaurantId,
      lines: { create: lines },
    },
    include: withLines,
  })

  return res.status(201).json({ combo })
}

/** PUT /api/restaurant/combos/:id */
const updateCombo = async (req, res) => {
  const existing = await prisma.combo.findFirst({
    where: { id: req.params.id, restaurantId: req.user.restaurantId },
    select: { id: true },
  })
  if (!existing) {
    return res.status(404).json({ error: 'Combo not found' })
  }

  let fields
  let lines
  try {
    fields = sanitiseCombo(req.body)
    lines = sanitiseLines(req.body?.lines)
  } catch (err) {
    return res.status(400).json({ error: err.message })
  }

  // Lines are replaced wholesale: they have no meaning apart from their combo,
  // and diffing them would only invent ways to get a half-updated combo.
  const combo = await prisma.$transaction(async (tx) => {
    await tx.comboLine.deleteMany({ where: { comboId: existing.id } })
    return tx.combo.update({
      where: { id: existing.id },
      data: { ...fields, lines: { create: lines } },
      include: withLines,
    })
  })

  return res.json({ combo })
}

/** DELETE /api/restaurant/combos/:id */
const deleteCombo = async (req, res) => {
  const existing = await prisma.combo.findFirst({
    where: { id: req.params.id, restaurantId: req.user.restaurantId },
    select: { id: true },
  })
  if (!existing) {
    return res.status(404).json({ error: 'Combo not found' })
  }

  await prisma.combo.delete({ where: { id: existing.id } })
  return res.json({ ok: true })
}

/** PATCH /api/restaurant/combos/:id/availability */
const toggleAvailability = async (req, res) => {
  const existing = await prisma.combo.findFirst({
    where: { id: req.params.id, restaurantId: req.user.restaurantId },
    select: { id: true, isAvailable: true },
  })
  if (!existing) {
    return res.status(404).json({ error: 'Combo not found' })
  }

  const next = typeof req.body?.isAvailable === 'boolean'
    ? req.body.isAvailable
    : !existing.isAvailable

  const combo = await prisma.combo.update({
    where: { id: existing.id },
    data: { isAvailable: next },
    include: withLines,
  })

  return res.json({ combo })
}

module.exports = {
  listCombos,
  getCombo,
  createCombo,
  updateCombo,
  deleteCombo,
  toggleAvailability,
}
