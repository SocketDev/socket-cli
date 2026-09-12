import { writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { generateSdxgenManifest } from '../../core/sdxgen/generate.mts'
import { commonFlags } from '../../flags.mts'
import { defineFlags } from '../../meow.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mts'
import { getFlagListOutput } from '../../util/output/formatting.mts'
import { outputDryRunExecute } from '../../util/dry-run/output.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mts'

const logger = getDefaultLogger()

const config = {
  commandName: 'sdxgen',
  description: 'Generate a CycloneDX manifest with the bundled sdxgen parsers',
  flags: defineFlags({
    ...commonFlags,
    executeTools: {
      type: 'boolean',
      default: false,
      description: 'Allow project build tools to execute',
    },
    recursive: {
      type: 'boolean',
      default: false,
      description: 'Include workspace projects',
    },
    out: {
      type: 'string',
      default: '',
      description: 'Write JSON to this path instead of stdout',
    },
  }),
  help: (command: string) =>
    `${command} [directory]\n${getFlagListOutput(config.flags)}`,
  hidden: false,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const cli = meowOrExit({ argv, config, importMeta, parentName })
  const projectPath = path.resolve(cli.input[0] ?? '.')
  if (cli.flags.dryRun) {
    outputDryRunExecute(
      'sdxgen',
      argv,
      `generate a manifest for ${projectPath}`,
    )
    return
  }
  const result = await generateSdxgenManifest(projectPath, {
    executeTools: cli.flags.executeTools,
    recursive: cli.flags.recursive,
  })
  const json = JSON.stringify(result, undefined, 2)
  if (cli.flags.out) {
    await writeFile(path.resolve(cli.flags.out), json, 'utf8')
  } else {
    logger.log(json)
  }
}

export const cmdManifestSdxgen = {
  description: config.description,
  hidden: false,
  run,
}
