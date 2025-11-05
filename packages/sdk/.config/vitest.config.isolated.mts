/**
 * @fileoverview Vitest configuration for tests requiring full isolation.
 * Used for tests that need vi.doMock() or other module-level mocking.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { getLocalPackageAliases } from '../scripts/utils/get-local-package-aliases.mjs'
import {
  baseCoverageConfig,
  isolatedCoverageThresholds,
} from './vitest.coverage.config.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Read list of tests that need isolation
const isolatedTestsPath = path.join(__dirname, 'isolated-tests.json')
const isolatedTestsData = JSON.parse(readFileSync(isolatedTestsPath, 'utf8'))
const isolatedTests = isolatedTestsData.tests

// Check if coverage is enabled via CLI flags or environment.
const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.env.npm_lifecycle_event?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

export default defineConfig({
  cacheDir: './.cache/vitest',
  resolve: {
    alias: getLocalPackageAliases(path.join(__dirname, '..')),
  },
  test: {
    globals: false,
    environment: 'node',
    // Only include tests that need isolation
    include: isolatedTests,
    reporters: ['default'],
    setupFiles: ['./test/utils/setup.mts'],
    // Use forks for full isolation
    pool: 'forks',
    poolOptions: {
      forks: {
        // Use single fork for coverage, parallel otherwise
        singleFork: isCoverageEnabled,
        maxForks: isCoverageEnabled ? 1 : 8,
        minForks: isCoverageEnabled ? 1 : 2,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Share coverage settings with main config
    coverage: {
      ...baseCoverageConfig,
      thresholds: isolatedCoverageThresholds,
    },
  },
})
