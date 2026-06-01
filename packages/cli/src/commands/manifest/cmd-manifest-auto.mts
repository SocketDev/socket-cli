import path from 'node:path'

import { debugDirNs } from '@socketsecurity/lib-stable/debug/output'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { detectManifestActions } from './detect-manifest-actions.mts'
import { generateAutoManifest } from './generate_auto_manifest.mts'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { readOrDefaultSocketJson } from '../../util/socket/json.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

const logger = getDefaultLogger()

const config = {
  commandName: 'auto',
  description: 'Auto-detect build and attempt to generate manifest file',
  flags: defineFlags({
    ...commonFlags,
    verbose: {
      type: 'boolean',
      default: false,
      description:
        'Enable debug output (only for auto itself; sub-steps need to have it pre-configured), may help when running into errors',
    },
  }),
  help: (command: string, config: { flags: MeowFlags }) => `
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
  hidden: false,
}

export const cmdManifestAuto = {
  description: config.description,
  hidden: config.hidden,
  run,
}

export async function run(
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
  debugDirNs('inspect', { detected })

  if (dryRun) {
    if (detected.count > 0) {
      outputDryRunExecute(
        'manifest generators',
        [cwd],
        `auto-detect and generate ${detected.count} manifest file(s)`,
      )
    } else {
      logger.log('No manifest targets detected in the specified directory.')
    }
    return
  }

  if (!detected.count) {
    logger.fail(
      'Was unable to discover any targets for which we can generate manifest files…',
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
