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

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

const logger = getDefaultLogger()

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
  '.cache',
  '.git',
  '.next',
  '.nuxt',
  '.output',
  '.turbo',
  '.type-coverage',
  '.yarn',
  'build',
  'coverage',
  'dist',
  'node_modules',
])

// File extensions to check
const TEXT_EXTENSIONS = new Set([
  '.bash',
  '.cjs',
  '.css',
  '.cts',
  '.htm',
  '.html',
  '.js',
  '.json',
  '.jsx',
  '.md',
  '.mjs',
  '.mts',
  '.sh',
  '.svg',
  '.ts',
  '.tsx',
  '.txt',
  '.xml',
  '.yaml',
  '.yml',
])

interface CdnViolation {
  file: string
  line: number
  content: string
  cdnDomain: string
}

/**
 * Check file contents for CDN references.
 */
export async function checkFileForCdnRefs(
  filePath: string,
): Promise<CdnViolation[]> {
  // Skip this validator script itself (it mentions CDN domains by necessity)
  if (filePath.endsWith('validate-no-cdn-refs.mts')) {
    return []
  }

  try {
    const content = await fs.readFile(filePath, 'utf8')
    const lines = content.split('\n')
    const violations: CdnViolation[] = []

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      const lineNumber = i + 1

      for (let i = 0, { length } = CDN_PATTERNS; i < length; i += 1) {
        const pattern = CDN_PATTERNS[i]
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
  } catch (e) {
    // Skip files we can't read (likely binary despite extension)
    const error = e as NodeJS.ErrnoException
    if (error.code === 'EISDIR' || error.message?.includes('ENOENT')) {
      return []
    }
    // For other errors, try to continue
    return []
  }
}

/**
 * Recursively find all text files to scan.
 */
export async function findTextFiles(
  dir: string,
  files: string[] = [],
): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })

    for (let i = 0, { length } = entries; i < length; i += 1) {
      const entry = entries[i]
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
 * Check if file should be scanned.
 */
export function shouldScanFile(filename: string): boolean {
  const ext = path.extname(filename).toLowerCase()
  return TEXT_EXTENSIONS.has(ext)
}

/**
 * Validate all files for CDN references.
 */
export async function validateNoCdnRefs(): Promise<CdnViolation[]> {
  const files = await findTextFiles(rootPath)
  const allViolations = []

  for (let i = 0, { length } = files; i < length; i += 1) {
    const file = files[i]
    const violations = await checkFileForCdnRefs(file)
    allViolations.push(...violations)
  }

  return allViolations
}

async function main(): Promise<void> {
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

    for (let i = 0, { length } = violations; i < length; i += 1) {
      const violation = violations[i]
      logger.log(`  ${violation.file}:${violation.line}`)
      logger.log(`    Domain: ${violation.cdnDomain}`)
      logger.log(`    Content: ${violation.content}`)
      logger.log('')
    }

    logger.log('Remove CDN references and use npm dependencies instead.')
    logger.log('')

    process.exitCode = 1
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.fail(`Validation failed: ${message}`)
    process.exitCode = 1
  }
}

main().catch((e: unknown) => {
  const message = e instanceof Error ? e.message : String(e)
  logger.fail(`Unexpected error: ${message}`)
  process.exitCode = 1
})
