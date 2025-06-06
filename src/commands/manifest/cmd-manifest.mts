import { cmdManifestAuto } from './cmd-manifest-auto.mts'
import { cmdManifestCdxgen } from './cmd-manifest-cdxgen.mts'
import { cmdManifestConda } from './cmd-manifest-conda.mts'
import { cmdManifestGradle } from './cmd-manifest-gradle.mts'
import { cmdManifestKotlin } from './cmd-manifest-kotlin.mts'
import { cmdManifestScala } from './cmd-manifest-scala.mts'
import { cmdManifestSetup } from './cmd-manifest-setup.mts'
import { commonFlags } from '../../flags.mts'
import { meowWithSubcommands } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'manifest',
  description: 'Generate a dependency manifest for given file or dir',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: (command, config) => `
    Usage
      $ ${command} [options] <LANGUAGE> <TARGET>

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

      $ ${command} auto
  `,
}

export const cmdManifest = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  await meowWithSubcommands(
    {
      auto: cmdManifestAuto,
      cdxgen: cmdManifestCdxgen,
      conda: cmdManifestConda,
      gradle: cmdManifestGradle,
      kotlin: cmdManifestKotlin,
      scala: cmdManifestScala,
      setup: cmdManifestSetup,
    },
    {
      argv,
      aliases: {
        yolo: {
          description: config.description,
          hidden: true,
          argv: ['auto'],
        },
      },
      description: config.description,
      importMeta,
      flags: config.flags,
      name: `${parentName} ${config.commandName}`,
    },
  )
}
