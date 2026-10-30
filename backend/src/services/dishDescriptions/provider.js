'use strict'

const { generateFilter, OllamaError } = require('../menuImport/ollama')

/**
 * Where descriptions get written.
 *
 * Two places, chosen by what the server has been given, never by the browser.
 *
 * - **Ollama**, on this machine. Free and private, and about 4.7 tokens a
 *   second, so a long menu is hours.
 * - **A hosted endpoint**, when DESCRIPTION_API_KEY is set. Hundreds of
 *   tokens a second, which turns those hours into minutes. Dish names leave
 *   the machine, which is why it is off unless a key is deliberately added.
 *
 * Both are given the same prompt and both answers go through the same
 * validation, so switching changes the speed and nothing else.
 */

const API_KEY = process.env.DESCRIPTION_API_KEY || ''
const API_URL = process.env.DESCRIPTION_API_URL || 'https://api.groq.com/openai/v1/chat/completions'
// Groq shut llama-3.1-8b-instant down on 16 August 2026 for free and
// developer tier keys, and named this as its replacement. A request for the
// old ID now fails for every dish, which is exactly how the first real run of
// this feature ended.
const API_MODEL = process.env.DESCRIPTION_API_MODEL || 'openai/gpt-oss-20b'
const API_TIMEOUT_MS = Number(process.env.DESCRIPTION_API_TIMEOUT_MS || 60000)

// gpt-oss thinks before it answers, and those thinking tokens come out of the
// same completion budget as the answer. Ten dishes of JSON plus reasoning
// needs room; too little and the reply is cut off mid-object.
const API_MAX_TOKENS = Number(process.env.DESCRIPTION_API_MAX_TOKENS || 2000)

// Models that reason before answering. Strict JSON mode and a reasoning model
// do not mix: the reasoning is emitted too, the reply is then not a bare JSON
// object, and the service rejects the whole request with
// "400 Failed to validate JSON" - intermittently, which is the worst way for
// it to fail. The prompt asks for JSON either way, and the reply is parsed
// leniently below, so nothing is lost by not insisting.
const REASONING_MODEL = /gpt-oss|qwen3|o[134](?:-|$)|reason/i

/**
 * The JSON in a reply that may not be only JSON.
 *
 * A reasoning model will sometimes preface its answer, or wrap it in a fenced
 * block. The object is still in there, and refusing to look for it throws away
 * a perfectly good set of descriptions.
 */
function parseLoosely (content) {
  const text = String(content == null ? '' : content).trim()

  try {
    return JSON.parse(text)
  } catch {
    // Keep looking.
  }

  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fenced) {
    try {
      return JSON.parse(fenced[1].trim())
    } catch {
      // Keep looking.
    }
  }

  const first = text.indexOf('{')
  const last = text.lastIndexOf('}')
  if (first !== -1 && last > first) {
    try {
      return JSON.parse(text.slice(first, last + 1))
    } catch {
      // Nothing usable.
    }
  }

  throw new ProviderError('unreadable', 'The description service did not reply with JSON.')
}

class ProviderError extends Error {
  constructor(code, message) {
    super(message)
    this.name = 'ProviderError'
    this.code = code
  }
}

/** Whatever the service said went wrong, in its own words. */
async function reasonFrom(response) {
  try {
    const body = await response.json()
    const error = body && body.error ? body.error : body
    const message = error && error.message
    // The service hands back the generation it refused. That text is the whole
    // answer to "why", and discarding it left nothing to act on.
    const failed = error && error.failed_generation
    const detail = typeof failed === 'string' && failed.trim() !== ''
      ? ` Model said: ${failed.trim().slice(0, 300)}`
      : ''
    return typeof message === 'string' && message.trim() !== '' ? message.trim() + detail : detail.trim()
  } catch {
    return ''
  }
}

/** Which one is in use, for the panel to show and the logs to record. */
function describeProvider() {
  return API_KEY
    ? { name: 'api', model: API_MODEL, fast: true }
    : { name: 'ollama', model: process.env.OLLAMA_TEXT_MODEL || 'qwen2.5:3b', fast: false }
}

/** The local model. One prompt in, parsed JSON out. */
async function viaOllama(prompt) {
  const reply = await generateFilter({ prompt })
  return typeof reply.raw === 'string' ? JSON.parse(reply.raw) : reply.raw
}

/**
 * A hosted OpenAI-compatible endpoint.
 *
 * The key is read from the environment and never logged, never returned to
 * the browser, and never accepted from a request.
 */
async function viaApi(prompt) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS)

  let response
  try {
    response = await fetch(API_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: API_MODEL,
        temperature: 0.4,
        max_completion_tokens: API_MAX_TOKENS,
        // Asked for, not insisted on, when the model reasons first. See
        // REASONING_MODEL above.
        ...(REASONING_MODEL.test(API_MODEL)
          ? { reasoning_effort: 'low' }
          : { response_format: { type: 'json_object' } }),
        messages: [{ role: 'user', content: prompt }],
      }),
    })
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new ProviderError('timeout', 'The description service took too long.')
    }
    throw new ProviderError('unreachable', 'The description service could not be reached.')
  } finally {
    clearTimeout(timer)
  }

  if (response.status === 429) {
    throw new ProviderError('rate_limited', 'The description service is rate limiting us.')
  }
  if (response.status === 401 || response.status === 403) {
    const reason = await reasonFrom(response)
    throw new ProviderError('rejected',
      reason ? `The description service rejected the API key: ${reason}` : 'The description service rejected the API key.')
  }
  if (!response.ok) {
    // What the service said, in its own words - not merely that something went
    // wrong. Groq's reply to a retired model ID names the model and its
    // replacement, and throwing that away left the panel showing "(failed)"
    // and nobody any way to find out why.
    const reason = await reasonFrom(response)
    // A bad model ID or a malformed request will fail identically forever, so
    // it is named apart from a service having a bad minute.
    const code = response.status === 400 || response.status === 404 ? 'misconfigured' : 'failed'
    throw new ProviderError(code,
      reason ? `The description service returned ${response.status}: ${reason}` : `The description service returned ${response.status}.`)
  }

  const body = await response.json()
  const content = body?.choices?.[0]?.message?.content
  if (!content) {
    throw new ProviderError('empty', 'The description service returned nothing.')
  }

  return parseLoosely(content)
}

/**
 * Ask whichever provider is configured.
 * @throws {ProviderError} when the service itself is the problem.
 */
async function ask(prompt) {
  if (API_KEY) return viaApi(prompt)

  try {
    return await viaOllama(prompt)
  } catch (err) {
    if (err instanceof OllamaError) {
      throw new ProviderError(err.code, err.message)
    }
    throw err
  }
}

module.exports = { ask, describeProvider, ProviderError, API_MODEL }
