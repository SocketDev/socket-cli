import { fileURLToPath } from 'node:url'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, it } from 'vitest'

it.each([
  { entryPath: 'dist/index.js', prefix: [] },
  { entryPath: 'scripts/repo/cli-build/run-dist.mts', prefix: ['--'] },
])(
  'initializes bundled factories through $entryPath',
  ({ entryPath, prefix }) => {
    const entry = fileURLToPath(
      new URL(entryPath, new URL('../../../', import.meta.url)),
    )
    const result = spawnSync(
      process.execPath,
      [entry, ...prefix, '--no-banner', 'sfw', 'ca', '--help'],
      {
        encoding: 'utf8',
        timeout: 10_000,
        env: {
          SOCKET_CLI_NO_API_TOKEN: '1',
          SOCKET_CLI_SKIP_UPDATE_CHECK: '1',
          DO_NOT_TRACK: '1',
        },
      },
    )
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('Socket Firewall')
  },
)
