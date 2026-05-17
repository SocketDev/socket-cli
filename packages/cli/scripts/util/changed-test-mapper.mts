/**
 * @fileoverview Maps changed source files to test files for affected test running.
 * Uses git utilities from socket-registry to detect changes.
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  getChangedFilesSync,
  getStagedFilesSync,
} from '@socketsecurity/lib-stable/git'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { PACKAGE_ROOT } from '../paths.mts'

const rootPath = PACKAGE_ROOT

/**
 * Core files that require running all tests when changed.
 */
const CORE_FILES = [
  'src/constants/config.mts',
  'src/constants/errors.mts',
  'src/util/config.mts',
  'src/util/error',
]

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
    return { tests: undefined, mode }
  }

  const testFiles = new Set()
  let runAllTests = false
  let runAllReason = ''

  for (let i = 0, { length } = changedFiles; i < length; i += 1) {
    const file = changedFiles[i]
    const normalized = normalizePath(file)

    // Test files always run themselves (both in test/ and co-located in src/)
    if (normalized.includes('.test.')) {
      // Skip deleted files.
      if (existsSync(path.join(rootPath, file))) {
        testFiles.add(file)
      }
      continue
    }

    // Source files map to test files
    if (normalized.startsWith('src/')) {
      const tests = mapSourceToTests(normalized)
      if (tests.includes('all')) {
        runAllTests = true
        runAllReason = 'core file changes'
        break
      }
      for (let i = 0, { length } = tests; i < length; i += 1) {
        const test = tests[i]
        // Skip deleted files.
        if (existsSync(path.join(rootPath, test))) {
          testFiles.add(test)
        }
      }
      continue
    }

    // Config changes run all tests
    if (normalized.includes('vitest.config')) {
      runAllTests = true
      runAllReason = 'vitest config changed'
      break
    }

    if (normalized.includes('tsconfig')) {
      runAllTests = true
      runAllReason = 'TypeScript config changed'
      break
    }

    // Data changes may affect integration tests
    if (normalized.startsWith('data/')) {
      // Check if integration tests exist in test directory
      const integrationDir = path.join(rootPath, 'test/integration')
      if (existsSync(integrationDir)) {
        testFiles.add('test/integration/**/*.test.mts')
      }
    }

    // Config file changes
    if (normalized.includes('package.json')) {
      runAllTests = true
      runAllReason = 'package.json changed'
      break
    }
  }

  if (runAllTests) {
    return { tests: 'all', reason: runAllReason, mode: 'all' }
  }

  if (testFiles.size === 0) {
    return { tests: undefined, mode }
  }

  return { tests: Array.from(testFiles), mode }
}

/**
 * Map source files to their corresponding test files.
 * @param {string} filepath - Path to source file
 * @returns {string[]} Array of test file paths
 */
export function mapSourceToTests(filepath) {
  const normalized = normalizePath(filepath)

  // Skip non-code files
  const ext = path.extname(normalized)
  const codeExtensions = ['.js', '.mjs', '.cjs', '.ts', '.cts', '.mts', '.json']
  if (!codeExtensions.includes(ext)) {
    return []
  }

  // Core utilities affect all tests.
  if (CORE_FILES.some(f => normalized.includes(f))) {
    return ['all']
  }

  // CLI-specific command mappings for files with multiple related tests.
  // Commands with malware tests (npm, npx, pnpm, yarn).
  if (normalized.includes('src/commands/npm/cmd-npm.mts')) {
    return [
      'src/commands/npm/cmd-npm.test.mts',
      'src/commands/npm/cmd-npm-malware.test.mts',
    ]
  }
  if (normalized.includes('src/commands/npx/cmd-npx.mts')) {
    return [
      'src/commands/npx/cmd-npx.test.mts',
      'src/commands/npx/cmd-npx-malware.test.mts',
    ]
  }
  if (normalized.includes('src/commands/pnpm/cmd-pnpm.mts')) {
    return [
      'src/commands/pnpm/cmd-pnpm.test.mts',
      'src/commands/pnpm/cmd-pnpm-malware.test.mts',
    ]
  }
  if (normalized.includes('src/commands/yarn/cmd-yarn.mts')) {
    return [
      'src/commands/yarn/cmd-yarn.test.mts',
      'src/commands/yarn/cmd-yarn-malware.test.mts',
    ]
  }

  // Commands with smoke tests.
  if (normalized.includes('src/commands/login/cmd-login.mts')) {
    return [
      'src/commands/login/cmd-login.test.mts',
      'src/commands/login/cmd-login-smoke.test.mts',
    ]
  }
  if (normalized.includes('src/commands/repository/cmd-repository.mts')) {
    return [
      'src/commands/repository/cmd-repository.test.mts',
      'src/commands/repository/cmd-repository-smoke.test.mts',
    ]
  }

  // Commands with e2e tests.
  if (normalized.includes('src/commands/fix/cmd-fix.mts')) {
    return [
      'src/commands/fix/cmd-fix.test.mts',
      'src/commands/fix/cmd-fix-e2e.test.mts',
    ]
  }

  // Commands with additional test files.
  if (normalized.includes('src/commands/optimize/cmd-optimize.mts')) {
    return [
      'src/commands/optimize/cmd-optimize.test.mts',
      'src/commands/optimize/cmd-optimize-pnpm-versions.test.mts',
    ]
  }

  // CLI uses co-located tests - check for test file next to source.
  // src/commands/scan.mts → src/commands/scan.test.mts
  // src/util/helper.mts → src/util/helper.test.mts
  const dir = path.dirname(normalized)
  const basename = path.basename(normalized, path.extname(normalized))
  const ext2 = path.extname(basename)
  const nameWithoutExt = basename.replace(ext2, '')
  const colocatedTestFile = path.join(dir, `${nameWithoutExt}.test.mts`)

  // Check if co-located test exists.
  if (existsSync(path.join(rootPath, colocatedTestFile))) {
    return [colocatedTestFile]
  }

  // Check test directory for separate test files
  const testFile = `test/${nameWithoutExt}.test.mts`
  if (existsSync(path.join(rootPath, testFile))) {
    return [testFile]
  }

  // Commands may have multiple related tests - check subdirectory pattern
  // src/commands/scan/handler.mts → src/commands/scan/*.test.mts
  if (normalized.startsWith('src/commands/')) {
    const commandMatch = normalized.match(/src\/commands\/([^/]+)\//)
    if (commandMatch) {
      const commandName = commandMatch[1]
      const commandDir = `src/commands/${commandName}`
      // Return pattern to match all tests in command directory
      return [`${commandDir}/**/*.test.mts`]
    }
  }

  // Utils may have related tests in test/utils
  if (normalized.startsWith('src/util/')) {
    // Specific utility file mappings
    if (normalized.includes('src/util/alert/translations.mts')) {
      return ['src/util/alert/translations.test.mts']
    }
    if (normalized.includes('src/util/cache-strategies.mts')) {
      return ['test/util/cache-strategies.test.mts']
    }
    if (normalized.includes('src/util/cli/completion.mts')) {
      return ['src/util/cli/completion.test.mts']
    }
    if (normalized.includes('src/util/cli/messages.mts')) {
      return ['src/util/cli/messages.test.mts']
    }
    if (normalized.includes('src/util/cli/with-subcommands.mts')) {
      return ['src/util/cli/with-subcommands.test.mts']
    }
    if (normalized.includes('src/util/coana/extract-scan-id.mts')) {
      return ['src/util/coana/extract-scan-id.test.mts']
    }
    if (normalized.includes('src/util/command/registry-core.mts')) {
      return ['src/util/command/registry-core.test.mts']
    }
    if (normalized.includes('src/util/config.mts')) {
      return ['src/util/config.test.mts']
    }
    if (normalized.includes('src/util/data/map-to-object.mts')) {
      return ['src/util/data/map-to-object.test.mts']
    }
    if (normalized.includes('src/util/data/objects.mts')) {
      return ['src/util/data/objects.test.mts']
    }
    if (normalized.includes('src/util/data/strings.mts')) {
      return ['src/util/data/strings.test.mts']
    }
    if (normalized.includes('src/util/data/walk-nested-map.mts')) {
      return ['src/util/data/walk-nested-map.test.mts']
    }
    if (normalized.includes('src/util/debug.mts')) {
      return ['src/util/debug.test.mts']
    }
    if (normalized.includes('src/util/dlx/binary.mts')) {
      return ['src/util/dlx/binary.test.mts']
    }
    if (normalized.includes('src/util/dlx/detection.mts')) {
      return ['src/util/dlx/detection.test.mts']
    }
    if (normalized.includes('src/util/dlx/spawn.mts')) {
      return ['src/util/dlx/spawn.e2e.test.mts']
    }
    if (normalized.includes('src/util/ecosystem/types.mts')) {
      return ['src/util/ecosystem/ecosystem.test.mts']
    }
    if (normalized.includes('src/util/ecosystem/environment.mts')) {
      return ['src/util/ecosystem/environment.test.mts']
    }
    if (normalized.includes('src/util/ecosystem/requirements.mts')) {
      return ['src/util/ecosystem/requirements.test.mts']
    }
    if (normalized.includes('src/util/ecosystem/spec.mts')) {
      return ['src/util/ecosystem/spec.test.mts']
    }
    if (normalized.includes('src/util/error/errors.mts')) {
      return ['src/util/error/errors.test.mts']
    }
    if (normalized.includes('src/util/error/fail-msg-with-badge.mts')) {
      return ['src/util/error/fail-msg-with-badge.test.mts']
    }
    if (normalized.includes('src/util/executable/detect.mts')) {
      return ['src/util/executable/detect.test.mts']
    }
    if (normalized.includes('src/util/fs/fs.mts')) {
      return ['src/util/fs/fs.test.mts']
    }
    if (normalized.includes('src/util/fs/home-path.mts')) {
      return ['src/util/fs/home-path.test.mts']
    }
    if (normalized.includes('src/util/fs/path-resolve.mts')) {
      return ['src/util/fs/path-resolve.test.mts']
    }
    if (normalized.includes('src/util/git/operations.mts')) {
      return ['src/util/git/git.test.mts']
    }
    if (normalized.includes('src/util/git/github.mts')) {
      return ['src/util/git/github.test.mts']
    }
    if (normalized.includes('src/util/home-cache-time.mts')) {
      return ['src/util/home-cache-time.test.mts']
    }
    if (normalized.includes('src/util/manifest/patch-backup.mts')) {
      return ['src/util/manifest/patch-backup.test.mts']
    }
    if (normalized.includes('src/util/manifest/patch-hash.mts')) {
      return ['src/util/manifest/patch-hash.test.mts']
    }
    if (normalized.includes('src/util/manifest/patches.mts')) {
      return ['src/util/manifest/patches.test.mts']
    }
    if (normalized.includes('src/util/memoization.mts')) {
      return ['test/util/memoization.test.mts']
    }
    if (normalized.includes('src/util/npm/config.mts')) {
      return ['src/util/npm/config.test.mts']
    }
    if (normalized.includes('src/util/npm/package-arg.mts')) {
      return ['src/util/npm/package-arg.test.mts']
    }
    if (normalized.includes('src/util/npm/paths.mts')) {
      return ['src/util/npm/paths.test.mts']
    }
    if (normalized.includes('src/util/npm/spec.mts')) {
      return ['src/util/npm/spec.test.mts']
    }
    if (normalized.includes('src/util/organization.mts')) {
      return ['src/util/organization.test.mts']
    }
    if (normalized.includes('src/util/output/formatting.mts')) {
      return ['src/util/output/formatting.test.mts']
    }
    if (normalized.includes('src/util/output/markdown.mts')) {
      return ['src/util/output/markdown.test.mts']
    }
    if (normalized.includes('src/util/output/mode.mts')) {
      return ['src/util/output/mode.test.mts']
    }
    if (normalized.includes('src/util/output/result-json.mts')) {
      return ['src/util/output/result-json.test.mts']
    }
    if (normalized.includes('src/util/pnpm/lockfile.mts')) {
      return ['src/util/pnpm/lockfile.test.mts']
    }
    if (normalized.includes('src/util/pnpm/paths.mts')) {
      return ['src/util/pnpm/paths.test.mts']
    }
    if (normalized.includes('src/util/process/cmd.mts')) {
      return ['src/util/process/cmd.test.mts']
    }
    if (normalized.includes('src/util/process/performance.mts')) {
      return ['test/util/performance.test.mts']
    }
    if (normalized.includes('src/util/promise/queue.mts')) {
      return ['src/util/promise/queue.test.mts']
    }
    if (normalized.includes('src/util/purl/parse.mts')) {
      return ['src/util/purl/parse.test.mts']
    }
    if (normalized.includes('src/util/purl/to-ghsa.mts')) {
      return ['src/util/purl/to-ghsa.test.mts']
    }
    if (normalized.includes('src/util/python/standalone.mts')) {
      return ['src/util/python/standalone.test.mts']
    }
    if (normalized.includes('src/util/sanitize-names.mts')) {
      return ['src/util/sanitize-names.test.mts']
    }
    if (normalized.includes('src/util/semver.mts')) {
      return ['src/util/semver.test.mts']
    }
    if (normalized.includes('src/util/socket/alerts.mts')) {
      return ['src/util/socket/alerts.test.mts']
    }
    if (normalized.includes('src/util/socket/api.mts')) {
      return ['src/util/socket/api.test.mts']
    }
    if (normalized.includes('src/util/socket/json.mts')) {
      return ['src/util/socket/json.test.mts']
    }
    if (normalized.includes('src/util/socket/org-slug.mts')) {
      return ['src/util/socket/org-slug.test.mts']
    }
    if (normalized.includes('src/util/socket/package-alert.mts')) {
      return ['src/util/socket/package-alert.test.mts']
    }
    if (normalized.includes('src/util/socket/sdk.mts')) {
      return ['src/util/socket/sdk.test.mts']
    }
    if (normalized.includes('src/util/socket/url.mts')) {
      return ['src/util/socket/url.test.mts']
    }
    if (normalized.includes('src/util/terminal/ascii-header.mts')) {
      return ['src/util/terminal/ascii-header.test.mts']
    }
    if (normalized.includes('src/util/terminal/colors.mts')) {
      return ['src/util/terminal/colors.test.mts']
    }
    if (normalized.includes('src/util/terminal/link.mts')) {
      return ['src/util/terminal/link.test.mts']
    }
    if (normalized.includes('src/util/terminal/rich-progress.mts')) {
      return ['src/util/terminal/rich-progress.test.mts']
    }
    if (normalized.includes('src/util/update/checker.mts')) {
      return ['src/util/update/checker.test.mts']
    }
    if (normalized.includes('src/util/update/manager.mts')) {
      return ['src/util/update/manager.test.mts']
    }
    if (normalized.includes('src/util/update/store.mts')) {
      return ['src/util/update/store.test.mts']
    }
    if (normalized.includes('src/util/validation/check-input.mts')) {
      return ['src/util/validation/check-input.test.mts']
    }
    if (normalized.includes('src/util/validation/filter-config.mts')) {
      return ['src/util/validation/filter-config.test.mts']
    }
    if (normalized.includes('src/util/wordpiece-tokenizer.mts')) {
      return ['src/util/wordpiece-tokenizer.test.mts']
    }
    if (normalized.includes('src/util/yarn/paths.mts')) {
      return ['src/util/yarn/paths.test.mts']
    }
    if (normalized.includes('src/util/yarn/version.mts')) {
      return ['src/util/yarn/version.test.mts']
    }

    // Fallback: check test/util/ for separate test file
    const utilsTestFile = `test/util/${nameWithoutExt}.test.mts`
    if (existsSync(path.join(rootPath, utilsTestFile))) {
      return [utilsTestFile]
    }
  }

  // If no specific mapping, run all tests to be safe
  return ['all']
}
