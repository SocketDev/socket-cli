import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  DRY_RUN_BAILING_NOW,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mjs'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  getSupportedConfigEntries,
  isSupportedConfigKey,
} from '../../utils/config.mts'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type { MeowFlags } from '../../flags.mts'
import type { OutputKind } from '../../types.mjs'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'
import type { LocalConfig } from '../../utils/config.mts'

const logger = getDefaultLogger()

type ConfigCommandSpec = {
  commandName: string
  description: string
  hidden?: boolean
  flags?: MeowFlags
  needsValue?: boolean
  helpUsage: string
  helpDescription: string
  helpExamples: string[]
  validate?: (cli: {
    input: readonly string[]
    flags: Record<string, unknown>
  }) => Array<{
    test: boolean
    message: string
    fail: string
    nook?: boolean
    pass?: string
  }>
  handler: (params: {
    key: keyof LocalConfig
    value?: string
    outputKind: OutputKind
  }) => Promise<void>
}

export function createConfigCommand(spec: ConfigCommandSpec) {
  const config: CliCommandConfig = {
    commandName: spec.commandName,
    description: spec.description,
    hidden: spec.hidden ?? false,
    flags: spec.flags ?? {
      ...commonFlags,
      ...outputFlags,
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] ${spec.helpUsage}

    Options
      ${getFlagListOutput(config.flags)}

    ${spec.helpDescription}

    Keys:

${getSupportedConfigEntries()
  .map(({ 0: key, 1: description }) => `     - ${key} -- ${description}`)
  .join('\n')}

    Examples
${spec.helpExamples.map(ex => `      $ ${command} ${ex}`).join('\n')}
  `,
  }

  return {
    description: config.description,
    hidden: config.hidden,
    run: async (
      argv: string[] | readonly string[],
      importMeta: ImportMeta,
      { parentName }: CliCommandContext,
    ): Promise<void> => {
      const cli = meowOrExit({
        argv,
        config,
        importMeta,
        parentName,
      })

      const { json, markdown } = cli.flags
      const dryRun = !!cli.flags['dryRun']
      const [key = '', ...rest] = cli.input
      const value = rest.join(' ')
      const outputKind = getOutputKind(json, markdown)

      // Build validation checks.
      const validations = [
        {
          test: key === 'test' || isSupportedConfigKey(key),
          message: 'Config key should be the first arg',
          fail: key ? 'invalid config key' : 'missing',
        },
        {
          nook: true,
          test: !json || !markdown,
          message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
          fail: 'bad',
        },
      ]

      // Add value validation if needed.
      if (spec.needsValue) {
        validations.splice(1, 0, {
          test: !!value,
          message:
            'Key value should be the remaining args (use `unset` to unset a value)',
          fail: 'missing',
        })
      }

      // Add custom validations if provided.
      if (spec.validate) {
        validations.push(...spec.validate(cli))
      }

      const wasValidInput = checkCommandInput(outputKind, ...validations)
      if (!wasValidInput) {
        return
      }

      if (dryRun) {
        logger.log(DRY_RUN_BAILING_NOW)
        return
      }

      await spec.handler({
        key: key as keyof LocalConfig,
        ...(spec.needsValue && value !== undefined ? { value } : {}),
        outputKind,
      })
    },
  }
}
