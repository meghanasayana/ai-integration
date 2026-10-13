'use strict'

/**
 * Upload handling for menu imports only.
 *
 * Deliberately separate from middleware/upload.js, which caps dish photos at
 * 5MB and rejects PDFs. Widening that one would change behaviour for every
 * other upload in the app.
 *
 * Memory storage, not disk: the file is read once, sent to the AI, and
 * discarded. Nothing is written to the filesystem, so there is no upload
 * directory to clean up and no path-traversal surface.
 */

const multer = require('multer')
const { MAX_FILE_BYTES, IMAGE_TYPES, PDF_TYPE } = require('../services/menuImport/fileSupport')

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_TYPES.has(file.mimetype) || file.mimetype === PDF_TYPE) {
      return cb(null, true)
    }
    cb(new Error('Upload a JPG, PNG or WebP image, or a PDF.'), false)
  },
})

const single = upload.single('menu')

/** Wraps multer so its errors become clean JSON instead of a stack trace. */
function menuUpload(req, res, next) {
  single(req, res, (err) => {
    if (!err) return next()

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({
        error: `That file is too large. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
      })
    }
    return res.status(400).json({ error: err.message || 'That file could not be read.' })
  })
}

module.exports = { menuUpload }
