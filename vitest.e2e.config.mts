import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    include: ['**/*-e2e.test.mts'],
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
