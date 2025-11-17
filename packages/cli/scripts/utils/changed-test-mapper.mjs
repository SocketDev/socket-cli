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
import { normalizePath } from '@socketsecurity/lib/paths/normalize'

const rootPath = path.resolve(process.cwd())

/**
 * Core files that require running all tests when changed.
 */
const CORE_FILES = [
  'src/constants/config.mts',
  'src/constants/errors.mts',
  'src/utils/config.mts',
  'src/utils/error',
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
  // src/utils/helper.mts → src/utils/helper.test.mts
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
  if (normalized.startsWith('src/utils/')) {
    // Specific utility file mappings
    if (normalized.includes('src/utils/alert/translations.mts')) {
      return ['src/utils/alert/translations.test.mts']
    }
    if (normalized.includes('src/utils/cache-strategies.mts')) {
      return ['test/utils/cache-strategies.test.mts']
    }
    if (normalized.includes('src/utils/cli/completion.mts')) {
      return ['src/utils/cli/completion.test.mts']
    }
    if (normalized.includes('src/utils/cli/messages.mts')) {
      return ['src/utils/cli/messages.test.mts']
    }
    if (normalized.includes('src/utils/cli/with-subcommands.mts')) {
      return ['src/utils/cli/with-subcommands.test.mts']
    }
    if (normalized.includes('src/utils/coana/extract-scan-id.mts')) {
      return ['src/utils/coana/extract-scan-id.test.mts']
    }
    if (normalized.includes('src/utils/command/registry-core.mts')) {
      return ['src/utils/command/registry-core.test.mts']
    }
    if (normalized.includes('src/utils/config.mts')) {
      return ['src/utils/config.test.mts']
    }
    if (normalized.includes('src/utils/data/map-to-object.mts')) {
      return ['src/utils/data/map-to-object.test.mts']
    }
    if (normalized.includes('src/utils/data/objects.mts')) {
      return ['src/utils/data/objects.test.mts']
    }
    if (normalized.includes('src/utils/data/strings.mts')) {
      return ['src/utils/data/strings.test.mts']
    }
    if (normalized.includes('src/utils/data/walk-nested-map.mts')) {
      return ['src/utils/data/walk-nested-map.test.mts']
    }
    if (normalized.includes('src/utils/debug.mts')) {
      return ['src/utils/debug.test.mts']
    }
    if (normalized.includes('src/utils/dlx/binary.mts')) {
      return ['src/utils/dlx/binary.test.mts']
    }
    if (normalized.includes('src/utils/dlx/detection.mts')) {
      return ['src/utils/dlx/detection.test.mts']
    }
    if (normalized.includes('src/utils/dlx/spawn.mts')) {
      return ['src/utils/dlx/spawn.e2e.test.mts']
    }
    if (normalized.includes('src/utils/ecosystem/types.mts')) {
      return ['src/utils/ecosystem/ecosystem.test.mts']
    }
    if (normalized.includes('src/utils/ecosystem/environment.mts')) {
      return ['src/utils/ecosystem/environment.test.mts']
    }
    if (normalized.includes('src/utils/ecosystem/requirements.mts')) {
      return ['src/utils/ecosystem/requirements.test.mts']
    }
    if (normalized.includes('src/utils/ecosystem/spec.mts')) {
      return ['src/utils/ecosystem/spec.test.mts']
    }
    if (normalized.includes('src/utils/error/errors.mts')) {
      return ['src/utils/error/errors.test.mts']
    }
    if (normalized.includes('src/utils/error/fail-msg-with-badge.mts')) {
      return ['src/utils/error/fail-msg-with-badge.test.mts']
    }
    if (normalized.includes('src/utils/executable/detect.mts')) {
      return ['src/utils/executable/detect.test.mts']
    }
    if (normalized.includes('src/utils/fs/fs.mts')) {
      return ['src/utils/fs/fs.test.mts']
    }
    if (normalized.includes('src/utils/fs/home-path.mts')) {
      return ['src/utils/fs/home-path.test.mts']
    }
    if (normalized.includes('src/utils/fs/path-resolve.mts')) {
      return ['src/utils/fs/path-resolve.test.mts']
    }
    if (normalized.includes('src/utils/git/operations.mts')) {
      return ['src/utils/git/git.test.mts']
    }
    if (normalized.includes('src/utils/git/github.mts')) {
      return ['src/utils/git/github.test.mts']
    }
    if (normalized.includes('src/utils/home-cache-time.mts')) {
      return ['src/utils/home-cache-time.test.mts']
    }
    if (normalized.includes('src/utils/manifest/patch-backup.mts')) {
      return ['src/utils/manifest/patch-backup.test.mts']
    }
    if (normalized.includes('src/utils/manifest/patch-hash.mts')) {
      return ['src/utils/manifest/patch-hash.test.mts']
    }
    if (normalized.includes('src/utils/manifest/patches.mts')) {
      return ['src/utils/manifest/patches.test.mts']
    }
    if (normalized.includes('src/utils/memoization.mts')) {
      return ['test/utils/memoization.test.mts']
    }
    if (normalized.includes('src/utils/npm/config.mts')) {
      return ['src/utils/npm/config.test.mts']
    }
    if (normalized.includes('src/utils/npm/package-arg.mts')) {
      return ['src/utils/npm/package-arg.test.mts']
    }
    if (normalized.includes('src/utils/npm/paths.mts')) {
      return ['src/utils/npm/paths.test.mts']
    }
    if (normalized.includes('src/utils/npm/spec.mts')) {
      return ['src/utils/npm/spec.test.mts']
    }
    if (normalized.includes('src/utils/organization.mts')) {
      return ['src/utils/organization.test.mts']
    }
    if (normalized.includes('src/utils/output/formatting.mts')) {
      return ['src/utils/output/formatting.test.mts']
    }
    if (normalized.includes('src/utils/output/markdown.mts')) {
      return ['src/utils/output/markdown.test.mts']
    }
    if (normalized.includes('src/utils/output/mode.mts')) {
      return ['src/utils/output/mode.test.mts']
    }
    if (normalized.includes('src/utils/output/result-json.mts')) {
      return ['src/utils/output/result-json.test.mts']
    }
    if (normalized.includes('src/utils/pnpm/lockfile.mts')) {
      return ['src/utils/pnpm/lockfile.test.mts']
    }
    if (normalized.includes('src/utils/pnpm/paths.mts')) {
      return ['src/utils/pnpm/paths.test.mts']
    }
    if (normalized.includes('src/utils/process/cmd.mts')) {
      return ['src/utils/process/cmd.test.mts']
    }
    if (normalized.includes('src/utils/process/performance.mts')) {
      return ['test/utils/performance.test.mts']
    }
    if (normalized.includes('src/utils/promise/queue.mts')) {
      return ['src/utils/promise/queue.test.mts']
    }
    if (normalized.includes('src/utils/purl/parse.mts')) {
      return ['src/utils/purl/parse.test.mts']
    }
    if (normalized.includes('src/utils/purl/to-ghsa.mts')) {
      return ['src/utils/purl/to-ghsa.test.mts']
    }
    if (normalized.includes('src/utils/python/standalone.mts')) {
      return ['src/utils/python/standalone.test.mts']
    }
    if (normalized.includes('src/utils/sanitize-names.mts')) {
      return ['src/utils/sanitize-names.test.mts']
    }
    if (normalized.includes('src/utils/semver.mts')) {
      return ['src/utils/semver.test.mts']
    }
    if (normalized.includes('src/utils/shadow/links.mts')) {
      return ['src/utils/shadow/links.test.mts']
    }
    if (normalized.includes('src/utils/socket/alerts.mts')) {
      return ['src/utils/socket/alerts.test.mts']
    }
    if (normalized.includes('src/utils/socket/api.mts')) {
      return ['src/utils/socket/api.test.mts']
    }
    if (normalized.includes('src/utils/socket/json.mts')) {
      return ['src/utils/socket/json.test.mts']
    }
    if (normalized.includes('src/utils/socket/org-slug.mts')) {
      return ['src/utils/socket/org-slug.test.mts']
    }
    if (normalized.includes('src/utils/socket/package-alert.mts')) {
      return ['src/utils/socket/package-alert.test.mts']
    }
    if (normalized.includes('src/utils/socket/sdk.mts')) {
      return ['src/utils/socket/sdk.test.mts']
    }
    if (normalized.includes('src/utils/socket/url.mts')) {
      return ['src/utils/socket/url.test.mts']
    }
    if (normalized.includes('src/utils/terminal/ascii-header.mts')) {
      return ['src/utils/terminal/ascii-header.test.mts']
    }
    if (normalized.includes('src/utils/terminal/colors.mts')) {
      return ['src/utils/terminal/colors.test.mts']
    }
    if (normalized.includes('src/utils/terminal/link.mts')) {
      return ['src/utils/terminal/link.test.mts']
    }
    if (normalized.includes('src/utils/terminal/rich-progress.mts')) {
      return ['src/utils/terminal/rich-progress.test.mts']
    }
    if (normalized.includes('src/utils/update/checker.mts')) {
      return ['src/utils/update/checker.test.mts']
    }
    if (normalized.includes('src/utils/update/manager.mts')) {
      return ['src/utils/update/manager.test.mts']
    }
    if (normalized.includes('src/utils/update/store.mts')) {
      return ['src/utils/update/store.test.mts']
    }
    if (normalized.includes('src/utils/validation/check-input.mts')) {
      return ['src/utils/validation/check-input.test.mts']
    }
    if (normalized.includes('src/utils/validation/filter-config.mts')) {
      return ['src/utils/validation/filter-config.test.mts']
    }
    if (normalized.includes('src/utils/wordpiece-tokenizer.mts')) {
      return ['src/utils/wordpiece-tokenizer.test.mts']
    }
    if (normalized.includes('src/utils/yarn/paths.mts')) {
      return ['src/utils/yarn/paths.test.mts']
    }
    if (normalized.includes('src/utils/yarn/version.mts')) {
      return ['src/utils/yarn/version.test.mts']
    }

    // Fallback: check test/utils/ for separate test file
    const utilsTestFile = `test/utils/${nameWithoutExt}.test.mts`
    if (existsSync(path.join(rootPath, utilsTestFile))) {
      return [utilsTestFile]
    }
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
      for (const test of tests) {
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
    return { tests: null, mode }
  }

  return { tests: Array.from(testFiles), mode }
}
