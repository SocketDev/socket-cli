#!/usr/bin/env node
/**
 * @file `check --all` gate (fail-closed): no dependency or external tool ships
 *   a telemetry / analytics SDK that hasn't been REVIEWED. Scans every lockfile
 *   \+ external-tools manifest (pnpm-lock.yaml, uv.lock, external-tools.json)
 *   for known telemetry SDK names (Sentry, PostHog, Segment, Amplitude,
 *   Datadog, OpenTelemetry SDK/exporters, langfuse, …) and FAILS on any that
 *   isn't in the reviewed baseline (lib/telemetry-scan.mts REVIEWED_TELEMETRY).
 *   So a dep update or a newly-pulled tool that ADDS a telemetry SDK is caught
 *   at commit time and forced through a human review + an explicit
 *   accept-with-reason — the operator's "never silently phone home" rule, as
 *   law. Per-tool runtime telemetry that isn't a third-party SDK (e.g.
 *   headroom's own beacon) is covered by that tool's lockdown gate; this is the
 *   dep-surface arm. Runs in update.mts too, so every software update
 *   re-checks. Usage: node scripts/fleet/check/telemetry-deps-are-reviewed.mts
 *   [--quiet]
 */

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import {
  REVIEWED_TELEMETRY,
  scanRepoForTelemetry,
  telemetryScanSurface,
} from '../lib/telemetry-scan.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

function main(): number {
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
  if (scanned === 0) {
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
    process.exitCode = 1
    return 1
  }
  const unreviewed = scanRepoForTelemetry(REPO_ROOT)
  if (unreviewed.length) {
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
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    const reviewed = Object.keys(REVIEWED_TELEMETRY).length
    logger.success(
      `[telemetry-deps-are-reviewed] no unreviewed telemetry SDKs across ${scanned} lockfile(s)/manifest(s) (${reviewed} reviewed + tolerated).`,
    )
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  main()
}
