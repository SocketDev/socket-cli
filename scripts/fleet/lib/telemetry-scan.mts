/**
 * @file Telemetry / phone-home scanner for the fleet's dependency +
 *   external-tool surface. Detects when a dependency we pull in (npm / PyPI /
 *   cargo) or an external tool ships a known telemetry / analytics SDK. Run on
 *   every software update (scripts/fleet/update.mts) and as a `check --all`
 *   gate (check/deps-are-telemetry-reviewed.mts), fail-closed: a telemetry SDK
 *   that is NOT in REVIEWED_TELEMETRY (i.e. one ADDED by an update or a new
 *   tool) fails, forcing a human review + an explicit accept-with-reason. This
 *   is name-based detection (high-signal SDK package names), not deep static
 *   analysis — it catches the common case (a dep adds Sentry/PostHog/Segment/…)
 *   cheaply and deterministically. Per-tool runtime telemetry that isn't a
 *   third-party SDK (e.g. headroom's own beacon) is handled by that tool's
 *   lockdown (see headroom-is-telemetry-locked-down.mts). The sfw CDN allowlist
 *   is the runtime backstop regardless.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

import { globSync } from '@socketsecurity/lib-stable/globs/match'

// Known telemetry / analytics / phone-home SDK package-name patterns across npm,
// PyPI, and cargo. High-signal: SDKs that SHIP usage data. Inert APIs are
// excluded on purpose — `opentelemetry-api` alone cannot export, no exporter,
// so it is NOT listed; the SDK + exporters CAN, so they are.
export const TELEMETRY_SDKS: readonly RegExp[] = [
  /^@sentry\//,
  /^sentry(-sdk)?$/,
  /^@posthog\//,
  /^posthog(-js|-node|-python|ai)?$/,
  /^mixpanel/,
  /^@segment\//,
  /^(analytics-node|analytics-python|segment-analytics-python)$/,
  /^@amplitude\//,
  /^amplitude(-js|-analytics|-analytics-browser)?$/,
  /^(datadog|dd-trace|ddtrace)$/,
  /^@datadog\//,
  /^opentelemetry-sdk$/,
  /^opentelemetry-exporter-/,
  /^@opentelemetry\/(exporter|sdk)/,
  /^@scarf\/scarf$/,
  /^scarf$/,
  /^applicationinsights$/,
  /^@microsoft\/applicationinsights/,
  /^@bugsnag\//,
  /^bugsnag/,
  /^rollbar$/,
  /^logrocket/,
  /^@fullstory\//,
  /^(statsig|statsig-node)$/,
  /^@statsig\//,
  /^heap-api$/,
  /^@vercel\/analytics$/,
  /^hotjar/,
  // LLM-observability backends that ship traces/usage to a vendor cloud.
  /^langfuse$/,
  /^@langfuse\//,
]

// Telemetry SDKs already present in the tree that have been REVIEWED + accepted
// or judged inert, each with the reason it is tolerated. The scanner FAILS on
// any telemetry SDK NOT listed here — i.e. one ADDED by a dependency update or a
// newly-pulled external tool. Keep this short + justified; it is the exact
// reviewed set, not an escape hatch. Re-review on every bump.
//
// "It probably never fires" is NOT a reason to list an SDK here. An entry means
// the SDK cannot export — no exporter in the closure, or an opt-out enforced at
// a launch chokepoint the fleet owns. A vendored tool whose closure carries a
// real OTLP exporter gets the headroom treatment instead: set the off-switch in
// the tool's launcher lib and gate it with a check, then the SDK is inert by
// construction and the entry states which chokepoint holds it off. Reaching for
// this map to quiet a red gate is the anti-pattern it exists to stop.
export const REVIEWED_TELEMETRY: Readonly<Record<string, string>> = {
  __proto__: null,
  // No telemetry SDK is currently tolerated in the tree. A telemetry SDK that
  // shows up here, via a dependency update or a newly-pulled tool, FAILS the
  // scan until it is reviewed and re-added with its justification. (PostHog was
  // dropped with @rely-ai/caliber — the only SDK that had pulled it in.)
} as unknown as Record<string, string>

export function matchesTelemetrySdk(name: string): boolean {
  for (let i = 0, { length } = TELEMETRY_SDKS; i < length; i += 1) {
    if (TELEMETRY_SDKS[i]!.test(name)) {
      return true
    }
  }
  return false
}

// Telemetry SDK names found among `names`, sorted + de-duped.
export function findTelemetryDeps(names: Iterable<string>): string[] {
  const out = new Set<string>()
  for (const n of names) {
    if (matchesTelemetrySdk(n)) {
      out.add(n)
    }
  }
  return [...out].toSorted()
}

// Telemetry SDKs present but NOT in the reviewed baseline — the fail set.
export function unreviewedTelemetry(names: Iterable<string>): string[] {
  return findTelemetryDeps(names).filter(n => !(n in REVIEWED_TELEMETRY))
}

// Pull npm package names out of a pnpm-lock.yaml. Package keys look like
// `  'posthog-node@5.33.4':`, `  posthog-node@5.33.4:`, or `  /scoped@1.0.0:`.
export function namesFromPnpmLock(text: string): string[] {
  const out = new Set<string>()
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    // capture group 1: the package name (optionally @scope/) before the `@version`.
    const m =
      /^\s+'?\/?(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)@[^\s':]+'?:/.exec(
        lines[i]!,
      )
    if (m) {
      out.add(m[1]!)
    }
  }
  return [...out]
}

// Pull package names out of a uv.lock (`name = "X"` per [[package]]).
export function namesFromUvLock(text: string): string[] {
  const out = new Set<string>()
  const lines = text.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = /^name = "([^"]+)"/.exec(lines[i]!)
    if (m) {
      out.add(m[1]!)
    }
  }
  return [...out]
}

// Pull package names out of external-tools.json purls (`pkg:npm/name@…`,
// `pkg:pypi/name@…`) — the tool surface we pull in.
export function namesFromExternalTools(text: string): string[] {
  const out = new Set<string>()
  // capture the package name segment of a purl, scope-aware.
  const re =
    /pkg:(?:cargo|npm|pypi)\/(@?[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)?)/g
  let m: RegExpExecArray | null = re.exec(text)
  while (m) {
    out.add(m[1]!)
    m = re.exec(text)
  }
  return [...out]
}

// The one telemetry-scan operation both the `check --all` gate and update.mts
// run: scan the repo's whole dep/tool surface and return the unreviewed
// telemetry SDKs (the fail set, empty = clean).
export function scanRepoForTelemetry(repoRoot: string): string[] {
  return unreviewedTelemetry(extractDepNames(repoRoot))
}

/**
 * What a scan actually READ. The gate reports these counts so a scan that
 * matched nothing is visible as a vacuous run instead of a green.
 */
export interface TelemetryScanSurface {
  readonly externalToolsFiles: readonly string[]
  readonly pnpmLockFiles: readonly string[]
  readonly uvLockFiles: readonly string[]
}

// `dot: true` is load-bearing. The fleet's uv projects and tool manifests live
// under DOT directories — `.claude/hooks/fleet/setup-security-tools/…`,
// `.config/repo/…`, `.github/actions/fleet/…` — and tinyglobby's `**` does not
// descend into a dot directory without it. Omitting it made the uv arm match
// ZERO files in the repo that OWNS the payload while the very same lockfiles
// failed the gate in a member, so the scan reported green on a surface it had
// never opened.
const GLOB_IGNORE: readonly string[] = ['**/.git/**', '**/node_modules/**']

/**
 * Every lockfile / tool manifest the telemetry scan reads, resolved absolute.
 */
export function telemetryScanSurface(repoRoot: string): TelemetryScanSurface {
  const pnpmLock = path.join(repoRoot, 'pnpm-lock.yaml')
  return {
    externalToolsFiles: globSync(['**/external-tools.json'], {
      cwd: repoRoot,
      absolute: true,
      dot: true,
      ignore: [...GLOB_IGNORE, '**/build/**'],
    }),
    pnpmLockFiles: existsSync(pnpmLock) ? [pnpmLock] : [],
    uvLockFiles: globSync(['**/uv.lock'], {
      cwd: repoRoot,
      absolute: true,
      dot: true,
      ignore: [...GLOB_IGNORE, '**/build/**'],
    }),
  }
}

// Every dependency / tool name across the repo's lockfiles + external-tools
// manifests (pnpm-lock.yaml, every uv.lock, external-tools.json). The union the
// telemetry scan runs against.
export function extractDepNames(repoRoot: string): string[] {
  const names = new Set<string>()
  const surface = telemetryScanSurface(repoRoot)
  const { externalToolsFiles, pnpmLockFiles, uvLockFiles } = surface
  for (let i = 0, { length } = pnpmLockFiles; i < length; i += 1) {
    for (const n of namesFromPnpmLock(
      readFileSync(pnpmLockFiles[i]!, 'utf8'),
    )) {
      names.add(n)
    }
  }
  for (let i = 0, { length } = uvLockFiles; i < length; i += 1) {
    for (const n of namesFromUvLock(readFileSync(uvLockFiles[i]!, 'utf8'))) {
      names.add(n)
    }
  }
  for (let i = 0, { length } = externalToolsFiles; i < length; i += 1) {
    for (const n of namesFromExternalTools(
      readFileSync(externalToolsFiles[i]!, 'utf8'),
    )) {
      names.add(n)
    }
  }
  return [...names].toSorted()
}
