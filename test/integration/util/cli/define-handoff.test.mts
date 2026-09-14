import { chmod, mkdtemp, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { expect, it } from 'vitest'

import { getBinCliPath } from '../../../../src/constants/paths.mts'
import { spawnSocketCli } from '../../../utils.mts'

it.concurrent.each([
  ...['bundler', 'cargo', 'gem', 'go', 'nuget', 'pip', 'pip3', 'uv'].map(
    command => ({ command, rootArgs: [] as string[] }),
  ),
  { command: 'cargo', rootArgs: ['--config', '{}'] },
])(
  'forwards $command help with root arguments $rootArgs',
  async ({ command, rootArgs }) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'handoff-child-'))
    try {
      const fixture = path.join(directory, 'child-fixture.mjs')
      await writeFile(
        fixture,
        'process.stdout.write(JSON.stringify(process.argv.slice(2)))',
      )
      const windows = process.platform === 'win32'
      const executable = path.join(
        directory,
        `${command}${windows ? '.cmd' : ''}`,
      )
      await writeFile(
        executable,
        windows
          ? `@"${process.execPath}" "${fixture}" %*\r\n`
          : `#!${process.execPath}\nimport ${JSON.stringify(fixture)}\n`,
      )
      await chmod(executable, 0o755)
      const result = await spawnSocketCli(
        getBinCliPath(),
        [
          ...rootArgs,
          command,
          ...(rootArgs.length ? [] : ['--config', '{}']),
          '--help',
          '--config',
          'child.json',
        ],
        {
          env: {
            HOME: directory,
            USERPROFILE: directory,
            PATH: [directory, path.dirname(process.execPath)].join(
              path.delimiter,
            ),
            SOCKET_CLI_SKIP_UPDATE_CHECK: '1',
            SOCKET_CLI_NO_API_TOKEN: '1',
            SOCKET_API_TOKEN: 'sfw_free',
            SFW_CA_CERT_PATH: '',
            SFW_CA_KEY_PATH: '',
          },
        },
      )
      expect(result.code, result.stderr).toBe(0)
      expect(JSON.parse(result.stdout)).toEqual([
        '--help',
        '--config',
        'child.json',
      ])
      expect(result.stderr).toContain(
        `socket ${command === 'pip3' ? 'pip' : command}`,
      )
    } finally {
      await safeDelete(directory)
    }
  },
)
