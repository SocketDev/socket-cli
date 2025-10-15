/**
 * @fileoverview Maps changed source files to test files for affected test running.
 * Uses git utilities from socket-registry to detect changes.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  getChangedFilesSync,
  getStagedFilesSync,
} from '@socketsecurity/registry/lib/git'
import { normalizePath } from '@socketsecurity/registry/lib/path'

const rootPath = path.resolve(process.cwd())

/**
 * Core files that require running all tests when changed.
 */
const CORE_FILES = [
  'src/cli-entry.mts',
  'src/cli-dispatch.mts',
  'src/constants.mts',
  'src/types.mts',
  'src/utils/debug.mts',
  'src/utils/errors.mts',
  'src/utils/logger.mts',
  'src/utils/config.mts',
  'src/utils/api-helpers.mts',
]

/**
 * Patterns that trigger running all tests.
 */
const RUN_ALL_PATTERNS = [
  '.config/',
  'vitest.config.',
  'tsconfig',
  'package.json',
  'pnpm-lock.yaml',
  '.env.test',
]

/**
 * Map source files to their corresponding test files.
 * @param {string} filepath - Path to source file
 * @returns {string[]} Array of test file paths or ['all'] to run all tests
 */
function mapSourceToTests(filepath) {
  const normalized = normalizePath(filepath)

  // Skip non-code files
  const ext = path.extname(normalized)
  const codeExtensions = ['.js', '.mjs', '.cjs', '.ts', '.cts', '.mts', '.json']
  if (!codeExtensions.includes(ext)) {
    return []
  }

  // Core utilities affect all tests
  if (CORE_FILES.some(f => normalized.includes(f))) {
    return ['all']
  }

  // Config changes run all tests
  if (RUN_ALL_PATTERNS.some(pattern => normalized.includes(pattern))) {
    return ['all']
  }

  // Test files always run themselves
  if (normalized.includes('.test.')) {
    return [filepath]
  }

  // Map command files to their co-located tests
  if (normalized.startsWith('src/commands/')) {
    const tests = []
    // Direct co-located test
    const dirname = path.dirname(normalized)
    const basename = path.basename(normalized, path.extname(normalized))
    const colocatedTest = path.join(dirname, `${basename}.test.mts`)
    if (existsSync(path.join(rootPath, colocatedTest))) {
      tests.push(colocatedTest)
    }
    // If it's a cmd-* file, also check for cmd-*.test.mts in same directory
    if (basename.startsWith('cmd-')) {
      const pattern = path.join(dirname, `${basename}.test.mts`)
      if (existsSync(path.join(rootPath, pattern))) {
        tests.push(pattern)
      }
    }
    return tests.length > 0 ? tests : ['all']
  }

  // Map utils files to their tests
  if (normalized.startsWith('src/utils/')) {
    const tests = []
    const basename = path.basename(normalized, path.extname(normalized))

    // Check for co-located test in src/utils/
    const colocatedTest = `src/utils/${basename}.test.mts`
    if (existsSync(path.join(rootPath, colocatedTest))) {
      tests.push(colocatedTest)
    }

    // Check for test in test/unit/utils/
    const testUnitTest = `test/unit/utils/${basename}.test.mts`
    if (existsSync(path.join(rootPath, testUnitTest))) {
      tests.push(testUnitTest)
    }

    return tests.length > 0 ? tests : ['all']
  }

  // If no specific mapping, run all tests to be safe
  return ['all']
}

/**
 * Get affected test files to run based on changed files.
 * @param {Object} options
 * @param {boolean} options.staged - Use staged files instead of all changes
 * @param {boolean} options.all - Run all tests
 * @returns {string[] | null} Array of test patterns, 'all', or null if no tests needed
 */
export function getTestsToRun(options = {}) {
  const { all = false, staged = false } = options

  // All mode runs all tests
  if (all || process.env.FORCE_TEST === '1') {
    return 'all'
  }

  // CI always runs all tests
  if (process.env.CI === 'true') {
    return 'all'
  }

  // Get changed files
  const changedFiles = staged ? getStagedFilesSync() : getChangedFilesSync()

  if (changedFiles.length === 0) {
    // No changes, skip tests
    return null
  }

  const testFiles = new Set()
  let runAllTests = false

  for (const file of changedFiles) {
    const normalized = normalizePath(file)
    const tests = mapSourceToTests(normalized)

    if (tests.includes('all')) {
      runAllTests = true
      break
    }

    for (const test of tests) {
      testFiles.add(test)
    }
  }

  if (runAllTests) {
    return 'all'
  }

  if (testFiles.size === 0) {
    return null
  }

  return Array.from(testFiles)
}
