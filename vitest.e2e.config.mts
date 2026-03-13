import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    // Serialize test files to prevent concurrent npx --force invocations
    // from racing on the npm _npx cache directory.
    fileParallelism: false,
    include: ['**/*.e2e.test.mts'],
    coverage: {
      exclude: [
        '**/{eslint,vitest}.config.*',
        '**/node_modules/**',
        '**/[.]**',
        '**/*.d.mts',
        '**/virtual:*',
        'coverage/**',
        'dist/**',
        'scripts/**',
        'src/**/types.mts',
        'test/**',
      ],
    },
  },
})
