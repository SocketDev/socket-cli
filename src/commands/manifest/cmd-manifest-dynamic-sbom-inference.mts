import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleManifestDynamicSbomInference } from './handle-manifest-dynamic-sbom-inference.mts'
import { excludePathsFlag } from './manifest-flags.mts'
import constants, { FLAG_JSON, FLAG_MARKDOWN } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'
import { assertValidExcludePaths } from '../scan/exclude-paths.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'dynamic-sbom-inference',
  description:
    'Recursively discover gradle/sbt/maven build roots and generate a Socket facts SBOM for each',
  // Hidden: `--dynamic-sbom-inference` already names an unrelated, root-only
  // scan create/reach flag (see reachability-flags.mts). Keep this hidden
  // until the naming collision between the two is resolved.
  hidden: true,
  flags: {
    ...commonFlags,
    ...outputFlags,
    ...excludePathsFlag,
    verbose: {
      type: 'boolean',
      default: false,
      description: 'Print debug messages',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Recursively walks CWD, discovers independent gradle, sbt, and maven build
    roots, and generates a Socket facts SBOM (.socket.facts.json) for each,
    skipping subproject/reactor-module directories a parent build root already
    covers. Unlike \`socket manifest auto\`, this looks beyond CWD itself.

    Options
      ${getFlagListOutput(config.flags)}

    Examples

      $ ${command}
      $ ${command} ./monorepo
  `,
}

export const cmdManifestDynamicSbomInference = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    dryRun,
    json,
    markdown,
    verbose: verboseFlag,
  } = cli.flags as {
    dryRun: boolean
    json: boolean
    markdown: boolean
    verbose: boolean | undefined
  }
  const verbose = !!verboseFlag

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  // This debug block prints to stdout; --json's payload does too, so skip it
  // here (unlike the other manifest commands, this one supports --json).
  if (verbose && !json) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- target:', cwd)
    logger.groupEnd()
  }

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: cli.input.length <= 1,
      message: 'Can only accept one DIR (make sure to escape spaces!)',
      fail: `received ${cli.input.length}`,
    },
    {
      nook: true,
      test: !json || !markdown,
      message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
      fail: 'bad',
    },
  )
  if (!wasValidInput) {
    return
  }

  const excludePaths = cmdFlagValueToArray(cli.flags['excludePaths'])
  assertValidExcludePaths(excludePaths)

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleManifestDynamicSbomInference({
    cwd,
    excludePaths,
    outputKind,
    verbose,
  })
}
