#!/usr/bin/env node
/**
 * @file Doc-integrity gate for the fleet hook registry
 *   (`docs/agents.md/fleet/hook-registry.md`). The registry is the canonical
 *   per-hook listing CLAUDE.md defers to; it has historically drifted (bullets
 *   for renamed hooks left behind, new hooks never added). This asserts the one
 *   invariant that is unambiguous and false-positive-free: Every `- \`<name>``
 *   bullet in the registry names a REAL fleet hook directory
 *   (`.claude/hooks/fleet/<name>/`). A bullet with no matching dir is a stale
 *   or misnamed entry — it points a reader at policy that doesn't exist. That
 *   is a hard FAIL (exit 1). Completeness (every real hook dir appears in the
 *   registry) is REPORTED, not enforced: many hooks are deliberately
 *   undocumented internal tooling, and a hard completeness gate would need a
 *   hand-maintained exempt-set that itself drifts. The report names the
 *   undocumented hooks so the gap stays visible without blocking. Exit codes: 0
 *   — no stale bullets; 1 — stale bullet(s).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const REGISTRY_PATH = path.join(
  REPO_ROOT,
  'docs',
  'agents.md',
  'fleet',
  'hook-registry.md',
)
const FLEET_HOOKS_DIR = path.join(REPO_ROOT, '.claude', 'hooks', 'fleet')

// Bullet shape: `- \`<name>\` — description`. Captures the backticked hook id.
const REGISTRY_BULLET_RE = /^- `([a-z0-9-]+)`/gm

// A bullet is "capability-gated" when its prose declares the hook installs only
// in repos opting into a capability — the canonical phrasing cites the hook's
// `@socket-capability <cap>` header. Such a hook is LEGITIMATELY absent from any
// repo that doesn't declare that capability (the cascade's dir-mirror copy
// filter skips it), so its bullet must NOT be flagged stale there. The registry
// markdown is byte-identical in every repo, so this signal travels downstream
// even though the hook DIRECTORY does not. Capture the whole bullet line so we
// can pair each hook id with its own text.
//
// Regex parts:
//   ^- `         a registry bullet opens with "- `" at line start.
//   ([a-z0-9-]+) the hook id (kebab-case), captured.
//   `            closing backtick of the id.
//   [^\n]*       the rest of the bullet's first line (its prose).
const REGISTRY_BULLET_LINE_RE = /^- `([a-z0-9-]+)`[^\n]*/gm

// Marker in a bullet's prose that flags the hook as capability-gated. Matches
// the canonical phrasing `@socket-capability <cap>` (in backticks in the prose).
const CAPABILITY_GATED_RE = /@socket-capability\s+[a-z0-9-]+/

// The real fleet hook directory names (every `.claude/hooks/fleet/<name>/`
// except the shared-utility dir, which is not a hook).
export function realFleetHooks(fleetHooksDir: string): Set<string> {
  if (!existsSync(fleetHooksDir)) {
    return new Set()
  }
  const names = readdirSync(fleetHooksDir, { withFileTypes: true })
    .filter(e => e.isDirectory() && e.name !== '_shared')
    .map(e => e.name)
  return new Set(names)
}

// Every hook id cited as a registry bullet.
export function registryBullets(registryText: string): string[] {
  const ids: string[] = []
  let m
  while ((m = REGISTRY_BULLET_RE.exec(registryText)) !== null) {
    ids.push(m[1]!)
  }
  return ids
}

// Hook ids whose bullet declares them capability-gated. These are legitimately
// absent in repos that don't opt into the capability, so a missing dir is NOT
// staleness for them.
export function capabilityGatedBullets(registryText: string): Set<string> {
  const gated = new Set<string>()
  let m
  while ((m = REGISTRY_BULLET_LINE_RE.exec(registryText)) !== null) {
    if (CAPABILITY_GATED_RE.test(m[0])) {
      gated.add(m[1]!)
    }
  }
  return gated
}

// Bullets that name no real hook dir (stale / misnamed) — the hard-fail set.
// A capability-gated bullet whose hook is absent is NOT stale: the cascade
// intentionally skips installing it in repos lacking the capability, yet the
// canonical registry (identical in every repo) still documents it.
export function staleBullets(
  bullets: readonly string[],
  real: ReadonlySet<string>,
  capabilityGated: ReadonlySet<string> = new Set(),
): string[] {
  // oxlint-disable-next-line unicorn/no-array-sort -- .filter() already returns a fresh array (no shared mutation); .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  return bullets.filter(id => !real.has(id) && !capabilityGated.has(id)).sort()
}

function main(): void {
  if (!existsSync(REGISTRY_PATH)) {
    logger.success('No hook-registry.md to check.')
    return
  }
  const real = realFleetHooks(FLEET_HOOKS_DIR)
  const registryText = readFileSync(REGISTRY_PATH, 'utf8')
  const bullets = registryBullets(registryText)
  const capabilityGated = capabilityGatedBullets(registryText)
  const stale = staleBullets(bullets, real, capabilityGated)

  // Report (non-fatal) undocumented hooks so the completeness gap stays visible.
  const documented = new Set(bullets)
  // oxlint-disable-next-line unicorn/no-array-sort -- spread already copies; .toSorted() would trip socket/no-runtime-features-below-engine-floor in cascaded Node-18 repos.
  const undocumented = [...real].filter(h => !documented.has(h)).sort()
  if (undocumented.length > 0) {
    logger.info(
      `hook-registry.md omits ${undocumented.length} fleet hook(s) (not fatal): ${undocumented.join(', ')}`,
    )
  }

  if (stale.length > 0) {
    logger.error(
      [
        `hook-registry.md has ${stale.length} stale bullet(s) — each names a hook that does not exist under .claude/hooks/fleet/:`,
        ...stale.map(
          id =>
            `  - \`${id}\` — rename to the real hook id, or remove the bullet`,
        ),
      ].join('\n'),
    )
    process.exitCode = 1
    return
  }
  logger.success(
    `hook-registry.md is current — all ${bullets.length} bullets name real fleet hooks.`,
  )
}

if (process.argv[1]?.endsWith('hook-registry-is-current.mts')) {
  main()
}
