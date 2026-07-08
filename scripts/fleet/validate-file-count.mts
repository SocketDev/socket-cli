#!/usr/bin/env node
/*
 * @file Validates that commits don't contain too many files. Rules:
 *
 *   - No single commit should contain 50+ files
 *   - Helps catch accidentally staging too many files or generated content
 *   - Prevents overly large commits that are hard to review
 */

import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const rootPath = REPO_ROOT

// Maximum number of files in a single commit
const MAX_FILES_PER_COMMIT = 50

interface FileCountViolation {
  count: number
  files: string[]
  limit: number
}

/**
 * Check if too many files are staged for commit.
 */
async function validateStagedFileCount(): Promise<
  FileCountViolation | undefined
> {
  try {
    // Check if we're in a git repository
    const { stdout: gitRoot } = await spawn(
      'git',
      ['rev-parse', '--show-toplevel'],
      {
        cwd: rootPath,
      },
    )

    // Not a git repository
    if (!String(gitRoot).trim()) {
      return undefined
    }

    // Get list of staged files
    const { stdout } = await spawn('git', ['diff', '--cached', '--name-only'], {
      cwd: rootPath,
    })

    const stagedFiles = String(stdout)
      .trim()
      .split('\n')
      .filter(line => line.length > 0)

    if (stagedFiles.length >= MAX_FILES_PER_COMMIT) {
      return {
        count: stagedFiles.length,
        files: stagedFiles,
        limit: MAX_FILES_PER_COMMIT,
      }
    }

    return undefined
  } catch {
    // Not a git repo or git not available
    return undefined
  }
}

async function main(): Promise<void> {
  try {
    const violation = await validateStagedFileCount()

    if (!violation) {
      logger.success('Commit size is acceptable')
      process.exitCode = 0
      return
    }

    logger.fail('Too many files staged for commit')
    logger.log('')
    logger.log(`Staged files: ${violation.count}`)
    logger.log(`Maximum allowed: ${violation.limit}`)
    logger.log('')
    logger.log('Staged files:')
    logger.log('')

    // Show first 20 files, then summary if more
    const filesToShow = violation.files.slice(0, 20)
    for (let i = 0, { length } = filesToShow; i < length; i += 1) {
      const file = filesToShow[i]!
      logger.log(`  ${file}`)
    }

    if (violation.files.length > 20) {
      logger.log(`  ... and ${violation.files.length - 20} more files`)
    }

    logger.log('')
    logger.log(
      'Split into smaller commits, check for accidentally staged files, or exclude generated files.',
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
