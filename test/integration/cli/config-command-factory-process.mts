import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { cmdConfigSet } from '../../../src/command/config/cmd-config-set.mts'
import { createConfigCommand } from '../../../src/command/config/config-command-factory.mts'
import { handleConfigSet } from '../../../src/command/config/config-set-command.mts'
import { handleConfigUnset } from '../../../src/command/config/config-unset-command.mts'
import { commonFlags, outputFlags } from '../../../src/flags.mts'
import { InputError } from '../../../src/util/error/errors.mts'

import type { ConfigCommandSpec } from '../../../src/command/config/config-command-factory.mts'
import type { MeowFlags } from '../../../src/flags.mts'

const logger = getDefaultLogger()
const context = { parentName: 'socket config' }
const flags = {
  ...commonFlags,
  ...outputFlags,
  fixture: {
    type: 'string',
    description: 'Select the fixture validation mode',
  },
} satisfies MeowFlags

const setSpec: ConfigCommandSpec = {
  commandName: 'set',
  description: 'Set a config value through the command factory',
  flags,
  handler: handleConfigSet,
  helpDescription: 'Factory integration fixture.',
  helpExamples: ['defaultOrg example-org'],
  helpUsage: '<KEY> <VALUE>',
  needsValue: true,
  validate: ({ flags: parsedFlags, input }) => {
    const value = input.slice(1).join(' ')
    return parsedFlags['fixture'] === 'reject' && value === 'reject-me'
      ? [
          {
            test: false,
            message: 'Fixture validation rejected the selected value',
            fail: 'invalid fixture value',
          },
        ]
      : []
  },
}

const unsetSpec: ConfigCommandSpec = {
  commandName: 'unset',
  description: 'Unset a config value through the command factory',
  flags,
  handler: handleConfigUnset,
  helpDescription: 'Factory integration fixture.',
  helpExamples: ['defaultOrg'],
  helpUsage: '<KEY>',
  needsValue: false,
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((argument: unknown) => typeof argument === 'string')
  )
}

async function runUndefinedHandlerValue(): Promise<void> {
  try {
    await handleConfigSet({
      key: 'defaultOrg',
      outputKind: 'text',
      value: undefined,
    })
  } catch (error) {
    if (error instanceof InputError) {
      logger.log('undefined value rejected')
      return
    }
    throw error
  }
  process.exitCode = 1
}

async function main(): Promise<void> {
  const [scenario = '', ...args] = process.argv.slice(2)
  if (scenario === 'file') {
    const argsPath = args[0]
    if (argsPath === undefined) {
      throw new Error('Expected a config command argument file')
    }
    const decodedArgs: unknown = JSON.parse(readFileSync(argsPath, 'utf8'))
    if (!isStringArray(decodedArgs)) {
      throw new Error('Expected config command arguments to be strings')
    }
    await cmdConfigSet.run(decodedArgs, import.meta, context)
    return
  }
  if (scenario === 'undefined') {
    await runUndefinedHandlerValue()
    return
  }
  if (scenario === 'frozen') {
    await cmdConfigSet.run(Object.freeze(args), import.meta, context)
    return
  }
  const command = createConfigCommand(
    scenario === 'unset' ? unsetSpec : setSpec,
  )
  await command.run(args, import.meta, context)
}

void main().catch(error => {
  logger.fail(error instanceof Error ? error.message : 'Factory fixture failed')
  process.exitCode = 1
})
