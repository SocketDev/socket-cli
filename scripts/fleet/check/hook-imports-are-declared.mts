#!/usr/bin/env node
/**
 * @file `check --all` gate: every STATIC bare-specifier import in a fleet or
 *   repo hook (`.claude/hooks/{fleet,repo}/**\/*.mts`) must be declared in the
 *   repo root `package.json`'s `dependencies` or `devDependencies`. A hook that
 *   imports a package the manifest doesn't declare inherits a broken import at
 *   runtime for every member that installs from the manifest but never gets the
 *   transitive package on disk — the incident this check exists to catch:
 *   `check-new-deps` imported `@socketregistry/packageurl-js-stable` and
 *   `@socketsecurity/sdk-stable` while the wheelhouse root `package.json`
 *   declared neither, so every member inherited a hook whose imports weren't
 *   installed. Scans every `.mts` file under `.claude/hooks/fleet/` (always)
 *   and `.claude/hooks/repo/` (when present — not every fleet member carries
 *   one). Extracts every STATIC bare-specifier import: `import … from
 *   '<spec>'`, the bare side-effect form `import '<spec>'`, and `export … from
 *   '<spec>'` re-exports — including `import type` / `export type` (still needs
 *   the package on disk for `tsc` to resolve its types). Dynamic `import(...)`
 *   and `require(...)` are not static and are never matched. A `node:*` builtin
 *   or a relative (`./`, `../`) specifier names no installed package and is
 *   skipped. A subpath import (e.g.
 *   `@socketsecurity/lib-stable/logger/default`) resolves to its package name
 *   (`@socketsecurity/lib-stable`) before the declared-deps check. Fails loud
 *   (What / Where / Saw / Wanted / Fix) listing every undeclared specifier +
 *   the importing file — never a silent skip. Usage: node
 *   scripts/fleet/check/hook-imports-are-declared.mts [--quiet]
 */

import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { PACKAGE_JSON, REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Hook trees to scan, relative to REPO_ROOT. `.claude/hooks/repo` is
// repo-specific (not every fleet member carries one); listMtsFiles returns
// `[]` for a missing directory, so an absent tree is simply a no-op — never an
// error.
export const HOOK_TREES: readonly string[] = [
  path.join('.claude', 'hooks', 'fleet'),
  path.join('.claude', 'hooks', 'repo'),
]

export interface UndeclaredImport {
  readonly file: string
  readonly packageName: string
  readonly specifier: string
}

interface PackageJsonShape {
  dependencies?: Record<string, string> | undefined
  devDependencies?: Record<string, string> | undefined
}

/**
 * Recursively list every `.mts` file under `dir`. Returns `[]` for a missing
 * or unreadable directory — a repo with no `.claude/hooks/repo/` tree is not
 * an error, just nothing to scan.
 */
export function listMtsFiles(dir: string): string[] {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }
  const out: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === 'node_modules' || name.startsWith('.')) {
      continue
    }
    const full = path.join(dir, name)
    let isDir: boolean
    try {
      isDir = statSync(full).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      out.push(...listMtsFiles(full))
    } else if (name.endsWith('.mts')) {
      out.push(full)
    }
  }
  return out
}

/**
 * Extract every STATIC bare-specifier import's raw specifier string out of a
 * `.mts` file's content: `import … from '<spec>'` / `export … from '<spec>'`
 * (both including a `type` keyword), and the bare side-effect form
 * `import '<spec>'`. Dynamic `import(...)` and `require(...)` are not static
 * and are never matched.
 *
 * The gap between the `import`/`export` keyword and `from` is deliberately
 * restricted to `[\s\w,{}*]` — whitespace (newlines included, so a multi-line
 * named-import list still matches), identifier characters, commas, braces, and
 * `*`. This is narrower than a naive `[^;]*?` gap on purpose: TS/JS statements
 * don't require a terminating `;` (ASI), so an unbounded gap can walk straight
 * through an unrelated `export const x = [...]` all the way to an UNRELATED
 * later `from` inside a string literal (e.g. a hook's own `lines.push('...
 * cascade from ...')` reminder text), capturing garbage source as the
 * "specifier". The restricted class can't cross `=`, `(`, quotes, or any other
 * real-statement punctuation, so a false start like that fails outright
 * instead of running away. It still admits the shapes the fleet's `.mts`
 * imports actually use: named/default/namespace imports, `type` and `as`
 * keywords, and `export … from` re-exports.
 */
export function extractImportSpecifiers(content: string): string[] {
  const specifiers: string[] = []
  const fromRe =
    /(?:^|\n)[ \t]*(?:export|import)\b[\s\w,{}*]*?\bfrom[ \t]*['"]([^'"]+)['"]/g // socket-lint: allow uncommented-regex
  let m: RegExpExecArray | null
  while ((m = fromRe.exec(content)) !== null) {
    specifiers.push(m[1]!)
  }
  // Bare side-effect import: `import '<spec>'` (no `from`). Anchored so the
  // first non-space token after `import` must be a quote, so it never
  // re-matches a `from`-form line already caught above.
  const sideEffectRe = /(?:^|\n)[ \t]*import[ \t]*['"]([^'"]+)['"]/g // socket-lint: allow uncommented-regex
  while ((m = sideEffectRe.exec(content)) !== null) {
    specifiers.push(m[1]!)
  }
  return specifiers
}

/**
 * Resolve a bare import specifier to the package name that must be declared
 * in `package.json`: `@scope/name` for a scoped package (subpath dropped), or
 * the first path segment for an unscoped package. Returns `undefined` for a
 * relative (`.`/`..`) or `node:` builtin specifier — neither names an
 * installed package.
 */
export function packageNameFromSpecifier(
  specifier: string,
): string | undefined {
  if (
    specifier === '' ||
    specifier.startsWith('.') ||
    specifier.startsWith('node:')
  ) {
    return undefined
  }
  if (specifier.startsWith('@')) {
    const [scope, name] = specifier.split('/')
    return scope && name ? `${scope}/${name}` : undefined
  }
  return specifier.split('/')[0]
}

/**
 * Read `dependencies` + `devDependencies` keys off `packageJsonPath` into one
 * declared-names set. A missing/unparseable `package.json` yields an empty
 * set — fail loud downstream (every import reads as undeclared), which
 * correctly signals the manifest itself is broken rather than silently
 * passing.
 */
export function readDeclaredPackageNames(packageJsonPath: string): Set<string> {
  let pkg: PackageJsonShape
  try {
    pkg = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageJsonShape
  } catch {
    return new Set()
  }
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {}),
  ])
}

/**
 * Diagnose every hook file in `files` (relative path → content) for a
 * bare-specifier import whose resolved package name is NOT in
 * `declaredNames`. Pure — the check's whole finding logic, independent of
 * file-system layout, so unit tests can drive it with in-memory fixtures.
 * Deduplicates by (file, packageName) so a package imported via several
 * subpaths in one file is reported once.
 */
export function findUndeclaredImports(
  files: ReadonlyMap<string, string>,
  declaredNames: ReadonlySet<string>,
): UndeclaredImport[] {
  const findings: UndeclaredImport[] = []
  const seen = new Set<string>()
  for (const [file, content] of files) {
    for (const specifier of extractImportSpecifiers(content)) {
      const packageName = packageNameFromSpecifier(specifier)
      if (packageName === undefined || declaredNames.has(packageName)) {
        continue
      }
      const key = `${file} ${packageName}`
      if (seen.has(key)) {
        continue
      }
      seen.add(key)
      findings.push({ file, packageName, specifier })
    }
  }
  findings.sort(
    (a, b) =>
      a.file.localeCompare(b.file) ||
      a.packageName.localeCompare(b.packageName),
  )
  return findings
}

/**
 * Read every `.mts` file under each of `hookDirs` into a relative-path →
 * content map (relative to `repoRoot`). Unreadable files are skipped, never
 * fatal.
 */
export function readHookFiles(
  repoRoot: string,
  hookDirs: readonly string[],
): Map<string, string> {
  const files = new Map<string, string>()
  for (let i = 0, { length } = hookDirs; i < length; i += 1) {
    const dir = path.join(repoRoot, hookDirs[i]!)
    const mtsFiles = listMtsFiles(dir)
    for (let j = 0, fl = mtsFiles.length; j < fl; j += 1) {
      const file = mtsFiles[j]!
      let content: string
      try {
        content = readFileSync(file, 'utf8')
      } catch {
        continue
      }
      files.set(path.relative(repoRoot, file), content)
    }
  }
  return files
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const declaredNames = readDeclaredPackageNames(PACKAGE_JSON)
  const files = readHookFiles(REPO_ROOT, HOOK_TREES)
  const findings = findUndeclaredImports(files, declaredNames)

  if (findings.length > 0) {
    logger.fail(
      '[hook-imports-are-declared] a hook imports a package the root package.json does not declare.',
    )
    logger.error('')
    logger.error(
      '  What:   every bare-specifier import in a .claude/hooks/{fleet,repo} file',
    )
    logger.error(
      '          must resolve to a name in package.json dependencies/devDependencies —',
    )
    logger.error(
      '          otherwise a member installs the hook without the package it imports.',
    )
    logger.error('')
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      logger.error(`  Where:  ${f.file}`)
      logger.error(
        `  Saw:    import '${f.specifier}' → package "${f.packageName}", not declared`,
      )
      logger.error(
        `  Wanted: "${f.packageName}" in package.json dependencies or devDependencies`,
      )
      logger.error('')
    }
    logger.error(
      '  Fix:    add each missing package to package.json (catalog: if a fleet-canonical',
    )
    logger.error(
      '          catalog entry exists — see scripts/repo/sync-scaffolding/manifest/catalog.mts)',
    )
    logger.error('          and run `pnpm i`.')
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.success(
      '[hook-imports-are-declared] every hook import resolves to a declared package.json dependency.',
    )
  }
}

if (isMainModule(import.meta.url)) {
  main()
}
