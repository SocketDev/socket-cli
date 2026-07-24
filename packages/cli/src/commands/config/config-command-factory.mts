import { FLAG_JSON, FLAG_MARKDOWN } from '../../constants/cli.mjs'
import { outputDryRunWrite } from '../../util/dry-run/output.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getSupportedConfigEntries,
  isSupportedConfigKey,
} from '../../util/config.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { MeowFlags } from '../../flags.mts'
import type { OutputKind } from '../../types.mjs'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../util/cli/with-subcommands.mjs'
import type { LocalConfig } from '../../util/config.mts'

export type ConfigCommandSpec = {
  commandName: string
  description: string
  hidden?: boolean | undefined
  flags?: MeowFlags | undefined
  needsValue?: boolean | undefined
  helpUsage: string
  helpDescription: string
  helpExamples: string[]
  validate?:
    | ((cli: {
        input: readonly string[]
        flags: Record<string, unknown>
      }) => Array<{
        test: boolean
        message: string
        fail: string
        nook?: boolean | undefined
        pass?: string | undefined
      }>)
    | undefined
  handler: (params: {
    key: keyof LocalConfig
    value?: string | undefined
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
    help: (command, helpConfig) => `
    Usage
      $ ${command} [options] ${spec.helpUsage}

    Options
      ${getFlagListOutput(helpConfig.flags)}

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

      // Build validation checks. The shape matches `checkCommandInput`'s
      // param exactly so spec.validate() output (which may include
      // `pass?`) appends cleanly without the inferred discriminated-union
      // narrowing kicking in.
      type Validation = {
        test: boolean
        message: string
        fail: string
        nook?: boolean | undefined
        pass?: string | undefined
      }
      const validations: Validation[] = [
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
        // Runtime read so tests that mutate process.env['HOME'] pick up changes.
        const configPath = `${process.env['HOME']}/.config/socket/config.json`
        const changes = spec.needsValue
          ? [`Set "${key}" to: ${value}`]
          : [`Remove "${key}" from config`]
        outputDryRunWrite(
          configPath,
          spec.needsValue
            ? `set config value for "${key}"`
            : `unset config value for "${key}"`,
          changes,
        )
        return
      }

      await spec.handler({
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the validation above admits the literal 'test' sentinel (the config test-mode key) alongside real LocalConfig keys, so a type guard cannot narrow this; handlers treat 'test' explicitly.
        key: key as keyof LocalConfig,
        ...(spec.needsValue && value !== undefined ? { value } : {}),
        outputKind,
      })
    },
  }
}
