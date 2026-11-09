/* eslint-disable no-await-in-loop -- Retry attempts must run sequentially. */
const MAX_ATTEMPTS = 3
const RETRY_DELAYS = [500, 1_000] as const
const RETRYABLE_HTTP_STATUSES = new Set([408, 429, 500, 502, 503, 504])
const RETRYABLE_ERROR_CODES = new Set([
  'UND_ERR_RES_CONTENT_LENGTH_MISMATCH',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
  'ECONNRESET',
  'ETIMEDOUT',
  'EAI_AGAIN',
])

type DownloadBytesOptions = {
  fetchOptions?:
    | Omit<NonNullable<Parameters<typeof fetch>[1]>, 'signal'>
    | undefined
  maxBytes?: number | undefined
  timeoutMs?: number | undefined
  acceptedStatuses?: readonly number[] | undefined
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function isRetryable(error: unknown): boolean {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current && typeof current === 'object' && !seen.has(current)) {
    seen.add(current)
    const candidate = current as {
      cause?: unknown
      code?: unknown
      name?: unknown
      status?: unknown
    }
    if (
      (typeof candidate.code === 'string' &&
        RETRYABLE_ERROR_CODES.has(candidate.code)) ||
      (typeof candidate.status === 'number' &&
        RETRYABLE_HTTP_STATUSES.has(candidate.status)) ||
      candidate.name === 'TimeoutError'
    ) {
      return true
    }
    current = candidate.cause
  }
  return false
}

export async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // A failed or already-consumed stream can reject cancellation.
  }
}

export function failedDownload(
  url: string,
  attempts: number,
  cause: unknown,
): Error {
  return new Error(
    `Download failed for ${url} after ${attempts} attempt${attempts === 1 ? '' : 's'}: ${errorMessage(cause)}`,
    { cause },
  )
}

export async function waitBeforeRetry(attempt: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, RETRY_DELAYS[attempt - 1]!))
}

/** Fetch bytes with bounded retries for transient transport failures only. */
export async function downloadBytes(
  url: string,
  {
    acceptedStatuses,
    fetchOptions,
    maxBytes,
    timeoutMs = 120_000,
  }: DownloadBytesOptions = {},
): Promise<Buffer> {
  let lastError: unknown
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let response: Response | undefined
    try {
      response = await fetch(url, {
        ...fetchOptions,
        signal: AbortSignal.timeout(timeoutMs),
      })
      const statusAccepted = acceptedStatuses
        ? acceptedStatuses.includes(response.status)
        : response.ok
      if (!statusAccepted) {
        const statusError = Object.assign(
          new Error(`HTTP ${response.status}`),
          { status: response.status },
        )
        await cancelBody(response)
        throw statusError
      }
      const declaredLength = Number(response.headers.get('content-length'))
      if (
        maxBytes !== undefined &&
        Number.isFinite(declaredLength) &&
        declaredLength > maxBytes
      ) {
        await cancelBody(response)
        throw new Error(`Response exceeds the ${maxBytes}-byte limit`)
      }
      if (!response.body) {
        throw new Error('Response has no body')
      }

      const reader = response.body.getReader()
      const chunks: Buffer[] = []
      let total = 0
      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) {
            break
          }
          total += value.byteLength
          if (maxBytes !== undefined && total > maxBytes) {
            try {
              await reader.cancel()
            } catch {
              // The stream may already be closing.
            }
            throw new Error(`Response exceeds the ${maxBytes}-byte limit`)
          }
          chunks.push(Buffer.from(value))
        }
      } catch (error) {
        try {
          await reader.cancel(error)
        } catch {
          // The stream can already be errored, including on truncated bodies.
        }
        throw error
      } finally {
        reader.releaseLock()
      }
      return Buffer.concat(chunks, total)
    } catch (error) {
      if (response) {
        await cancelBody(response)
      }
      lastError = error
      if (!isRetryable(error) || attempt === MAX_ATTEMPTS) {
        throw failedDownload(url, attempt, error)
      }
    }
    await waitBeforeRetry(attempt)
  }
  throw failedDownload(url, MAX_ATTEMPTS, lastError)
}
