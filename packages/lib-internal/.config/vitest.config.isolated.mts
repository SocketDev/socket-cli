/**
 * @fileoverview Vitest configuration for isolated tests
 * Tests that require full isolation due to shared module state
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(__dirname, '..')

// Normalize paths for cross-platform glob patterns (forward slashes on Windows)
const toGlobPath = (pathLike: string): string => pathLike.replaceAll('\\', '/')

export default defineConfig({
  cacheDir: path.resolve(projectRoot, '.cache/vitest-isolated'),
  resolve: {
    preserveSymlinks: false,
    extensions: ['.mts', '.ts', '.mjs', '.js', '.json'],
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
        path.resolve(projectRoot, 'test/isolated/**/*.test.{js,ts,mjs,mts}'),
      ),
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    reporters: ['default'],
    // Full isolation for tests that modify shared module state
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: true,
        maxThreads: 1,
        minThreads: 1,
        isolate: true,
        useAtomics: true,
      },
    },
    testTimeout: 10_000,
    hookTimeout: 10_000,
    sequence: {
      concurrent: false,
    },
  },
})
