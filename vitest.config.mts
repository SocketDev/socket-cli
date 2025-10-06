import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'test/**/*.test.{js,ts,mjs,cjs,mts}',
      'src/**/*.test.{js,ts,mjs,cjs,mts}',
    ],
    reporters: ['default'],
    // Use parallel execution with controlled concurrency.
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: false,
        maxForks: 4,
        // Isolate tests to prevent memory leaks between test files.
        isolate: true,
      },
      threads: {
        singleThread: false,
        // Limit thread concurrency to prevent RegExp compiler exhaustion.
        maxThreads: 4,
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
        'external/**',
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
