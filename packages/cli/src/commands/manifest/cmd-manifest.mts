import { cmdManifestAuto } from './cmd-manifest-auto.mts'
import { cmdManifestCdxgen } from './cmd-manifest-cdxgen.mts'
import { cmdManifestConda } from './cmd-manifest-conda.mts'
import { cmdManifestGradle } from './cmd-manifest-gradle.mts'
import { cmdManifestKotlin } from './cmd-manifest-kotlin.mts'
import { cmdManifestScala } from './cmd-manifest-scala.mts'
import { cmdManifestSetup } from './cmd-manifest-setup.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowWithSubcommands } from '../../utils/cli/with-subcommands.mjs'

import type { CliCommandContext } from '../../utils/cli/with-subcommands.mjs'

// meowWithSubcommands renders its own help text from the subcommand list,
// so this command-level config doesn't need a help builder.
const config = {
  commandName: 'manifest',
  description: 'Generate a dependency manifest for certain ecosystems',
  hidden: false,
  flags: defineFlags({
    ...commonFlags,
  }),
}

export const cmdManifest = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  await meowWithSubcommands(
    {
      argv,
      name: `${parentName} ${config.commandName}`,
      importMeta,
      subcommands: {
        auto: cmdManifestAuto,
        cdxgen: cmdManifestCdxgen,
        conda: cmdManifestConda,
        gradle: cmdManifestGradle,
        kotlin: cmdManifestKotlin,
        scala: cmdManifestScala,
        setup: cmdManifestSetup,
      },
    },
    {
      aliases: {
        yolo: {
          description: config.description,
          hidden: true,
          argv: ['auto'],
        },
      },
      description: config.description,
      flags: config.flags,
    },
  )
}
