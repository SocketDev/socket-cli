import { defineConfig } from 'vitest/config'

// Check if coverage is enabled via CLI flags or environment.
const isCoverageEnabled =
  process.env['COVERAGE'] === 'true' ||
  process.env['npm_lifecycle_event']?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

export default defineConfig({
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    globals: false,
    environment: 'node',
    setupFiles: ['./test/vitest-setup.mts'],
    include: [
      'test/**/*.test.{js,ts,mjs,cjs,mts}',
      'src/**/*.test.{js,ts,mjs,cjs,mts}',
    ],
    reporters: ['default'],
    // Improve memory usage by running tests sequentially in CI.
    pool: 'forks',
    poolOptions: {
      forks: {
        // Use single fork for coverage to reduce memory, parallel otherwise.
        singleFork: isCoverageEnabled,
        ...(isCoverageEnabled ? { maxForks: 1 } : {}),
        // Isolate tests to prevent memory leaks between test files.
        isolate: true,
      },
      threads: {
        // Use single thread for coverage to reduce memory, parallel otherwise.
        singleThread: isCoverageEnabled,
        ...(isCoverageEnabled ? { maxThreads: 1 } : {}),
      },
    },
    testTimeout: 60_000,
    hookTimeout: 60_000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
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
        'pnpmfile.*',
        'scripts/**',
        'src/**/types.mts',
        'test/**',
      ],
      include: ['src/**/*.mts', 'src/**/*.ts'],
      all: true,
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
