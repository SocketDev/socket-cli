// Conservative dedupe + override-tidiness sweep for rolldown-bundled repos.
//
// Keeps a repo's dependency graph and its rolldown `external/` bundle lean: it
// reports (and with --fix, applies) the lockfile dedupes pnpm can collapse,
// checks that Socket-published packages are routed through the `catalog:`
// overrides (not duplicated at floating versions), and flags any `external/`
// entry that has grown from a thin re-export shim into a fat re-vendored tree.
// Low-friction "care and feeding": dry-run by default, no prompting, safe to
// run unattended (e.g. on a /loop).
//
// What it does NOT do: it never edits source, never removes a dependency, never
// rewrites the bundle. The only mutation (under --fix) is `pnpm dedupe`, whose
// effect is lockfile-only — the published artifact is unchanged. Anything that
// would change the published surface is reported for a human to decide.
//
// Background — why external/ rarely needs hand-deduping: the fleet's external
// bundles consolidate shared deps into mega-bundles (e.g. socket-lib's
// `npm-pack` / `external-pack`) and expose per-dep files as thin re-export
// shims (`module.exports = require('./npm-pack').semver`). A shim that stops
// being thin (re-vendors its own tree) is the regression this sweep catches.
//
// Default is --dry-run (report only). Pass --fix to run `pnpm dedupe`.
//
// Usage:
//   node tidy-rolldown-bundles.mts            # dry-run: report dedupe + override drift
//   node tidy-rolldown-bundles.mts --fix      # also run `pnpm dedupe` per repo
//   node tidy-rolldown-bundles.mts --repo socket-lib

import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

// 1 path, 1 reference: the roster + its reader live in one shared owner.
import { readRoster } from '../../_shared/scripts/fleet-roster.mts'

const logger = getDefaultLogger()

const PROJECTS = process.env['PROJECTS'] || path.join(os.homedir(), 'projects')

export { readRoster }

// A re-export shim is small. Past this byte size, an `external/<dep>.js` is
// likely re-vendoring its own tree instead of delegating to a shared bundle —
// the regression this sweep flags. Generous so a shim with a few named
// re-exports doesn't trip it.
export const SHIM_MAX_BYTES = 4096

// Socket-published packages that must resolve through the `catalog:` overrides
// rather than a floating version (the dedupe lever for the Socket surface).
export const CATALOG_PINNED_PREFIXES = [
  '@socketsecurity/',
  '@socketregistry/',
] as const

export interface RepoFinding {
  repo: string
  kind:
    | 'dedupe-available'
    | 'override-missing'
    | 'fat-shim'
    | 'no-bundle'
    | 'clean'
  detail: string
}

/**
 * True when the repo has a rolldown bundle surface worth sweeping: an
 * `src/external/` dir or a `scripts/bundle.mts`. Repos without one are
 * skipped.
 */
export function hasRolldownBundle(repoDir: string): boolean {
  return (
    existsSync(path.join(repoDir, 'src', 'external')) ||
    existsSync(path.join(repoDir, 'scripts', 'bundle.mts'))
  )
}

/**
 * Find `external/<dep>.js` files that exceed the shim size — likely re-vendored
 * trees rather than thin re-exports. Returns the offending relative paths.
 */
export function findFatShims(repoDir: string): string[] {
  const dir = path.join(repoDir, 'src', 'external')
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const fat: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (!name.endsWith('.js')) {
      continue
    }
    const full = path.join(dir, name)
    let size = 0
    try {
      size = statSync(full).size
    } catch {
      continue
    }
    // The consolidation bundles themselves (`*-pack.js`) are legitimately large.
    if (name.endsWith('-pack.js')) {
      continue
    }
    if (size > SHIM_MAX_BYTES) {
      fat.push(`external/${name} (${size}B)`)
    }
  }
  return fat
}

/**
 * Read the `overrides:` block of pnpm-workspace.yaml and report which
 * catalog-pinned Socket prefixes are NOT routed through `catalog:`. Cheap
 * line-scan — the overrides block is flat `key: value` YAML.
 */
export function findMissingOverrides(repoDir: string): string[] {
  const yamlPath = path.join(repoDir, 'pnpm-workspace.yaml')
  let yaml: string
  try {
    yaml = readFileSync(yamlPath, 'utf8')
  } catch {
    return []
  }
  // Collect package names already mapped to catalog: in the overrides region.
  const catalogPinned = new Set<string>()
  const lines = yaml.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const m = /^\s*'?(@?[a-z0-9@/._-]+)'?\s*:\s*['"]?catalog:/.exec(line)
    if (m?.[1]) {
      catalogPinned.add(m[1])
    }
  }
  // A prefix is "covered" if at least one package under it is catalog-pinned.
  const missing: string[] = []
  for (let i = 0, { length } = CATALOG_PINNED_PREFIXES; i < length; i += 1) {
    const prefix = CATALOG_PINNED_PREFIXES[i]!
    let covered = false
    for (const pinned of catalogPinned) {
      if (pinned.startsWith(prefix)) {
        covered = true
        break
      }
    }
    if (!covered && yaml.includes(prefix)) {
      missing.push(prefix)
    }
  }
  return missing
}

export async function dedupeCheck(
  repoDir: string,
): Promise<{ hasChanges: boolean; summary: string }> {
  const result = await spawn('pnpm', ['dedupe', '--check'], {
    cwd: repoDir,
    stdioString: true,
    env: { ...process.env, CI: 'true' },
  }).then(
    () => ({ code: 0, stdout: '', stderr: '' }),
    (e: unknown) => {
      const err = e as {
        code?: number | undefined
        stdout?: string | undefined
        stderr?: string | undefined
      }
      return {
        code: typeof err?.code === 'number' ? err.code : 1,
        stdout: String(err?.stdout ?? ''),
        stderr: String(err?.stderr ?? ''),
      }
    },
  )
  // pnpm dedupe --check exits non-zero (ERR_PNPM_DEDUPE_CHECK_ISSUES) when there
  // are collapses available.
  const out = `${result.stdout}\n${result.stderr}`
  const hasChanges =
    result.code !== 0 || /DEDUPE_CHECK_ISSUES|changes to the lockfile/.test(out)
  const pkgCount = (out.match(/^[@a-z][^\n]*@\d/gm) ?? []).length
  return {
    hasChanges,
    summary: hasChanges
      ? `~${pkgCount} package(s) could be deduped`
      : 'lockfile already deduped',
  }
}

export async function dedupeFix(repoDir: string): Promise<boolean> {
  return await spawn('pnpm', ['dedupe'], {
    cwd: repoDir,
    stdioString: true,
    env: { ...process.env, CI: 'true' },
  }).then(
    () => true,
    () => false,
  )
}

export async function sweepRepo(
  repo: string,
  config: { fix: boolean },
): Promise<RepoFinding[]> {
  const cfg = { __proto__: null, ...config } as typeof config
  const repoDir = path.join(PROJECTS, repo)
  if (!existsSync(path.join(repoDir, '.git'))) {
    return []
  }
  if (!hasRolldownBundle(repoDir)) {
    return [{ repo, kind: 'no-bundle', detail: 'no external/ or bundle.mts' }]
  }
  const findings: RepoFinding[] = []

  const fatShims = findFatShims(repoDir)
  for (let i = 0, { length } = fatShims; i < length; i += 1) {
    findings.push({
      repo,
      kind: 'fat-shim',
      detail: `${fatShims[i]} exceeds the ${SHIM_MAX_BYTES}B shim cap — re-vendoring its own tree instead of delegating to a shared *-pack bundle?`,
    })
  }

  const missingOverrides = findMissingOverrides(repoDir)
  for (let i = 0, { length } = missingOverrides; i < length; i += 1) {
    findings.push({
      repo,
      kind: 'override-missing',
      detail: `${missingOverrides[i]}* is referenced but not routed through a \`catalog:\` override — add one so its version dedupes fleet-wide`,
    })
  }

  const dedupe = await dedupeCheck(repoDir)
  if (dedupe.hasChanges) {
    if (cfg.fix) {
      const ok = await dedupeFix(repoDir)
      findings.push({
        repo,
        kind: 'dedupe-available',
        detail: ok
          ? `ran \`pnpm dedupe\` — ${dedupe.summary} collapsed (lockfile-only). Re-run the bundle build to confirm externals still load.`
          : `\`pnpm dedupe\` failed — ${dedupe.summary}; run it manually`,
      })
    } else {
      findings.push({
        repo,
        kind: 'dedupe-available',
        detail: `${dedupe.summary} — run with --fix to \`pnpm dedupe\``,
      })
    }
  }

  if (!findings.length) {
    findings.push({ repo, kind: 'clean', detail: 'bundle + deps tidy' })
  }
  return findings
}

export async function main(): Promise<void> {
  const fix = process.argv.includes('--fix')
  const repoIdx = process.argv.indexOf('--repo')
  const onlyRepo = repoIdx !== -1 ? process.argv[repoIdx + 1] : undefined

  const roster = onlyRepo ? [onlyRepo] : readRoster()
  const mode = fix ? 'FIX' : 'DRY-RUN'
  logger.info(`tidy-rolldown-bundles (${mode}) — ${roster.length} repo(s)`)

  let actionable = 0
  for (let i = 0, { length } = roster; i < length; i += 1) {
    const repo = roster[i]!
    const findings = await sweepRepo(repo, { fix })
    const notable = findings.filter(
      f => f.kind !== 'clean' && f.kind !== 'no-bundle',
    )
    if (!notable.length) {
      continue
    }
    actionable += notable.length
    logger.info(`── ${repo} ──`)
    for (let j = 0, n = notable.length; j < n; j += 1) {
      logger.info(`  • ${notable[j]!.kind}: ${notable[j]!.detail}`)
    }
  }

  if (actionable === 0) {
    logger.success(
      'tidy-rolldown-bundles: every bundled repo is deduped + overrides tidy.',
    )
  } else if (fix) {
    logger.success(
      `tidy-rolldown-bundles: applied ${actionable} dedupe(s); rebuild each touched bundle to confirm externals still load.`,
    )
  } else {
    logger.info(
      `tidy-rolldown-bundles: ${actionable} item(s) to address. Re-run with --fix for the dedupe-able ones (override/fat-shim items are reported for a human).`,
    )
  }
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  void (async () => {
    await main()
  })()
}
