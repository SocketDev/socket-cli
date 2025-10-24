/**
 * @fileoverview Vitest configuration for tests requiring full isolation.
 * Used for tests that need vi.doMock() or other module-level mocking that
 * requires true module isolation. Use this config when tests need to mock
 * modules differently in the same file or when isolate: false causes issues.
 */
import { defineConfig } from 'vitest/config'

// Check if coverage is enabled via CLI flags or environment.
const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.env.npm_lifecycle_event?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // Exclude E2E tests from regular test runs.
      '**/*-e2e.test.mts',
    ],
    reporters: ['default'],
    // Use forks for full isolation.
    pool: 'forks',
    poolOptions: {
      forks: {
        // True isolation for vi.doMock() and module-level mocking.
        isolate: true,
        singleFork: isCoverageEnabled,
        maxForks: isCoverageEnabled ? 4 : 16,
        minForks: isCoverageEnabled ? 1 : 2,
      },
    },
    testTimeout: 30_000,
    hookTimeout: 10_000,
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
      ],
      include: ['src/**/*.mts', 'src/**/*.ts'],
      all: true,
      clean: true,
      skipFull: false,
      ignoreClassMethods: ['constructor'],
      thresholds: {
        lines: 35,
        functions: 60,
        branches: 35,
        statements: 35,
      },
    },
  },
})
