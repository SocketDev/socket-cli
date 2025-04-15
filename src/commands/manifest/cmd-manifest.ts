import { cmdManifestAuto } from './cmd-manifest-auto'
import { cmdManifestConda } from './cmd-manifest-conda'
import { cmdManifestGradle } from './cmd-manifest-gradle'
import { cmdManifestKotlin } from './cmd-manifest-kotlin'
import { cmdManifestScala } from './cmd-manifest-scala'
import { commonFlags } from '../../flags'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands'
import { getFlagListOutput } from '../../utils/output-formatting'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands'

const config: CliCommandConfig = {
  commandName: 'manifest',
  description: 'Generate a dependency manifest for given file or dir',
  hidden: false,
  flags: {
    ...commonFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <language> <target>

    Options
      ${getFlagListOutput(config.flags, 6)}

    Generates a declarative dependency manifest (like a package.json for Node.JS
    or requirements.txt for PyPi), but for certain supported ecosystems
    where it's common to use a dynamic manifest, like Scala's sbt.

    Only certain languages are supported and there may be language specific
    configurations available. See \`manifest <language> --help\` for usage details
    per language.

    Currently supported language: scala [beta], gradle [beta], kotlin (through
    gradle) [beta].

    Examples

      $ ${command} scala .

    To have it auto-detect and attempt to run:

      $ ${command} yolo
  `
}

export const cmdManifest = {
  description: config.description,
  hidden: config.hidden,
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  await meowWithSubcommands(
    {
      auto: cmdManifestAuto,
      conda: cmdManifestConda,
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
