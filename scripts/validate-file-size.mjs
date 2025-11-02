#!/usr/bin/env node
/**
 * @fileoverview Validates that no individual files exceed size threshold.
 *
 * Rules:
 * - No single file should exceed 2MB (2,097,152 bytes)
 * - Helps prevent accidental commits of large binaries, data files, or artifacts
 * - Excludes: node_modules, .git, dist, build, coverage directories
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import loggerPkg from '@socketsecurity/lib/logger';

const logger = loggerPkg.getDefaultLogger();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.join(__dirname, '..');

// Maximum file size: 2MB
const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2,097,152 bytes

// Directories to skip
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.cache',
  'coverage',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.vercel',
  '.vscode',
  'tmp',
]);

/**
 * Format bytes to human-readable size.
 */
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
}

/**
 * Recursively scan directory for files exceeding size limit.
 */
async function scanDirectory(dir, violations = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip excluded directories and hidden directories (except .claude, .config, .github)
        if (
          !SKIP_DIRS.has(entry.name) &&
          (!entry.name.startsWith('.') ||
            entry.name === '.claude' ||
            entry.name === '.config' ||
            entry.name === '.github')
        ) {
          await scanDirectory(fullPath, violations);
        }
      } else if (entry.isFile()) {
        try {
          const stats = await fs.stat(fullPath);
          if (stats.size > MAX_FILE_SIZE) {
            const relativePath = path.relative(rootPath, fullPath);
            violations.push({
              file: relativePath,
              size: stats.size,
              formattedSize: formatBytes(stats.size),
              maxSize: formatBytes(MAX_FILE_SIZE),
            });
          }
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return violations;
}

/**
 * Validate file sizes in repository.
 */
async function validateFileSizes() {
  const violations = await scanDirectory(rootPath);

  // Sort by size descending (largest first)
  violations.sort((a, b) => b.size - a.size);

  return violations;
}

async function main() {
  try {
    const violations = await validateFileSizes();

    if (violations.length === 0) {
      logger.success('All files are within size limits');
      process.exitCode = 0;
      return;
    }

    logger.fail('File size violations found');
    logger.log('');
    logger.log(`Maximum allowed file size: ${formatBytes(MAX_FILE_SIZE)}`);
    logger.log('');
    logger.log('Files exceeding limit:');
    logger.log('');

    for (const violation of violations) {
      logger.log(`  ${violation.file}`);
      logger.log(`    Size: ${violation.formattedSize}`);
      logger.log(`    Exceeds limit by: ${formatBytes(violation.size - MAX_FILE_SIZE)}`);
      logger.log('');
    }

    logger.log(
      'Reduce file sizes, move large files to external storage, or exclude from repository.',
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
