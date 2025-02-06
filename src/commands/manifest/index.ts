import meow from 'meow'

import { scala } from './scala'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'


import type { CliSubcommand } from '../../utils/meow-with-subcommands'

const description =
  'Generate a "Software Bill of Materials" for given file or dir'
const help = (name: string) => `
  Usage

    $ ${name} <language> <target>

  Generates a declarative dependency manifest (like a package.json for Node.JS
  or requirements.txt for PyPi), but for certain supported ecosystems
  where it's common to use a dynamic manifest, like Scala's sbt.

  Only certain languages are supported and there may be language specific
  configurations available. See \`manifest <language> --help\` for usage details
  per language.

  Currently supported language: scala

  Examples

    $ ${name} scala .
`

export const manifest: CliSubcommand = {
  description,
  async run(argv, importMeta, { parentName }) {
    const name = `${parentName} manifest`

    // Note: this won't catch `socket manifest -xyz --help` sort of cases which
    //       would fallback to the default meow help behavior. That's fine.
    if (argv.length === 0 || argv[0] === '--help') {
      meow(help(name), {
        argv: ['--help'] as const, // meow will exit() when --help is passed
        description,
        importMeta
      })
    }

    await meowWithSubcommands(
      {
        scala
      },
      {
        argv,
        description,
        importMeta,
        name
      }
    )
  }
}
