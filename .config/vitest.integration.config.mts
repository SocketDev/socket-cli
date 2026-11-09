import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    // CLI integration tests may exercise npm exec/npx and pnpm dlx. Keep files
    // serial so they never mutate the same package-manager cache concurrently.
    fileParallelism: false,
    include: [
      '**/*.integration.test.mts',
      'src/commands/cli.test.mts',
      'src/commands/json/cmd-json.test.mts',
      'src/commands/manifest/cmd-manifest-auto.test.mts',
    ],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      '.claude/worktrees/**',
      '.pnpm-store/**',
      '**/.{idea,git,cache,output,temp}/**',
      'test/fixtures/**',
    ],
  },
})
