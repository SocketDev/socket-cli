/** @fileoverview Manifest cdxgen command for Socket CLI. Runs CycloneDX cdxgen tool for SBOM (Software Bill of Materials) generation with Socket-specific defaults. Filters Socket CLI flags and forwards everything else to cdxgen. Sets lifecycle to pre-build for security. */

import terminalLink from 'terminal-link'

import { logger } from '@socketsecurity/registry/lib/logger'

import { runCdxgen } from './run-cdxgen.mts'
import constants, { FLAG_HELP } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { filterFlags, isHelpFlag } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'cdxgen',
  description: 'Run cdxgen for SBOM generation',
  hidden: false,
  flags: {},
  help: command => `
    Usage
      $ ${command} [options] [PATH]

    Note: Everything after "${config.commandName}" is forwarded to cdxgen.
          Socket CLI applies secure defaults and filters its own flags.

    Secure Defaults:
      --lifecycle pre-build  Avoids arbitrary code execution during scan
      --output socket-cdx.json  Default output filename

    Examples
      $ ${command}
      $ ${command} --help
      $ ${command} --type js
      $ ${command} --output my-sbom.json

    See cdxgen ${terminalLink(
      'documentation',
      'https://cyclonedx.github.io/cdxgen/',
    )} for full options.
  `,
}

export const cmdManifestCdxgen = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = {
    __proto__: null,
    ...context,
  } as CliCommandContext
  const cli = meowOrExit({
    // Don't let meow take over --help for cdxgen.
    argv: argv.filter(a => !isHelpFlag(a)),
    config,
    importMeta,
    parentName,
  })

  const { dryRun } = cli.flags as { dryRun: boolean }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  // Filter Socket CLI flags from argv, but keep --help for cdxgen.
  const argsToForward = filterFlags(argv, { ...commonFlags, ...outputFlags }, [
    FLAG_HELP,
    '-h',
  ])

  process.exitCode = 1

  const result = await runCdxgen(argsToForward)
  const output = await result.spawnPromise

  // Update process exit code based on cdxgen result.
  if (typeof output.code === 'number') {
    process.exitCode = output.code
  }
}
