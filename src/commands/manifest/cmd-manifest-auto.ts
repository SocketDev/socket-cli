import { existsSync } from 'node:fs'
import path from 'node:path'

import meow from 'meow'

import { logger } from '@socketsecurity/registry/lib/logger'

import { cmdManifestConda } from './cmd-manifest-conda'
import { cmdManifestGradle } from './cmd-manifest-gradle'
import { cmdManifestScala } from './cmd-manifest-scala'
import constants from '../../constants'
import { commonFlags } from '../../flags'
import { meowOrExit } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const { DRY_RUN_BAIL_TEXT } = constants

const config: CliCommandConfig = {
  commandName: 'auto',
  description: 'Auto-detect build and attempt to generate manifest file',
  hidden: false,
  flags: {
    ...commonFlags,
    cwd: {
      type: 'string',
      description: 'Set the cwd, defaults to process.cwd()'
    },
    verbose: {
      type: 'boolean',
      default: false,
      description: 'Enable debug output, may help when running into errors'
    }
    // TODO: support output flags
  },
  help: (command, config) => `
    Usage
      $ ${command}

    Options
      ${getFlagListOutput(config.flags, 6)}

    Tries to figure out what language your current repo uses. If it finds a
    supported case then it will try to generate the manifest file for that
    language with the default or detected settings.
  `
}

export const cmdManifestAuto = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })
  const verbose = !!cli.flags['verbose']
  const cwd = (cli.flags['cwd'] as string) ?? process.cwd()

  if (verbose) {
    logger.group('- ', parentName, config.commandName, ':')
    logger.group('- flags:', cli.flags)
    logger.groupEnd()
    logger.log('- input:', cli.input)
    logger.log('- cwd:', cwd)
    logger.groupEnd()
  }

  const subArgs = []
  if (verbose) {
    subArgs.push('--verbose')
  }

  const dir = cwd

  if (existsSync(path.join(dir, 'build.sbt'))) {
    logger.log('Detected a Scala sbt build, running default Scala generator...')
    if (cwd) {
      subArgs.push('--cwd', cwd)
    }
    subArgs.push(dir)
    if (cli.flags['dryRun']) {
      logger.log(DRY_RUN_BAIL_TEXT)
      return
    }
    await cmdManifestScala.run(subArgs, importMeta, { parentName })
    return
  }

  if (existsSync(path.join(dir, 'gradlew'))) {
    logger.log('Detected a gradle build, running default gradle generator...')
    if (cwd) {
      // This command takes the cwd as first arg.
      subArgs.push(cwd)
    }
    if (cli.flags['dryRun']) {
      logger.log(DRY_RUN_BAIL_TEXT)
      return
    }
    await cmdManifestGradle.run(subArgs, importMeta, { parentName })
    return
  }

  const envyml = path.join(dir, 'environment.yml')
  const hasEnvyml = existsSync(envyml)
  const envyaml = path.join(dir, 'environment.yaml')
  const hasEnvyaml = !hasEnvyml && existsSync(envyaml)
  if (hasEnvyml || hasEnvyaml) {
    logger.log(
      'Detected an environment.yml file, running default Conda generator...'
    )
    // This command takes the TARGET as first arg.
    subArgs.push(hasEnvyml ? envyml : hasEnvyaml ? envyaml : '')
    if (cli.flags['dryRun']) {
      logger.log(DRY_RUN_BAIL_TEXT)
      return
    }
    await cmdManifestConda.run(subArgs, importMeta, { parentName })
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAIL_TEXT)
    return
  }

  // Show new help screen and exit.
  meow(
    `
    $ ${parentName} ${config.commandName}

    Unfortunately this script did not discover a supported language in the
    current folder.

    - Make sure this script would work with your target build
    - Make sure to run it from the correct folder
    - Make sure the necessary build tools are available (\`PATH\`)

    If that doesn't work, see \`${parentName} <lang> --help\` for config details for
    your target language.
  `,
    {
      argv: [],
      description: config.description,
      importMeta
    }
  ).showHelp()
}
