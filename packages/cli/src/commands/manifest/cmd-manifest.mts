import { cmdManifestAuto } from './cmd-manifest-auto.mts'
import { cmdManifestCdxgen } from './cmd-manifest-cdxgen.mts'
import { cmdManifestConda } from './cmd-manifest-conda.mts'
import { cmdManifestGradle } from './cmd-manifest-gradle.mts'
import { cmdManifestKotlin } from './cmd-manifest-kotlin.mts'
import { cmdManifestScala } from './cmd-manifest-scala.mts'
import { cmdManifestSetup } from './cmd-manifest-setup.mts'
import { defineSubcommandGroup } from '../../util/cli/define-subcommand-group.mts'

const description = 'Generate a dependency manifest for certain ecosystems'

export const cmdManifest = defineSubcommandGroup({
  name: 'manifest',
  description,
  hidden: false,
  passCommonFlags: true,
  subcommands: {
    auto: cmdManifestAuto,
    cdxgen: cmdManifestCdxgen,
    conda: cmdManifestConda,
    gradle: cmdManifestGradle,
    kotlin: cmdManifestKotlin,
    scala: cmdManifestScala,
    setup: cmdManifestSetup,
  },
  aliases: {
    yolo: {
      description,
      hidden: true,
      argv: ['auto'],
    },
  },
})
