import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  resolve: {
    preserveSymlinks: false,
  },
  test: {
    // These tests run a native executable and may invoke npm exec/npx or pnpm
    // dlx. Serialize files to protect both package managers' shared caches.
    fileParallelism: false,
    // The integration files already execute complete CLI processes through
    // spawnSocketCli, which switches to the SEA binary in this lane.
    include: [
      '**/*.native.test.mts',
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
