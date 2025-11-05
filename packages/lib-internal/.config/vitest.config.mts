/**
 * @fileoverview Vitest configuration for socket-lib
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// Normalize paths for cross-platform glob patterns (forward slashes on Windows)
const toGlobPath = (pathLike: string): string => pathLike.replaceAll('\\', '/')

// Coverage mode detection
const isCoverageEnabled =
  process.env.COVERAGE === 'true' ||
  process.env.npm_lifecycle_event?.includes('coverage') ||
  process.argv.some(arg => arg.includes('coverage'))

export default defineConfig({
  cacheDir: path.resolve(projectRoot, '.cache/vitest'),
  resolve: {
    preserveSymlinks: false,
    extensions: isCoverageEnabled
      ? ['.ts', '.mts', '.cts', '.js', '.mjs', '.cjs', '.json']
      : ['.mts', '.ts', '.mjs', '.js', '.json'],
    alias: {
      '#env/ci': path.resolve(projectRoot, 'src/env/ci.ts'),
      '#env': path.resolve(projectRoot, 'src/env'),
      '#constants': path.resolve(projectRoot, 'src/constants'),
      '#lib': path.resolve(projectRoot, 'src/lib'),
      '#packages': path.resolve(projectRoot, 'src/lib/packages'),
      '#types': path.resolve(projectRoot, 'src/types.ts'),
      '#utils': path.resolve(projectRoot, 'src/utils'),
      cacache: path.resolve(projectRoot, 'src/external/cacache'),
      'make-fetch-happen': path.resolve(
        projectRoot,
        'src/external/make-fetch-happen',
      ),
      'fast-sort': path.resolve(projectRoot, 'src/external/fast-sort'),
      pacote: path.resolve(projectRoot, 'src/external/pacote'),
      '@socketregistry/scripts': path.resolve(projectRoot, 'scripts'),
      '@socketsecurity/lib/stdio/prompts': path.resolve(
        projectRoot,
        'src/stdio/prompts/index.ts',
      ),
      '@socketsecurity/lib': path.resolve(projectRoot, 'src'),
    },
  },
  test: {
    globalSetup: [path.resolve(__dirname, 'vitest-global-setup.mts')],
    globals: false,
    environment: 'node',
    include: [
      toGlobPath(
        path.resolve(projectRoot, 'test/**/*.test.{js,ts,mjs,mts,cjs,cts}'),
      ),
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      toGlobPath(path.resolve(projectRoot, 'test/isolated/**')),
      ...(process.env.INCLUDE_NPM_TESTS
        ? []
        : [toGlobPath(path.resolve(projectRoot, 'test/npm/**'))]),
    ],
    reporters: ['default'],
    // Optimize test execution for speed
    // Threads are faster than forks
    pool: 'threads',
    poolOptions: {
      threads: {
        // Maximize parallelism for speed
        // During coverage, use single thread for deterministic execution
        singleThread: isCoverageEnabled,
        maxThreads: isCoverageEnabled ? 1 : 16,
        minThreads: isCoverageEnabled ? 1 : 4,
        // IMPORTANT: isolate: false for performance and test compatibility
        //
        // Tradeoff Analysis:
        // - isolate: true  = Full isolation, slower, breaks nock/module mocking
        // - isolate: false = Shared worker context, faster, mocking works
        //
        // We choose isolate: false because:
        // 1. Significant performance improvement (faster test runs)
        // 2. HTTP mocking works correctly across all test files
        // 3. Vi.mock() module mocking functions properly
        // 4. Test state pollution is prevented through proper beforeEach/afterEach
        // 5. Our tests are designed to clean up after themselves
        isolate: false,
        useAtomics: true,
      },
    },
    // Reduce timeouts for faster failures
    testTimeout: 10_000,
    hookTimeout: 10_000,
    // Speed optimizations
    sequence: {
      // Run tests concurrently within suites
      concurrent: true,
    },
    // Bail early on first failure in CI
    bail: process.env.CI ? 1 : 0,
    server: {
      deps: {
        inline: isCoverageEnabled ? [/@socketsecurity\/lib/, 'zod'] : ['zod'],
      },
    },
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json', 'html', 'lcov', 'clover'],
      exclude: [
        '**/*.config.*',
        '**/node_modules/**',
        '**/[.]**',
        '**/*.d.ts',
        '**/virtual:*',
        'coverage/**',
        'test/**',
        'packages/**',
        'perf/**',
        'dist/**',
        'src/external/**',
        'src/types.ts',
        'scripts/**',
      ],
      include: ['src/**/*.{ts,mts,cts}'],
      all: true,
      clean: true,
      skipFull: false,
      ignoreClassMethods: ['constructor'],
      thresholds: {
        lines: 1,
        functions: 68,
        branches: 70,
        statements: 1,
      },
    },
  },
})
