import path from 'node:path'

import { handleDoctor } from './handle-doctor.mts'
import { CMD_NAME as CMD_NAME_FULL } from './shared.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import { outputDryRunPreview } from '../../util/dry-run/output.mts'
import { detectAndValidatePackageEnvironment } from '../../util/ecosystem/environment.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

export const CMD_NAME = 'doctor'

const description = 'Enforce dependency health policies (soak-time and more)'

const hidden = false

export const cmdDoctor = {
  description,
  hidden,
  run,
}

export async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: defineFlags({
      ...commonFlags,
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(helpConfig.flags)}

    Examples
      $ ${command}
      $ ${command} ./path/to/project
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = cli.flags['dryRun']

  const { json, markdown } = cli.flags

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  const outputKind = getOutputKind(json, markdown)

  if (dryRun) {
    const pkgEnvCResult = await detectAndValidatePackageEnvironment(cwd, {
      cmdName: CMD_NAME_FULL,
    })
    outputDryRunPreview({
      summary: 'Enforce dependency health policies',
      actions: [
        {
          type: pkgEnvCResult.ok ? 'modify' : 'fetch',
          description: pkgEnvCResult.ok
            ? `Enforce soak-time in ${pkgEnvCResult.data.pkgPath}`
            : 'Detect package environment',
          target: cwd,
        },
      ],
      wouldSucceed: pkgEnvCResult.ok,
    })
    return
  }

  await handleDoctor({ cwd, outputKind })
}
