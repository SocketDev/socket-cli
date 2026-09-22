export const NPM_SCAN_RECEIPT_ARTIFACT_PREFIX = 'npm-stage-scan-receipt'
export const NPM_SCAN_RECEIPT_FILE = 'npm-stage-scan-receipt.json'
const SHA_RE = /^[a-f0-9]{40}$/u
const STAGE_ID_RE = /^[0-9a-f-]{36}$/u

export function verifyNpmScanSourceBinding(config: {
  sourceSha: string
  runHead: string
  parents: readonly string[]
  logs: string
}): void {
  const committed = [
    ...config.logs.matchAll(
      // Match a complete bump receipt, allowing the logger prefix and capturing its commit SHA.
      /^(?:✔ )?\[bump\].* committed ([0-9a-f]{7,40}) .*via the release App\.$/gmu,
    ),
  ].map(match => match[1]!)
  const resumed = [
    ...config.logs.matchAll(
      /^\[bump\] resuming reserved \S+ from ([0-9a-f]{7,40})\.$/gmu,
    ),
  ].map(match => match[1]!)
  const prefixes = [...new Set([...committed, ...resumed])]
  if (
    !SHA_RE.test(config.sourceSha) ||
    !SHA_RE.test(config.runHead) ||
    prefixes.length !== 1 ||
    !config.sourceSha.startsWith(prefixes[0]!)
  ) {
    throw new Error(
      'Scan source has no unique release receipt in the original publish run.',
    )
  }
  if (config.sourceSha === config.runHead) {
    return
  }
  if (
    resumed.length &&
    config.logs.split(/\r?\n/).includes(`[reserved-source] ${config.sourceSha}`)
  ) {
    return
  }
  const fetched = new RegExp(
    `^\\s*\\* branch\\s+${config.sourceSha}\\s+->\\s+FETCH_HEAD\\s*$`,
    'mu',
  )
  if (
    committed.length &&
    config.parents.length === 1 &&
    config.parents[0] === config.runHead &&
    fetched.test(config.logs)
  ) {
    return
  }
  throw new Error(
    'Scan source is neither the reserved source nor a fetched bump child of the original run.',
  )
}

export interface NpmRemoteScanReceipt {
  schemaVersion: 1
  repository: string
  workflow: 'publish-npm.yml'
  runId: number
  runAttempt: number
  sourceSha: string
  publishRunId: number
  packageName: string
  packageVersion: string
  stageId: string
  stageSha1: string
  scanId: string
  verdict: 'passed'
  policy: {
    errorAlerts: number
    warnAlerts: number
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function npmScanReceiptArtifactName(
  runId: number,
  runAttempt: number,
): string {
  if (
    !Number.isSafeInteger(runId) ||
    runId <= 0 ||
    !Number.isSafeInteger(runAttempt) ||
    runAttempt <= 0
  ) {
    throw new Error('npm scan receipt artifact identity is invalid.')
  }
  return `${NPM_SCAN_RECEIPT_ARTIFACT_PREFIX}-${runId}-${runAttempt}`
}

export function parseNpmRemoteScanReceipt(
  value: unknown,
): NpmRemoteScanReceipt {
  const receipt = recordOf(value)
  const policy = recordOf(receipt['policy'])
  const parsed = {
    schemaVersion: receipt['schemaVersion'],
    repository: receipt['repository'],
    workflow: receipt['workflow'],
    runId: receipt['runId'],
    runAttempt: receipt['runAttempt'],
    sourceSha: receipt['sourceSha'],
    publishRunId: receipt['publishRunId'],
    packageName: receipt['packageName'],
    packageVersion: receipt['packageVersion'],
    stageId: receipt['stageId'],
    stageSha1: receipt['stageSha1'],
    scanId: receipt['scanId'],
    verdict: receipt['verdict'],
    policy: {
      errorAlerts: policy['errorAlerts'],
      warnAlerts: policy['warnAlerts'],
    },
  }
  const checks = [
    parsed.schemaVersion === 1,
    typeof parsed.repository === 'string',
    parsed.workflow === 'publish-npm.yml',
    Number.isSafeInteger(parsed.runId),
    Number(parsed.runId) > 0,
    Number.isSafeInteger(parsed.runAttempt),
    Number(parsed.runAttempt) > 0,
    typeof parsed.sourceSha === 'string' && SHA_RE.test(parsed.sourceSha),
    Number.isSafeInteger(parsed.publishRunId),
    Number(parsed.publishRunId) > 0,
    typeof parsed.packageName === 'string' && parsed.packageName !== '',
    typeof parsed.packageVersion === 'string' && parsed.packageVersion !== '',
    typeof parsed.stageId === 'string' && STAGE_ID_RE.test(parsed.stageId),
    typeof parsed.stageSha1 === 'string' && SHA_RE.test(parsed.stageSha1),
    typeof parsed.scanId === 'string' && parsed.scanId !== '',
    parsed.verdict === 'passed',
    Number.isSafeInteger(parsed.policy.errorAlerts),
    parsed.policy.errorAlerts === 0,
    Number.isSafeInteger(parsed.policy.warnAlerts),
    Number(parsed.policy.warnAlerts) >= 0,
  ]
  if (checks.includes(false)) {
    throw new Error('Remote npm scan receipt is malformed or non-passing.')
  }
  return parsed as NpmRemoteScanReceipt
}
