import { expect, it, vi } from 'vitest'

import { defineHandoffCommand } from '../../../../src/util/cli/define-handoff.mts'
import { resolveSubcommand } from '../../../../src/util/cli/with-subcommands-dispatch.mts'

it.each(['cargo', 'compiler'])(
  'selects Socket flags without consuming %s child configuration',
  commandOrAliasName => {
    const command = defineHandoffCommand({
      name: 'cargo',
      description: 'Run cargo',
      examples: [],
      supportDryRun: false,
    })
    const argv = ['--config', '{}', '--help', '--config', 'child.json']
    const resolved = resolveSubcommand({
      aliases: { compiler: { argv: ['cargo'], description: 'cargo alias' } },
      commandOrAliasName,
      rawCommandArgv: argv,
      subcommands: { cargo: command },
    })
    expect(resolved.commandDefinition).toBe(command)
    expect(
      resolved.commandDefinition?.selectGlobalArgs?.(resolved.commandArgv),
    ).toEqual(['--config', '{}'])
    expect(resolved.commandArgv).toEqual(argv)
    expect(argv).toEqual(['--config', '{}', '--help', '--config', 'child.json'])
  },
)

it('preserves alias arguments and commands without a selector', () => {
  const command = { description: 'Run scan', run: vi.fn() }
  const result = resolveSubcommand({
    aliases: {
      inspect: { argv: ['scan', 'create'], description: 'scan alias' },
    },
    commandOrAliasName: 'inspect',
    rawCommandArgv: ['--json'],
    subcommands: { scan: command },
  })
  expect(result.commandDefinition).toBe(command)
  expect(result.commandArgv).toEqual(['create', '--json'])
})

it('does not resolve inherited command names', () => {
  const result = resolveSubcommand({
    aliases: {},
    commandOrAliasName: 'constructor',
    rawCommandArgv: [],
    subcommands: {},
  })
  expect(result.commandDefinition).toBeUndefined()
})
