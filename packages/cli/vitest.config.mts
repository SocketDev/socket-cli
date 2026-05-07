import os from 'node:os'

import { defineConfig } from 'vitest/config'

// Pin TZ in the parent process before vitest spawns its workers, so
// every worker inherits TZ=UTC from spawn env. V8 caches the timezone
// at the first Date op per-worker, so it must be present before any
// test code (or vitest worker bootstrap) runs. test.env below sets it
// on the worker for additional belt-and-suspenders coverage.
if (!process.env['TZ']) {
  process.env['TZ'] = 'UTC'
}

const isCoverageEnabled =
  process.env['npm_lifecycle_event'] === 'cover' ||
  process.argv.includes('--coverage')

// Detect if running in CI.
const isCI = 'CI' in process.env

// Detect if running in CI on macOS.
const isMacCI = isCI && process.platform === 'darwin'

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
    preserveSymlinks: false,
  },
  test: {
    globals: false,
    environment: 'node',
    // Pin timezone for stable date-formatting snapshots regardless of
    // how vitest is invoked. CI runners are UTC; without this, devs on
    // local timezones see shifted dates (a 2025-04-19T04:50Z fixture
    // renders as Apr 18 in PDT). Vitest applies `test.env` to the
    // worker process before any module loads, so this is set early
    // enough that V8's internal timezone cache picks it up.
    env: {
      TZ: 'UTC',
    },
    include: ['test/**/*.test.{mts,ts}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // Exclude E2E tests from regular test runs.
      '**/*.e2e.test.mts',
      // Exclude integration tests (run separately via scripts/integration.mts).
      'test/integration/**',
      // Exclude iocraft-dependent tests in CI (requires native module).
      ...(isCI
        ? [
            '**/AnalyticsRenderer.test.mts',
            '**/AuditLogRenderer.test.mts',
            '**/ThreatFeedRenderer.test.mts',
            '**/iocraft-new-features.test.mts',
            '**/iocraft-properties.test.mts',
          ]
        : []),
    ],
    reporters: ['default'],
    setupFiles: ['./test/setup.mts'],
    // Use threads for better performance.
    pool: 'threads',
    // Maximize parallel execution to offset isolate: true performance cost.
    // Use CPU count for better hardware utilization.
    // Reduce threads on macOS CI to prevent memory exhaustion (SIGABRT).
    maxWorkers: getMaxThreads(),
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
    deps: {
      interopDefault: false,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // Enable file-level parallelization for better performance.
    // Large test files (like cmd-scan-reach.test.mts) will run in separate threads.
    fileParallelism: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
      // Prevent v8 coverage segfaults by processing in smaller chunks.
      processingConcurrency: 1,
      // Use less memory-intensive options.
      reportOnFailure: true,
      reportsDirectory: './coverage',
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
        // iocraft renderers — being replaced by stuie. The native
        // iocraft module isn't available in CI and stuie isn't
        // published yet, so coverage measurement is excluded until
        // the migration lands. The Renderer.mts files here are all
        // doomed; the replacement (stuie) renderers will be tested
        // fresh once stuie is published. Only the *Renderer.mts
        // files are excluded — the surrounding output-*.mts files
        // contain non-iocraft logic (markdown / JSON formatters)
        // that's still tested directly.
        'src/utils/terminal/iocraft.mts',
        'src/commands/analytics/AnalyticsRenderer.mts',
        'src/commands/audit-log/AuditLogRenderer.mts',
        'src/commands/threat-feed/ThreatFeedRenderer.mts',
      ],
      include: ['src/**/*.mts', 'src/**/*.ts'],
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
