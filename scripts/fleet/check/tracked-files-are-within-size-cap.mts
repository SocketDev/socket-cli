#!/usr/bin/env node
/**
 * @file Commit-time gate: no single file in the working tree exceeds the 2 MB
 *   byte cap. Catches an accidentally-committed binary, data dump, or build
 *   artifact before it bloats the repo. Distinct from socket/max-file-lines (a
 *   per-file LINE count for source) — this is a whole-tree BYTE-size scan.
 *   Skips build/cache/vendor dirs (node_modules, dist, build, coverage, vendor,
 *   .git, …); a small allowlist covers fleet-canonical generated artifacts
 *   whose size is bounded by what they bundle (the rolldown hook dispatcher).
 *   Exits non-zero on any violation.
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const MAX_FILE_SIZE = 2 * 1024 * 1024

// Fleet-canonical large artifacts whose size is set by what they bundle/ship,
// not by repo authoring. Matched by path SUFFIX so both a member's live copy
// (.claude/…) and the wheelhouse template/base/.claude/… mirror are covered.
const ALLOWED_LARGE_SUFFIXES: readonly string[] = [
  // Rolldown-bundled fleet hook dispatcher, its V8-snapshot variant, and the
  // excluded-hooks companion bundle (non-bundle-safe hooks, same build).
  '.claude/hooks/fleet/_dispatch/bundle.cjs',
  '.claude/hooks/fleet/_dispatch/excluded-bundle.cjs',
  '.claude/hooks/fleet/_dispatch/snapshot-bundle.cjs',
]

export function isAllowedLargeFile(relativePath: string): boolean {
  const unix = relativePath.split(path.sep).join('/')
  return ALLOWED_LARGE_SUFFIXES.some(suffix => unix.endsWith(suffix))
}

// Repo-owned exceptions (same opt-in pattern as .config/repo/lock-step-refs.json):
// exact repo-relative paths a host repo deliberately tracks above the cap
// (bench corpora whose size IS the workload, committed PGO profiles). Every
// entry must carry a non-empty reason; globs are not supported so an entry
// can never silently admit future large files.
const EXCEPTIONS_CONFIG = '.config/repo/size-cap-exceptions.json'

export async function loadSizeCapExceptions(
  rootDir: string,
): Promise<Set<string>> {
  const configPath = path.join(rootDir, EXCEPTIONS_CONFIG)
  let raw: string
  try {
    raw = await fs.readFile(configPath, 'utf8')
  } catch {
    return new Set()
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (e) {
    throw new Error(
      `${EXCEPTIONS_CONFIG} is not valid JSON: ${(e as Error).message}. ` +
        `Fix the syntax (or drop the config to run with no exceptions).`,
    )
  }
  const allow = (parsed as { allow?: unknown })?.allow
  if (!Array.isArray(allow)) {
    throw new Error(
      `${EXCEPTIONS_CONFIG} must be { "allow": [{ "path", "reason" }] } — ` +
        `saw no "allow" array. Fix the shape (or drop the config).`,
    )
  }
  const paths = new Set<string>()
  for (const entry of allow) {
    const p = (entry as { path?: unknown })?.path
    const reason = (entry as { reason?: unknown })?.reason
    if (typeof p !== 'string' || p === '' || p.includes('*')) {
      throw new Error(
        `${EXCEPTIONS_CONFIG}: every allow entry needs an exact ` +
          `repo-relative "path" (no globs) — saw ${JSON.stringify(p)}.`,
      )
    }
    if (typeof reason !== 'string' || reason.trim() === '') {
      throw new Error(
        `${EXCEPTIONS_CONFIG}: entry for ${p} is missing a non-empty ` +
          `"reason" — justify the exception or remove the entry.`,
      )
    }
    paths.add(p)
  }
  return paths
}

const SKIP_DIRS = new Set<string>([
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vercel',
  '.vscode',
  'build',
  'cmake-build',
  'cmake-build-tests',
  'coverage',
  'dist',
  'dist-app',
  // Vendored upstream trees (submodule corpora) are foreign content sized by
  // their upstreams, not this repo's tracked surface.
  'external',
  'node_modules',
  // Cargo build-output dirs: `target` is cargo's default and `out` is the
  // fleet build layout's output segment (build/<mode>/<platform-arch>/out/…,
  // also used as CARGO_TARGET_DIR). Local rust builds drop multi-hundred-MB
  // rlibs there; they are never tracked surface.
  'out',
  'pkg-node',
  'pkg-node-dev',
  'target',
  'third_party',
  'tmp',
  'upstream',
  'vendor',
])

export interface SizeViolation {
  file: string
  formattedSize: string
  size: number
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i] ?? 'B'}`
}

export async function scanDirectory(
  dir: string,
  rootDir: string,
  violations: SizeViolation[] = [],
): Promise<SizeViolation[]> {
  let entries
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    // Skip directories we can't read.
    return violations
  }
  // A `.git` entry below the root marks a nested checkout (submodule
  // working tree) — foreign surface sized by its upstream, never this
  // repo's tracked content. Don't descend.
  if (dir !== rootDir && entries.some(e => e.name === '.git')) {
    return violations
  }
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      // Skip excluded + hidden dirs (except the fleet config trees).
      if (
        !SKIP_DIRS.has(entry.name) &&
        (!entry.name.startsWith('.') ||
          entry.name === '.claude' ||
          entry.name === '.config' ||
          entry.name === '.github')
      ) {
        await scanDirectory(fullPath, rootDir, violations)
      }
    } else if (entry.isFile()) {
      let size: number
      try {
        // oxlint-disable-next-line socket/prefer-exists-sync -- need the byte size, not existence.
        size = (await fs.stat(fullPath)).size
      } catch {
        continue
      }
      if (size > MAX_FILE_SIZE) {
        const relativePath = path.relative(rootDir, fullPath)
        if (!isAllowedLargeFile(relativePath)) {
          violations.push({
            file: relativePath,
            formattedSize: formatBytes(size),
            size,
          })
        }
      }
    }
  }
  return violations
}

// Drop violations git itself ignores (local build stragglers a commit can
// never sweep in — a stray compiled binary, a generated embed). One batch
// check-ignore call over the violation set only; fail-open (keep the
// violation) when git is unavailable.
export function filterGitIgnored(
  violations: SizeViolation[],
  rootDir: string,
): SizeViolation[] {
  if (violations.length === 0) {
    return violations
  }
  const result = spawnSync('git', ['check-ignore', '--stdin', '-z'], {
    cwd: rootDir,
    input: violations.map(v => v.file).join('\0'),
    stdio: 'pipe',
    stdioString: true,
  })
  // Exit 0 = some ignored, 1 = none ignored, 128 = error (fail-open).
  if (result.status !== 0 && result.status !== 1) {
    return violations
  }
  const ignored = new Set(
    String(result.stdout ?? '')
      .split('\0')
      .filter(Boolean),
  )
  return violations.filter(v => !ignored.has(v.file))
}

export async function validateFileSizes(
  rootDir: string = REPO_ROOT,
): Promise<SizeViolation[]> {
  const exceptions = await loadSizeCapExceptions(rootDir)
  const violations = filterGitIgnored(
    (await scanDirectory(rootDir, rootDir)).filter(
      v => !exceptions.has(v.file.split(path.sep).join('/')),
    ),
    rootDir,
  )
  violations.sort((a, b) => b.size - a.size)
  return violations
}

async function main(): Promise<void> {
  const violations = await validateFileSizes()
  if (violations.length === 0) {
    logger.success('All files are within the size cap')
    return
  }
  logger.fail(`File size cap exceeded (max ${formatBytes(MAX_FILE_SIZE)})`)
  logger.log('')
  for (const violation of violations) {
    logger.log(`  ${violation.file} — ${violation.formattedSize}`)
  }
  logger.log('')
  logger.log(
    'Reduce the file, move it to external storage, or skip it from the tree.',
  )
  process.exitCode = 1
}

main().catch((error: unknown) => {
  logger.fail('file-size check failed:', error)
  process.exitCode = 1
})
