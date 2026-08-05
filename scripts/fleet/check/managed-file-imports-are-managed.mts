#!/usr/bin/env node
/**
 * @file `check --all` gate: a managed file's RELATIVE imports are managed too.
 *   The cascade ships a file only when some manifest list names it, so a
 *   managed file that imports an unmanaged sibling delivers a broken module to
 *   every member — the import target simply never arrives. Incident: the
 *   conditional vitest group shipped `.config/repo/vitest.config.mts` without
 *   the `./vitest.settings.mts` it imports, so every member's suite failed to
 *   load its config until a human noticed by hand. The scan reads every path in
 *   `EXPECTED_FILES`, `PRESET_FILES`, `OPTIONAL_IDENTICAL_FILES`, and each
 *   `CONDITIONAL_FILES` group, plus `IDENTICAL_FILES`, expanding every entry
 *   that names a DIRECTORY into the files beneath it (a directory entry ships
 *   its whole subtree, so those files are managed even though no list names
 *   them one by one). Only a specifier written at STATEMENT position counts,
 *   which is what keeps a guard's example message or a codegen template from
 *   being read as a real import. Each relative specifier is resolved against
 *   the importer's directory and the gate fails when the result is in no list.
 *   EXEMPTION, deliberately narrow: an import that
 *   resolves OUTSIDE `template/base/` is skipped — for example a
 *   `.config/repo/` file reaching up past the tree root. Those specifiers point
 *   at repo-owned or member-owned territory the manifest does not govern at
 *   all, so flagging them would bury the propagation signal this gate exists to
 *   surface. Widening the exemption any further defeats the check.
 *   Wheelhouse-only in effect: a member ships this check but has no
 *   `template/base` to read and no `scripts/repo` manifest to import, so it is
 *   a vacuous pass there — same shape as
 *   wheelhouse-controlled-files-are-classified. Usage: node
 *   scripts/fleet/check/managed-file-imports-are-managed.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The byte-canonical template tree every managed path is read from. Computed
// here, not imported: scripts/fleet/paths.mts is the cascaded per-member paths
// module and never resolves the wheelhouse-only template root.
const TEMPLATE_BASE_DIR = path.join(REPO_ROOT, 'template', 'base')

// Only a module source can carry an import; a managed .json / .md / .yml entry
// is read as data and has nothing to scan.
const SOURCE_EXTENSIONS: readonly string[] = ['.mts', '.ts', '.mjs', '.js']

// Suffixes a Node ESM resolver would try for an extensionless specifier. Fleet
// code writes explicit extensions, so this only keeps the odd directory import
// from being reported as a phantom hole.
const RESOLUTION_SUFFIXES: readonly string[] = [
  '.mts',
  '.ts',
  '.mjs',
  '.js',
  '/index.mts',
  '/index.ts',
  '/index.mjs',
  '/index.js',
]

// A line that OPENS an import/export statement, or continues a multi-line one
// with its closing brace (`} from './x.mts'`). Anchoring at statement position
// is what keeps the scan from harvesting prose: a guard's example message
// (`logger.error("import { x } from './y.mts'")`) and a codegen template that
// emits an import both put the keyword inside a quote, never at line start.
const STATEMENT_LINE_RE = /^[ \t]*(?:\}\s*from\b|export\b|import\b)/
// The specifier inside such a line: the `from` clause, or a bare side-effect
// `import './x.mts'`. The leading `.` is what makes a specifier relative — a
// bare `lodash` or a `node:path` builtin can never fail to propagate, so
// neither can match here.
const FROM_SPECIFIER_RE = /\bfrom\s*['"](\.[^'"]+)['"]/
const SIDE_EFFECT_SPECIFIER_RE = /^[ \t]*import\s*['"](\.[^'"]+)['"]/
// A dynamic `import('./x.mts')`. Accepted only when nothing before it on the
// line is quoted, which is the same statement-position discipline applied to an
// expression that can sit mid-line.
const DYNAMIC_IMPORT_RE = /\bimport\(\s*['"](\.[^'"]+)['"]/

// Block comments (the @file headers) and whole-line `//` comments, stripped
// before scanning so a doc comment quoting an import is not read as one. A line
// comment must own its line, which leaves a `https://` inside a string intact.
const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g
const LINE_COMMENT_RE = /^[ \t]*\/\/.*$/gm

// Directory names the mirror walk never descends into: local state, never
// template content.
const SKIP_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules'])

/**
 * One managed file importing a path the cascade does not deliver.
 */
export interface UnmanagedImportFinding {
  /**
   * Repo-relative POSIX path of the managed file holding the import.
   */
  readonly importer: string
  /**
   * The relative specifier exactly as written in the source.
   */
  readonly specifier: string
  /**
   * Repo-relative POSIX path the specifier resolves to.
   */
  readonly resolved: string
}

/**
 * Inputs for the pure scan. `managedPaths` is every repo-relative path the
 * manifest delivers; `readSource` returns a managed path's `template/base`
 * source, or undefined when no such source exists (a generated entry, or one a
 * member owns outright).
 */
export interface ManagedImportScanInput {
  readonly managedPaths: readonly string[]
  readonly readSource: (relPosix: string) => string | undefined
}

/**
 * Every relative import / export-from specifier in `source`, in source order,
 * deduplicated. Bare specifiers and `node:` builtins never match — only a
 * relative one can fail to propagate.
 */
export function extractRelativeSpecifiers(source: string): string[] {
  const lines = source
    .replace(BLOCK_COMMENT_RE, '')
    .replace(LINE_COMMENT_RE, '')
    .split('\n')
  const seen = new Set<string>()
  const out: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const specifier = readLineSpecifier(line)
    // A specifier holding an interpolation is not a static import at all — it
    // is a codegen template emitting one, and there is no single path to check.
    if (specifier === undefined || specifier.includes('${')) {
      continue
    }
    if (!seen.has(specifier)) {
      seen.add(specifier)
      out.push(specifier)
    }
  }
  return out
}

// The one relative specifier a line imports, or undefined when the line is not
// an import at statement position.
function readLineSpecifier(line: string): string | undefined {
  if (STATEMENT_LINE_RE.test(line)) {
    const sideEffect = SIDE_EFFECT_SPECIFIER_RE.exec(line)
    if (sideEffect) {
      return sideEffect[1]!
    }
    const fromClause = FROM_SPECIFIER_RE.exec(line)
    if (fromClause) {
      return fromClause[1]!
    }
    return undefined
  }
  const dynamic = DYNAMIC_IMPORT_RE.exec(line)
  if (dynamic && !/['"`]/.test(line.slice(0, dynamic.index))) {
    return dynamic[1]!
  }
  return undefined
}

/**
 * Resolve `specifier` against `importer`'s directory to a repo-relative POSIX
 * path. Returns undefined when the result climbs out of the tree the manifest
 * governs — that is the deliberate exemption, not a resolution failure.
 */
export function resolveImportTarget(
  importer: string,
  specifier: string,
): string | undefined {
  const importerDir = path.posix.dirname(normalizePath(importer))
  const resolved = normalizePath(
    path.posix.normalize(path.posix.join(importerDir, specifier)),
  )
  if (resolved === '..' || resolved.startsWith('../')) {
    return undefined
  }
  return resolved
}

/**
 * True when `resolved` is delivered by the manifest, either exactly or through
 * one of the extensionless forms a Node ESM resolver would try.
 */
export function isManagedTarget(
  resolved: string,
  managedSet: ReadonlySet<string>,
): boolean {
  if (managedSet.has(resolved)) {
    return true
  }
  for (let i = 0, { length } = RESOLUTION_SUFFIXES; i < length; i += 1) {
    if (managedSet.has(`${resolved}${RESOLUTION_SUFFIXES[i]!}`)) {
      return true
    }
  }
  return false
}

/**
 * True when `relPosix` names a module source worth scanning for imports.
 */
export function isScannableSource(relPosix: string): boolean {
  const normalized = normalizePath(relPosix)
  for (let i = 0, { length } = SOURCE_EXTENSIONS; i < length; i += 1) {
    if (normalized.endsWith(SOURCE_EXTENSIONS[i]!)) {
      return true
    }
  }
  return false
}

/**
 * Every managed file whose relative import resolves to a path the manifest does
 * not deliver. Pure — the source reader is injected, so a test drives it with a
 * fake tree and never touches the real manifest. Empty array = the gate passes.
 */
export function findUnmanagedImports(
  input: ManagedImportScanInput,
): UnmanagedImportFinding[] {
  const { managedPaths, readSource } = input
  const managedSet = new Set(managedPaths.map(p => normalizePath(p)))
  const findings: UnmanagedImportFinding[] = []
  const sortedPaths = [...managedSet].toSorted()
  for (let i = 0, { length } = sortedPaths; i < length; i += 1) {
    const importer = sortedPaths[i]!
    if (!isScannableSource(importer)) {
      continue
    }
    const source = readSource(importer)
    if (source === undefined) {
      continue
    }
    const specifiers = extractRelativeSpecifiers(source)
    for (let j = 0, { length: specLen } = specifiers; j < specLen; j += 1) {
      const specifier = specifiers[j]!
      const resolved = resolveImportTarget(importer, specifier)
      if (resolved === undefined) {
        continue
      }
      if (!isManagedTarget(resolved, managedSet)) {
        findings.push({ importer, resolved, specifier })
      }
    }
  }
  return findings
}

/**
 * Read a `template/base` source, or undefined when the managed entry has no
 * template source.
 */
export function readTemplateSource(relPosix: string): string | undefined {
  try {
    return readFileSync(path.join(TEMPLATE_BASE_DIR, relPosix), 'utf8')
  } catch {
    return undefined
  }
}

function walkTree(dir: string, rel: string, out: string[]): void {
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    if (SKIP_DIRS.has(entry.name)) {
      continue
    }
    const childRel = `${rel}/${entry.name}`
    if (entry.isDirectory()) {
      walkTree(path.join(dir, entry.name), childRel, out)
    } else {
      out.push(childRel)
    }
  }
}

/**
 * Expand each manifest entry into the paths it delivers: a file entry is
 * itself, a directory entry is every file beneath it. Every list can name a
 * directory (`test/fleet/_shared/lib` is an optional-identical DIR, the mirror
 * roots are identical DIRs), and a directory ships its whole subtree, so those
 * files are managed even though no list names them one by one.
 */
export function expandManagedEntries(
  entries: readonly string[],
  baseDir: string,
): string[] {
  const out: string[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = normalizePath(entries[i]!)
    const abs = path.join(baseDir, entry)
    if (!existsSync(abs)) {
      continue
    }
    out.push(entry)
    walkTree(abs, entry, out)
  }
  return out
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  // A cascaded member has no template/base and no scripts/repo — vacuous pass.
  if (!existsSync(TEMPLATE_BASE_DIR)) {
    return
  }
  // scripts/repo/ is wheelhouse-only, never cascaded, so a STATIC import would
  // break every member. Import at runtime, guarded by the probe above.
  const manifestUrl = pathToFileURL(
    path.join(REPO_ROOT, 'scripts/repo/sync-scaffolding/manifest.mts'),
  ).href
  const manifest = (await import(manifestUrl)) as {
    IDENTICAL_FILES: readonly string[]
    EXPECTED_FILES: readonly string[]
    PRESET_FILES: readonly string[]
    OPTIONAL_IDENTICAL_FILES: readonly string[]
    CONDITIONAL_FILES: ReadonlyArray<{ files: readonly string[] }>
  }
  const managedPaths = expandManagedEntries(
    [
      ...manifest.EXPECTED_FILES,
      ...manifest.PRESET_FILES,
      ...manifest.OPTIONAL_IDENTICAL_FILES,
      ...manifest.CONDITIONAL_FILES.flatMap(group => group.files),
      ...manifest.IDENTICAL_FILES,
    ],
    TEMPLATE_BASE_DIR,
  )
  const findings = findUnmanagedImports({
    managedPaths,
    readSource: readTemplateSource,
  })
  if (!findings.length) {
    if (!quiet) {
      logger.success(
        'managed-file-imports-are-managed: OK (every relative import propagates).',
      )
    }
    return
  }
  logger.error(
    [
      `managed-file-imports-are-managed: ${findings.length} relative import(s) the cascade never delivers.`,
      '',
      '  Where:',
      ...findings.map(
        f => `    ${f.importer}\n      ${f.specifier} -> ${f.resolved}`,
      ),
      '',
      '  Saw:    a managed file whose relative import target is in NO manifest',
      '          list, so the cascade ships the importer without the file it',
      '          imports and the module fails to load in every member.',
      '  Wanted: every relative import target managed by the same manifest.',
      '  Fix:    add the imported file to the SAME manifest group as its importer',
      '          in scripts/repo/sync-scaffolding/manifest/files.mts, then',
      '          re-cascade: node scripts/repo/sync-scaffolding/cli.mts --target . --fix',
      '',
    ].join('\n'),
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks every managed file relative-imports only files the cascade also manages',
  help: `Usage: node scripts/fleet/check/managed-file-imports-are-managed.mts [flags]

  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
