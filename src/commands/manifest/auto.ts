import fs from 'node:fs'

import meow from 'meow'

import type { CliSubcommand } from '../../utils/meow-with-subcommands'
import { scala } from './scala.ts'

const description =
  'Auto-detect build and attempt to generate manifest file'

const help = (name: string) => `
  Usage
    $ ${name}

  Tries to figure out what language your current repo uses. If it finds a
  supported case then it will try to generate the manifest file for that
  language with the default or detected settings.

  This command takes no arguments except --verbose.
`

export const auto: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    // Allow `--verbose` to pass through
    let verbose = false;
    const args = argv.filter(arg => {
      if (arg === '--verbose') {
        verbose = true;
        return false;
      }
      return true;
    });

    const name = `${parentName} auto`
    if (args.length) {
      // note: meow will exit if it prints the --help screen
      meow(help(name), {
        argv: ['--help'],
        description,
        importMeta
      })
    }

    const subArgs = [];
    if (verbose) subArgs.push('--verbose', '1');
    const scalaDir = '.';
    if (fs.existsSync(scalaDir)) {
      console.log('Detected a Scala sbt build, running default Scala generator...')
      subArgs.push(scalaDir)
      await scala.run(subArgs, importMeta, {parentName})
      return;
    }

    // Show new help screen and exit
    meow(`
      $ ${name}

      Unfortunately this script did not discover a supported language in the
      current folder.

      - Make sure this script would work with your target build
      - Make sure to run it from the correct folder
      - Make sure the necessary build tools are available (\`PATH\`)

      If that doesn't work, see \`${name} <lang> --help\` for config details
    `, {
      argv: ['--help'],
      description,
      importMeta
    })
  }
}

