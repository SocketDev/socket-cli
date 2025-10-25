/**
 * @fileoverview Maps changed source files to test files for affected test running.
 * Uses git utilities from socket-registry to detect changes.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  getChangedFilesSync,
  getStagedFilesSync,
} from '@socketsecurity/lib/git'
import { normalizePath } from '@socketsecurity/lib/path'

const rootPath = path.resolve(process.cwd())

/**
 * Core files that require running all tests when changed.
 */
const CORE_FILES = [
  'packages/cli/src/constants/',
  'packages/cli/src/bootstrap/',
  'packages/cli/src/polyfills/',
  'vitest.config.mts',
  '.config/vitest.config.mts',
  'tsconfig.json',
  '.config/tsconfig',
]

/**
 * Map source files to their corresponding test files.
 * @param {string} filepath - Path to source file
 * @returns {string[]} Array of test file paths
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

  // Test files that live alongside source
  if (normalized.includes('.test.')) {
    return [normalized]
  }

  // Map packages/cli/src files to their test counterparts
  if (normalized.startsWith('packages/cli/src/')) {
    // For files in packages/cli/src root, check for co-located test
    const basename = path.basename(normalized, path.extname(normalized))
    const dirname = path.dirname(normalized)

    // Check for test file in same directory
    const colocatedTest = path.join(dirname, `${basename}.test.mts`)
    if (existsSync(path.join(rootPath, colocatedTest))) {
      return [colocatedTest]
    }

    // Check for test file in packages/cli/test
    const testInTestDir = `packages/cli/test/${basename}.test.mts`
    if (existsSync(path.join(rootPath, testInTestDir))) {
      return [testInTestDir]
    }

    // Special mappings for subdirectories
    if (normalized.includes('packages/cli/src/commands/')) {
      // Commands might have integration tests
      return ['packages/cli/test/integration/']
    }

    if (normalized.includes('packages/cli/src/shadow/')) {
      // Shadow files have tests in shadow directory
      const shadowTest = normalized.replace('.mts', '.test.mts')
      if (existsSync(path.join(rootPath, shadowTest))) {
        return [shadowTest]
      }
    }

    // Check helpers and utils
    if (normalized.includes('packages/cli/src/helpers/')) {
      const helperName = basename
      const helperTest = `packages/cli/test/helpers/${helperName}.test.mts`
      if (existsSync(path.join(rootPath, helperTest))) {
        return [helperTest]
      }
    }

    if (normalized.includes('packages/cli/src/utils/')) {
      const utilName = basename
      const utilTest = `packages/cli/test/utils/${utilName}.test.mts`
      if (existsSync(path.join(rootPath, utilTest))) {
        return [utilTest]
      }
    }
  }

  // Scripts changes run all tests
  if (normalized.startsWith('scripts/')) {
    return ['all']
  }

  // External or fixtures changes
  if (normalized.startsWith('external/') || normalized.startsWith('fixtures/')) {
    return ['packages/cli/test/integration/']
  }

  // If no specific mapping, run all tests to be safe
  return ['all']
}

/**
 * Get affected test files to run based on changed files.
 * @param {Object} options
 * @param {boolean} options.staged - Use staged files instead of all changes
 * @param {boolean} options.all - Run all tests
 * @returns {{tests: string[] | 'all' | null, reason?: string, mode?: string}} Object with test patterns, reason, and mode
 */
export function getTestsToRun(options = {}) {
  const { all = false, staged = false } = options

  // All mode runs all tests
  if (all || process.env.FORCE_TEST === '1') {
    return { tests: 'all', reason: 'explicit --all flag', mode: 'all' }
  }

  // CI always runs all tests
  if (process.env.CI === 'true') {
    return { tests: 'all', reason: 'CI environment', mode: 'all' }
  }

  // Get changed files
  const changedFiles = staged ? getStagedFilesSync() : getChangedFilesSync()
  const mode = staged ? 'staged' : 'changed'

  if (changedFiles.length === 0) {
    // No changes, skip tests
    return { tests: null, mode }
  }

  const testFiles = new Set()
  let runAllTests = false
  let runAllReason = ''

  for (const file of changedFiles) {
    const normalized = normalizePath(file)

    // Test files always run themselves
    if (normalized.includes('.test.')) {
      // Skip deleted files.
      if (existsSync(path.join(rootPath, file))) {
        testFiles.add(file)
      }
      continue
    }

    // Source files map to test files
    const tests = mapSourceToTests(normalized)
    if (tests.includes('all')) {
      runAllTests = true
      runAllReason = 'core file changes'
      break
    }

    for (const test of tests) {
      // Handle directory patterns
      if (test.endsWith('/')) {
        runAllTests = true
        runAllReason = 'integration test directory'
        break
      }

      // Skip deleted files.
      if (existsSync(path.join(rootPath, test))) {
        testFiles.add(test)
      }
    }

    if (runAllTests) {
      break
    }
  }

  if (runAllTests) {
    return { tests: 'all', reason: runAllReason, mode: 'all' }
  }

  if (testFiles.size === 0) {
    return { tests: null, mode }
  }

  return { tests: Array.from(testFiles), mode }
}
