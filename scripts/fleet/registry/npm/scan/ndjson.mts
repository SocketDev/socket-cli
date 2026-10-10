const FULL_SCAN_MAX_BYTES = 128 * 1024 * 1024
const FULL_SCAN_MAX_LINE_LENGTH = 4 * 1024 * 1024

export interface FullScanArtifact {
  alerts?:
    | Array<{
        action?: string | undefined
        severity?: string | undefined
        type?: string | undefined
      }>
    | undefined
  name?: string | undefined
  version?: string | undefined
}

export type FullScanStreamResult =
  | {
      artifacts: FullScanArtifact[]
      processing?: undefined
      reason?: undefined
    }
  | { artifacts?: undefined; processing: true; reason?: undefined }
  | { artifacts?: undefined; processing?: undefined; reason: string }

function isMatchingProcessingEnvelope(value: unknown, scanId: string): boolean {
  if (value === null || typeof value !== 'object') {
    return false
  }
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).toSorted().join(',') === 'id,status' &&
    record['id'] === scanId &&
    record['status'] === 'processing'
  )
}

function scoresRecordIsValid(value: unknown): boolean | undefined {
  if (
    value === null ||
    typeof value !== 'object' ||
    (value as { _type?: unknown | undefined })._type !== 'scores'
  ) {
    return undefined
  }
  const record = value as Record<string, unknown>
  return (
    Object.keys(record).toSorted().join(',') === '_type,value' &&
    record['value'] !== null &&
    typeof record['value'] === 'object'
  )
}

export async function readFullScanNdjson(
  rawResponse: AsyncIterable<unknown>,
  scanId: string,
): Promise<FullScanStreamResult> {
  const artifacts: FullScanArtifact[] = []
  const decoder = new TextDecoder()
  let pending = ''
  let processing = false
  let sawScores = false
  let totalBytes = 0

  function consumeLine(rawLine: string): string | undefined {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine
    if (line === '') {
      return undefined
    }
    let value: unknown
    try {
      value = JSON.parse(line) as unknown
    } catch {
      return 'full scan returned malformed NDJSON'
    }
    if (isMatchingProcessingEnvelope(value, scanId)) {
      if (processing || sawScores || artifacts.length > 0) {
        return 'full scan returned a misplaced processing envelope'
      }
      processing = true
      return undefined
    }
    if (processing) {
      return 'full scan mixed processing and artifact evidence'
    }
    const validScores = scoresRecordIsValid(value)
    if (validScores !== undefined) {
      if (sawScores || !validScores) {
        return 'full scan returned a malformed scores record'
      }
      sawScores = true
      return undefined
    }
    if (sawScores) {
      return 'full scan returned evidence after the final scores record'
    }
    artifacts.push(value as FullScanArtifact)
    return undefined
  }

  for await (const chunk of rawResponse) {
    if (typeof chunk !== 'string' && !(chunk instanceof Uint8Array)) {
      return { reason: 'full scan returned an unsupported stream chunk' }
    }
    totalBytes +=
      typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.byteLength
    if (totalBytes > FULL_SCAN_MAX_BYTES) {
      return { reason: 'full scan exceeded the response size limit' }
    }
    pending +=
      typeof chunk === 'string'
        ? chunk
        : decoder.decode(chunk, { stream: true })
    let newline = pending.indexOf('\n')
    while (newline !== -1) {
      if (newline > FULL_SCAN_MAX_LINE_LENGTH) {
        return { reason: 'full scan exceeded the NDJSON line size limit' }
      }
      const reason = consumeLine(pending.slice(0, newline))
      if (reason) {
        return { reason }
      }
      pending = pending.slice(newline + 1)
      newline = pending.indexOf('\n')
    }
    if (pending.length > FULL_SCAN_MAX_LINE_LENGTH) {
      return { reason: 'full scan exceeded the NDJSON line size limit' }
    }
  }
  pending += decoder.decode()
  if (pending.length > FULL_SCAN_MAX_LINE_LENGTH) {
    return { reason: 'full scan exceeded the NDJSON line size limit' }
  }
  const reason = consumeLine(pending)
  if (reason) {
    return { reason }
  }
  if (processing) {
    return { processing: true }
  }
  return { artifacts }
}
