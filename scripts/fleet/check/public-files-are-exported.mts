/*
 * @file Fleet check — a package's `exports` map and its public file surface
 *   agree. Two failure modes, for every non-private workspace package that
 *   declares `exports`:
 *
 *   1. **Stale export** — an `exports` target points at a file that does not exist
 *      on disk. Rots silently after a rename/delete until a consumer's `import`
 *      throws ERR_MODULE_NOT_FOUND.
 *   2. **Orphaned public file** — a published file that IS public (survives the
 *      privacy taxonomy: not `external/`, not `_`-prefixed, not dev-junk) but
 *      is reachable through NO `exports` entry. Either it should be exported,
 *      or it should be marked private (`_`-prefix / `external/`) so the intent
 *      is explicit. Complements (does not duplicate):
 *      `package-files-are-allowlisted` (files[] tarball hygiene) and
 *      socket-lib's repo-tier `dist-exports` (runtime require-ability). This
 *      check is about the MAP ↔ FILES correspondence. Skips: private packages,
 *      packages with no `exports`, binary platform packages (`os`/`cpu` gated,
 *      no JS API), and packages with no built output. Per-package opt-out for a
 *      deliberately-unexported public file: prefix it `_` or place it under
 *      `external/`. Usage: node
 *      scripts/fleet/check/public-files-are-exported.mts [--quiet]
 */

import { existsSync, readdirSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import {
  findWorkspacePackages,
  readPackageJson,
} from './package-files-are-allowlisted.mts'
import { isPrivatePath, matchesGlob } from '../make-package-exports.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

export interface ExportsFinding {
  readonly kind: 'stale_export' | 'orphaned_public_file'
  readonly pkgName: string
  readonly detail: string
}

// Built output roots a public file may live under (or the package root itself).
const OUTPUT_DIRS = ['dist', 'build']

// Public-file candidate extensions (runtime + declarations).
const PUBLIC_EXT_RE = /\.(?:c?js|d\.c?ts|d\.mts|mjs)$/

// Dev-junk dirs never part of the public surface (mirrors the generator's
// DEFAULT_IGNORE_GLOBS without dragging fast-glob into a sync check).
const JUNK_SEGMENT_RE =
  // Matches a junk directory segment anywhere in a normalized (unix-slash) path.
  // (\/|^) — literal "/" or start-of-string (segment boundary on the left)
  // (?:coverage|…|vendor) — non-capturing alternation of the known junk dir names
  // ($|\/) — end-of-string or "/" (segment boundary on the right)
  /(?:\/|^)(?:coverage|node_modules|scripts|src|test|tests|tools|vendor)(?:$|\/)/

/**
 * Collect every export target (string leaf) from an `exports` value, descending
 * through condition objects. Returns relative file paths (the `./x` form).
 */
export function collectExportTargets(
  exportsValue: unknown,
  out: Set<string> = new Set(),
): Set<string> {
  if (typeof exportsValue === 'string') {
    out.add(exportsValue)
    return out
  }
  if (exportsValue && typeof exportsValue === 'object') {
    for (const v of Object.values(exportsValue as Record<string, unknown>)) {
      collectExportTargets(v, out)
    }
  }
  return out
}

/**
 * Walk a package's built output for public files (privacy taxonomy applied).
 * `privateSegments` extends the built-in private set (external/, `_`-prefixed)
 * to match the same per-package config the generator uses. Returns paths
 * relative to the package root.
 */
export function collectPublicFiles(
  pkgDir: string,
  privateSegments?: readonly string[] | undefined,
): string[] {
  const out: string[] = []
  const roots = OUTPUT_DIRS.map(d => path.join(pkgDir, d)).filter(existsSync)
  if (!roots.length) {
    return out
  }
  for (let i = 0, { length } = roots; i < length; i += 1) {
    walkDir(roots[i]!, pkgDir, out, privateSegments)
  }
  return out
}

function walkDir(
  dir: string,
  pkgDir: string,
  out: string[],
  privateSegments?: readonly string[] | undefined,
): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    const abs = path.join(dir, name)
    const rel = normalizePath(path.relative(pkgDir, abs))
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkDir(abs, pkgDir, out, privateSegments)
    } else if (
      PUBLIC_EXT_RE.test(name) &&
      !isPrivatePath(rel, privateSegments) &&
      !JUNK_SEGMENT_RE.test(rel)
    ) {
      out.push(rel)
    }
  }
}

export interface CheckOptions {
  // Extra private path-segment names (matches the generator's privateSegments).
  readonly privateSegments?: readonly string[] | undefined
  // Published files reachable via package.json `bin` (CLI entries) — public but
  // intentionally not in `exports`, so not orphans.
  readonly binTargets?: readonly string[] | undefined
  // Shallow ignore globs the package's exports config excludes (the same
  // ignoreGlobs the generator uses — e.g. a bundled bin artifact or an
  // alias-shadowed leaf). Matched against the package-relative path.
  readonly ignoreGlobs?: readonly string[] | undefined
}

/**
 * Check one package. Returns findings (empty = clean). `exportsValue` is the
 * raw `exports` field; `pkgDir` the package root. A built file is "covered"
 * (not an orphan) when it is an export target, a `bin` target, or matches a
 * config `ignoreGlobs` entry.
 */
export function checkPackageExports(
  pkgName: string,
  pkgDir: string,
  exportsValue: unknown,
  options: CheckOptions = {},
): ExportsFinding[] {
  const { binTargets = [], ignoreGlobs = [], privateSegments } = options
  const findings: ExportsFinding[] = []
  const targets = collectExportTargets(exportsValue)

  // A target points into built output (`./dist/…` / `./build/…`) when its first
  // path segment is an OUTPUT_DIR. Such a target only exists AFTER a build, so
  // we can't judge it stale in an unbuilt checkout (CI's lint/check job runs
  // without building — only provenance/release build dist/). Skip dist-target
  // staleness when that output root is absent; `source` (./src/…) targets are
  // always present and stay checked.
  const builtRoots = new Set(
    OUTPUT_DIRS.filter(d => existsSync(path.join(pkgDir, d))),
  )
  function pointsAtUnbuiltOutput(rel: string): boolean {
    const firstSeg = normalizePath(rel).split('/')[0]!
    return OUTPUT_DIRS.includes(firstSeg) && !builtRoots.has(firstSeg)
  }

  // 1. Stale exports — every target file must exist. A target into an unbuilt
  // output dir is skipped (can't validate output that was never produced), and
  // so is a config-ignored target: an ignoreGlobs entry declares a build
  // artifact produced OUTSIDE the output dirs (e.g. a package-root wasm/mjs
  // materialized by a fetch step), which is equally absent in an unbuilt
  // checkout.
  const exportedFiles = new Set<string>()
  for (const target of targets) {
    const rel = target.replace(/^\.\//, '')
    exportedFiles.add(normalizePath(rel))
    if (pointsAtUnbuiltOutput(rel)) {
      continue
    }
    if (ignoreGlobs.some(g => matchesGlob(normalizePath(rel), g))) {
      continue
    }
    if (!existsSync(path.join(pkgDir, rel))) {
      findings.push({
        kind: 'stale_export',
        pkgName,
        detail: `exports target "${target}" points at a file that does not exist. Remove the entry or restore the file.`,
      })
    }
  }
  const binFiles = new Set(
    binTargets.map(t => normalizePath(t.replace(/^\.\//, ''))),
  )

  // 2. Orphaned public files — every public built file must be covered.
  const publicFiles = collectPublicFiles(pkgDir, privateSegments)
  for (let i = 0, { length } = publicFiles; i < length; i += 1) {
    const rel = publicFiles[i]!
    if (
      exportedFiles.has(rel) ||
      binFiles.has(rel) ||
      ignoreGlobs.some(g => matchesGlob(rel, g))
    ) {
      continue
    }
    findings.push({
      kind: 'orphaned_public_file',
      pkgName,
      detail: `public file "${rel}" is reachable through no exports entry. Export it, mark it private (prefix \`_\` / \`external/\`), or list it in the exports-config ignoreGlobs / package.json bin.`,
    })
  }
  return findings
}

// Binary platform packages (os/cpu gated, no JS public API) and any package
// without exports are skipped.
function shouldSkip(pkg: Record<string, unknown>): boolean {
  if (pkg['private']) {
    return true
  }
  if (!pkg['exports']) {
    return true
  }
  if (pkg['os'] || pkg['cpu']) {
    return true
  }
  return false
}

// Bin targets from a package.json `bin` field (string or object form).
export function binTargetsOf(pkg: Record<string, unknown>): string[] {
  const bin = pkg['bin']
  if (typeof bin === 'string') {
    return [bin]
  }
  if (bin && typeof bin === 'object') {
    return Object.values(bin as Record<string, string>)
  }
  return []
}

// Read the package's exports-config `ignore` globs (the same the generator
// excludes) so the validator excludes exactly what the generator does.
// Best-effort: a package without the config yields none. Imported dynamically
// so the sync callers stay simple; returns [] on any failure.
export async function ignoreGlobsOf(pkgDir: string): Promise<string[]> {
  const configPath = path.join(
    pkgDir,
    'scripts/repo/package-exports.config.mts',
  )
  if (!existsSync(configPath)) {
    return []
  }
  try {
    const mod = (await import(configPath)) as {
      config?: { ignore?: readonly string[] | undefined } | undefined
    }
    return [...(mod.config?.ignore ?? [])]
  } catch {
    return []
  }
}

export async function runCheck(repoRoot: string): Promise<number> {
  const findings: ExportsFinding[] = []
  const pkgDirs = findWorkspacePackages(repoRoot)
  for (let i = 0, { length } = pkgDirs; i < length; i += 1) {
    const pkgDir = pkgDirs[i]!
    const pkg = readPackageJson(pkgDir) as Record<string, unknown> | undefined
    if (!pkg || shouldSkip(pkg)) {
      continue
    }
    const pkgName = (pkg['name'] as string) ?? path.basename(pkgDir)
    const ignoreGlobs = await ignoreGlobsOf(pkgDir)
    findings.push(
      ...checkPackageExports(pkgName, pkgDir, pkg['exports'], {
        binTargets: binTargetsOf(pkg),
        ignoreGlobs,
      }),
    )
  }
  if (!findings.length) {
    logger.log(
      '[check-public-files-are-exported] every exports target resolves and every public file is exported.',
    )
    return 0
  }
  logger.fail(
    `[check-public-files-are-exported] ${findings.length} finding(s):`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.log(`  ${f.pkgName} [${f.kind}]: ${f.detail}`)
  }
  return 1
}

if (isMainModule(import.meta.url)) {
  void (async () => {
    process.exit(await runCheck(REPO_ROOT))
  })()
}
