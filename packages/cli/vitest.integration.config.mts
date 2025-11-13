import os from 'node:os'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
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
