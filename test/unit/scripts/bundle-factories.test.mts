import { fileURLToPath } from 'node:url'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, it } from 'vitest'

it.each([
  {
    entryPath: 'dist/index.js',
    args: ['--no-banner', 'sfw', 'ca', '--help'],
    expected: 'Socket Firewall',
  },
  {
    entryPath: 'scripts/repo/cli-build/run-dist.mts',
    args: ['--describe'],
    expected: 'run the built Socket CLI with forwarded arguments',
  },
])('initializes $entryPath', ({ entryPath, args, expected }) => {
  const entry = fileURLToPath(
    new URL(entryPath, new URL('../../../', import.meta.url)),
  )
  const result = spawnSync(process.execPath, [entry, ...args], {
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      SOCKET_CLI_NO_API_TOKEN: '1',
      SOCKET_CLI_SKIP_UPDATE_CHECK: '1',
      DO_NOT_TRACK: '1',
    },
  })
  expect(result.status).toBe(0)
  expect(result.stdout).toContain(expected)
})
