import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCdxgen } from './handle-cdxgen.mts'
import { commonFlags } from '../../flags.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const config: CliCommandConfig = {
  commandName: 'cdxgen',
  description: 'Create an SBOM with CycloneDX generator (cdxgen)',
  hidden: true,
  flags: {
    ...commonFlags,
  },
  help: (parentName, _config) => `
    Usage
      $ ${parentName}
  `,
}

export const cmdCdxgen = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  logger.warn(
    'Warning: The `socket cdxgen` command moved to `socket manifest cdxgen` and will be removed as a toplevel command in the next major bump.',
  )

  await handleCdxgen(argv, importMeta, { parentName })
}
