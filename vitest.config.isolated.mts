/**
 * @fileoverview Vitest configuration for tests requiring full isolation.
 * Used for tests that need vi.doMock() or other module-level mocking.
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
    include: ['test/**/*.test.{js,ts,mjs,mts,cjs}'],
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
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov', 'clover'],
      exclude: [
        '**/*.config.*',
        '**/node_modules/**',
        '**/[.]**',
        '**/*.d.ts',
        '**/virtual:*',
        'coverage/**',
        'dist/**',
        'scripts/**',
        'types/**',
        'test/**',
        '**/*.mjs',
        '**/*.cjs',
        'src/types.ts',
        'perf/**',
        '/scripts/**',
        '/test/**',
      ],
      include: ['src/**/*.{ts,mts,cts}'],
      all: true,
      clean: true,
      skipFull: false,
      ignoreClassMethods: ['constructor'],
      thresholds: {
        lines: 99,
        functions: 99,
        branches: 99,
        statements: 99,
      },
    },
  },
})
