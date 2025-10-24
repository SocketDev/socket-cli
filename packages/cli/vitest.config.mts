import { defineConfig } from 'vitest/config'

import { getLocalPackageAliases } from './scripts/utils/get-local-package-aliases.mjs'

const isCoverageEnabled =
  process.env.npm_lifecycle_event === 'cover' ||
  process.argv.includes('--coverage')

export default defineConfig({
  resolve: {
    alias: getLocalPackageAliases(),
    preserveSymlinks: false,
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      'test/**/*.test.{mts,ts}',
      'src/**/*.test.{mts,ts}',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // Exclude E2E tests from regular test runs.
      '**/*-e2e.test.mts',
    ],
    reporters: ['default'],
    setupFiles: ['./test/setup.mts'],
    // Use threads for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: isCoverageEnabled ? 1 : 16,
        minThreads: isCoverageEnabled ? 1 : 4,
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
