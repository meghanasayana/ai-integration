'use strict'

/**
 * Thin client for the local Ollama server.
 *
 * Deliberately has no fallback to a paid cloud API. If Ollama is not
 * running, that is reported plainly rather than quietly costing money.
 */

const { buildImagePrompt, buildTextPrompt, buildRowsPrompt } = require('./prompt')

const DEFAULT_HOST = process.env.OLLAMA_HOST || 'http://localhost:11434'
const DEFAULT_MODEL = process.env.OLLAMA_VISION_MODEL || 'qwen3-vl:4b'

/**
 * Reading an image needs a vision model. Reading text does not, and a vision
 * model is markedly slower at it on a CPU-only machine: the same work goes
 * through a far larger network for no benefit. So the text and rows paths use
 * a small text-only model when one is configured, and fall back to the vision
 * model so nothing breaks if it is not.
 */
const DEFAULT_TEXT_MODEL = process.env.OLLAMA_TEXT_MODEL || DEFAULT_MODEL
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 180000)

class OllamaError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'OllamaError'
    this.code = code
  }
}

async function generate({ prompt, images, model, host, timeoutMs, signal }) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS)
  if (signal) signal.addEventListener('abort', () => controller.abort(), { once: true })

  const body = {
    model: model || DEFAULT_MODEL,
    prompt,
    stream: false,
    format: 'json',
    options: {
      // Low temperature: this is transcription, not creative writing.
      temperature: 0,
      // Ollama defaults qwen3-vl to a 4096 context. A full-page menu image
      // becomes a large number of vision tokens and can overflow that, which
      // silently truncates the image. Raise it explicitly.
      num_ctx: Number(process.env.OLLAMA_NUM_CTX || 16384),
    },
  }
  if (images && images.length > 0) body.images = images

  let response
  try {
    response = await fetch(`${host || DEFAULT_HOST}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new OllamaError('timeout', 'The AI took too long to read this menu.')
    }

    // Report what actually happened. An earlier version mapped every failure
    // here to "Ollama is not running", which sent us checking a service that
    // was running fine while the real fault was the connection dropping
    // part-way through a long request.
    const code = (err.cause && err.cause.code) || err.code || ''
    console.error('[ollama] request failed:', code || err.name, '-', err.message)

    if (code === 'ECONNREFUSED') {
      throw new OllamaError(
        'unreachable',
        'Nothing is listening on the local AI service. Start Ollama and try again.',
      )
    }

    if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') {
      throw new OllamaError(
        'unreachable',
        'The local AI service address could not be resolved. Check OLLAMA_HOST.',
      )
    }

    if (code === 'ECONNRESET' || code === 'EPIPE' || code === 'UND_ERR_SOCKET') {
      throw new OllamaError(
        'connection_dropped',
        'The connection to the local AI service dropped while it was working. ' +
          'This usually means the model ran out of memory. Try a smaller model.',
      )
    }

    throw new OllamaError(
      'request_failed',
      'The request to the local AI service failed' + (code ? ' (' + code + ').' : '.'),
    )
  } finally {
    clearTimeout(timeout)
  }

  if (response.status === 404) {
    throw new OllamaError(
      'model_missing',
      `The model "${body.model}" is not installed. Run: ollama pull ${body.model}`,
    )
  }

  if (!response.ok) {
    throw new OllamaError('bad_response', `The local AI service returned ${response.status}.`)
  }

  const payload = await response.json()

  // Diagnostics. These fields are the only way to tell a slow-but-working
  // model from one that produced nothing, and they are cheap to log.
  const seconds = (n) => (typeof n === 'number' ? (n / 1e9).toFixed(1) + 's' : '?')
  console.log(
    '[ollama] model=%s done_reason=%s ctx=%s | input %s tokens in %s | output %s tokens in %s | response=%d chars thinking=%d chars',
    body.model,
    payload.done_reason,
    body.options.num_ctx,
    payload.prompt_eval_count,
    seconds(payload.prompt_eval_duration),
    payload.eval_count,
    seconds(payload.eval_duration),
    typeof payload.response === 'string' ? payload.response.length : -1,
    typeof payload.thinking === 'string' ? payload.thinking.length : 0,
  )
  if (payload.error) console.error('[ollama] error field:', payload.error)

  if (typeof payload.response !== 'string') {
    throw new OllamaError('bad_response', 'The local AI service returned an unexpected payload.')
  }

  // An empty string passes the type check above but carries no menu. Say so
  // precisely rather than blaming the photo.
  if (payload.response.trim() === '') {
    console.error('[ollama] empty response. First 400 chars of thinking:',
      String(payload.thinking || '').slice(0, 400))
    throw new OllamaError(
      'empty_response',
      payload.done_reason === 'length'
        ? 'The AI ran out of room before it answered. Try a smaller or simpler menu.'
        : 'The AI returned nothing. Check the backend terminal for details.',
    )
  }

  return { raw: payload.response, model: body.model }
}

function extractFromImage({ base64Image, ...options }) {
  return generate({ prompt: buildImagePrompt(), images: [base64Image], ...options })
}

function extractFromText({ menuText, ...options }) {
  return generate({ model: DEFAULT_TEXT_MODEL, prompt: buildTextPrompt(menuText), ...options })
}

/**
 * A short structured reply rather than a menu: used by the menu assistant,
 * which needs a small JSON filter back. Given a much shorter timeout than
 * extraction, because a filter that takes a minute is a failure whatever it
 * eventually returns.
 */
function generateFilter({ prompt, ...options }) {
  return generate({
    model: DEFAULT_TEXT_MODEL,
    prompt,
    timeoutMs: Number(process.env.OLLAMA_ASSISTANT_TIMEOUT_MS || 60000),
    ...options,
  })
}

/** Text rebuilt from the PDF's layout: tab-separated rows, not prose. */
function extractFromRows({ rowsText, ...options }) {
  return generate({ model: DEFAULT_TEXT_MODEL, prompt: buildRowsPrompt(rowsText), ...options })
}

module.exports = {
  extractFromImage,
  extractFromText,
  extractFromRows,
  generateFilter,
  OllamaError,
  DEFAULT_MODEL,
  DEFAULT_TEXT_MODEL,
  DEFAULT_HOST,
}
