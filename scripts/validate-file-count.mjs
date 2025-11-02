#!/usr/bin/env node
/**
 * @fileoverview Validates that commits don't contain too many files.
 *
 * Rules:
 * - No single commit should contain 50+ files
 * - Helps catch accidentally staging too many files or generated content
 * - Prevents overly large commits that are hard to review
 */

import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import loggerPkg from '@socketsecurity/lib/logger';

const logger = loggerPkg.getDefaultLogger();
const execAsync = promisify(exec);

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.join(__dirname, '..');

// Maximum number of files in a single commit
const MAX_FILES_PER_COMMIT = 50;

/**
 * Check if too many files are staged for commit.
 */
async function validateStagedFileCount() {
  try {
    // Check if we're in a git repository
    const { stdout: gitRoot } = await execAsync('git rev-parse --show-toplevel', {
      cwd: rootPath,
    });

    if (!gitRoot.trim()) {
      return null; // Not a git repository
    }

    // Get list of staged files
    const { stdout } = await execAsync('git diff --cached --name-only', { cwd: rootPath });

    const stagedFiles = stdout
      .trim()
      .split('\n')
      .filter(line => line.length > 0);

    if (stagedFiles.length >= MAX_FILES_PER_COMMIT) {
      return {
        count: stagedFiles.length,
        files: stagedFiles,
        limit: MAX_FILES_PER_COMMIT,
      };
    }

    return null;
  } catch {
    // Not a git repo or git not available
    return null;
  }
}

async function main() {
  try {
    const violation = await validateStagedFileCount();

    if (!violation) {
      logger.success('Commit size is acceptable');
      process.exitCode = 0;
      return;
    }

    logger.fail('Too many files staged for commit');
    logger.log('');
    logger.log(`Staged files: ${violation.count}`);
    logger.log(`Maximum allowed: ${violation.limit}`);
    logger.log('');
    logger.log('Staged files:');
    logger.log('');

    // Show first 20 files, then summary if more
    const filesToShow = violation.files.slice(0, 20);
    for (const file of filesToShow) {
      logger.log(`  ${file}`);
    }

    if (violation.files.length > 20) {
      logger.log(`  ... and ${violation.files.length - 20} more files`);
    }

    logger.log('');
    logger.log(
      'Split into smaller commits, check for accidentally staged files, or exclude generated files.',
    );
    logger.log('');

    process.exitCode = 1;
  } catch (error) {
    logger.fail(`Validation failed: ${error.message}`);
    process.exitCode = 1;
  }
}

main().catch(error => {
  logger.fail(`Validation failed: ${error}`);
  process.exitCode = 1;
});
