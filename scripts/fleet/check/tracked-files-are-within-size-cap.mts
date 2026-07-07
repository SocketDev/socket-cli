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

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const MAX_FILE_SIZE = 2 * 1024 * 1024

// Fleet-canonical large artifacts whose size is set by what they bundle/ship,
// not by repo authoring. Matched by path SUFFIX so both a member's live copy
// (.claude/…) and the wheelhouse template/base/.claude/… mirror are covered.
const ALLOWED_LARGE_SUFFIXES: readonly string[] = [
  // Rolldown-bundled fleet hook dispatcher + its V8-snapshot variant.
  '.claude/hooks/fleet/_dispatch/bundle.cjs',
  '.claude/hooks/fleet/_dispatch/snapshot-bundle.cjs',
]

export function isAllowedLargeFile(relativePath: string): boolean {
  const unix = relativePath.split(path.sep).join('/')
  return ALLOWED_LARGE_SUFFIXES.some(suffix => unix.endsWith(suffix))
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
  'coverage',
  'dist',
  'node_modules',
  'tmp',
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

export async function validateFileSizes(
  rootDir: string = REPO_ROOT,
): Promise<SizeViolation[]> {
  const violations = await scanDirectory(rootDir, rootDir)
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
