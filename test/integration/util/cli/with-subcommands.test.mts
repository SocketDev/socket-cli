import process from 'node:process'

import { afterEach, expect, it, vi } from 'vitest'

import { meowWithSubcommands } from '../../../../src/util/cli/with-subcommands.mts'

const helpExit = new Error('Fixture help exit')

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  process.exitCode = undefined
})

it.each(['--help', '--dry-run'])(
  'does not select a default command for flag-only %s',
  async flag => {
    vi.stubEnv('SOCKET_CLI_NO_API_TOKEN', '1')
    vi.spyOn(process, 'exit').mockImplementation(() => {
      throw helpExit
    })
    const run = vi.fn()
    await expect(
      meowWithSubcommands(
        {
          name: 'socket',
          argv: [flag],
          importMeta: import.meta,
          subcommands: { list: { description: 'List entries', run } },
        },
        { defaultSub: 'list' },
      ),
    ).rejects.toBe(helpExit)
    expect(run).not.toHaveBeenCalled()
  },
)

it.each([
  { argv: [], expected: [] },
  {
    argv: ['--config', '{}', 'list', 'example-entry'],
    expected: ['example-entry'],
  },
])(
  'dispatches default or explicit command for $argv',
  async ({ argv, expected }) => {
    vi.stubEnv('SOCKET_CLI_NO_API_TOKEN', '1')
    const run = vi.fn()
    await meowWithSubcommands(
      {
        name: 'socket',
        argv,
        importMeta: import.meta,
        subcommands: { list: { description: 'List entries', run } },
      },
      { defaultSub: 'list' },
    )
    expect(run).toHaveBeenCalledWith(
      expected,
      import.meta,
      expect.objectContaining({ parentName: 'socket' }),
    )
  },
)
