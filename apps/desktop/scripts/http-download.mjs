/**
 * GitHub and jsDelivr sometimes drop the TCP handshake (undici's default connect
 * timeout is 10s). Retry the whole download with a longer connect timeout.
 */
import { Agent } from 'undici'

export const DOWNLOAD_ATTEMPTS = 5
export const CONNECT_TIMEOUT_MS = 60_000
export const BODY_TIMEOUT_MS = 300_000

export const downloadDispatcher = new Agent({
  connect: { timeout: CONNECT_TIMEOUT_MS },
  headersTimeout: BODY_TIMEOUT_MS,
  bodyTimeout: BODY_TIMEOUT_MS,
})

export function httpFailure(url, status) {
  const error = new Error(`HTTP ${status} for ${url}`)
  error.retryable = status === 408 || status === 429 || status >= 500
  return error
}

export function fetchDownload(url, fetchImpl = fetch) {
  return fetchImpl(url, {
    dispatcher: downloadDispatcher,
    redirect: 'follow',
    signal: AbortSignal.timeout(BODY_TIMEOUT_MS),
  })
}

export async function withDownloadRetry(run, options = {}) {
  const attempts = options.attempts ?? DOWNLOAD_ATTEMPTS
  const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)))
  const warn = options.warn ?? ((message) => console.warn(message))
  let last
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await run()
    } catch (error) {
      last = error
      if (error?.retryable === false || attempt === attempts) break
      const delay = Math.min(2000 * 2 ** (attempt - 1), 16_000)
      warn(`download failed (attempt ${attempt}/${attempts}): ${error instanceof Error ? error.message : String(error)}; retrying in ${delay}ms`)
      await sleep(delay)
    }
  }
  throw last
}
