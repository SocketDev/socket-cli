import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import { expect, it } from 'vitest'

const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

it.each([
  { command: process.execPath, prefix: ['dist/index.js'] },
  { command: 'pnpm', prefix: ['run', 's'] },
])('initializes bundled factories through $command', ({ command, prefix }) => {
  const result = spawnSync(
    command,
    [...prefix, '--no-banner', 'sfw', 'ca', '--help'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: 10_000,
      env: {
        ...process.env,
        SOCKET_CLI_NO_API_TOKEN: '1',
        SOCKET_CLI_SKIP_UPDATE_CHECK: '1',
        DO_NOT_TRACK: '1',
      },
    },
  )
  expect(result.status).toBe(0)
  expect(result.stdout).toContain('Socket Firewall')
})
