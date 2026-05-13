import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/worktrees/**',
      '.pnpm-store/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // Exclude E2E tests from regular test runs.
      '**/*.e2e.test.mts',
      // Exclude test fixtures — directories like test/fixtures/commands/optimize/pnpm{8,9}/
      // contain full repo copies populated by `socket optimize` runs; their .test.mts
      // files would otherwise be globbed and run as if they were the real suite.
      'test/fixtures/**',
    ],
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
