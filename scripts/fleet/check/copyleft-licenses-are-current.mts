#!/usr/bin/env node
/*
 * @file Release/CI gate: the SPDX id pinned for every copyleft upstream still
 *   matches reality. `_shared/copyleft-upstreams.mts` records `spdx` as the
 *   pinned EXPECTATION that drives the `no-copyleft-source-read` block; this
 *   is the watchdog on that pin. Socket's own API is the authoritative,
 *   machine-readable source: a batch package fetch with
 *   `include_license_details` returns `licenseDetails[].spdxDisj`, an SPDX
 *   expression in disjunctive normal form, plus a `match_strength` confidence
 *   and an `errorData` field, with the artifact's top-level `license` as the
 *   summary fallback.
 *
 *   An upstream silently relicensing is exactly what poisons a derivation
 *   months later: trufflehog itself moved GPL-2.0 to AGPL-3.0 at v3.0. Two
 *   versions are probed per entry — the recorded `verifiedVersion` as a
 *   regression anchor, and the upstream's newest GitHub release tag as the
 *   drift probe, which fires the day a relicense ships rather than whenever
 *   someone next bumps a pin.
 *
 *   NETWORK DISCIPLINE. This check is offline-safe and never fails closed on
 *   connectivity. No token, no network, an API error, an unresolved purl, an
 *   empty license payload, a low `match_strength`, or a non-empty `errorData`
 *   all yield UNVERIFIED — reported as a notice, exit 0. Only a CONFIDENT
 *   reading that disagrees with the pin fails, and it names both values. It is
 *   registered as a `releaseStep`, so the interactive `check --all` loop stays
 *   offline while CI and the pre-push gate carry it.
 *
 *   Exit: 0 — every pin confirmed, or unverifiable; 1 — a confident mismatch.
 *   Usage: node scripts/fleet/check/copyleft-licenses-are-current.mts [--quiet]
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { readSocketApiToken } from '@socketsecurity/lib-stable/secrets/socket-api-token'
import { SocketSdk } from '@socketsecurity/sdk-stable'

import { COPYLEFT_UPSTREAMS } from '../../../.claude/hooks/fleet/_shared/copyleft-upstreams.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

import type { CopyleftUpstream } from '../../../.claude/hooks/fleet/_shared/copyleft-upstreams.mts'

const logger = getDefaultLogger()

// Below this `match_strength` the detected license is a guess, not a finding.
// A weak reading must never be reported as a mismatch — the fail-safe direction
// for a watchdog is to stay quiet rather than cry wolf on a pin that is right.
const MIN_MATCH_STRENGTH = 0.8

/**
 * One probe's verdict. `unverified` carries the reason so a skip is never
 * silent — an operator can tell "the API said MIT" from "there was no token".
 */
export interface LicenseProbeResult {
  readonly observed?: string | undefined
  readonly purl: string
  readonly reason?: string | undefined
  readonly upstream: CopyleftUpstream
  readonly verdict: 'match' | 'mismatch' | 'unverified'
}

/**
 * The shape this check reads off a Socket batch-fetch artifact. Declared
 * locally and narrowly so the SDK's much wider response type does not leak
 * into the comparison logic.
 */
export interface SocketLicenseArtifact {
  readonly license?: string | undefined
  readonly licenseDetails?:
    | ReadonlyArray<{
        readonly errorData?: string | undefined
        readonly match_strength?: number | undefined
        readonly spdxDisj?: string | undefined
      }>
    | undefined
}

/**
 * Compare a pinned SPDX id against Socket's reading of one artifact. Pure — the
 * whole verdict rule in one testable function.
 *
 * `licenseDetails` is preferred: it is per-file evidence with a confidence
 * score. When it is absent or empty the artifact's summary `license` is used,
 * which is what Socket returns for ecosystems it has no per-file detail for. A
 * detail entry carrying `errorData`, or scoring below the confidence floor, is
 * treated as no evidence at all rather than as disagreement.
 */
export function judgeLicenseAgainstPin(
  pinnedSpdx: string,
  artifact: SocketLicenseArtifact | undefined,
): {
  observed?: string | undefined
  reason?: string | undefined
  verdict: LicenseProbeResult['verdict']
} {
  if (!artifact) {
    return { reason: 'purl did not resolve', verdict: 'unverified' }
  }
  const details = artifact.licenseDetails ?? []
  for (let i = 0, { length } = details; i < length; i += 1) {
    const detail = details[i]!
    if (detail.errorData) {
      return {
        reason: `license parsing reported an error: ${detail.errorData}`,
        verdict: 'unverified',
      }
    }
    const strength = detail.match_strength ?? 0
    if (strength < MIN_MATCH_STRENGTH) {
      return {
        reason: `match_strength ${strength} is below the ${MIN_MATCH_STRENGTH} floor`,
        verdict: 'unverified',
      }
    }
    const spdxDisj = detail.spdxDisj ?? ''
    if (spdxDisj === '') {
      continue
    }
    return spdxDisj.includes(pinnedSpdx)
      ? { observed: spdxDisj, verdict: 'match' }
      : { observed: spdxDisj, verdict: 'mismatch' }
  }
  const summary = artifact.license ?? ''
  if (summary === '') {
    return { reason: 'no license data in the response', verdict: 'unverified' }
  }
  return summary.includes(pinnedSpdx)
    ? { observed: summary, verdict: 'match' }
    : { observed: summary, verdict: 'mismatch' }
}

/**
 * The newest release tag for an upstream, or undefined when GitHub is
 * unreachable, unauthenticated, or the repo publishes no releases. Best-effort
 * by contract: an unresolved tag downgrades the drift probe to a notice, it
 * never fails the gate.
 */
export async function resolveLatestReleaseTag(
  upstream: CopyleftUpstream,
): Promise<string | undefined> {
  try {
    const result = (await spawn(
      'gh',
      [
        'api',
        `repos/${upstream.owner}/${upstream.repo}/releases/latest`,
        '--jq',
        '.tag_name',
      ],
      { stdio: 'pipe', stdioString: true },
    )) as { stdout?: string | undefined }
    const tag = String(result?.stdout ?? '').trim()
    return tag === '' ? undefined : tag
  } catch {
    return undefined
  }
}

/**
 * Probe one `<purl>@<version>` through Socket's license data.
 */
export async function probeCopyleftLicense(
  sdk: SocketSdk,
  upstream: CopyleftUpstream,
  version: string,
): Promise<LicenseProbeResult> {
  const purl = `${upstream.purl}@${version}`
  let artifact: SocketLicenseArtifact | undefined
  try {
    const response = (await sdk.batchPackageFetch(
      { components: [{ purl }] },
      { include_license_details: true },
    )) as {
      data?: SocketLicenseArtifact[] | undefined
      status?: number | undefined
      success?: boolean | undefined
    }
    // A rejected call throws, but an auth / quota / server refusal comes back
    // as `success: false` with no data. Reporting that as "purl did not
    // resolve" would misname a credential problem as a roster problem, so the
    // transport verdict is read BEFORE the payload is judged.
    if (response?.success === false) {
      return {
        purl,
        reason: `Socket API returned status ${response.status ?? 'unknown'} — the pin was not verified`,
        upstream,
        verdict: 'unverified',
      }
    }
    artifact = response?.data?.[0]
  } catch (e) {
    return {
      purl,
      reason: `Socket API call failed: ${errorMessage(e)}`,
      upstream,
      verdict: 'unverified',
    }
  }
  const judged = judgeLicenseAgainstPin(upstream.spdx, artifact)
  return {
    observed: judged.observed,
    purl,
    reason: judged.reason,
    upstream,
    verdict: judged.verdict,
  }
}

/**
 * Probe every roster entry at its regression anchor and its newest release.
 */
export async function probeAllCopyleftLicenses(
  sdk: SocketSdk,
): Promise<LicenseProbeResult[]> {
  const results: LicenseProbeResult[] = []
  for (let i = 0, { length } = COPYLEFT_UPSTREAMS; i < length; i += 1) {
    const upstream = COPYLEFT_UPSTREAMS[i]!
    const versions = [upstream.verifiedVersion]
    const latest = await resolveLatestReleaseTag(upstream)
    if (latest && latest !== upstream.verifiedVersion) {
      versions.push(latest)
    }
    for (let j = 0, { length: vlen } = versions; j < vlen; j += 1) {
      results.push(await probeCopyleftLicense(sdk, upstream, versions[j]!))
    }
  }
  return results
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const token = await readSocketApiToken()
  if (!token) {
    logger.warn(
      'copyleft-licenses-are-current: SKIPPED — no Socket API token available.\n' +
        '  The license pins in _shared/copyleft-upstreams.mts were NOT verified this run.\n' +
        '  Fix: run `pnpm run setup:1-token` to persist a token to the OS keychain.',
    )
    process.exitCode = 0
    return
  }
  let results: LicenseProbeResult[]
  try {
    results = await probeAllCopyleftLicenses(new SocketSdk(token))
  } catch (e) {
    logger.warn(
      `copyleft-licenses-are-current: SKIPPED — the Socket API was unreachable: ${errorMessage(e)}`,
    )
    process.exitCode = 0
    return
  }
  const mismatches = results.filter(r => r.verdict === 'mismatch')
  const unverified = results.filter(r => r.verdict === 'unverified')
  for (let i = 0, { length } = unverified; i < length; i += 1) {
    const r = unverified[i]!
    logger.warn(
      `copyleft-licenses-are-current: UNVERIFIED ${r.purl} — ${r.reason ?? 'no evidence'}.`,
    )
  }
  if (mismatches.length === 0) {
    if (!quiet) {
      const confirmed = results.length - unverified.length
      logger.log(
        `copyleft-licenses-are-current: ${confirmed} pin(s) confirmed against Socket license data.`,
      )
    }
    process.exitCode = 0
    return
  }
  logger.fail(
    `copyleft-licenses-are-current: ${mismatches.length} pinned license(s) no longer match reality:`,
  )
  for (let i = 0, { length } = mismatches; i < length; i += 1) {
    const r = mismatches[i]!
    logger.fail(
      `  ${r.purl}: pinned \`${r.upstream.spdx}\`, Socket reports \`${r.observed ?? 'unknown'}\`.`,
    )
  }
  logger.fail(
    '  What:  a copyleft upstream relicensed out from under its pinned SPDX id.\n' +
      '  Where: the purl(s) above.\n' +
      '  Wanted: the `spdx` field in _shared/copyleft-upstreams.mts is the contract\n' +
      "          the read-guard enforces; it must match the upstream's real license.\n" +
      '  Fix:   confirm the new license from the upstream LICENSE file, update `spdx`\n' +
      '         and `verifiedVersion` in _shared/copyleft-upstreams.mts, then RE-EVALUATE\n' +
      '         every derivation from that upstream — a relicense can retroactively\n' +
      '         change what a derived work is obliged to do.\n' +
      '         See docs/agents.md/fleet/copyleft-boundaries.md.',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`copyleft-licenses-are-current failed: ${String(e)}`)
    process.exitCode = 1
  })
}
/* c8 ignore stop */
