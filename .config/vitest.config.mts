import { defineConfig } from 'vitest/config'

const isCoverageEnabled =
  process.env.npm_lifecycle_event === 'cover' ||
  process.argv.includes('--coverage')

// oxlint-disable-next-line socket/no-default-export -- vitest config files must use export default per vitest's contract.
export default defineConfig({
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    globals: false,
    environment: 'node',
    include: [
      // NOTE: No root-level tests exist. All tests are in individual packages.
      // Each package (e.g., packages/cli/) has its own vitest.config.mts.
      // This root config serves as a fallback default configuration only.
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      '**/*.test.{js,ts,mjs,cjs,mts}',
      // Exclude E2E tests from regular test runs.
      '**/*.e2e.test.mts',
    ],
    passWithNoTests: true,
    reporters: ['default'],
    setupFiles: ['./test/setup.mts'],
    // Use threads for better performance
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: isCoverageEnabled ? 1 : 16,
        minThreads: isCoverageEnabled ? 1 : 4,
        // isolate: true for consistency with packages/cli/vitest.config.mts
        // and CI reliability. The tradeoff is slower runs and nock/vi.mock
        // friction, but those concerns turned out to be solvable with
        // per-test setup/teardown discipline.
        isolate: true,
        // Use worker threads for better performance
        useAtomics: true,
      },
    },
    deps: {
      interopDefault: false,
    },
    testTimeout: 30_000,
    hookTimeout: 30_000,
    bail: process.env.CI ? 1 : 0, // Exit on first failure in CI for faster feedback.
    sequence: {
      concurrent: true, // Run tests concurrently within suites for better parallelism.
    },
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
