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
} from '../lib/telemetry-scan.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

function main(): number {
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
      `[telemetry-deps-are-reviewed] no unreviewed telemetry SDKs (${reviewed} reviewed + tolerated).`,
    )
  }
  return 0
}

if (isMainModule(import.meta.url)) {
  main()
}
