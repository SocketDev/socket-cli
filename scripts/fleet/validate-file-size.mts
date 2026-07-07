#!/usr/bin/env node
/*
 * @file Validates that no individual files exceed size threshold. Rules:
 *
 *   - No single file should exceed 2MB (2,097,152 bytes)
 *   - Helps prevent accidental commits of large binaries, data files, or
 *     artifacts
 *   - Excludes: node_modules, .git, dist, build, coverage directories
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const rootPath = REPO_ROOT

// Maximum file size: 2MB (2,097,152 bytes)
const MAX_FILE_SIZE = 2 * 1024 * 1024

// Allowlisted large files: fleet-canonical assets whose size is bounded by
// the upstream they ship, not by repo authoring. Empty — the shared AST
// parser ships as the @ultrathink/acorn.wasm dependency (resolved from
// node_modules), not a tracked binary. Adding a path here is intentional —
// it should only happen for files the fleet jointly owns, not per-repo
// binary leaks.
const ALLOWED_LARGE_FILES = new Set<string>()

// Directories to skip
const SKIP_DIRS = new Set([
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
  'external',
  'node_modules',
  'tmp',
])

/**
 * Format bytes to human-readable size.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) {
    return '0 B'
  }
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    sizes.length - 1,
  )
  return `${(bytes / k ** i).toFixed(2)} ${sizes[i]}`
}

interface FileSizeViolation {
  file: string
  size: number
  formattedSize: string
  maxSize: string
}

/**
 * Recursively scan directory for files exceeding size limit.
 */
async function scanDirectory(
  dir: string,
  violations: FileSizeViolation[] = [],
): Promise<FileSizeViolation[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]!
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip excluded directories and hidden directories (except .claude, .config, .github)
        if (
          !SKIP_DIRS.has(entry.name) &&
          (!entry.name.startsWith('.') ||
            entry.name === '.claude' ||
            entry.name === '.config' ||
            entry.name === '.github')
        ) {
          await scanDirectory(fullPath, violations)
        }
      } else if (entry.isFile()) {
        try {
          // oxlint-disable-next-line socket/prefer-exists-sync -- need stats.size for the size threshold check; this IS the file-size validator.
          const stats = await fs.stat(fullPath)
          if (stats.size > MAX_FILE_SIZE) {
            const relativePath = path.relative(rootPath, fullPath)
            if (ALLOWED_LARGE_FILES.has(relativePath)) {
              continue
            }
            violations.push({
              file: relativePath,
              size: stats.size,
              formattedSize: formatBytes(stats.size),
              maxSize: formatBytes(MAX_FILE_SIZE),
            })
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return violations
}

/**
 * Validate file sizes in repository.
 */
async function validateFileSizes(): Promise<FileSizeViolation[]> {
  const violations = await scanDirectory(rootPath)

  // Sort by size descending (largest first)
  violations.sort((a, b) => b.size - a.size)

  return violations
}

async function main(): Promise<void> {
  try {
    const violations = await validateFileSizes()

    if (violations.length === 0) {
      logger.success('All files are within size limits')
      process.exitCode = 0
      return
    }

    logger.fail('File size violations found')
    logger.log('')
    logger.log(`Maximum allowed file size: ${formatBytes(MAX_FILE_SIZE)}`)
    logger.log('')
    logger.log('Files exceeding limit:')
    logger.log('')

    for (let i = 0, { length } = violations; i < length; i += 1) {
      const violation = violations[i]!
      logger.log(`  ${violation.file}`)
      logger.log(`    Size: ${violation.formattedSize}`)
      logger.log(
        `    Exceeds limit by: ${formatBytes(violation.size - MAX_FILE_SIZE)}`,
      )
      logger.log('')
    }

    logger.log(
      'Reduce file sizes, move large files to external storage, or exclude from repository.',
    )
    logger.log('')

    process.exitCode = 1
  } catch (e) {
    logger.fail(`Validation failed: ${errorMessage(e)}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  logger.fail(`Validation failed: ${e}`)
  process.exitCode = 1
})
