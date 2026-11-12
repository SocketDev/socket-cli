import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    // Keep the package unit lane scoped to this CLI. The checkout also contains
    // ignored upstream repositories and fleet tooling with independent deps and
    // Vitest configs; those are exercised by their own workflows.
    include: ['src/**/*.test.mts', 'test/**/*.test.mts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/worktrees/**',
      '.pnpm-store/**',
      '**/.{idea,git,cache,output,temp}/**',
      '**/{karma,rollup,webpack,vite,vitest,jest,ava,babel,nyc,cypress,tsup,build,eslint,prettier}.config.*',
      // Exclude E2E tests from regular test runs.
      '**/*.e2e.test.mts',
      // Process-level CLI tests run in the serialized integration lane.
      '**/*.integration.test.mts',
      'src/commands/cli.test.mts',
      'src/commands/json/cmd-json.test.mts',
      'src/commands/manifest/cmd-manifest-auto.test.mts',
      // Native process tests require the explicitly built SEA artifact.
      '**/*.native.test.mts',
      // Termless requires Node 23.6+; these focused UI captures run in the Node 26 lane.
      'test/unit/lib/terminal/animation.test.mts',
      'test/unit/utils/self-update.terminal.test.mts',
      'test/unit/lib/optimize-svg.test.mts',
      'test/unit/lib/native/cli-harness.test.mts',
      // Exclude test fixtures — directories like test/fixtures/commands/optimize/pnpm{8,9}/
      // contain full repo copies populated by `socket optimize` runs; their .test.mts
      // files would otherwise be globbed and run as if they were the real suite.
      'test/fixtures/**',
      'test/fleet/**',
      'upstream/**',
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
