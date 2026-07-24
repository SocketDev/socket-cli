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
// excluded on purpose — `opentelemetry-api` alone cannot export (no exporter),
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
// (or judged inert), each with the reason it is tolerated. The scanner FAILS on
// any telemetry SDK NOT listed here — i.e. one ADDED by a dependency update or a
// newly-pulled external tool. Keep this short + justified; it is the exact
// reviewed set, not an escape hatch. Re-review on every bump.
export const REVIEWED_TELEMETRY: Readonly<Record<string, string>> = {
  __proto__: null,
  // No telemetry SDK is currently tolerated in the tree. A telemetry SDK that
  // shows up here (via a dependency update or a newly-pulled tool) FAILS the
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

// Every dependency / tool name across the repo's lockfiles + external-tools
// manifests (pnpm-lock.yaml, every uv.lock, external-tools.json). The union the
// telemetry scan runs against.
export function extractDepNames(repoRoot: string): string[] {
  const names = new Set<string>()
  const pnpmLock = path.join(repoRoot, 'pnpm-lock.yaml')
  if (existsSync(pnpmLock)) {
    for (const n of namesFromPnpmLock(readFileSync(pnpmLock, 'utf8'))) {
      names.add(n)
    }
  }
  const uvLocks = globSync(['**/uv.lock'], {
    cwd: repoRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**'],
  })
  for (let i = 0, { length } = uvLocks; i < length; i += 1) {
    for (const n of namesFromUvLock(readFileSync(uvLocks[i]!, 'utf8'))) {
      names.add(n)
    }
  }
  const extTools = globSync(['**/external-tools.json'], {
    cwd: repoRoot,
    absolute: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/build/**'],
  })
  for (let i = 0, { length } = extTools; i < length; i += 1) {
    for (const n of namesFromExternalTools(
      readFileSync(extTools[i]!, 'utf8'),
    )) {
      names.add(n)
    }
  }
  return [...names].toSorted()
}
