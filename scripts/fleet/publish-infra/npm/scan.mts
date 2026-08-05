/**
 * @file Pre-approve Socket full-scan gate, CLI-free: everything runs through
 *   `@socketsecurity/sdk` against the Socket API directly — no `socket`
 *   binary. The shasum gate has already proven the staged bytes are identical
 *   to the local `pnpm pack`, so scanning the local artifact's extract IS
 *   scanning the staged upload. Each verified entry is packed, extracted to a
 *   temp dir, submitted as a `tmp` full scan (hidden from the dashboard scan
 *   list — a promotion gate, not a tracked branch scan), and gated on the
 *   org's OWN security policy: any alert whose policy action is `error` fails
 *   the entry, mirroring the report-level:error semantics. Fail-closed by
 *   design: promotion includes a full scan unless `--no-scan` skips it
 *   explicitly. Auth is verified ONCE up front (`preflightSocketScanAuth`)
 *   with a cheap quota read; an interactive run with no token in the
 *   environment opens the Socket dashboard in the browser and prompts for a
 *   pasted key (masked — the token never echoes).
 */

import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { SocketSdk } from '@socketsecurity/sdk-stable'

import { logger, rootPath, runCapture } from '../shared.mts'
import {
  acquireSocketTokenViaOAuth,
  socketOAuthConfigured,
} from '../socket-oauth.mts'
import { defaultPackTarball } from './staged.mts'
import { collectThreatFailures, runLocalThreatScan } from './threat-scan.mts'
import type { ThreatManifest } from './threat-scan.mts'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { password } from '@socketsecurity/lib-stable/stdio/prompts'

// The canonical fleet env name for the Socket API token — bootstrap hooks
// normalize the legacy aliases into it, so only this one is read.
export const SOCKET_TOKEN_ENV_VAR = 'SOCKET_API_TOKEN'

// Where a human mints a token when none is in the environment: dashboard →
// org settings → API tokens. The gate needs `full-scans` + `report` scopes.
export const SOCKET_TOKEN_MINT_URL = 'https://socket.dev/dashboard'

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
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const value = env[SOCKET_TOKEN_ENV_VAR]
  return typeof value === 'string' && value !== '' ? value : undefined
}

// Best-effort platform browser opener (`open` / `xdg-open` / `start`),
// fire-and-forget so the gate never waits on the browser process. A failure
// to open is non-fatal — the URL is printed and the human opens it by hand.
function openInBrowser(url: string): void {
  const win32 = process.platform === 'win32'
  const opener =
    process.platform === 'darwin' ? 'open' : win32 ? 'start' : 'xdg-open'
  try {
    const child = spawn(opener, [url], {
      detached: true,
      shell: win32,
      stdio: 'ignore',
    })
    child.catch(() => {
      // Non-fatal: the printed URL is the fallback.
    })
  } catch {
    // Non-fatal: the printed URL is the fallback.
  }
}

/**
 * One-shot pre-gate auth setup, SDK-only. Resolves the API token from the
 * environment — or, on an interactive terminal, opens the Socket dashboard
 * and prompts for a pasted key (masked input; the token is never echoed) —
 * verifies it with a cheap `getQuota()` call, and resolves the org slug the
 * full scans run under (`SOCKET_ORG_SLUG` override, else the token's single
 * org). Run ONCE before the per-entry loop so a missing/expired token
 * surfaces before any human selection, not mid-gate. Every dependency is an
 * injectable seam so tests drive the flow with no network, browser, or TTY.
 */
export async function preflightSocketScanAuth(
  options?:
    | {
        env?: NodeJS.ProcessEnv | undefined
        interactive?: boolean | undefined
        openUrl?: ((url: string) => void) | undefined
        promptForToken?: (() => Promise<string>) | undefined
        sdkFactory?: ((token: string) => SocketSdk) | undefined
      }
    | undefined,
): Promise<SocketScanContext | undefined> {
  const {
    env = process.env,
    interactive = Boolean(process.stdout.isTTY),
    openUrl = openInBrowser,
    promptForToken,
    sdkFactory = token => new SocketSdk(token),
  } = { __proto__: null, ...options } as NonNullable<typeof options>

  let token = resolveSocketApiToken(env)
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
  if (!token && interactive) {
    logger.log(
      `Scan gate: no Socket API token in the environment — opening ${SOCKET_TOKEN_MINT_URL} ` +
        '(org settings → API tokens; the gate needs full-scans + report scopes).',
    )
    openUrl(SOCKET_TOKEN_MINT_URL)
    const prompt =
      promptForToken ??
      (async () =>
        String(
          (await password({ message: 'Paste the Socket API token:' })) ?? '',
        ))
    const pasted = (await prompt()).trim()
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
        'storage; --no-scan skips the gate explicitly.',
    )
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
        '  Fix: check network/proxy and retry; --no-scan skips the gate explicitly.',
    )
    return undefined
  }
  if (!quotaOk) {
    logger.fail(
      'Scan gate: the Socket API token was rejected.\n' +
        '  Where: getQuota()\n' +
        '  Saw: an unauthenticated response; wanted a valid token.\n' +
        `  Fix: re-mint at ${SOCKET_TOKEN_MINT_URL} and export it; ` +
        '--no-scan skips the gate explicitly.',
    )
    return undefined
  }

  const orgOverride = env['SOCKET_ORG_SLUG']
  if (typeof orgOverride === 'string' && orgOverride !== '') {
    return { orgSlug: orgOverride, sdk }
  }
  let slugs: string[] = []
  try {
    const orgs = await sdk.listOrganizations()
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
  return { orgSlug: slugs[0]!, sdk }
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

/**
 * Pure policy evaluation: bucket every artifact alert by its org
 * security-policy action. This is the report-level gate semantic — the org's
 * own policy decides what blocks, not a hardcoded severity floor.
 */
export function summarizePolicyAlerts(
  artifacts: ReadonlyArray<{
    alerts?:
      | ReadonlyArray<{ severity?: string | undefined; type: string }>
      | undefined
    name?: string | undefined
    version?: string | undefined
  }>,
  policyRules: Readonly<Record<string, { action?: string | undefined }>>,
): PolicyAlertSummary {
  const summary: PolicyAlertSummary = { error: [], total: 0, warn: [] }
  for (let i = 0, { length } = artifacts; i < length; i += 1) {
    const artifact = artifacts[i]!
    const alerts = artifact.alerts ?? []
    for (const alert of alerts) {
      summary.total += 1
      const action = policyRules[alert.type]?.action
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

/**
 * Pure policy evaluation: collect every alert whose org security-policy
 * action is `error`. This is the report-level:error gate semantic — the org's
 * own policy decides what blocks, not a hardcoded severity floor.
 */
export function collectPolicyFailingAlerts(
  artifacts: ReadonlyArray<{
    alerts?:
      | ReadonlyArray<{ severity?: string | undefined; type: string }>
      | undefined
    name?: string | undefined
    version?: string | undefined
  }>,
  policyRules: Readonly<Record<string, { action?: string | undefined }>>,
): PolicyFailingAlert[] {
  return summarizePolicyAlerts(artifacts, policyRules).error
}

// Full-scan payload shapes vary by endpoint version (a bare artifact array vs
// an `{ artifacts: [...] }` wrapper); normalize to the artifact array the
// policy evaluation consumes.
export interface FullScanArtifact {
  alerts?: Array<{ severity?: string | undefined; type: string }> | undefined
  name?: string | undefined
  version?: string | undefined
}

export type SecurityPolicyRules = Record<
  string,
  { action?: string | undefined }
>

// Return the artifact list for a RECOGNIZED full-scan response shape (a bare
// array or `{ artifacts: [...] }`), or undefined when the shape is
// unrecognized. The gate fails closed on undefined rather than conflating
// "unknown response shape" with "clean" — the SDK maps an empty HTTP body to
// `{}`, and a future enveloped/paginated shape would otherwise silently pass.
// A recognized-but-empty `[]` is also a fail-closed signal at the call site: a
// real full scan of a package always yields at least the package's own
// artifact, so zero artifacts means nothing was evaluated.
export function normalizeFullScanArtifacts(
  data: unknown,
): FullScanArtifact[] | undefined {
  if (Array.isArray(data)) {
    return data as FullScanArtifact[]
  }
  if (data && typeof data === 'object') {
    const maybe = (data as { artifacts?: unknown | undefined }).artifacts
    if (Array.isArray(maybe)) {
      return maybe as FullScanArtifact[]
    }
  }
  return undefined
}

// Return the org security-policy rule map for a RECOGNIZED shape, or undefined
// when `securityPolicyRules` is absent or not an object. The gate fails closed
// on undefined rather than defaulting to an empty map — an empty map matches
// no alert, so a missing/renamed policy would silently approve a package that
// carries genuine error-action alerts.
export function extractSecurityPolicyRules(
  data: unknown,
): SecurityPolicyRules | undefined {
  if (data && typeof data === 'object') {
    const rules = (data as { securityPolicyRules?: unknown | undefined })
      .securityPolicyRules
    if (rules && typeof rules === 'object') {
      return rules as SecurityPolicyRules
    }
  }
  return undefined
}

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
    packTarball = defaultPackTarball,
    runThreat = runLocalThreatScan,
    threatScan = false,
  } = {
    __proto__: null,
    ...options,
  } as {
    context?: SocketScanContext | undefined
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
  const { orgSlug, sdk } = scanContext
  const { name, version } = entry
  const tarballPath = await packTarball(name, version)
  if (!tarballPath) {
    logger.fail(
      `Scan gate: could not pack ${name}@${version} locally; refusing to approve unscanned bytes.`,
    )
    return scanRefused(
      `no tarball to scan for ${name}@${version} — every artifact source came up empty`,
    )
  }
  const tmpRoot = os.tmpdir()
  try {
    // Upload the WHOLE tarball via the archive endpoint. depscan extracts it
    // server-side and ingests every bundled manifest + lockfile AS SHIPPED, so
    // the scan sees the full pinned dependency graph — not just the top-level
    // package.json a manifest-only createFullScan would send. This scans
    // DEPENDENCIES, not the package's own code (non-manifest files are matched
    // out and ignored server-side). Mirrors socket-webext's staged-review
    // full-scan, which uses the same archive endpoint.
    logger.log(
      `Scan gate: Socket full scan (tmp, archive) on ${name}@${version} via the API…`,
    )
    let scanId: string | undefined
    try {
      const created = await sdk.createOrgFullScanFromArchive(
        orgSlug,
        tarballPath,
        { repo: 'staged-publish-gate', tmp: true },
      )
      if (created.success) {
        scanId = (created.data as { id?: string | undefined }).id
      } else {
        logger.fail(
          `Scan gate: archive full-scan create failed for ${name}@${version} ` +
            `(status ${created.status}${created.error ? `: ${String(created.error)}` : ''}).`,
        )
        return scanRefused(
          `archive full-scan create failed for ${name}@${version} (status ${created.status})`,
        )
      }
    } catch (e) {
      logger.fail(
        `Scan gate: archive full-scan create threw for ${name}@${version} (${errorMessage(e)}).`,
      )
      return scanRefused(
        `archive full-scan create threw for ${name}@${version}: ${errorMessage(e)}`,
      )
    }
    if (!scanId) {
      logger.fail(
        `Scan gate: archive full-scan create returned no scan id for ${name}@${version}; not approving.`,
      )
      return scanRefused(
        `archive full-scan create returned no scan id for ${name}@${version}`,
      )
    }
    let artifacts: FullScanArtifact[]
    let policyRules: SecurityPolicyRules
    try {
      const [scan, policy] = await Promise.all([
        sdk.getFullScan(orgSlug, scanId),
        sdk.getOrgSecurityPolicy(orgSlug),
      ])
      if (!scan.success || !policy.success) {
        logger.fail(
          `Scan gate: could not read the scan or the org security policy for ${name}@${version}; not approving.`,
        )
        return scanRefused(
          `could not read full scan ${scanId} or the org security policy for ${name}@${version}`,
        )
      }
      // Fail closed on an unrecognized or empty scan/policy: an unknown
      // response shape (or the SDK's empty-body → `{}`) must never read as
      // "clean". A real full scan yields at least the package's own artifact,
      // and a real org carries a policy rule map; the absence of either means
      // nothing was actually evaluated.
      const rawArtifacts = normalizeFullScanArtifacts(scan.data)
      if (!rawArtifacts || rawArtifacts.length === 0) {
        logger.fail(
          `Scan gate: full scan for ${name}@${version} returned no recognizable ` +
            'artifacts; refusing to approve bytes the scan did not evaluate.',
        )
        return scanRefused(
          `full scan ${scanId} returned no recognizable artifacts for ${name}@${version} — nothing was evaluated`,
        )
      }
      const rules = extractSecurityPolicyRules(policy.data)
      if (!rules) {
        logger.fail(
          `Scan gate: org security policy for ${name}@${version} was empty or ` +
            'unrecognized; refusing to approve without a policy to evaluate against.',
        )
        return scanRefused(
          `the ${orgSlug} security policy was empty or unrecognized — no policy to evaluate ${name}@${version} against`,
        )
      }
      artifacts = rawArtifacts
      policyRules = rules
    } catch (e) {
      logger.fail(
        `Scan gate: reading scan results threw for ${name}@${version} (${errorMessage(e)}).`,
      )
      return scanRefused(
        `reading full scan ${scanId} threw for ${name}@${version}: ${errorMessage(e)}`,
      )
    }
    const summary = summarizePolicyAlerts(artifacts, policyRules)
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
