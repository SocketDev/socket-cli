import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { getLocalPackageAliases } from './scripts/utils/get-local-package-aliases.mjs'

// Get the socket-cli repo root directory.
const __dirname = path.dirname(fileURLToPath(import.meta.url))
const repoRoot = path.resolve(__dirname, '../..')

export default defineConfig({
  resolve: {
    alias: getLocalPackageAliases(repoRoot),
    preserveSymlinks: false,
  },
  test: {
    globals: false,
    environment: 'node',
    include: ['test/integration/**/*.test.{mts,ts}'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
    ],
    reporters: ['default'],
    setupFiles: ['./test/setup.mts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        maxThreads: os.cpus().length,
        minThreads: Math.min(2, Math.floor(os.cpus().length / 2)),
        isolate: true,
      },
    },
    testTimeout: 60_000, // Integration tests may take longer.
    hookTimeout: 30_000,
    fileParallelism: true,
  },
})
