import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
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
      ],
      include: ['src/**/*.mts', 'src/**/*.ts'],
      all: true,
    },
  },
})
