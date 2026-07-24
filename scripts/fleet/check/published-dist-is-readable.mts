/*
 * @file Release-hygiene gate: a fleet member that ships a bundled `dist/`
 *   (rolldown) must publish MAPLESS + UNMINIFIED code — Socket ships readable,
 *   unobscured code, never an unauditable minified blob with leaked source
 *   maps. In scope only when the repo actually publishes a bundled dist:
 *   package.json `files` includes `"dist"` AND a rolldown/rollup config exists
 *   (repo root or `.config/{fleet,repo}/`) — the same two-signal shape
 *   `dependencies-are-deduped.mts`'s `repoUsesRolldown` gates cross-major
 *   enforcement on. Skips cleanly (exit 0) when the repo doesn't ship a
 *   bundled dist, or `dist/` hasn't been built yet (a lint/type CI lane that
 *   never runs the build step) — never a false block on an unbuilt tree.
 *   Three assertions once in scope:
 *
 *   1. No `*.map` file exists anywhere under a publishing package's `dist/` — a
 *      source map in the tarball leaks original sources and bloats the
 *      artifact; it must never reach the published tarball.
 *   2. The built `dist/**\/*.{js,mjs,cjs}` is not minified — heuristic: sample up
 *      to SAMPLE_FILE_COUNT files and flag one whose average line length
 *      exceeds MAX_AVG_LINE_LENGTH, or that is a near-zero-newline megaline of
 *      real size. Calibrated against socket-lib's own unminified dist (~40
 *      chars/line) with ~7x headroom; a real minifier output measures in the
 *      thousands of chars/line (verified against tweetnacl / protobufjs
 *      minified bundles: ~9,000-19,000 chars/line).
 *   3. The bundler config itself sets `minify: false` EXPLICITLY (a literal grep)
 *      — pins intent so a future edit can't silently fall back to the bundler's
 *      default. The `no-minified-bundler-output` oxlint rule enforces this at
 *      AUTHOR time; this check re-verifies it at RELEASE time as a second,
 *      independent gate over the built artifact. MODE: REPORT-ONLY (exits 0,
 *      lists findings) — the member-ci-fires-on-push /
 *      published-packages-have-files-field rollout pattern: flip to 'strict'
 *      once the fleet backlog (if any) clears, so a pre-existing violation
 *      can't ship red fleet-wide on day one. Usage: node
 *      scripts/fleet/check/published-dist-is-readable.mts
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findWorkspacePackages } from './package-files-are-allowlisted.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

// Report now; flip to 'strict' once the fleet backlog (if any) clears.
const MODE: 'report' | 'strict' = 'report'

// Calibrated against socket-lib's own unminified dist (~40 chars/line);
// generous headroom before a legitimately long (but not minified) line trips
// it, while a real minifier's output (thousands of chars/line) clears it by
// an order of magnitude. A single-megaline file is the degenerate case of
// this same average (one line's length IS the average when there's only one
// line), so one threshold covers both "many long lines" and "one giant line"
// — no separate near-zero-newline branch needed.
const MAX_AVG_LINE_LENGTH = 300
// Sample this many dist files per package (traversal order) rather than
// reading every file in a large bundle.
const SAMPLE_FILE_COUNT = 5

const BUNDLER_CONFIG_BASENAMES: readonly string[] = [
  'rolldown.config.mts',
  'rolldown.config.ts',
  'rolldown.config.mjs',
  'rolldown.config.js',
  'rollup.config.mts',
  'rollup.config.ts',
  'rollup.config.mjs',
  'rollup.config.js',
]

export interface DistFinding {
  readonly fix: string
  readonly saw: string
  readonly what: string
  readonly where: string
}

export interface PackageJsonFiles {
  files?: unknown | undefined
}

/**
 * True when `pkg.files` is an array containing the literal `"dist"` entry —
 * the repo intends to publish a built dist directory. Pure.
 */
export function publishesDist(pkg: PackageJsonFiles): boolean {
  return Array.isArray(pkg.files) && pkg.files.includes('dist')
}

/**
 * Locate the repo's rolldown/rollup bundler config — checked at repo root and
 * under `.config/{fleet,repo}/`, the same locations
 * `dependencies-are-deduped.mts`'s `repoUsesRolldown` checks for a rolldown
 * dep-less bundling script. Returns the first match, or undefined when no
 * bundler config exists (the repo doesn't bundle).
 */
export function findBundlerConfig(repoRoot: string): string | undefined {
  const dirs = [
    repoRoot,
    path.join(repoRoot, '.config', 'fleet'),
    path.join(repoRoot, '.config', 'repo'),
  ]
  for (let i = 0, { length } = dirs; i < length; i += 1) {
    const dir = dirs[i]!
    for (let j = 0, n = BUNDLER_CONFIG_BASENAMES.length; j < n; j += 1) {
      const candidate = path.join(dir, BUNDLER_CONFIG_BASENAMES[j]!)
      if (existsSync(candidate)) {
        return candidate
      }
    }
  }
  return undefined
}

/**
 * True when `configText` sets `minify: false` (any spacing around the colon)
 * literally — pins intent so a future edit can't silently fall back to the
 * bundler's own minify default. An honest content check (does the config
 * TEXT contain this literal token?), not a behavior-inference — deliberately
 * narrow (no AST parse) since this only needs to confirm the pin is PRESENT.
 */
export function bundlerPinsNoMinify(configText: string): boolean {
  return /minify\s*:\s*false\b/.test(configText)
}

/**
 * Recursively collect every file under `dir` (absolute paths). Returns `[]`
 * when `dir` doesn't exist — the "dist not built yet" case this check must
 * skip cleanly rather than false-block on.
 */
export function walkFiles(dir: string): string[] {
  if (!existsSync(dir)) {
    return []
  }
  const out: string[] = []
  const entries = readdirSync(dir, { withFileTypes: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      out.push(...walkFiles(full))
    } else {
      out.push(full)
    }
  }
  return out
}

/**
 * The minification heuristic for one file's source text: an average line
 * length over MAX_AVG_LINE_LENGTH. A single-megaline file (real bundlers wrap
 * at module/statement boundaries; a minifier collapses onto one or a handful
 * of lines) is caught by the same formula — with zero (or near-zero) newlines
 * the "average" IS the file's own length. Pure; unit-tested directly against
 * literal strings calibrated from real unminified (socket-lib, ~40
 * chars/line) and minified (tweetnacl / protobufjs, ~9,000-19,000
 * chars/line) dist output.
 */
export function isLikelyMinified(source: string): boolean {
  const trimmed = source.replace(/\s+$/, '')
  if (trimmed.length === 0) {
    return false
  }
  const newlineCount = (trimmed.match(/\n/g) ?? []).length
  const avgLineLength = trimmed.length / (newlineCount + 1)
  return avgLineLength > MAX_AVG_LINE_LENGTH
}

/**
 * Evaluate one publishing package's built `dist/` (already confirmed to
 * exist by the caller): every `*.map` file is a finding, and up to
 * SAMPLE_FILE_COUNT sampled `.js`/`.mjs`/`.cjs` files are checked for
 * minification. Pure of process state.
 */
export function checkDistDir(distDir: string, relPkg: string): DistFinding[] {
  const findings: DistFinding[] = []
  const allFiles = walkFiles(distDir)
  const mapFiles = allFiles.filter(f => f.endsWith('.map'))
  for (let i = 0, { length } = mapFiles; i < length; i += 1) {
    findings.push({
      what: 'Source map published in a bundled dist',
      where: path.relative(distDir, mapFiles[i]!),
      saw: `${relPkg}: a .map file exists in the published dist/`,
      fix: 'Set `sourcemap: false` in the bundler config and rebuild — a source map must never reach the published tarball (Socket ships readable code, not de-obfuscation aids).',
    })
  }
  // `.js`, `.mjs`, or `.cjs` extension — the three JS output forms rolldown
  // can emit (`(?:c|m)?` is the optional single-letter cjs/mjs prefix).
  const jsFiles = allFiles.filter(f => /\.(?:c|m)?js$/.test(f))
  const sample = jsFiles.slice(0, SAMPLE_FILE_COUNT)
  for (let i = 0, { length } = sample; i < length; i += 1) {
    const file = sample[i]!
    let source: string
    try {
      source = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (isLikelyMinified(source)) {
      findings.push({
        what: 'Published dist appears minified',
        where: path.relative(distDir, file),
        saw: `${relPkg}: line-length heuristic flagged this file as minified (unminified fleet dist averages ~40 chars/line; a real minifier's output runs into the thousands)`,
        fix: 'Set `minify: false` in the bundler config and rebuild — Socket ships readable, unobscured code.',
      })
    }
  }
  return findings
}

/**
 * Discover every workspace package whose `files` field includes `"dist"`,
 * scoped to the repo's bundler-config eligibility (a repo-wide fact — one
 * shared rolldown/rollup config, not per-package). Returns `[]` (vacuous
 * pass) when the repo has no bundler config, or no package publishes a dist.
 * Pure of process state; unit-testable against a fixture repoRoot.
 */
export function collectFindings(repoRoot: string): DistFinding[] {
  const bundlerConfigPath = findBundlerConfig(repoRoot)
  if (!bundlerConfigPath) {
    return []
  }
  const pkgDirs = findWorkspacePackages(repoRoot)
  const publishingPkgDirs: string[] = []
  for (let i = 0, { length } = pkgDirs; i < length; i += 1) {
    const pkgDir = pkgDirs[i]!
    const pkgJsonPath = path.join(pkgDir, 'package.json')
    if (!existsSync(pkgJsonPath)) {
      continue
    }
    let pkg: PackageJsonFiles
    try {
      pkg = JSON.parse(readFileSync(pkgJsonPath, 'utf8')) as PackageJsonFiles
    } catch {
      continue
    }
    if (publishesDist(pkg)) {
      publishingPkgDirs.push(pkgDir)
    }
  }
  if (publishingPkgDirs.length === 0) {
    return []
  }

  const findings: DistFinding[] = []
  let configText: string
  try {
    configText = readFileSync(bundlerConfigPath, 'utf8')
  } catch {
    configText = ''
  }
  if (!bundlerPinsNoMinify(configText)) {
    findings.push({
      what: 'Bundler config does not explicitly pin `minify: false`',
      where: path.relative(repoRoot, bundlerConfigPath),
      saw: 'no literal `minify: false` in the bundler config',
      fix: 'Add `minify: false` to the rolldown/rollup config explicitly — pin intent rather than relying on the bundler default.',
    })
  }

  for (let i = 0, { length } = publishingPkgDirs; i < length; i += 1) {
    const pkgDir = publishingPkgDirs[i]!
    const distDir = path.join(pkgDir, 'dist')
    if (!existsSync(distDir)) {
      // dist not built yet (a lint/type CI lane) — skip this package cleanly.
      continue
    }
    const relPkg = path.relative(repoRoot, pkgDir) || '.'
    findings.push(...checkDistDir(distDir, relPkg))
  }
  return findings
}

/**
 * Scan + report for `repoRoot`, returning the process exit code. Split from
 * `main()` (not import-safe — `process.exit()`) so a test can drive the full
 * report against a fixture repo. Fails LOUD in the canonical four-ingredient
 * shape (What / Where / Saw / Fix) per finding.
 */
export function runCheck(repoRoot: string): number {
  const findings = collectFindings(repoRoot)
  if (findings.length === 0) {
    logger.log(
      '[check-published-dist-is-readable] OK — no bundled-dist readability findings (or the repo does not publish a bundled dist).',
    )
    return 0
  }

  const isStrict = MODE === 'strict'
  const prefix = isStrict
    ? '[check-published-dist-is-readable]'
    : '[check-published-dist-is-readable] (report-only)'
  logger.error('')
  logger.info(
    `${prefix} ${findings.length} published-dist readability finding(s):`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    logger.error('')
    logger.info(`Finding ${i + 1}:`)
    logger.info(`  What:  ${f.what}`)
    logger.info(`  Where: ${f.where}`)
    logger.info(`  Saw:   ${f.saw}`)
    logger.info(`  Fix:   ${f.fix}`)
  }
  return isStrict ? 1 : 0
}

function main(): void {
  process.exit(runCheck(REPO_ROOT))
}

if (isMainModule(import.meta.url)) {
  main()
}
