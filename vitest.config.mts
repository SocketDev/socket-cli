import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
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
