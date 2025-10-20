import { existsSync } from 'node:fs'
import path from 'node:path'

import { getSpinner } from '@socketsecurity/registry/constants/process'

import { handlePatchDiscover } from './handle-patch-discover.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { InputError } from '../../utils/error/errors.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
  CliSubcommand,
} from '../../utils/cli/with-subcommands.mjs'

export const CMD_NAME = 'discover'

const description = 'Discover available patches for installed dependencies'

export const cmdPatchDiscover: CliSubcommand = {
  description,
  hidden: false,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: CliCommandContext,
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    flags: {
      ...commonFlags,
      ...outputFlags,
      interactive: {
        type: 'boolean',
        default: false,
        shortFlag: 'i',
        description: 'Interactively download discovered patches',
      },
      scan: {
        type: 'string',
        shortFlag: 's',
        description: 'Discover patches from existing scan',
      },
    },
    hidden: false,
    help: (command, config) => `
    Usage
      $ ${command} [CWD=.]
      $ ${command} -s <scan-id>
      $ ${command} -i

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} ./path/to/project
      $ ${command} -s scan-abc123
      $ ${command} -i
      $ ${command} -s scan-abc123 -i
      $ ${command} --json
    `,
  }

  const cli = meowOrExit(
    {
      argv,
      config,
      parentName,
      importMeta,
    },
    { allowUnknownFlags: false },
  )

  const { interactive, json, markdown, scan } = cli.flags as unknown as {
    interactive: boolean
    json: boolean
    markdown: boolean
    scan?: string
  }

  const outputKind = getOutputKind(json, markdown)

  const wasValidInput = checkCommandInput(outputKind, {
    nook: true,
    test: !json || !markdown,
    message: 'The json and markdown flags cannot be both set, pick one',
    fail: 'omit one',
  })
  if (!wasValidInput) {
    return
  }

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  // Check if node_modules exists (only if not using --scan).
  if (!scan) {
    const nodeModulesPath = path.join(cwd, 'node_modules')
    if (!existsSync(nodeModulesPath)) {
      throw new InputError(
        'No node_modules directory found. Run npm/yarn/pnpm install first',
      )
    }
  }

  await handlePatchDiscover({
    cwd,
    interactive,
    outputKind,
    ...(scan ? { scanId: scan } : {}),
    spinner: getSpinner() ?? undefined,
  })
}
