import fs from 'node:fs'
import path from 'node:path'

import meow from 'meow'

import { cmdManifestGradle } from './cmd-gradle.ts'
import { cmdManifestScala } from './cmd-scala.ts'
import { commonFlags } from '../../flags.ts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'auto',
  description: 'Auto-detect build and attempt to generate manifest file',
  hidden: false,
  flags: {
    ...commonFlags,
    verbose: {
      type: 'boolean',
      default: false,
      description: 'Enable debug output, may help when running into errors'
    }
    // TODO: support output flags
  },
  help: (parentName, config) => `
    Usage
      $ ${parentName} ${config.commandName}

    Tries to figure out what language your current repo uses. If it finds a
    supported case then it will try to generate the manifest file for that
    language with the default or detected settings.

    This command takes no arguments except --verbose.
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
  // Allow `--verbose` to pass through
  let verbose = false
  const args = argv.filter(arg => {
    if (arg === '--verbose') {
      verbose = true
      return false
    }
    return true
  })

  if (args.length) {
    meow(config.help(parentName, config), {
      argv: ['--help'],
      description: config.description,
      importMeta,
      flags: config.flags
    })
    return
  }

  const subArgs = []
  if (verbose) subArgs.push('--verbose', '1')

  const dir = '.'

  if (fs.existsSync(path.join(dir, 'build.sbt'))) {
    console.log(
      'Detected a Scala sbt build, running default Scala generator...'
    )
    subArgs.push(dir)
    await cmdManifestScala.run(subArgs, importMeta, { parentName })
    return
  }

  if (fs.existsSync(path.join(dir, 'gradlew'))) {
    console.log('Detected a gradle build, running default gradle generator...')
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
