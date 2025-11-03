import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { getLocalPackageAliases } from './scripts/utils/get-local-package-aliases.mjs'

// Get the socket-cli repo root directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

const isCoverageEnabled =
  process.env.npm_lifecycle_event === 'cover' ||
  process.argv.includes('--coverage')

// Detect if running in CI on macOS.
const isMacCI = 'CI' in process.env && process.platform === 'darwin'

// Calculate optimal thread count based on environment.
// macOS CI runners have limited memory, so use fewer threads to prevent SIGABRT.
function getMaxThreads(): number {
  if (isCoverageEnabled) {
    return 1
  }
  if (isMacCI) {
    // Use 50% of CPUs on macOS CI to prevent memory exhaustion.
    return Math.max(2, Math.floor(os.cpus().length / 2))
  }
  // Use all CPUs on other platforms.
  return os.cpus().length
}

export default defineConfig({
  resolve: {
    alias: getLocalPackageAliases(repoRoot),
    preserveSymlinks: false,
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/**/*.test.{mts,ts}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // Exclude E2E tests from regular test runs.
      '**/*.e2e.test.mts',
      // Exclude integration tests (run separately via scripts/integration.mjs).
      'test/integration/**',
    ],
    reporters: ['default'],
    setupFiles: ['./test/setup.mts'],
    // Use threads for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        // Maximize parallel execution to offset isolate: true performance cost.
        // Use CPU count for better hardware utilization.
        // Reduce threads on macOS CI to prevent memory exhaustion (SIGABRT).
        maxThreads: getMaxThreads(),
        minThreads: isCoverageEnabled ? 1 : Math.min(2, Math.floor(getMaxThreads() / 2)),
        // IMPORTANT: Changed to isolate: true to fix worker thread termination issues.
        //
        // Previous configuration (isolate: false) caused "Terminating worker thread"
        // errors due to resource cleanup issues when tests completed.
        //
        // Tradeoff Analysis:
        // - isolate: true  = Full isolation, slower, but reliable cleanup
        // - isolate: false = Shared worker context, faster, but cleanup issues
        //
        // We choose isolate: true to ensure:
        // 1. Clean worker thread termination without errors
        // 2. Reliable test execution in CI environments
        // 3. Proper resource cleanup between tests
        // 4. No "Terminating worker thread" errors
        //
        // Performance impact is acceptable for reliability.
        isolate: true,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Enable file-level parallelization for better performance.
    // Large test files (like cmd-scan-reach.test.mts) will run in separate threads.
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
      exclude: [
        '**/*.config.*',
        '**/node_modules/**',
        '**/[.]**',
        '**/*.d.mts',
        '**/*.d.ts',
        '**/virtual:*',
        'bin/**',
        'coverage/**',
        'dist/**',
        'external/**',
        'pnpmfile.*',
        'scripts/**',
        'src/**/types.mts',
        'test/**',
        'perf/**',
        // Explicit root-level exclusions
        '/scripts/**',
        '/test/**',
      ],
      include: ['src/**/*.mts', 'src/**/*.ts'],
      all: true,
      clean: true,
      skipFull: false,
      ignoreClassMethods: ['constructor'],
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
  },
})
