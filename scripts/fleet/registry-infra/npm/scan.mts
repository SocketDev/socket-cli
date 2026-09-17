/**
 * @file Pre-approve Socket full-scan gate, CLI-free: everything runs through
 *   `@socketsecurity/sdk` against the Socket API directly — no `socket` binary.
 *   Approval supplies the staged download and its registry-recorded shasum. The
 *   scan refuses before contacting Socket when those bytes differ. Each
 *   verified entry is submitted as a `tmp` full scan (hidden from the dashboard
 *   scan list — a promotion gate, not a tracked branch scan), and gated on the
 *   org's OWN security policy: any alert whose policy action is `error` fails
 *   the entry, mirroring the report-level:error semantics. Fail-closed by
 *   design: promotion always includes a full scan. Auth is verified ONCE up
 *   front (`preflightSocketScanAuth`) with a cheap quota read; an interactive
 *   run with no token in the environment opens the Socket dashboard in the
 *   browser and prompts for a pasted key (masked — the token never echoes).
 */

import crypto from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { SocketSdk } from '@socketsecurity/sdk-stable'

import { logger, rootPath, runCapture } from '../shared.mts'
import {
  acquireSocketTokenViaOAuth,
  socketOAuthConfigured,
} from '../socket-oauth.mts'
import { readFullScanNdjson } from './scan-ndjson.mts'
import type { FullScanArtifact, FullScanStreamResult } from './scan-ndjson.mts'
export type { FullScanArtifact } from './scan-ndjson.mts'
import { defaultPackTarball } from './staged.mts'
import { collectThreatFailures, runLocalThreatScan } from './threat-scan.mts'
import type { ThreatManifest } from './threat-scan.mts'
import { getSocketApiToken } from '@socketsecurity/lib-stable/env/socket'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { sleep } from '@socketsecurity/lib-stable/promises/timers'
import { password } from '@socketsecurity/lib-stable/stdio/prompts'

export const SOCKET_TOKEN_ENV_VAR = 'SOCKET_API_TOKEN'

// Where a human mints a token when none is in the environment: dashboard →
// org settings → API tokens. The gate needs `full-scans` + `report` scopes.
export const SOCKET_TOKEN_MINT_URL = 'https://socket.dev/dashboard'

async function openSocketScanTokenPage<T>(
  task: (open: (url: string) => Promise<void>) => Promise<T>,
): Promise<T> {
  const { withBrowserAuthNavigation } =
    await import('../../browser/auth-navigation.mts')
  return await withBrowserAuthNavigation('socket-scan', task)
}

/**
 * Everything a gate run needs: an authenticated SDK bound to one org.
 */
export interface SocketScanContext {
  orgSlug: string
  sdk: SocketSdk
}

/**
 * Read the Socket API token from the environment.
 */
export function resolveSocketApiToken(
  options?:
    | {
        env?: NodeJS.ProcessEnv | undefined
        resolveDefault?: (() => string | undefined) | undefined
      }
    | undefined,
): string | undefined {
  const opts = { __proto__: null, ...options }
  const env = opts.env ?? process.env
  if (env === process.env) {
    return (opts.resolveDefault ?? getSocketApiToken)()
  }
  const value = env[SOCKET_TOKEN_ENV_VAR]
  return typeof value === 'string' && value !== '' ? value : undefined
}

/**
 * The Socket API token the scan gate runs under: the environment first, then
 * browser OAuth when it is configured, then a masked interactive paste. The
 * token is never echoed. Returns undefined only after reporting WHERE the gate
 * looked and HOW to mint one.
 */
async function acquireSocketScanToken(config: {
  env: NodeJS.ProcessEnv
  interactive: boolean
  openUrl?: ((url: string) => void | Promise<void>) | undefined
  promptForToken?: (() => Promise<string>) | undefined
}): Promise<string | undefined> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { env, openUrl } = cfg
  let token = resolveSocketApiToken({ env })
  if (!token && socketOAuthConfigured(env)) {
    // Browser OAuth (authorization-code + PKCE + loopback) — no key to copy.
    // The browser opens on the operator's screen, so this path does not need
    // a TTY; a thrown failure falls through to the paste/fail paths below.
    try {
      token = await acquireSocketTokenViaOAuth({ env, openUrl })
    } catch (e) {
      logger.warn(errorMessage(e))
    }
  }
  if (!token && cfg.interactive) {
    logger.log(
      `Scan gate: no Socket API token in the environment — opening ${SOCKET_TOKEN_MINT_URL} ` +
        '(org settings → API tokens; the gate needs full-scans + report scopes).',
    )
    const prompt =
      cfg.promptForToken ??
      (async () =>
        String(
          (await password({ message: 'Paste the Socket API token:' })) ?? '',
        ))
    const pasted = (
      await (openUrl
        ? (async () => {
            await openUrl(SOCKET_TOKEN_MINT_URL)
            return await prompt()
          })()
        : openSocketScanTokenPage(async open => {
            await open(SOCKET_TOKEN_MINT_URL)
            return await prompt()
          }))
    ).trim()
    if (pasted) {
      token = pasted
    }
  }
  if (!token) {
    logger.fail(
      'Scan gate: no Socket API token.\n' +
        `  Where: env (${SOCKET_TOKEN_ENV_VAR})\n` +
        '  Saw: none set; wanted a token the Socket SDK can scan with.\n' +
        `  Fix: mint one at ${SOCKET_TOKEN_MINT_URL} (org settings → API ` +
        'tokens) and export it, or load it from sockeye Touch-ID credential ' +
        'storage; approval remains blocked until the scan succeeds.',
    )
    return undefined
  }
  return token
}

/**
 * The org slug the full scans run under: the `SOCKET_ORG_SLUG` override wins,
 * else the token's single org. Anything else — no org, or several — refuses
 * rather than guessing which org a scan should be billed and judged against.
 */
async function resolveSocketScanOrgSlug(config: {
  env: NodeJS.ProcessEnv
  sdk: SocketSdk
}): Promise<string | undefined> {
  const cfg = { __proto__: null, ...config } as typeof config
  const orgOverride = cfg.env['SOCKET_ORG_SLUG']
  if (typeof orgOverride === 'string' && orgOverride !== '') {
    return orgOverride
  }
  let slugs: string[] = []
  try {
    const orgs = await cfg.sdk.listOrganizations()
    if (orgs.success) {
      slugs = Object.values(orgs.data.organizations)
        .map(o => (o as { slug?: string | undefined }).slug ?? '')
        .filter(Boolean)
    }
  } catch (e) {
    logger.fail(`Scan gate: could not list organizations (${errorMessage(e)}).`)
    return undefined
  }
  if (slugs.length !== 1) {
    logger.fail(
      'Scan gate: could not resolve the org to scan under.\n' +
        '  Where: listOrganizations()\n' +
        `  Saw: ${slugs.length === 0 ? 'no orgs on this token' : `multiple orgs (${slugs.join(', ')})`}; wanted exactly one.\n` +
        '  Fix: export SOCKET_ORG_SLUG=<slug> to pick one explicitly.',
    )
    return undefined
  }
  return slugs[0]!
}

/**
 * One-shot pre-gate auth setup, SDK-only. Resolves the API token from the
 * environment — or, on an interactive terminal, opens the Socket dashboard
 * and prompts for a pasted key (masked input; the token is never echoed) —
 * verifies it with a cheap `getQuota()` call, and resolves the org slug the
 * full scans run under (`SOCKET_ORG_SLUG` override, else the token's single
 * org). Run ONCE before the per-entry loop so a missing/expired token
 * surfaces before any human selection, not mid-gate. Every dependency is
 * injectable so tests drive the flow with no network, browser, or TTY.
 */
export async function preflightSocketScanAuth(
  options?:
    | {
        env?: NodeJS.ProcessEnv | undefined
        interactive?: boolean | undefined
        openUrl?: ((url: string) => void | Promise<void>) | undefined
        promptForToken?: (() => Promise<string>) | undefined
        sdkFactory?: ((token: string) => SocketSdk) | undefined
      }
    | undefined,
): Promise<SocketScanContext | undefined> {
  const opts = { __proto__: null, ...options } as NonNullable<typeof options>
  const {
    env = process.env,
    interactive = Boolean(process.stdout.isTTY),
    openUrl,
    promptForToken,
    sdkFactory = token =>
      new SocketSdk(token, { timeout: FULL_SCAN_READ_TIMEOUT_MS }),
  } = opts

  const token = await acquireSocketScanToken({
    env,
    interactive,
    openUrl,
    promptForToken,
  })
  if (!token) {
    return undefined
  }

  const sdk = sdkFactory(token)
  let quotaOk = false
  try {
    const quota = await sdk.getQuota()
    quotaOk = Boolean((quota as { success?: boolean | undefined }).success)
  } catch (e) {
    logger.fail(
      'Scan gate: the Socket API is unreachable.\n' +
        `  Where: getQuota() (${errorMessage(e)})\n` +
        '  Saw: no API response; wanted a cheap authenticated read.\n' +
        '  Fix: check network/proxy and retry; approval remains blocked.',
    )
    return undefined
  }
  if (!quotaOk) {
    logger.fail(
      'Scan gate: the Socket API token was rejected.\n' +
        '  Where: getQuota()\n' +
        '  Saw: an unauthenticated response; wanted a valid token.\n' +
        `  Fix: re-mint at ${SOCKET_TOKEN_MINT_URL} and export it; ` +
        'approval remains blocked until the scan succeeds.',
    )
    return undefined
  }

  const orgSlug = await resolveSocketScanOrgSlug({ env, sdk })
  if (!orgSlug) {
    return undefined
  }
  return { orgSlug, sdk }
}

/**
 * One policy-failing alert, for the gate's failure report.
 */
export interface PolicyFailingAlert {
  artifact: string
  severity: string
  type: string
}

/**
 * Every alert the org security policy has an opinion about, split by the
 * action that policy assigns it. `error` blocks a promotion; `warn` does not,
 * but the publish pipeline's scan stage records the count so a clean-but-noisy
 * artifact is visible in the receipt instead of rounding to "passed". Pure.
 */
export interface PolicyAlertSummary {
  error: PolicyFailingAlert[]
  /**
   * Total alerts seen across every artifact, whatever the policy says about
   * them — the denominator that makes "0 error, 0 warn" readable as "the scan
   * evaluated N alerts", not "the scan saw nothing".
   */
  total: number
  warn: PolicyFailingAlert[]
}

const RESOLVED_ALERT_ACTIONS = new Set(['error', 'ignore', 'monitor', 'warn'])

function isResolvedPolicyAlert(alert: unknown): alert is {
  action: 'error' | 'ignore' | 'monitor' | 'warn'
  severity?: string | undefined
  type: string
} {
  if (alert === null || typeof alert !== 'object') {
    return false
  }
  const candidate = alert as {
    action?: unknown | undefined
    type?: unknown | undefined
  }
  return (
    typeof candidate.type === 'string' &&
    candidate.type !== '' &&
    typeof candidate.action === 'string' &&
    RESOLVED_ALERT_ACTIONS.has(candidate.action)
  )
}

/**
 * Pure policy evaluation: bucket every artifact alert by its org
 * security-policy action. This is the report-level gate semantic — the org's
 * own policy decides what blocks, not a hardcoded severity floor.
 */
export function summarizeResolvedPolicyAlerts(
  artifacts: readonly FullScanArtifact[],
): PolicyAlertSummary | undefined {
  const summary: PolicyAlertSummary = { error: [], total: 0, warn: [] }
  for (let i = 0, { length } = artifacts; i < length; i += 1) {
    const artifact = artifacts[i]!
    if (
      artifact === null ||
      typeof artifact !== 'object' ||
      !Array.isArray(artifact.alerts)
    ) {
      return undefined
    }
    const alerts = artifact.alerts
    for (const alert of alerts) {
      if (!isResolvedPolicyAlert(alert)) {
        return undefined
      }
      summary.total += 1
      const { action } = alert
      if (action !== 'error' && action !== 'warn') {
        continue
      }
      summary[action].push({
        artifact: `${artifact.name ?? '<unnamed>'}@${artifact.version ?? '?'}`,
        severity: alert.severity ?? 'unknown',
        type: alert.type,
      })
    }
  }
  return summary
}

// Full-scan payload shapes vary by endpoint version (a bare artifact array vs
// an `{ artifacts: [...] }` wrapper); normalize to the artifact array the
// policy evaluation consumes.
const FULL_SCAN_POLL_INTERVAL_MS = 1000
const FULL_SCAN_READ_TIMEOUT_MS = 2 * 60 * 1000

/**
 * Scan one staged entry's artifact through the Socket API. Resolves the
 * tarball (a local `pnpm pack`, byte-identical to the staged upload once the
 * shasum gate has passed, or a provider-supplied download), then submits the
 * WHOLE tarball as a `tmp` full scan via the archive endpoint. depscan
 * extracts the archive server-side and ingests every bundled manifest and
 * lockfile as shipped — the full pinned DEPENDENCY graph, not just a
 * hand-picked package.json — and the gate fails on any `error`-action alert
 * in the org security policy. Scope note: the archive endpoint scans the
 * dependency graph, NOT the package's own source code; non-manifest files are
 * matched out and ignored server-side (depscan ingest-tar-hash). Socket's
 * code/malware analysis is keyed to PUBLISHED packages by purl, so a
 * pre-publish staged tarball's own novel code is not analyzed here.
 * `options.packTarball` swaps the artifact source: a generated platform
 * package's payload is CI-built with no local twin, so the approve flow passes
 * a provider that downloads the STAGED tarball, whose structure the platform
 * verify gate has already checked, instead of packing locally.
 * `options.context` carries the preflighted SDK+org; when absent the entry
 * runs its own preflight (self-contained use).
 */
export async function scanStagedEntry(
  entry: {
    name: string
    version: string
  },
  options?:
    | {
        context?: SocketScanContext | undefined
        expectedShasum?: string | undefined
        packTarball?:
          | ((name: string, version: string) => Promise<string | undefined>)
          | undefined
        runThreat?: typeof runLocalThreatScan | undefined
        threatScan?: boolean | undefined
      }
    | undefined,
): Promise<boolean> {
  return (await scanStagedEntryDetailed(entry, options)).ok
}

/**
 * What one staged-entry scan concluded, with the evidence a receipt can
 * record. `ok` carries the same verdict {@link scanStagedEntry} returns — the
 * gate blocks on `error`-action alerts only — while `warnAlerts` and
 * `artifactCount` keep the non-blocking findings visible instead of rounding a
 * noisy-but-passing artifact down to a bare "passed". `detail` is a
 * one-line human summary; `scanId` is the Socket full-scan id (absent when the
 * run never got that far).
 */
export interface StagedScanVerdict {
  artifactCount: number
  detail: string
  errorAlerts: PolicyFailingAlert[]
  ok: boolean
  scanId?: string | undefined
  warnAlerts: PolicyFailingAlert[]
}

// A refusal verdict: the scan reached no conclusion about the bytes, which is
// a FAILURE here, never a pass. `detail` is what the receipt records.
function scanRefused(detail: string): StagedScanVerdict {
  return {
    artifactCount: 0,
    detail,
    errorAlerts: [],
    ok: false,
    warnAlerts: [],
  }
}

async function readStagedTarballShasum(
  filePath: string,
): Promise<string | undefined> {
  return await new Promise<string>((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = createReadStream(filePath)
    stream.on('data', chunk => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', () => resolve(hash.digest('hex')))
  }).catch(() => undefined)
}

async function resolveBoundScanTarball(config: {
  expectedShasum: string | undefined
  name: string
  packTarball: (name: string, version: string) => Promise<string | undefined>
  version: string
}): Promise<
  | { refusal: StagedScanVerdict; tarballPath?: undefined }
  | {
      refusal?: undefined
      tarballPath: string
    }
> {
  const { expectedShasum, name, packTarball, version } = config
  const tarballPath = await packTarball(name, version)
  if (!tarballPath) {
    logger.fail(
      `Scan gate: could not obtain staged bytes for ${name}@${version}; refusing to approve unscanned bytes.`,
    )
    return {
      refusal: scanRefused(
        `no tarball to scan for ${name}@${version} — every artifact source came up empty`,
      ),
    }
  }
  if (expectedShasum) {
    const actualShasum = await readStagedTarballShasum(tarballPath)
    if (actualShasum !== expectedShasum) {
      logger.fail(
        `Scan gate: staged tarball digest mismatch for ${name}@${version}; refusing to approve different bytes.`,
      )
      return {
        refusal: scanRefused(
          `staged tarball sha1 ${actualShasum ?? '<unreadable>'}; wanted ${expectedShasum}`,
        ),
      }
    }
  }
  return { tarballPath }
}

/**
 * Upload the WHOLE tarball via the archive endpoint and return the scan id.
 * depscan extracts it server-side and ingests every bundled manifest +
 * lockfile AS SHIPPED, so the scan sees the full pinned dependency graph — not
 * just the top-level package.json a manifest-only createFullScan would send.
 * This scans DEPENDENCIES, not the package's own code (non-manifest files are
 * matched out and ignored server-side). Every failure path returns a refusal:
 * unscanned bytes are never approved.
 */
async function createStagedArchiveScan(config: {
  context: SocketScanContext
  entryLabel: string
  tarballPath: string
}): Promise<
  | { refusal: StagedScanVerdict; scanId?: undefined }
  | { refusal?: undefined; scanId: string }
> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { entryLabel } = cfg
  const { orgSlug, sdk } = cfg.context
  let scanId: string | undefined
  try {
    const created = await sdk.createOrgFullScanFromArchive(
      orgSlug,
      cfg.tarballPath,
      { repo: 'staged-publish-gate', tmp: true },
    )
    if (created.success) {
      scanId = (created.data as { id?: string | undefined }).id
    } else {
      logger.fail(
        `Scan gate: archive full-scan create failed for ${entryLabel} ` +
          `(status ${created.status}${created.error ? `: ${String(created.error)}` : ''}).`,
      )
      return {
        refusal: scanRefused(
          `archive full-scan create failed for ${entryLabel} (status ${created.status})`,
        ),
      }
    }
  } catch (e) {
    logger.fail(
      `Scan gate: archive full-scan create threw for ${entryLabel} (${errorMessage(e)}).`,
    )
    return {
      refusal: scanRefused(
        `archive full-scan create threw for ${entryLabel}: ${errorMessage(e)}`,
      ),
    }
  }
  if (!scanId) {
    logger.fail(
      `Scan gate: archive full-scan create returned no scan id for ${entryLabel}; not approving.`,
    )
    return {
      refusal: scanRefused(
        `archive full-scan create returned no scan id for ${entryLabel}`,
      ),
    }
  }
  return { scanId }
}

type FullScanAttempt =
  | FullScanStreamResult
  | { missingStream: true }
  | { readStatus: number | undefined }

async function streamFullScanAttempt(
  sdk: SocketSdk,
  orgSlug: string,
  scanId: string,
): Promise<FullScanAttempt> {
  const scan = await sdk.streamFullScan(orgSlug, scanId)
  if (!scan.success) {
    const status = (scan as { status?: unknown | undefined }).status
    return { readStatus: typeof status === 'number' ? status : undefined }
  }
  const response = scan.data as {
    rawResponse?:
      | (AsyncIterable<unknown> & { destroy?: (() => void) | undefined })
      | undefined
  }
  const rawResponse = response?.rawResponse
  if (!rawResponse || typeof rawResponse[Symbol.asyncIterator] !== 'function') {
    return { missingStream: true }
  }
  try {
    return await readFullScanNdjson(rawResponse, scanId)
  } finally {
    rawResponse.destroy?.()
  }
}

/**
 * Read the finished scan with the server-resolved policy action on every
 * alert. FAILS CLOSED on an unrecognized or empty scan, or any alert without a
 * recognized resolved action. The full-scan endpoint applies the org policy;
 * a separate settings read is not required to evaluate the returned evidence.
 */
async function readFullScanEvidence(config: {
  context: SocketScanContext
  entryLabel: string
  scanId: string
}): Promise<
  | {
      artifacts: FullScanArtifact[]
      summary: PolicyAlertSummary
      refusal?: undefined
    }
  | { refusal: StagedScanVerdict }
> {
  const cfg = { __proto__: null, ...config } as typeof config
  const { entryLabel, scanId } = cfg
  const { orgSlug, sdk } = cfg.context
  const deadline = Date.now() + FULL_SCAN_READ_TIMEOUT_MS
  try {
    for (;;) {
      const streamed = await streamFullScanAttempt(sdk, orgSlug, scanId)
      if ('readStatus' in streamed) {
        const { readStatus: status } = streamed
        const scopeHint =
          status === 403 ? '; required scope: full-scans:list' : ''
        logger.fail(
          `Scan gate: full-scan read failed for ${entryLabel}` +
            (typeof status === 'number' ? ` (status ${status})` : '') +
            `${scopeHint}; not approving.`,
        )
        return {
          refusal: scanRefused(
            `could not read full scan ${scanId} for ${entryLabel}` +
              (typeof status === 'number' ? ` (status ${status})` : '') +
              scopeHint,
          ),
        }
      }
      if ('missingStream' in streamed) {
        return {
          refusal: scanRefused(
            `full scan ${scanId} returned no readable response stream for ${entryLabel}`,
          ),
        }
      }
      if (streamed.processing) {
        if (Date.now() + FULL_SCAN_POLL_INTERVAL_MS > deadline) {
          return {
            refusal: scanRefused(
              `full scan ${scanId} remained processing for ${entryLabel}`,
            ),
          }
        }
        await sleep(FULL_SCAN_POLL_INTERVAL_MS)
        continue
      }
      if (streamed.reason) {
        return {
          refusal: scanRefused(
            `${streamed.reason} for ${entryLabel} (${scanId})`,
          ),
        }
      }
      const rawArtifacts = streamed.artifacts
      if (!rawArtifacts || rawArtifacts.length === 0) {
        logger.fail(
          `Scan gate: full scan for ${entryLabel} returned no recognizable ` +
            'artifacts; refusing to approve bytes the scan did not evaluate.',
        )
        return {
          refusal: scanRefused(
            `full scan ${scanId} returned no recognizable artifacts for ${entryLabel} — nothing was evaluated`,
          ),
        }
      }
      const summary = summarizeResolvedPolicyAlerts(rawArtifacts)
      if (!summary) {
        logger.fail(
          `Scan gate: full scan for ${entryLabel} returned malformed or unresolved policy evidence; refusing to approve.`,
        )
        return {
          refusal: scanRefused(
            `full scan ${scanId} returned malformed or unresolved policy evidence for ${entryLabel}`,
          ),
        }
      }
      return { artifacts: rawArtifacts, summary }
    }
  } catch (e) {
    logger.fail(
      `Scan gate: reading scan results threw for ${entryLabel} (${errorMessage(e)}).`,
    )
    return {
      refusal: scanRefused(
        `reading full scan ${scanId} threw for ${entryLabel}: ${errorMessage(e)}`,
      ),
    }
  }
}

/**
 * {@link scanStagedEntry} with its evidence kept: identical gate semantics —
 * only `error`-action alerts block — but the verdict carries the scan id, the
 * artifact count, and the warn-action alerts so a pipeline stage can record
 * WHAT the scan saw. Fails closed on every unreachable / unrecognized path,
 * exactly as the boolean form does.
 */
export async function scanStagedEntryDetailed(
  entry: {
    name: string
    version: string
  },
  options?:
    | {
        context?: SocketScanContext | undefined
        expectedShasum?: string | undefined
        packTarball?:
          | ((name: string, version: string) => Promise<string | undefined>)
          | undefined
        runThreat?: typeof runLocalThreatScan | undefined
        threatScan?: boolean | undefined
      }
    | undefined,
): Promise<StagedScanVerdict> {
  const {
    context,
    expectedShasum,
    packTarball = defaultPackTarball,
    runThreat = runLocalThreatScan,
    threatScan = false,
  } = {
    __proto__: null,
    ...options,
  } as {
    context?: SocketScanContext | undefined
    expectedShasum?: string | undefined
    packTarball?:
      | ((name: string, version: string) => Promise<string | undefined>)
      | undefined
    runThreat?: typeof runLocalThreatScan | undefined
    threatScan?: boolean | undefined
  }
  const scanContext = context ?? (await preflightSocketScanAuth())
  if (!scanContext) {
    return scanRefused(
      'Socket scan gate unavailable (no usable API token / org) — no verdict on these bytes',
    )
  }
  const { orgSlug } = scanContext
  const { name, version } = entry
  const resolvedTarball = await resolveBoundScanTarball({
    expectedShasum,
    name,
    packTarball,
    version,
  })
  if (resolvedTarball.refusal) {
    return resolvedTarball.refusal
  }
  const { tarballPath } = resolvedTarball
  const tmpRoot = os.tmpdir()
  const entryLabel = `${name}@${version}`
  try {
    logger.log(
      `Scan gate: Socket full scan (tmp, archive) on ${entryLabel} via the API…`,
    )
    const created = await createStagedArchiveScan({
      context: scanContext,
      entryLabel,
      tarballPath,
    })
    if (created.refusal) {
      return created.refusal
    }
    const { scanId } = created
    const evidence = await readFullScanEvidence({
      context: scanContext,
      entryLabel,
      scanId,
    })
    if (evidence.refusal) {
      return evidence.refusal
    }
    const { artifacts, summary } = evidence
    const seen =
      `full scan ${scanId} (org ${orgSlug}): ${artifacts.length} artifact(s), ` +
      `${summary.total} alert(s) — ${summary.error.length} error, ${summary.warn.length} warn`
    const failing = summary.error
    if (failing.length > 0) {
      logger.fail(
        `Scan gate: ${failing.length} policy-failing alert(s) for ${name}@${version}; not approving.`,
      )
      for (let i = 0, { length } = failing; i < length; i += 1) {
        const f = failing[i]!
        logger.fail(`  - ${f.type} (${f.severity}) in ${f.artifact}`)
      }
      return {
        artifactCount: artifacts.length,
        detail: `${seen}; blocking: ${failing.map(f => `${f.type} (${f.severity}) in ${f.artifact}`).join(', ')}`,
        errorAlerts: failing,
        ok: false,
        scanId,
        warnAlerts: summary.warn,
      }
    }
    // Opt-in local code-threat leg: the dependency scan above cannot see the
    // package's OWN source, so when requested, extract the tarball and run the
    // keyless on-device triage over it. Fail closed on a blocking verdict AND
    // when the scan was requested but no local model resolved — the operator
    // asked for it, so a silent skip must not read as a pass.
    if (threatScan) {
      const passed = await runThreatLeg(tarballPath, entry, runThreat)
      if (!passed) {
        return {
          artifactCount: artifacts.length,
          detail: `${seen}; the local code-threat leg refused ${name}@${version} (see the gate's log above)`,
          errorAlerts: [],
          ok: false,
          scanId,
          warnAlerts: summary.warn,
        }
      }
    }
    return {
      artifactCount: artifacts.length,
      detail: seen,
      errorAlerts: [],
      ok: true,
      scanId,
      warnAlerts: summary.warn,
    }
  } finally {
    // Clean the tarball when a packTarball provider downloaded it into a temp
    // dir (the registry-API `stage download` and the browser-read passback
    // both mkdtemp under os.tmpdir()). A repo-local `pnpm pack` output lands
    // in the package dir, NOT under tmpdir, so it is never touched —
    // pnpm/repo hygiene owns that one.
    if (tarballPath.startsWith(tmpRoot + path.sep)) {
      await safeDelete(path.dirname(tarballPath))
    }
  }
}

// Extract the tarball and run the keyless local threat scan over its `package/`
// root. Returns true only when the scan ran AND every file triaged clean.
// Fails closed (returns false) on a blocking verdict, an extraction failure, or
// `available:false` — the scan was explicitly requested, so a missing local
// model must not read as a pass. The extract dir is always cleaned.
async function runThreatLeg(
  tarballPath: string,
  entry: { name: string; version: string },
  runThreat: typeof runLocalThreatScan,
): Promise<boolean> {
  const { name, version } = entry
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-threat-'))
  try {
    const untar = await runCapture(
      'tar',
      ['-xzf', tarballPath, '-C', dir],
      rootPath,
    )
    if (untar.code !== 0) {
      logger.fail(
        `Threat scan: extracting ${name}@${version} failed (tar exited ${untar.code}); not approving.`,
      )
      return false
    }
    const packageDir = path.join(dir, 'package')
    let manifest: ThreatManifest = {}
    try {
      manifest = JSON.parse(
        await fs.readFile(path.join(packageDir, 'package.json'), 'utf8'),
      ) as ThreatManifest
    } catch {
      // A tarball with no readable package.json still gets a code scan; the
      // manifest only refines file prioritization.
    }
    const result = await runThreat(packageDir, { manifest })
    if (!result.available) {
      logger.fail(
        `Threat scan: requested (--threat-scan) but no on-device model resolved for ${name}@${version}; ` +
          'failing closed. Provision a local backend (ODAI_BACKEND / node:smol-ai / llama-server) or drop --threat-scan.',
      )
      return false
    }
    const failing = collectThreatFailures(result.findings)
    if (failing.length > 0) {
      logger.fail(
        `Threat scan: ${failing.length} threat finding(s) for ${name}@${version}; not approving.`,
      )
      for (let i = 0, { length } = failing; i < length; i += 1) {
        const f = failing[i]!
        logger.fail(
          `  - ${f.verdict} (${f.confidence}) ${f.file}: ${f.reasons.join('; ')}`,
        )
      }
      return false
    }
    logger.log(
      `Threat scan: ${result.findings.length} file(s) triaged clean for ${name}@${version}.`,
    )
    return true
  } finally {
    await safeDelete(dir)
  }
}
