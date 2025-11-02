#!/usr/bin/env node
/**
 * @fileoverview Validates that markdown files follow naming conventions.
 *
 * Special files (allowed anywhere):
 * - README.md, LICENSE
 *
 * Allowed SCREAMING_CASE (all caps) files (root, docs/, or .claude/ only):
 * - AUTHORS.md, CHANGELOG.md, CITATION.md, CLAUDE.md
 * - CODE_OF_CONDUCT.md, CONTRIBUTORS.md, CONTRIBUTING.md
 * - COPYING, CREDITS.md, GOVERNANCE.md, MAINTAINERS.md
 * - NOTICE.md, SECURITY.md, SUPPORT.md, TRADEMARK.md
 *
 * All other .md files must:
 * - Be lowercase-with-hyphens
 * - Be located within docs/ or .claude/ directories (any depth)
 * - NOT be at root level
 */

import { promises as fs } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import loggerPkg from '@socketsecurity/lib/logger';

const logger = loggerPkg.getDefaultLogger();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootPath = path.join(__dirname, '..');

// Allowed SCREAMING_CASE markdown files (without .md extension for comparison)
const ALLOWED_SCREAMING_CASE = new Set([
  'AUTHORS',
  'CHANGELOG',
  'CITATION',
  'CLAUDE',
  'CODE_OF_CONDUCT',
  'CONTRIBUTORS',
  'CONTRIBUTING',
  'COPYING',
  'CREDITS',
  'GOVERNANCE',
  'LICENSE',
  'MAINTAINERS',
  'NOTICE',
  'README',
  'SECURITY',
  'SUPPORT',
  'TRADEMARK',
])

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
])

/**
 * Check if a filename is in SCREAMING_CASE (all uppercase with optional underscores).
 */
function isScreamingCase(filename) {
  // Remove extension for checking
  const nameWithoutExt = filename.replace(/\.(md|MD)$/, '')

  // Check if it contains any lowercase letters
  return /^[A-Z0-9_]+$/.test(nameWithoutExt) && /[A-Z]/.test(nameWithoutExt)
}

/**
 * Check if a filename is lowercase-with-hyphens.
 */
function isLowercaseHyphenated(filename) {
  // Remove extension for checking
  const nameWithoutExt = filename.replace(/\.md$/, '')

  // Must be lowercase letters, numbers, and hyphens only
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameWithoutExt)
}

/**
 * Recursively find all markdown files.
 */
async function findMarkdownFiles(dir, files = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
          await findMarkdownFiles(fullPath, files)
        }
      } else if (entry.isFile()) {
        // Check for .md files or LICENSE (no extension)
        if (entry.name.endsWith('.md') || entry.name === 'LICENSE') {
          files.push(fullPath)
        }
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return files
}

/**
 * Check if file is in an allowed location for SCREAMING_CASE files.
 * SCREAMING_CASE files can only be at: root, docs/, or .claude/ (top level only).
 */
function isInAllowedLocationForScreamingCase(filePath) {
  const relativePath = path.relative(rootPath, filePath)
  const dir = path.dirname(relativePath)

  // Allow at root level
  if (dir === '.') {
    return true
  }

  // Allow in docs/ folder (but not subdirectories)
  if (dir === 'docs') {
    return true
  }

  // Allow in .claude/ folder (but not subdirectories)
  if (dir === '.claude') {
    return true
  }

  return false
}

/**
 * Check if file is in an allowed location for regular markdown files.
 * Regular .md files must be within docs/ or .claude/ directories.
 */
function isInAllowedLocationForRegularMd(filePath) {
  const relativePath = path.relative(rootPath, filePath)
  const dir = path.dirname(relativePath)

  // Must be within docs/ (any depth)
  if (dir === 'docs' || dir.startsWith('docs/')) {
    return true
  }

  // Must be within .claude/ (any depth)
  if (dir === '.claude' || dir.startsWith('.claude/')) {
    return true
  }

  return false
}

/**
 * Validate a markdown filename.
 */
function validateFilename(filePath) {
  const filename = path.basename(filePath)
  const nameWithoutExt = filename.replace(/\.(md|MD)$/, '')
  const relativePath = path.relative(rootPath, filePath)

  // README.md and LICENSE are special - allowed anywhere
  if (nameWithoutExt === 'README' || nameWithoutExt === 'LICENSE') {
    return null // Valid - allowed in any location
  }

  // Check if it's an allowed SCREAMING_CASE file
  if (ALLOWED_SCREAMING_CASE.has(nameWithoutExt)) {
    // Must be in an allowed location (root, docs/, or .claude/)
    if (!isInAllowedLocationForScreamingCase(filePath)) {
      return {
        file: relativePath,
        filename,
        issue: 'SCREAMING_CASE files only allowed at root, docs/, or .claude/',
        suggestion: `Move to root, docs/, or .claude/, or rename to ${filename.toLowerCase().replace(/_/g, '-')}`,
      }
    }
    return null // Valid
  }

  // Check if it's in SCREAMING_CASE but not allowed
  if (isScreamingCase(filename)) {
    return {
      file: relativePath,
      filename,
      issue: 'SCREAMING_CASE not allowed',
      suggestion: filename.toLowerCase().replace(/_/g, '-'),
    }
  }

  // Check if it has .MD extension (should be .md)
  if (filename.endsWith('.MD')) {
    return {
      file: path.relative(rootPath, filePath),
      filename,
      issue: 'Extension should be lowercase .md',
      suggestion: filename.replace(/\.MD$/, '.md'),
    }
  }

  // Check if it's properly lowercase-hyphenated
  if (!isLowercaseHyphenated(filename)) {
    // Try to suggest a corrected version
    const nameOnly = filename.replace(/\.md$/, '')
    const suggested = nameOnly
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')

    return {
      file: relativePath,
      filename,
      issue: 'Must be lowercase-with-hyphens',
      suggestion: `${suggested}.md`,
    }
  }

  // Regular markdown files must be in docs/ or .claude/
  if (!isInAllowedLocationForRegularMd(filePath)) {
    return {
      file: relativePath,
      filename,
      issue: 'Markdown files must be in docs/ or .claude/ directories',
      suggestion: `Move to docs/${filename} or .claude/${filename}`,
    }
  }

  return null // Valid
}

/**
 * Validate all markdown filenames.
 */
async function validateMarkdownFilenames() {
  const files = await findMarkdownFiles(rootPath)
  const violations = []

  for (const file of files) {
    const violation = validateFilename(file)
    if (violation) {
      violations.push(violation)
    }
  }

  return violations
}

async function main() {
  try {
    const violations = await validateMarkdownFilenames();

    if (violations.length === 0) {
      logger.success('All markdown filenames follow conventions');
      process.exitCode = 0;
      return;
    }

    logger.fail('Markdown filename violations found');
    logger.log('');
    logger.log('Special files (allowed anywhere):');
    logger.log('  README.md, LICENSE');
    logger.log('');
    logger.log('Allowed SCREAMING_CASE files (root, docs/, or .claude/ only):');
    logger.log('  AUTHORS.md, CHANGELOG.md, CITATION.md, CLAUDE.md,');
    logger.log('  CODE_OF_CONDUCT.md, CONTRIBUTORS.md, CONTRIBUTING.md,');
    logger.log('  COPYING, CREDITS.md, GOVERNANCE.md, MAINTAINERS.md,');
    logger.log('  NOTICE.md, SECURITY.md, SUPPORT.md, TRADEMARK.md');
    logger.log('');
    logger.log('All other .md files must:');
    logger.log('  - Be lowercase-with-hyphens');
    logger.log('  - Be in docs/ or .claude/ directories (any depth)');
    logger.log('');

    for (const violation of violations) {
      logger.log(`  ${violation.file}`);
      logger.log(`    Issue: ${violation.issue}`);
      logger.log(`    Current: ${violation.filename}`);
      logger.log(`    Suggested: ${violation.suggestion}`);
      logger.log('');
    }

    logger.log('Rename files to follow conventions.');
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
