#!/usr/bin/env node
/**
 * @file Assertion: every file under `assets/repo/brand/` is canonically named
 *   `<repo>-<mark>[-<variant>].<ext>` — a stray `logo.svg`, a wrong-repo
 *   prefix, or an unknown mark drifts the brand surface and breaks the
 *   README/asset-dirs references that resolve those exact names. The canonical
 *   grammar: <repo> the repo's own name (package.json name sans @scope, else
 *   the repo directory basename) <mark> combomark | favicon | logomark |
 *   wordmark <variant> light | dark (optional — the theme-split of an adaptive
 *   mark) <ext> svg | png e.g. `sockeye-combomark.svg` (adaptive),
 *   `sockeye-combomark-dark.svg`, `sockeye-logomark.png`,
 *   `sockeye-favicon.svg`. CONDITIONAL: a repo with no `assets/repo/brand/`
 *   directory vacuous-passes (most members carry no brand marks). The gate
 *   bites only on a repo that HAS brand assets, so a malformed name is caught
 *   the moment marks land. Strict: a non-canonical name exits 1 (no known-good
 *   exceptions — the brand grammar is exact).
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// The canonical mark names, variants, and extensions. Sorted; a name outside
// these sets is non-canonical.
const MARKS: ReadonlySet<string> = new Set([
  'combomark',
  'favicon',
  'logomark',
  'wordmark',
])
const VARIANTS: ReadonlySet<string> = new Set(['dark', 'light'])
const EXTENSIONS: ReadonlySet<string> = new Set(['png', 'svg'])

export interface BrandNameIssue {
  readonly file: string
  readonly message: string
}

/**
 * The repo-tier brand-asset directory for a repo root.
 */
export function brandDir(repoRoot: string): string {
  return path.join(repoRoot, 'assets', 'repo', 'brand')
}

/**
 * The repo's canonical name — the `package.json` `name` (sans `@scope/`) if
 * present, else the repo directory basename. Pure; exported for tests.
 */
export function resolveRepoName(repoRoot: string): string {
  try {
    const pkg = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8'),
    ) as { name?: unknown | undefined }
    if (typeof pkg.name === 'string' && pkg.name.length > 0) {
      const slash = pkg.name.lastIndexOf('/')
      return slash >= 0 ? pkg.name.slice(slash + 1) : pkg.name
    }
  } catch {}
  return path.basename(repoRoot)
}

/**
 * The canonicity issue for one brand filename, or undefined when it matches
 * `<repoName>-<mark>[-<variant>].<ext>`. Pure; exported for tests.
 */
export function canonicalBrandIssue(
  filename: string,
  repoName: string,
): string | undefined {
  const dot = filename.lastIndexOf('.')
  if (dot <= 0) {
    return `no extension (expected .svg or .png)`
  }
  const ext = filename.slice(dot + 1)
  if (!EXTENSIONS.has(ext)) {
    return `extension '.${ext}' is not .svg or .png`
  }
  const stem = filename.slice(0, dot)
  const prefix = `${repoName}-`
  if (!stem.startsWith(prefix)) {
    return `must be prefixed '${prefix}' (the repo name)`
  }
  const parts = stem.slice(prefix.length).split('-')
  const mark = parts[0]!
  if (!MARKS.has(mark)) {
    return `unknown mark '${mark}' (expected combomark / favicon / logomark / wordmark)`
  }
  if (parts.length === 1) {
    return undefined
  }
  if (parts.length === 2) {
    return VARIANTS.has(parts[1]!)
      ? undefined
      : `unknown variant '${parts[1]}' (expected light / dark)`
  }
  return `too many name segments (expected <repo>-<mark>[-light|-dark].<ext>)`
}

/**
 * Scan a brand directory, returning the non-canonical files. Returns [] when
 * the directory is absent (the conditional vacuous pass). Pure; exported for
 * tests.
 */
export function scanBrandDir(dir: string, repoName: string): BrandNameIssue[] {
  let entries: string[]
  try {
    entries = readdirSync(dir, { withFileTypes: true })
      .filter(dirent => dirent.isFile())
      .map(dirent => dirent.name)
  } catch {
    return []
  }
  const issues: BrandNameIssue[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const file = entries[i]!
    // .DS_Store and other dotfiles are not brand assets.
    if (file.startsWith('.')) {
      continue
    }
    const message = canonicalBrandIssue(file, repoName)
    if (message !== undefined) {
      issues.push({ file, message })
    }
  }
  issues.sort((a, b) => a.file.localeCompare(b.file))
  return issues
}

export function main(): void {
  const dir = brandDir(REPO_ROOT)
  if (!existsSync(dir)) {
    logger.log(
      'brand-assets-are-canonically-named: skipped (no assets/repo/brand/ — repo carries no brand marks).',
    )
    return
  }
  const repoName = resolveRepoName(REPO_ROOT)
  const issues = scanBrandDir(dir, repoName)
  if (issues.length === 0) {
    logger.log(
      `brand-assets-are-canonically-named: OK — all brand marks match ${repoName}-<mark>[-light|-dark].<svg|png>.`,
    )
    return
  }
  logger.warn(
    `brand-assets-are-canonically-named: ${issues.length} non-canonical brand file(s) under assets/repo/brand/:`,
  )
  for (const issue of issues) {
    logger.warn(`  ${issue.file} — ${issue.message}`)
  }
  logger.warn(
    'Rename to <repo>-<mark>[-light|-dark].<svg|png>, mark ∈ combomark|favicon|logomark|wordmark.',
  )
  process.exitCode = 1
}

/* c8 ignore start - entrypoint guard; exercised via subprocess */
if (isMainModule(import.meta.url)) {
  main()
}
/* c8 ignore stop */
