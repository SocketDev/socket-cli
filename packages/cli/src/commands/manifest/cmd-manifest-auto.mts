import path from 'node:path'

import { debugDir } from '@socketsecurity/lib/debug'
import { logger } from '@socketsecurity/lib/logger'

import { detectManifestActions } from './detect-manifest-actions.mts'
import { generateAutoManifest } from './generate_auto_manifest.mts'
import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mjs'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { readOrDefaultSocketJson } from '../../utils/socket/json.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const config: CliCommandConfig = {
  commandName: 'auto',
  description: 'Auto-detect build and attempt to generate manifest file',
  hidden: false,
  flags: {
    ...commonFlags,
    verbose: {
      type: 'boolean',
      default: false,
      description:
        'Enable debug output (only for auto itself; sub-steps need to have it pre-configured), may help when running into errors',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    Options
      ${getFlagListOutput(config.flags)}

    Tries to figure out what language your target repo uses. If it finds a
    supported case then it will try to generate the manifest file for that
    language with the default or detected settings.

    Note: you can exclude languages from being auto-generated if you don't want
          them to. Run \`socket manifest setup\` in the same dir to disable it.

    Examples

      $ ${command}
      $ ${command} ./project/foo
  `,
}

export const cmdManifestAuto = {
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
  // Feature request: Pass outputKind to manifest generators for json/md output support.
  const { json, markdown, verbose: verboseFlag } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const verbose = !!verboseFlag

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const outputKind = getOutputKind(json, markdown)

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.log('- cwd:', cwd)
    logger.groupEnd()
  }

  const sockJson = readOrDefaultSocketJson(cwd)

  const detected = await detectManifestActions(sockJson, cwd)
  debugDir('inspect', { detected })

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  if (!detected.count) {
    logger.fail(
      'Was unable to discover any targets for which we can generate manifest files...',
    )
    logger.log('')
    logger.log(
      '- Make sure this script would work with your target build (see `socket manifest --help` for your target).',
    )
    logger.log(
      '- Make sure to run it from the correct dir (use --cwd to target another dir)',
    )
    logger.log('- Make sure the necessary build tools are available (`PATH`)')
    process.exitCode = 1
    return
  }

  await generateAutoManifest({
    detected,
    cwd,
    outputKind,
    verbose,
  })

  logger.success(
    `Finished. Should have attempted to generate manifest files for ${detected.count} targets.`,
  )
}
