#!/usr/bin/env node
/**
 * @fileoverview Validates that there are no CDN references in the codebase.
 *
 * This is a preventative check to ensure no hardcoded CDN URLs are introduced.
 * The project deliberately avoids CDN dependencies for security and reliability.
 *
 * Blocked CDN domains:
 * - unpkg.com
 * - cdn.jsdelivr.net
 * - esm.sh
 * - cdn.skypack.dev
 * - ga.jspm.io
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import loggerPkg from '@socketsecurity/lib/logger'

const logger = loggerPkg.getDefaultLogger()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const rootPath = path.join(__dirname, '..')

// CDN domains to block
const CDN_PATTERNS = [
  /unpkg\.com/i,
  /cdn\.jsdelivr\.net/i,
  /esm\.sh/i,
  /cdn\.skypack\.dev/i,
  /ga\.jspm\.io/i,
]

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
  '.type-coverage',
  '.yarn',
])

// File extensions to check
const TEXT_EXTENSIONS = new Set([
  '.js',
  '.mjs',
  '.cjs',
  '.ts',
  '.mts',
  '.cts',
  '.jsx',
  '.tsx',
  '.json',
  '.md',
  '.html',
  '.htm',
  '.css',
  '.yml',
  '.yaml',
  '.xml',
  '.svg',
  '.txt',
  '.sh',
  '.bash',
])

/**
 * Check if file should be scanned.
 */
function shouldScanFile(filename) {
  const ext = path.extname(filename).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

/**
 * Recursively find all text files to scan.
 */
async function findTextFiles(dir, files = []) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)

      if (entry.isDirectory()) {
        // Skip certain directories and hidden directories (except .github)
        if (
          !SKIP_DIRS.has(entry.name) &&
          (!entry.name.startsWith('.') || entry.name === '.github')
        ) {
          await findTextFiles(fullPath, files)
        }
      } else if (entry.isFile() && shouldScanFile(entry.name)) {
        files.push(fullPath)
      }
    }
  } catch {
    // Skip directories we can't read
  }

  return files
}

/**
 * Check file contents for CDN references.
 */
async function checkFileForCdnRefs(filePath) {
  // Skip this validator script itself (it mentions CDN domains by necessity)
  if (filePath.endsWith('validate-no-cdn-refs.mjs')) {
    return []
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const lines = content.split('\n')
    const violations = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNumber = i + 1

      for (const pattern of CDN_PATTERNS) {
        if (pattern.test(line)) {
          const match = line.match(pattern)
          violations.push({
            file: path.relative(rootPath, filePath),
            line: lineNumber,
            content: line.trim(),
            cdnDomain: match[0],
          })
        }
      }
    }

    return violations
  } catch (error) {
    // Skip files we can't read (likely binary despite extension)
    if (error.code === 'EISDIR' || error.message.includes('ENOENT')) {
      return []
    }
    // For other errors, try to continue
    return []
  }
}

/**
 * Validate all files for CDN references.
 */
async function validateNoCdnRefs() {
  const files = await findTextFiles(rootPath)
  const allViolations = []

  for (const file of files) {
    const violations = await checkFileForCdnRefs(file)
    allViolations.push(...violations)
  }

  return allViolations
}

async function main() {
  try {
    const violations = await validateNoCdnRefs()

    if (violations.length === 0) {
      logger.success('No CDN references found')
      process.exitCode = 0
      return
    }

    logger.fail(`Found ${violations.length} CDN reference(s)`)
    logger.log('')
    logger.log('CDN URLs are not allowed in this codebase for security and')
    logger.log('reliability reasons. Please use npm packages instead.')
    logger.log('')
    logger.log('Blocked CDN domains:')
    logger.log('  - unpkg.com')
    logger.log('  - cdn.jsdelivr.net')
    logger.log('  - esm.sh')
    logger.log('  - cdn.skypack.dev')
    logger.log('  - ga.jspm.io')
    logger.log('')
    logger.log('Violations:')
    logger.log('')

    for (const violation of violations) {
      logger.log(`  ${violation.file}:${violation.line}`)
      logger.log(`    Domain: ${violation.cdnDomain}`)
      logger.log(`    Content: ${violation.content}`)
      logger.log('')
    }

    logger.log('Remove CDN references and use npm dependencies instead.')
    logger.log('')

    process.exitCode = 1
  } catch (error) {
    logger.fail(`Validation failed: ${error.message}`)
    process.exitCode = 1
  }
}

main().catch(error => {
  logger.fail(`Unexpected error: ${error.message}`)
  process.exitCode = 1
})
