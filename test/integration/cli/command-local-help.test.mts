import { describe, expect, it } from 'vitest'

import { cliPath, runChild } from './config-command-util.mts'

const commandNames = [
  'bundler',
  'cargo',
  'gem',
  'go',
  'npm',
  'npx',
  'nuget',
  'pnpm',
  'pip',
  'uv',
  'yarn',
] as const

const localHelpCases: ReadonlyArray<{
  name: string
  arguments: readonly string[]
}> = [
  { name: 'long help flag', arguments: ['--help'] },
  { name: 'short help flag', arguments: ['-h'] },
  {
    name: 'long help before a trailing wrapper flag',
    arguments: ['--help', '--no-banner'],
  },
  {
    name: 'short help before a trailing wrapper flag',
    arguments: ['-h', '--no-banner'],
  },
]

describe.each(commandNames)('local help for socket %s', commandName => {
  it.each(localHelpCases)('$name displays Socket usage', async helpCase => {
    const result = await runChild(cliPath, [commandName, ...helpCase.arguments])

    expect(result.code, result.exitDiagnostic).toBe(0)
    expect(result.signal).toBeNull()
    expect(result.output).toContain('Usage')
    expect(result.output).toContain(`$ socket ${commandName}`)
  })
})
