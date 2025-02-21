import fs from 'node:fs'
import path from 'node:path'

import meow from 'meow'

import { cmdManifestGradle } from './cmd-manifest-gradle.ts'
import { cmdManifestScala } from './cmd-manifest-scala.ts'
import { commonFlags } from '../../flags.ts'
import { getFlagListOutput } from '../../utils/output-formatting.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

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
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meow(config.help(parentName, config), {
    argv,
    description: config.description,
    importMeta,
    flags: config.flags,
    allowUnknownFlags: false
  })

  const verbose = cli.flags['verbose'] ?? false
  const cwd = String(cli.flags['cwd']) || false
  if (verbose) {
    console.group('- ', parentName, config.commandName, ':')
    console.group('- flags:', cli.flags)
    console.groupEnd()
    console.log('- input:', cli.input)
    console.log('- cwd:', cwd || process.cwd())
    console.groupEnd()
  }

  const subArgs = []
  if (verbose) subArgs.push('--verbose')

  const dir = cwd || '.'

  if (fs.existsSync(path.join(dir, 'build.sbt'))) {
    console.log(
      'Detected a Scala sbt build, running default Scala generator...'
    )
    if (cwd) subArgs.push('--cwd', cwd)
    subArgs.push(dir)
    await cmdManifestScala.run(subArgs, importMeta, { parentName })
    return
  }

  if (fs.existsSync(path.join(dir, 'gradlew'))) {
    console.log('Detected a gradle build, running default gradle generator...')
    if (cwd) subArgs.push(cwd) // This command takes the cwd as first arg
    await cmdManifestGradle.run(subArgs, importMeta, { parentName })
    return
  }

  // Show new help screen and exit
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
