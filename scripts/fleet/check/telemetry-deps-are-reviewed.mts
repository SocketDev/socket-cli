#!/usr/bin/env node
/**
 * @file `check --all` gate (fail-closed): no dependency or external tool ships
 *   a telemetry / analytics SDK that hasn't been REVIEWED. Two arms run, and
 *   either one failing fails the gate.
 *   NAME arm — scans every lockfile + external-tools manifest
 *   (pnpm-lock.yaml, uv.lock, external-tools.json) for known telemetry SDK
 *   names (Sentry, PostHog, Segment, Amplitude, Datadog, OpenTelemetry
 *   SDK/exporters, langfuse, …) and FAILS on any that isn't in
 *   lib/telemetry-scan.mts REVIEWED_TELEMETRY.
 *   PAYLOAD arm — a name list cannot see a dependency that inlines its
 *   analytics client into its own bundle: nothing analytics-named reaches the
 *   lockfile. So this arm streams the installed `dist`/`build`/`lib`/… files
 *   for analytics INGEST HOSTNAMES and unambiguous PUBLIC-KEY PREFIXES, and
 *   FAILS on any match that isn't in lib/telemetry-payload-scan.mts
 *   REVIEWED_TELEMETRY_PAYLOADS. Key matches are redacted to a prefix + length.
 *   So a dep update or a newly-pulled tool that ADDS telemetry — by name OR by
 *   bundled bytes — is caught at commit time and forced through a human review
 *   \+ an explicit accept-with-reason: the operator's "never silently phone
 *   home" rule, as law. Per-tool runtime telemetry that isn't a third-party
 *   SDK (e.g. headroom's own beacon) is covered by that tool's lockdown gate.
 *   The name arm runs in update.mts too, so every software update re-checks.
 *   Usage: node scripts/fleet/check/telemetry-deps-are-reviewed.mts [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import {
  scanInstalledTelemetryPayloads,
  unreviewedPayloadFindings,
} from '../lib/telemetry-payload-scan.mts'
import { REVIEWED_TELEMETRY_PAYLOADS } from '../lib/telemetry-payload-shapes.mts'
import {
  REVIEWED_TELEMETRY,
  scanRepoForTelemetry,
  telemetryScanSurface,
} from '../lib/telemetry-scan.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { TelemetryPayloadScanResult } from '../lib/telemetry-payload-scan.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// Human-readable MiB for a byte count, one decimal.
function formatMiB(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`
}

// Fail-loud, four-ingredient report for the payload arm's fail set. Key
// matches arrive already redacted to a prefix + length, so nothing printed
// here can leak a usable credential.
function reportPayloadFailures(result: TelemetryPayloadScanResult): void {
  const unreviewed = unreviewedPayloadFindings(result.findings)
  logger.fail(
    '[telemetry-deps-are-reviewed] bundled telemetry shape(s) found in installed payloads but NOT reviewed:',
  )
  logger.error(
    `  What:   ${unreviewed.length} analytics ingest host / public-key shape(s) are baked into a dependency's shipped bundle, where the package-name scan cannot see them.`,
  )
  logger.error(
    '  Where:  the package + file below; matcher is scripts/fleet/lib/telemetry-payload-scan.mts.',
  )
  logger.error('  Saw:    wanted zero unreviewed shapes, saw:')
  for (let i = 0, { length } = unreviewed; i < length; i += 1) {
    const finding = unreviewed[i]!
    logger.error(
      `    x ${finding.packageName}@${finding.packageVersion} [${finding.shapeId}] ${finding.vendor}: ${finding.redacted}`,
    )
    logger.error(`      in ${finding.file}`)
  }
  logger.error(
    '  Fix:    audit the package (does it post on import? on every invocation? is there an opt-out env var?),',
  )
  logger.error(
    '          then EITHER neutralize it (drop the dep, pnpm override, enforce the opt-out at a launch chokepoint)',
  )
  logger.error(
    '          OR, if the match is not a destination (a tracker catalog, a doc fixture, an endpoint allowlist),',
  )
  logger.error(
    '          add its `<package>::<shape-id>` key to REVIEWED_TELEMETRY_PAYLOADS in',
  )
  logger.error(
    '          scripts/fleet/lib/telemetry-payload-scan.mts with the reason. Never delete the shape to quiet one',
  )
  logger.error(
    '          package — that blinds the gate for every other one. The sfw CDN allowlist must still block the host.',
  )
}

// The byte / value-shape arm. Returns the exit code for this arm alone.
function runPayloadArm(quiet: boolean): number {
  const result = scanInstalledTelemetryPayloads(REPO_ROOT)
  if (!result.installed) {
    // Not installed is an explicit SKIP, never a pass: the arm measured
    // nothing, and saying so keeps a dependency-free CI job from reading as a
    // clean payload scan.
    logger.warn(
      `[telemetry-deps-are-reviewed] payload arm SKIPPED — no pnpm store at ${result.storeDir}. Run an install for a payload verdict.`,
    )
    return 0
  }
  if (result.packagesScanned === 0) {
    logger.fail(
      '[telemetry-deps-are-reviewed] payload arm scanned 0 packages — this is NOT a pass (vacuous scan).',
    )
    logger.error(
      `  What:   the pnpm store exists but yielded no readable installed manifest.`,
    )
    logger.error(
      '  Where:  scripts/fleet/lib/telemetry-payload-scan.mts listInstalledPackageDirs().',
    )
    logger.error(
      `  Saw:    0 packages under ${result.storeDir}; wanted at least one.`,
    )
    logger.error(
      '  Fix:    re-run `pnpm install` from the repo root, then re-run this check.',
    )
    return 1
  }
  if (unreviewedPayloadFindings(result.findings).length) {
    reportPayloadFailures(result)
    return 1
  }
  if (!quiet) {
    const reviewed = Object.keys(REVIEWED_TELEMETRY_PAYLOADS).length
    logger.success(
      `[telemetry-deps-are-reviewed] payload arm clean — ${result.packagesScanned} package(s), ` +
        `${result.filesScanned} file(s), ${formatMiB(result.bytesScanned)} in ${result.elapsedMs}ms. ` +
        `Skipped ${result.filesSkippedTooLarge} file(s) over the size cap and truncated ` +
        `${result.packagesTruncated} package(s) at the file cap; ${reviewed} match(es) reviewed + tolerated.`,
    )
  }
  return 0
}

export function main(): number {
  const quiet = process.argv.includes('--quiet')
  // A gate that opened no files is not a pass. The scan silently matched zero
  // uv.lock files for months because its glob skipped dot directories, so it
  // reported green in the very repo that OWNS the uv payload while the same
  // lockfiles failed in a member. Report the surface, and fail when it is
  // empty rather than let a mis-scoped glob read as clean.
  const surface = telemetryScanSurface(REPO_ROOT)
  const scanned =
    surface.externalToolsFiles.length +
    surface.pnpmLockFiles.length +
    surface.uvLockFiles.length
  // Both arms always run and their verdicts are accumulated, so one red arm
  // never hides the other's findings from the operator reading the output.
  let failed = false
  if (scanned === 0) {
    failed = true
    logger.fail(
      '[telemetry-deps-are-reviewed] scanned 0 files — this is NOT a pass (vacuous scan).',
    )
    logger.error(
      `  What:   the dep-surface scan found no pnpm-lock.yaml, no uv.lock, and no external-tools.json under ${REPO_ROOT}.`,
    )
    logger.error(
      '  Where:  scripts/fleet/lib/telemetry-scan.mts telemetryScanSurface().',
    )
    logger.error(
      '  Saw:    0 lockfile(s) / manifest(s) opened; wanted at least one, or an explicit reason this repo has no dep surface.',
    )
    logger.error(
      '  Fix:    check the glob scoping (dot directories need `dot: true`) and that the repo really carries no lockfile.',
    )
  }
  const unreviewed = scanned === 0 ? [] : scanRepoForTelemetry(REPO_ROOT)
  if (unreviewed.length) {
    failed = true
    logger.fail(
      '[telemetry-deps-are-reviewed] telemetry / analytics SDK(s) present but NOT reviewed:',
    )
    for (let i = 0, { length } = unreviewed; i < length; i += 1) {
      logger.error(`  ✗ ${unreviewed[i]!}`)
    }
    logger.error(
      '  A dependency update or a new external tool pulled in a telemetry SDK.',
    )
    logger.error(
      '  Fix: audit it (default-on? needs a key? endpoint?), then EITHER neutralize',
    )
    logger.error(
      '  it (pnpm override / env opt-out / drop the tool) OR, if genuinely inert,',
    )
    logger.error(
      '  add it to REVIEWED_TELEMETRY in scripts/fleet/lib/telemetry-scan.mts with',
    )
    logger.error(
      '  the reason it is tolerated. The sfw CDN allowlist must still block its host.',
    )
  }
  if (!failed && !quiet) {
    const reviewed = Object.keys(REVIEWED_TELEMETRY).length
    logger.success(
      `[telemetry-deps-are-reviewed] no unreviewed telemetry SDKs across ${scanned} lockfile(s)/manifest(s) (${reviewed} reviewed + tolerated).`,
    )
  }
  failed = runPayloadArm(quiet) === 1 || failed
  if (failed) {
    process.exitCode = 1
    return 1
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks no lockfile, external tool, or installed bundle ships unreviewed telemetry',
  help: `Usage: node scripts/fleet/check/telemetry-deps-are-reviewed.mts [flags]
  --quiet  suppress the per-arm success messages`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
