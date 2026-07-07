/*
 * @file Release-hygiene gate: every publishable workspace `package.json` must
 *   declare a `files` field. npm ships the ENTIRE directory when `files` is
 *   absent — test fixtures, `.claude/` tooling, build scripts, coverage reports,
 *   and any secret-adjacent files all land in the tarball. A missing `files`
 *   declaration is a silent over-publish that breaks with no warning.
 *
 *   Publishable = `"private"` is not `true` AND the manifest has a `name`.
 *   Private packages never reach npm, so the check is moot for them.
 *
 *   MODE: REPORT-ONLY (exits 0, lists findings).
 *   Flip `MODE` to `'strict'` after clearing any pre-existing backlog — a hard
 *   gate on a pre-existing backlog ships red fleet-wide.
 *
 *   Exit codes:
 *   - 0 — all publishable packages declare `files`, or MODE is 'report' (even
 *     with findings).
 *   - 1 — one or more publishable packages missing `files` AND MODE is 'strict'.
 *
 *   Usage: node scripts/fleet/check/published-packages-have-files-field.mts
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { findWorkspacePackages } from './package-files-are-allowlisted.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

// Flip to 'strict' after the pre-existing backlog is clear. In strict mode a
// missing `files` field is a hard failure (exit 1). In report mode it is logged
// and the gate exits 0 so it never breaks CI on a pre-existing backlog.
const MODE: 'report' | 'strict' = 'report'

// Packages that legitimately skip the `files` field. Add a package name and a
// reason when the omission is intentional (e.g. a package that intentionally
// publishes its whole directory via a deliberate `.npmignore`-based allowlist).
// Keep this list empty — every entry here is a per-package exception that
// weakens the gate for that package.
export const FILES_FIELD_ALLOWLIST: ReadonlyMap<string, string> = new Map<
  string,
  string
>([
  // example: ['@scope/pkg', 'uses .npmignore instead; verified clean by pack-contents-are-clean']
])

export interface PackageJson {
  name?: string | undefined
  private?: boolean | undefined
  files?: unknown | undefined
}

export interface FilesFieldFinding {
  readonly pkgName: string
  readonly relPath: string
}

/**
 * Read + parse a `package.json`, returning only the fields this check uses.
 * Returns `undefined` on read or parse error — not this check's job to flag
 * malformed JSON.
 */
export function readPackageJson(pkgDir: string): PackageJson | undefined {
  const pkgPath = path.join(pkgDir, 'package.json')
  if (!existsSync(pkgPath)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(pkgPath, 'utf8')) as PackageJson
  } catch {
    return undefined
  }
}

/**
 * Evaluate one parsed `package.json`. Returns a finding when the package is
 * publishable (not private, has a name) and declares no `files` field, and is
 * not in the allowlist. Returns `undefined` when the package is clean or
 * exempt. Pure + side-effect-free so unit tests can exercise it directly.
 */
export function checkFilesField(
  pkg: PackageJson,
  relPath: string,
): FilesFieldFinding | undefined {
  if (pkg.private === true) {
    return undefined
  }
  const name = pkg.name
  if (!name) {
    return undefined
  }
  if (FILES_FIELD_ALLOWLIST.has(name)) {
    return undefined
  }
  // `files` may be an array (correct), a non-array (malformed but present), or
  // absent. We only flag the fully-absent case — malformed shapes are caught by
  // the package-files-are-allowlisted gate's deeper audit.
  if (pkg.files !== undefined) {
    return undefined
  }
  return { pkgName: name, relPath }
}

/**
 * Discover every workspace package, evaluate each publishable one, and return
 * all findings. Pure of process state — callers decide reporting.
 */
export function collectFindings(repoRoot: string): FilesFieldFinding[] {
  const pkgDirs = findWorkspacePackages(repoRoot)
  const findings: FilesFieldFinding[] = []
  for (let i = 0, { length } = pkgDirs; i < length; i += 1) {
    const pkgDir = pkgDirs[i]!
    const pkg = readPackageJson(pkgDir)
    if (!pkg) {
      continue
    }
    const rel = path.relative(repoRoot, pkgDir)
    const relPath = `${rel === '' ? '.' : rel}/package.json`
    const finding = checkFilesField(pkg, relPath)
    if (finding) {
      findings.push(finding)
    }
  }
  return findings
}

/**
 * Scan + report for `repoRoot`, returning the process exit code. Split from
 * `main()` (which is not import-safe — it calls `process.exit()`) so a test
 * can drive the full report against a fixture repo without killing the test
 * runner or fighting the fixed `REPO_ROOT` constant.
 */
export function runCheck(repoRoot: string): number {
  const findings = collectFindings(repoRoot)
  if (findings.length === 0) {
    logger.log(
      '[check-published-packages-have-files-field] all publishable packages declare `files`.',
    )
    return 0
  }

  const isStrict = MODE === 'strict'
  const prefix = isStrict
    ? '[check-published-packages-have-files-field]'
    : '[check-published-packages-have-files-field] (report-only)'
  process.stderr.write(
    `${prefix} ${findings.length} publishable package${findings.length === 1 ? '' : 's'} missing \`files\` field:\n`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    process.stderr.write(
      `  ${f.pkgName} (${f.relPath}) — without \`files\`, npm publishes the whole directory. ` +
        `Declare an explicit \`files\` allowlist (typically ["CHANGELOG.md", "dist"]).\n`,
    )
  }
  process.stderr.write(
    '\nFix: add a `files` array to each package.json above. ' +
      'See scripts/fleet/check/package-files-are-allowlisted.mts for ' +
      'deeper allowlist hygiene.\n',
  )
  return isStrict ? 1 : 0
}

function main(): void {
  process.exit(runCheck(REPO_ROOT))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
