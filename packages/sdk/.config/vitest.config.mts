/**
 * @fileoverview Vitest configuration for Socket SDK test suite.
 * Configures test environment, coverage, and module resolution.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'
import {
  baseCoverageConfig,
  mainCoverageThresholds,
} from './vitest.coverage.config.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Check if coverage is enabled via CLI flags or environment.
const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.env.npm_lifecycle_event?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

// Set environment variable so tests can detect coverage mode
if (isCoverageEnabled) {
  process.env.COVERAGE = 'true'
}

export default defineConfig({
  cacheDir: './.cache/vitest',
  resolve: {
    alias: getLocalPackageAliases(path.join(__dirname, '..')),
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.{js,ts,mjs,mts,cjs}'],
    // Exclude tests that need isolation (they use separate config)
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'test/quota-utils-error-handling.test.mts',
      'test/json-parsing-edge-cases.test.mts',
      'test/getapi-sendapi-methods.test.mts',
      'test/socket-sdk-retry.test.mts',
      'test/entitlements.test.mts',
      'test/socket-sdk-batch.test.mts',
    ],
    reporters:
      process.env.TEST_REPORTER === 'json' ? ['json', 'default'] : ['default'],
    setupFiles: ['./test/utils/setup.mts'],
    // Optimize test execution for speed
    // Threads are faster than forks
    pool: 'threads',
    // Note: poolMatchGlobs with forks doesn't work with nock HTTP mocking
    // because nock patches the http module in the same process, which doesn't
    // cross fork boundaries. Tests requiring both nock AND fork isolation are
    // fundamentally incompatible. Such tests must skip in coverage mode.
    poolMatchGlobs: undefined,
    poolOptions: {
      forks: {
        // Configuration for tests that opt into fork isolation via { pool: 'forks' }
        // During coverage, use multiple forks for better isolation
        singleFork: false,
        maxForks: isCoverageEnabled ? 4 : 16,
        minForks: isCoverageEnabled ? 1 : 2,
        isolate: true,
      },
      threads: {
        // Maximize parallelism for speed
        // During coverage, use single thread for deterministic execution
        singleThread: isCoverageEnabled,
        maxThreads: isCoverageEnabled ? 1 : 16,
        minThreads: isCoverageEnabled ? 1 : 4,
        // IMPORTANT: isolate: false for performance and test compatibility
        //
        // Tradeoff Analysis:
        // - isolate: true  = Full isolation, slower, breaks nock/module mocking
        // - isolate: false = Shared worker context, faster, mocking works
        //
        // We choose isolate: false because:
        // 1. Significant performance improvement (faster test runs)
        // 2. Nock HTTP mocking works correctly across all test files
        // 3. Vi.mock() module mocking functions properly
        // 4. Test state pollution is prevented through proper beforeEach/afterEach
        // 5. Our tests are designed to clean up after themselves
        //
        // Tests requiring true isolation should use pool: 'forks' or be marked
        // with { pool: 'forks' } in the test file itself.
        isolate: false,
        // Use worker threads for better performance
        useAtomics: true,
      },
    },
    // Reduce timeouts for faster failures
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Speed optimizations
    // Note: cache is now configured via Vite's cacheDir
    sequence: {
      // Run tests concurrently within suites
      concurrent: true,
    },
    // Bail early on first failure in CI
    bail: process.env.CI ? 1 : 0,
    coverage: {
      ...baseCoverageConfig,
      thresholds: mainCoverageThresholds,
    },
  },
})
