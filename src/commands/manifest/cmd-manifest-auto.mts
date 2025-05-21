import path from 'node:path'

import meow from 'meow'

import { debugLog } from '@socketsecurity/registry/lib/debug'
import { logger } from '@socketsecurity/registry/lib/logger'

import { convertGradleToMaven } from './convert_gradle_to_maven.mts'
import { convertSbtToMaven } from './convert_sbt_to_maven.mts'
import { detectManifestActions } from './detect-manifest-actions.mts'
import { handleManifestConda } from './handle-manifest-conda.mts'
import constants from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'auto',
  description: 'Auto-detect build and attempt to generate manifest file',
  hidden: false,
  flags: {
    ...commonFlags,
    cwd: {
      type: 'string',
      description: 'Set the cwd, defaults to process.cwd()',
    },
    verbose: {
      type: 'boolean',
      default: false,
      description: 'Enable debug output, may help when running into errors',
    },
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Tries to figure out what language your current repo uses. If it finds a
    supported case then it will try to generate the manifest file for that
    language with the default or detected settings.
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
  { parentName }: { parentName: string },
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })
  const { cwd: cwdFlag, json, markdown, verbose: verboseFlag } = cli.flags
  const outputKind = getOutputKind(json, markdown) // TODO: impl json/md further
  const cwd = String(cwdFlag || process.cwd())
  const verbose = !!verboseFlag

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.log('- cwd:', cwd)
    logger.groupEnd()
  }

  // Both ways work (with and without `=`)
  // const tmp = meow('', {argv: '--bin x --foo=y'.split(' '), allowUnknownFlags:true, importMeta})
  // console.log('--->', tmp.input, tmp.flags);

  const result = await detectManifestActions(String(cwd))
  debugLog(result)

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  const found = Object.values(result).reduce(
    (sum, now) => (now ? sum + 1 : sum),
    0,
  )

  if (!found) {
    logger.fail(
      ' Was unable to discover any targets for which we can generate manifest files...',
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

  if (result.sbt) {
    logger.log('Detected a Scala sbt build, generating pom files with sbt...')
    await convertSbtToMaven(cwd, 'sbt', './socket.sbt.pom.xml', verbose, [])
  }

  if (result.gradle) {
    logger.log(
      'Detected a gradle build (Gradle, Kotlin, Scala), running default gradle generator...',
    )
    await convertGradleToMaven(cwd, path.join(cwd, 'gradlew'), cwd, verbose, [])
  }

  if (result.conda) {
    logger.log(
      'Detected an environment.yml file, running default Conda generator...',
    )
    await handleManifestConda(cwd, '', outputKind, cwd, verbose)
  }

  logger.success(
    `Finished. Should have attempted to generate manifest files for ${found} targets.`,
  )
}
