export const NPM_SCAN_RECEIPT_ARTIFACT_PREFIX = 'npm-stage-scan-receipt'
export const NPM_SCAN_RECEIPT_FILE = 'npm-stage-scan-receipt.json'
const SHA_RE = /^[a-f0-9]{40}$/u
const STAGE_ID_RE = /^[0-9a-f-]{36}$/u

export interface NpmPublishSourceEvidence {
  kind: 'committed' | 'prepared' | 'resumed'
  prefix: string
}

export function parseNpmPublishSourceEvidence(config: {
  logs: string
  version?: string | undefined
}): NpmPublishSourceEvidence {
  // These patterns match the source receipts emitted by the publish workflow.
  const committed = [
    ...config.logs.matchAll(
      /^.*\[bump\].* committed ([a-f\d]{7,40}) .*via the release App\.$/gmu,
    ),
  ].map(match => match[1]!)
  const resumed = [
    ...config.logs.matchAll(
      /^.*\[bump\] resuming reserved \S+ from ([a-f\d]{7,40})\.$/gmu,
    ),
  ].map(match => match[1]!)
  const preparedVersions = [
    ...config.logs.matchAll(
      /^.*Bump already applied: releasing prepared version (\d+\.\d+\.\d+)\.$/gmu,
    ),
  ].map(match => match[1]!)
  const ordinary = [
    ...committed.map(prefix => ({
      __proto__: null,
      kind: 'committed' as const,
      prefix,
    })),
    ...resumed.map(prefix => ({
      __proto__: null,
      kind: 'resumed' as const,
      prefix,
    })),
  ]
  if (ordinary.length > 0) {
    const unique = [
      ...new Map(
        ordinary.map(evidence => [
          `${evidence.kind}:${evidence.prefix}`,
          evidence,
        ]),
      ).values(),
    ]
    if (unique.length !== 1 || preparedVersions.length > 0) {
      throw new Error(
        'Publish logs do not contain one unique reserved source commit.',
      )
    }
    return unique[0]!
  }
  const preparedVersion = preparedVersions[0]
  const expectedVersion = config.version ?? preparedVersion
  // A prepared release has no bump commit, so require its matching branch line.
  const branchMarkers = [
    ...config.logs.matchAll(
      /^.*\[release-branch\] opened npm-publish-v(\d+\.\d+\.\d+) at ([a-f\d]{7,40})\.$/gmu,
    ),
  ].filter(match => match[1] === expectedVersion)
  if (
    preparedVersions.length !== 1 ||
    (config.version !== undefined && preparedVersion !== config.version) ||
    branchMarkers.length !== 1
  ) {
    throw new Error(
      'Publish logs do not contain one unique reserved source commit.',
    )
  }
  return { kind: 'prepared', prefix: branchMarkers[0]![2]! }
}

export function verifyNpmPreparedSourceBinding(config: {
  runHead: string
  sourceSha: string
}): void {
  if (
    !/^[a-f\d]{40}$/iu.test(config.sourceSha) ||
    config.sourceSha !== config.runHead
  ) {
    throw new Error(
      'Prepared release source does not match the publish workflow head.',
    )
  }
}

export function verifyNpmScanSourceBinding(config: {
  sourceSha: string
  runHead: string
  parents: readonly string[]
  logs: string
  version?: string | undefined
}): void {
  const evidence = parseNpmPublishSourceEvidence({
    logs: config.logs,
    version: config.version,
  })
  if (
    !SHA_RE.test(config.sourceSha) ||
    !SHA_RE.test(config.runHead) ||
    !config.sourceSha.startsWith(evidence.prefix)
  ) {
    throw new Error(
      'Scan source has no unique release receipt in the original publish run.',
    )
  }
  if (evidence.kind === 'prepared') {
    verifyNpmPreparedSourceBinding(config)
    return
  }
  if (config.sourceSha === config.runHead) {
    return
  }
  if (
    evidence.kind === 'resumed' &&
    config.logs.split(/\r?\n/).includes(`[reserved-source] ${config.sourceSha}`)
  ) {
    return
  }
  const fetched = new RegExp(
    `^\\s*\\* branch\\s+${config.sourceSha}\\s+->\\s+FETCH_HEAD\\s*$`,
    'mu',
  )
  if (
    evidence.kind === 'committed' &&
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
  schemaVersion: 2
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
    gate: 'malware'
    blockingAlerts: number
    errorAlerts: number
    totalAlerts: number
    warnAlerts: number
  }
}

function recordOf(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

export function hasPassingNpmScanPolicyCounts(value: unknown): boolean {
  const policy = recordOf(value)
  const errors = policy['errorAlerts']
  const total = policy['totalAlerts']
  const warnings = policy['warnAlerts']
  const blocking = policy['blockingAlerts']
  return (
    policy['gate'] === 'malware' &&
    blocking === 0 &&
    typeof errors === 'number' &&
    Number.isSafeInteger(errors) &&
    errors >= 0 &&
    typeof total === 'number' &&
    Number.isSafeInteger(total) &&
    total >= 0 &&
    typeof warnings === 'number' &&
    Number.isSafeInteger(warnings) &&
    warnings >= 0 &&
    errors <= total &&
    warnings <= total - errors
  )
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
      gate: policy['gate'],
      blockingAlerts: policy['blockingAlerts'],
      errorAlerts: policy['errorAlerts'],
      totalAlerts: policy['totalAlerts'],
      warnAlerts: policy['warnAlerts'],
    },
  }
  const checks = [
    parsed.schemaVersion === 2,
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
    hasPassingNpmScanPolicyCounts(parsed.policy),
  ]
  if (checks.includes(false)) {
    throw new Error('Remote npm scan receipt is malformed or non-passing.')
  }
  return parsed as NpmRemoteScanReceipt
}
