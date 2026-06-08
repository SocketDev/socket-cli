/**
 * @file Enforce `package.json` `files:` allowlist hygiene for every publishable
 *   workspace package. Three failure modes the lint catches:
 *
 *   1. **Overshoot** — a publish that includes paths the maintainer doesn't intend
 *      to ship (e.g. `test/`, `scripts/`, `*.test.*` files). Common cause:
 *      `files:` missing entirely (publishes everything not in `.npmignore`) or
 *      `files: ["."]` (same).
 *   2. **Undershoot** — `files:` entry that matches nothing in the publish output
 *      (rotted after a rename or directory deletion). Stays silent until
 *      consumers complain the package is missing a file.
 *   3. **Missing essentials** — common files (`README.md`, `LICENSE*`) absent from
 *      the publish output. README + LICENSE are required-by- convention;
 *      missing them ships malformed packages. Skips workspaces marked
 *      `"private": true` (those don't publish). Uses `npm pack --dry-run
 *      --json` as the source of truth for "what would publish" — same logic npm
 *      itself uses, including `.npmignore` resolution + the
 *      unconditionally-included file list. CI gate via `scripts/check.mts`.
 *      Exit 0 = clean. Exit 1 = drift, with per-package finding lists.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
// oxlint-disable-next-line socket/prefer-async-spawn -- sync stdin/stdout + typed string return matches the read-stdout-then-parse-JSON shape; v5 lib spawnSync omits 'encoding' from SpawnSyncOptions and returns string-or-Buffer.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

export interface PackageJson {
  name?: string | undefined
  private?: boolean | undefined
  files?: string[] | undefined
  scripts?: Record<string, string> | undefined
}

export interface PackOutput {
  files: Array<{ path: string; size: number; mode: number }>
}

export interface Finding {
  kind: 'overshoot' | 'undershoot' | 'missing_essential' | 'pack_failed'
  pkgDir: string
  pkgName: string
  message: string
}

/**
 * Patterns that should never appear in a publish output. If `npm pack
 * --dry-run` includes any of these, the `files:` allowlist is broken or
 * missing. Each pattern is matched against the publish-relative path.
 */
export const FORBIDDEN_PUBLISHED_PATTERNS: readonly RegExp[] = [
  // Test files of any common shape.
  /(^|\/)test\//, // socket-lint: allow regex-alternation-order — `^` (start anchor) before `\/` (literal slash) reads as "either start-of-path or a slash boundary".
  /(^|\/)tests\//, // socket-lint: allow regex-alternation-order — `^` (start anchor) before `\/` (literal slash) reads as "either start-of-path or a slash boundary".
  /\.test\.[cm]?[jt]sx?$/,
  /\.spec\.[cm]?[jt]sx?$/,
  // Build/dev scripts that aren't part of the published API.
  /(^|\/)scripts\//, // socket-lint: allow regex-alternation-order — `^` (start anchor) before `\/` (literal slash) reads as "either start-of-path or a slash boundary".
  // Per-developer config dirs.
  /(^|\/)\.config\//, // socket-lint: allow regex-alternation-order
  /(^|\/)\.github\//, // socket-lint: allow regex-alternation-order
  /(^|\/)\.claude\//, // socket-lint: allow regex-alternation-order
  /(^|\/)\.git-hooks\//, // socket-lint: allow regex-alternation-order
  /(^|\/)\.vscode\//, // socket-lint: allow regex-alternation-order
  // Lockfiles + workspace metadata.
  /(^|\/)pnpm-lock\.yaml$/, // socket-lint: allow regex-alternation-order
  /(^|\/)pnpm-workspace\.yaml$/, // socket-lint: allow regex-alternation-order
]

/**
 * Files that, by convention, should appear in every npm-published package.
 * Missing these surfaces as `missing_essential`. README + LICENSE are
 * non-negotiable; CHANGELOG is strongly recommended for consumer-facing
 * libraries.
 */
export const ESSENTIAL_FILES: readonly RegExp[] = [
  /^README(\.md)?$/i,
  /^LICENSE(\.md|\.txt)?$/i,
]

/**
 * Walk the workspace `packages:` glob in `pnpm-workspace.yaml` to find every
 * workspace package root. Returns absolute paths to dirs that contain a
 * `package.json`.
 */
export function findWorkspacePackages(repoRoot: string): string[] {
  const wsPath = path.join(repoRoot, 'pnpm-workspace.yaml')
  if (!existsSync(wsPath)) {
    return [repoRoot]
  }
  const content = readFileSync(wsPath, 'utf8')
  const lines = content.split('\n')
  const packagesIdx = lines.findIndex(line => line.trimEnd() === 'packages:')
  if (packagesIdx === -1) {
    return [repoRoot]
  }
  const globs: string[] = []
  for (let i = packagesIdx + 1, { length } = lines; i < length; i += 1) {
    const ln = lines[i]!
    if (ln === '' || (ln.length > 0 && !/^\s/.test(ln))) {
      break
    }
    const m = /^\s*-\s*['"]?([^'"#]+?)['"]?\s*(?:#.*)?$/.exec(ln)
    if (m?.[1]) {
      globs.push(m[1].trim())
    }
  }
  const out: string[] = [repoRoot]
  for (let i = 0, { length } = globs; i < length; i += 1) {
    const glob = globs[i]!
    if (glob.startsWith('!')) {
      continue
    }
    if (glob.endsWith('/*')) {
      const parentRel = glob.slice(0, -2)
      const parentAbs = path.join(repoRoot, parentRel)
      if (!existsSync(parentAbs)) {
        continue
      }
      const children = readdirSync(parentAbs)
      for (let j = 0, cl = children.length; j < cl; j += 1) {
        const child = children[j]!
        const childAbs = path.join(parentAbs, child)
        if (
          statSync(childAbs).isDirectory() &&
          existsSync(path.join(childAbs, 'package.json'))
        ) {
          out.push(childAbs)
        }
      }
    } else if (existsSync(path.join(repoRoot, glob, 'package.json'))) {
      out.push(path.join(repoRoot, glob))
    }
  }
  return out
}

/**
 * Read + parse a package.json. Returns `undefined` on missing file or parse
 * error (the surrounding check should treat that as "skip this package, not the
 * lint's job to flag malformed JSON").
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
 * Run `npm pack --dry-run --json` in `pkgDir` and parse the publish file list.
 * Returns `undefined` on pack failure (caller emits a finding).
 */
export function runPackDryRun(pkgDir: string): PackOutput | undefined {
  const r = spawnSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: pkgDir,
    stdio: ['ignore', 'pipe', 'pipe'],
  } as unknown as Parameters<typeof spawnSync>[2])
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return undefined
  }
  try {
    const parsed = JSON.parse(String(r.stdout)) as PackOutput[]
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return undefined
    }
    return parsed[0]
  } catch {
    return undefined
  }
}

/**
 * Decide whether a `files:` allowlist entry has any match in the publish
 * output. Handles bare names ("dist"), shallow globs ("_.md"), and "dist/_"
 * forms. Full minimatch support is overkill — the fleet's `files:` entries are
 * uniformly shallow.
 */
export function matchesAny(paths: string[], entry: string): boolean {
  const clean = entry.replace(/^\.?\/?/, '')
  if (clean.includes('*')) {
    const re = new RegExp(
      '^' +
        clean
          .replaceAll('.', '\\.')
          .replaceAll('**', '@@DOUBLESTAR@@')
          .replaceAll('*', '[^/]*')
          .replaceAll('@@DOUBLESTAR@@', '.*') +
        '$',
    )
    return paths.some(p => re.test(p))
  }
  return paths.some(p => p === clean || p.startsWith(`${clean}/`))
}

/**
 * Apply the three failure-mode checks to one package's pack output. Pushes
 * findings into `findings` in-place. `pkgName` defaults to the directory
 * basename when `package.json` has no `name` (rare; the workspace runner
 * usually requires it).
 */
export function checkPackage(
  pkgDir: string,
  pkg: PackageJson,
  packOut: PackOutput,
  findings: Finding[],
): void {
  const pkgName = pkg.name ?? path.basename(pkgDir)
  const paths = packOut.files.map(f => f.path)

  // Overshoot: any path matching a forbidden pattern.
  for (let i = 0, { length } = paths; i < length; i += 1) {
    const p = paths[i]!
    for (let j = 0, fl = FORBIDDEN_PUBLISHED_PATTERNS.length; j < fl; j += 1) {
      if (FORBIDDEN_PUBLISHED_PATTERNS[j]!.test(p)) {
        findings.push({
          kind: 'overshoot',
          pkgDir,
          pkgName,
          message: `Publishes \`${p}\` — looks like dev/test content. Tighten the \`files:\` allowlist in package.json so it doesn't leak into the published tarball.`,
        })
      }
    }
  }

  // Undershoot: each `files:` glob must match at least one path.
  if (Array.isArray(pkg.files)) {
    for (let i = 0, { length } = pkg.files; i < length; i += 1) {
      const entry = pkg.files[i]!
      if (!matchesAny(paths, entry)) {
        findings.push({
          kind: 'undershoot',
          pkgDir,
          pkgName,
          message: `\`files:\` entry \`${entry}\` matches nothing in the publish output. Remove the entry, or restore the file it was meant to ship.`,
        })
      }
    }
  }

  // Missing essentials: README + LICENSE must appear in the published set.
  for (let i = 0, { length } = ESSENTIAL_FILES; i < length; i += 1) {
    const re = ESSENTIAL_FILES[i]!
    if (!paths.some(p => re.test(p))) {
      findings.push({
        kind: 'missing_essential',
        pkgDir,
        pkgName,
        message: `Publish output has no file matching ${re.source}. Every published package must ship a README and LICENSE.`,
      })
    }
  }
}

/**
 * Run the check on every workspace package in `repoRoot`. Returns exit code (0
 * = clean, 1 = findings).
 */
export function runCheck(repoRoot: string): number {
  const findings: Finding[] = []
  const pkgDirs = findWorkspacePackages(repoRoot)
  for (let i = 0, { length } = pkgDirs; i < length; i += 1) {
    const pkgDir = pkgDirs[i]!
    const pkg = readPackageJson(pkgDir)
    if (!pkg || pkg.private || !pkg.name) {
      continue
    }
    const packOut = runPackDryRun(pkgDir)
    if (!packOut) {
      findings.push({
        kind: 'pack_failed',
        pkgDir,
        pkgName: pkg.name,
        message: `\`npm pack --dry-run --json\` failed; can't verify the publish surface.`,
      })
      continue
    }
    checkPackage(pkgDir, pkg, packOut, findings)
  }
  if (findings.length === 0) {
    logger.log(
      '[check-package-files-are-allowlisted] all publishable packages OK',
    )
    return 0
  }
  logger.fail(
    `[check-package-files-are-allowlisted] ${findings.length} finding(s):`,
  )
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    const rel = path.relative(repoRoot, f.pkgDir) || '.'
    logger.log(`  ${f.pkgName} (${rel}) [${f.kind}]: ${f.message}`)
  }
  return 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.exit(runCheck(REPO_ROOT))
}
