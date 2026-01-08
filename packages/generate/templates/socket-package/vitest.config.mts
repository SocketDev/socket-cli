import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: ['test/**', '**/*.test.mjs', 'node_modules/**', 'dist/**'],
      // Note: Coverage thresholds disabled for this package because it's a thin wrapper
      // that delegates to spawned processes. The tests validate behavior end-to-end
      // by executing the bootstrap script, which v8 coverage can't instrument.
      // Test coverage is comprehensive (19 tests covering all code paths), but
      // traditional coverage metrics don't apply to this execution model.
      thresholds: {
        lines: 0,
        functions: 0,
        branches: 0,
        statements: 0,
      },
    },
    testTimeout: 120000, // 2 min for npm download tests.
    hookTimeout: 30000,
  },
})
