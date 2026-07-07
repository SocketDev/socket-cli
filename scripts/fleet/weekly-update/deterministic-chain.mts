/*
 * @file The deterministic half of the weekly update — every step that needs no
 *   model judgment, run IN ORDER before the optional `spawnAiAgent` advisory
 *   pass in weekly-update.mts. Splitting it out keeps the runner thin and the
 *   ordering unit-testable.
 *
 *   Order (each step is skipped when its trigger file is absent, never fails the
 *   run — a non-zero step logs a warn and the chain continues; the AI advisory
 *   pass and CI's own gates catch a genuinely-broken step):
 *
 *   1. lockstep version-pin auto-bumps — when `.config/lockstep.json` (or a root
 *      `lockstep.json`) exists. Drives the canonical lockstep CLI + the
 *      `auto-bump` engine's plan/apply: read the `--json` drift report, fetch
 *      each drifting upstream's tags, resolve the target via the engine's tag
 *      math (`planFromReport`), and land each `auto` row with `applyBump`. The
 *      `advisory` rows (file-fork / feature-parity / locked / no-newer) are left
 *      for the AI pass — they need human judgment, not tag math.
 *   2. submodule bumps — covered by step 1 for version-pinned submodules; a
 *      repo with `.gitmodules` but NO lockstep manifest has only repo-specific
 *      submodule bumps, which stay with the AI pass (no single deterministic
 *      entrypoint). Recorded as a skip note so the remainder is explicit.
 *   3. npm deps — `update.mts` (taze 2-pass + lockfile). Mechanical.
 *   4. package-manager pins — `sync-package-manager-pins.mts` rewrites the
 *      `package.json` pnpm/npm pins from `external-tools.json`.
 *   5. gh-aw action pins — `sync-gh-aw-action-pins.mts` recompiles every tracked
 *      `*.github/workflows/*.md` via `gh aw compile --approve`, refreshing action
 *      SHAs and container image digests in the sibling `.lock.yml` +
 *      `.github/aw/actions-lock.json`. Best-effort when `gh aw` is not installed.
 *
 * The chain mutates the working tree; the caller commits/PRs afterward.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { applyBump, planFromReport } from '../lockstep/auto-bump.mts'
import { readManifest } from '../lockstep/manifest.mts'
import { REPO_ROOT } from '../paths.mts'

import type { Report } from '../lockstep/types.mts'

const logger = getDefaultLogger()

export interface ChainStepResult {
  name: string
  ok: boolean
  note: string | undefined
}

// Resolve the lockstep manifest path. The canonical CLI reads `lockstep.json` at
// the repo root; some repos keep it under `.config/`. Return whichever exists so
// the chain drives the same manifest the gate keyed on.
export function resolveLockstepManifestPath(
  repoRoot: string,
): string | undefined {
  const candidates = [
    path.join(repoRoot, 'lockstep.json'),
    path.join(repoRoot, '.config', 'lockstep.json'),
  ]
  for (let i = 0, { length } = candidates; i < length; i += 1) {
    if (existsSync(candidates[i]!)) {
      return candidates[i]
    }
  }
  return undefined
}

// Run a command capturing stdout; never throws. Mirrors weekly-update.mts.
async function capture(
  cmd: string,
  args: readonly string[],
): Promise<{ ok: boolean; out: string }> {
  try {
    const r = await spawn(cmd, [...args], {
      cwd: REPO_ROOT,
      stdioString: true,
    })
    return { ok: true, out: String(r.stdout ?? '') }
  } catch (e) {
    const err = e as { stdout?: unknown | undefined }
    return { ok: false, out: String(err.stdout ?? '') }
  }
}

// Run a command inheriting stdio; returns true on exit 0. Mirrors
// weekly-update.mts so a non-zero step warns rather than aborts the chain.
async function run(cmd: string, args: readonly string[]): Promise<boolean> {
  try {
    await spawn(cmd, [...args], { cwd: REPO_ROOT, stdio: 'inherit' })
    return true
  } catch {
    return false
  }
}

// Read a lockstep `--json` drift report from the canonical CLI. Returns the
// report rows, or undefined when the CLI emitted no parseable JSON.
export function parseLockstepReport(stdout: string): Report[] | undefined {
  const start = stdout.indexOf('{')
  if (start === -1) {
    return undefined
  }
  try {
    const parsed = JSON.parse(stdout.slice(start)) as {
      reports?: Report[] | undefined
    }
    return parsed.reports
  } catch {
    return undefined
  }
}

// Fetch the stable + pre-release tag list for one submodule path (deterministic
// git, not judgment). A fetch failure yields an empty list — the engine's tag
// resolver then leaves the row advisory rather than throwing.
async function fetchUpstreamTags(submodulePath: string): Promise<string[]> {
  const abs = path.join(REPO_ROOT, submodulePath)
  if (!existsSync(abs)) {
    return []
  }
  await run('git', ['-C', abs, 'fetch', 'origin', '--tags', '--quiet'])
  const tags = await capture('git', ['-C', abs, 'tag'])
  if (!tags.ok) {
    return []
  }
  return tags.out
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
}

// Map a lockstep report's drifting version-pin upstreams to their submodule
// paths via the manifest's `upstreams` table, then to their fetched tag lists.
async function tagsByUpstream(
  manifestPath: string,
  reports: readonly Report[],
): Promise<Record<string, string[]>> {
  const manifest = readManifest(manifestPath)
  const out: Record<string, string[]> = {
    __proto__: null,
  } as unknown as Record<string, string[]>
  for (let i = 0, { length } = reports; i < length; i += 1) {
    const report = reports[i]!
    if (report.kind !== 'version-pin' || report.severity === 'ok') {
      continue
    }
    const submodulePath = manifest.upstreams?.[report.upstream]?.submodule
    if (!submodulePath) {
      continue
    }
    out[report.upstream] = await fetchUpstreamTags(submodulePath)
  }
  return out
}

// Lockstep version-pin auto-bumps. Returns the per-step result; the advisory
// rows are reported in the note so the caller can narrow the AI prompt.
export async function bumpLockstep(): Promise<ChainStepResult> {
  const manifestPath = resolveLockstepManifestPath(REPO_ROOT)
  if (!manifestPath) {
    return { name: 'lockstep', note: 'no manifest — skipped', ok: true }
  }
  const lockstepScript = path.join(
    REPO_ROOT,
    'scripts',
    'fleet',
    'lockstep.mts',
  )
  const report = await capture(process.execPath, [lockstepScript, '--json'])
  const reports = parseLockstepReport(report.out)
  if (!reports) {
    return { name: 'lockstep', note: 'no parseable drift report', ok: true }
  }
  let tags: Record<string, string[]>
  try {
    tags = await tagsByUpstream(manifestPath, reports)
  } catch (e) {
    return { name: 'lockstep', note: errorMessage(e), ok: false }
  }
  const { advisory, auto } = planFromReport(reports, tags)
  let bumped = 0
  for (let i = 0, { length } = auto; i < length; i += 1) {
    const row = auto[i]!
    if (!row.targetTag) {
      continue
    }
    try {
      const result = applyBump({
        id: row.id,
        manifestPath,
        repoRoot: REPO_ROOT,
        targetTag: row.targetTag,
      })
      if (result.state === 'bumped') {
        bumped += 1
      }
    } catch (e) {
      logger.warn(
        `[weekly-update] lockstep bump ${row.id} failed: ${errorMessage(e)}`,
      )
    }
  }
  const advisoryNote = advisory.length
    ? `${advisory.length} advisory row(s) left for the AI pass`
    : 'no advisory rows'
  return {
    name: 'lockstep',
    note: `bumped ${bumped} version-pin row(s); ${advisoryNote}`,
    ok: true,
  }
}

// A repo with submodules but no lockstep manifest has only repo-specific
// submodule bumps, which have no single deterministic entrypoint — they stay
// with the AI advisory pass. Recorded so the remainder is explicit.
export function noteSubmoduleRemainder(): ChainStepResult {
  const hasGitmodules = existsSync(path.join(REPO_ROOT, '.gitmodules'))
  const hasLockstep = resolveLockstepManifestPath(REPO_ROOT) !== undefined
  if (hasGitmodules && !hasLockstep) {
    return {
      name: 'submodules',
      note: 'non-lockstep submodule bumps left for the AI pass',
      ok: true,
    }
  }
  return {
    name: 'submodules',
    note: hasGitmodules
      ? 'covered by lockstep version-pin rows'
      : 'no .gitmodules — skipped',
    ok: true,
  }
}

// npm deps via the existing update.mts (taze 2-pass + lockfile).
export async function bumpNpmDeps(): Promise<ChainStepResult> {
  const updateScript = path.join(REPO_ROOT, 'scripts', 'fleet', 'update.mts')
  const ok = await run(process.execPath, [updateScript])
  return {
    name: 'npm-deps',
    note: ok ? undefined : 'update.mts exited non-zero',
    ok,
  }
}

// Package-manager pins from external-tools.json.
export async function syncPackageManagerPins(): Promise<ChainStepResult> {
  const script = path.join(
    REPO_ROOT,
    'scripts',
    'fleet',
    'sync-package-manager-pins.mts',
  )
  const ok = await run(process.execPath, [script])
  return {
    name: 'package-manager-pins',
    note: ok ? undefined : 'sync-package-manager-pins.mts exited non-zero',
    ok,
  }
}

// gh-aw action/container SHA pins — recompiles every tracked
// `*.github/workflows/*.md` source via `gh aw compile --approve`, refreshing
// action SHAs and container image digests in the sibling `.lock.yml` +
// `.github/aw/actions-lock.json`. Skipped (best-effort) when `gh aw` is not
// installed — the evergreen bump runs only where the compiler is available.
export async function syncGhAwActionPins(): Promise<ChainStepResult> {
  const script = path.join(
    REPO_ROOT,
    'scripts',
    'fleet',
    'sync-gh-aw-action-pins.mts',
  )
  const ok = await run(process.execPath, [script, '--quiet'])
  return {
    name: 'gh-aw-action-pins',
    note: ok
      ? undefined
      : 'sync-gh-aw-action-pins.mts exited non-zero (gh aw not installed or compile failed)',
    ok,
  }
}

// Run the full deterministic chain in order. Each step is best-effort: a
// non-zero step logs and the chain continues, so a single flaky step never
// blocks the others or the AI advisory pass.
export async function runDeterministicChain(): Promise<ChainStepResult[]> {
  const steps: ChainStepResult[] = []
  steps.push(await bumpLockstep())
  steps.push(noteSubmoduleRemainder())
  steps.push(await bumpNpmDeps())
  steps.push(await syncPackageManagerPins())
  steps.push(await syncGhAwActionPins())
  for (let i = 0, { length } = steps; i < length; i += 1) {
    const step = steps[i]!
    const suffix = step.note ? ` — ${step.note}` : ''
    if (step.ok) {
      logger.info(`[weekly-update] chain step "${step.name}" done${suffix}`)
    } else {
      logger.warn(`[weekly-update] chain step "${step.name}" warned${suffix}`)
    }
  }
  return steps
}
