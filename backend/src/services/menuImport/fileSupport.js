'use strict'

/**
 * What a menu upload is allowed to be.
 *
 * Kept separate from the existing middleware/upload.js on purpose: that one
 * caps dish photos at 5MB and rejects PDFs, and widening it would change
 * behaviour for every other upload in the app.
 */

const MAX_FILE_BYTES = 15 * 1024 * 1024 // 15MB
const MAX_PDF_PAGES = 20

const IMAGE_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/webp'])
const PDF_TYPE = 'application/pdf'

// A text-layer PDF should yield far more than this. Below it, the pages are
// almost certainly scanned images, which this build does not support.
const MIN_TEXT_CHARS_PER_PDF = 120

function classifyUpload({ mimetype, size, originalname }) {
  if (!mimetype) {
    return { ok: false, code: 'unknown_type', message: 'Could not determine the file type.' }
  }

  if (typeof size === 'number' && size > MAX_FILE_BYTES) {
    return {
      ok: false,
      code: 'too_large',
      message: `That file is ${(size / 1024 / 1024).toFixed(1)}MB. The limit is ${MAX_FILE_BYTES / 1024 / 1024}MB.`,
    }
  }

  if (typeof size === 'number' && size === 0) {
    return { ok: false, code: 'empty_file', message: 'That file is empty.' }
  }

  if (IMAGE_TYPES.has(mimetype)) return { ok: true, kind: 'image' }
  if (mimetype === PDF_TYPE) return { ok: true, kind: 'pdf' }

  return {
    ok: false,
    code: 'unsupported_type',
    message: `${originalname || 'That file'} is not a supported menu format. Upload a JPG, PNG or WebP image, or a PDF.`,
  }
}

module.exports = {
  classifyUpload,
  MAX_FILE_BYTES,
  MAX_PDF_PAGES,
  MIN_TEXT_CHARS_PER_PDF,
  IMAGE_TYPES,
  PDF_TYPE,
}
