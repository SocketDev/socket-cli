import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  resolve: { preserveSymlinks: false },
  test: {
    include: [
      'test/unit/lib/terminal/animation.test.mts',
      'test/unit/utils/self-update.terminal.test.mts',
      'test/unit/lib/terminal/output.test.mts',
      'test/unit/lib/optimize-svg.test.mts',
      'test/unit/lib/native/cli-harness.test.mts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
  },
})
