import { mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { expect, it } from 'vitest'

import { getBinCliPath } from '../../../../src/constants/paths.mts'
import { spawnSocketCli } from '../../../utils.mts'

it.each([0, 23])(
  'forwards patch help and child exit %i offline',
  async code => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'patch-forwarding-'))
    try {
      const executable = path.join(directory, 'patch-fixture.mjs')
      await writeFile(
        executable,
        `process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exitCode = ${code};`,
      )
      const result = await spawnSocketCli(
        getBinCliPath(),
        ['patch', 'get', '--help', '--config', '{}', '--no-banner'],
        {
          env: {
            SOCKET_CLI_SOCKET_PATCH_LOCAL_PATH: executable,
            SOCKET_CLI_SKIP_UPDATE_CHECK: '1',
            SOCKET_CLI_NO_API_TOKEN: '1',
          },
        },
      )
      expect(JSON.parse(result.stdout)).toEqual(['get', '--help'])
      expect(result.code).toBe(code)
    } finally {
      await safeDelete(directory)
    }
  },
)
