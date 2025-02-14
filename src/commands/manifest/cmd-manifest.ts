import { cmdManifestAuto } from './cmd-auto.ts'
import { cmdManifestGradle } from './cmd-gradle.ts'
import { cmdManifestKotlin } from './cmd-kotlin.ts'
import { cmdManifestScala } from './cmd-scala.ts'
import { commonFlags } from '../../flags.ts'
import {
  type CliCommandConfig,
  meowWithSubcommands
} from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'manifest',
  description: 'Generate a dependency manifest for given file or dir',
  hidden: false,
  flags: {
    ...commonFlags
  },
  help: (parentName, config) => `
    Usage

      $ ${parentName} ${config.commandName} <language> <target>

    Generates a declarative dependency manifest (like a package.json for Node.JS
    or requirements.txt for PyPi), but for certain supported ecosystems
    where it's common to use a dynamic manifest, like Scala's sbt.

    Only certain languages are supported and there may be language specific
    configurations available. See \`manifest <language> --help\` for usage details
    per language.

    Currently supported language: scala, gradle

    Examples

      $ ${parentName} ${config.commandName} scala .

    To have it auto-detect and attempt to run:

      $ ${parentName} ${config.commandName} yolo
  `
}

export const cmdManifest = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  await meowWithSubcommands(
    {
      auto: cmdManifestAuto,
      scala: cmdManifestScala,
      gradle: cmdManifestGradle,
      kotlin: cmdManifestKotlin
    },
    {
      argv,
      aliases: {
        yolo: {
          description: config.description,
          hidden: true,
          argv: ['auto']
        }
      },
      description: config.description,
      importMeta,
      flags: config.flags,
      name: `${parentName} ${config.commandName}`
    }
  )
}
