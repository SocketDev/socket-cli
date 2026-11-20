import { fileURLToPath } from 'node:url'

import { defineConfig } from 'vitest/config'

import { resolveSnapshotPath } from './snapshot-path.mts'

export default defineConfig({
  root: fileURLToPath(new URL('../', import.meta.url)),
  resolve: { preserveSymlinks: false },
  test: {
    resolveSnapshotPath,
    globalSetup: ['./test/lib/termless/build-cli.mts'],
    env: process.argv.some(arg => arg === '--update' || arg === '-u')
      ? { SOCKET_CLI_NATIVE_TEST_UPDATE_SNAPSHOTS: 'true' }
      : {},
    include: [
      'test/e2e/termless.test.mts',
      'test/termless/**/*.test.mts',
      'test/unit/lib/native/cli-harness.test.mts',
      'test/unit/lib/terminal/output.test.mts',
      'test/unit/lib/termless/animation.test.mts',
      'test/unit/lib/termless/svgo.test.mts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**', '.claude/worktrees/**'],
  },
})
