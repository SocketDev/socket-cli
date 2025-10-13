import { defineConfig } from 'vitest/config'

const isCoverageEnabled =
  process.env.npm_lifecycle_event === 'cover' ||
  process.argv.includes('--coverage')

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
    setupFiles: ['./test/setup.mts'],
    // Use threads for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: isCoverageEnabled ? 1 : 16,
        isolate: false,
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
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
})
