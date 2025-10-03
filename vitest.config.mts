import { defineConfig } from 'vitest/config'

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
    testTimeout: 60_000,
    hookTimeout: 60_000,
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
