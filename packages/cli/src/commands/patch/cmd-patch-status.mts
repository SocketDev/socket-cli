import { existsSync } from 'node:fs'
import path from 'node:path'

import {
  DOT_SOCKET_DIR,
  MANIFEST_JSON,
} from '@socketsecurity/lib-internal/constants/paths'
import { getSpinner } from '@socketsecurity/lib-internal/constants/process'

import { handlePatchStatus } from './handle-patch-status.mts'
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

export const CMD_NAME = 'status'

const description = 'Show patch application status'

export const cmdPatchStatus: CliSubcommand = {
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
    hidden: false,
    flags: {
      ...commonFlags,
      ...outputFlags,
      applied: {
        type: 'boolean',
        default: false,
        description: 'Show only applied patches',
      },
      downloaded: {
        type: 'boolean',
        default: false,
        description: 'Show only downloaded patches',
      },
      failed: {
        type: 'boolean',
        default: false,
        description: 'Show only failed patches',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} ./path/to/project
      $ ${command} --applied
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

  const { applied, downloaded, failed, json, markdown } =
    cli.flags as unknown as {
      applied: boolean
      downloaded: boolean
      failed: boolean
      json: boolean
      markdown: boolean
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

  const dotSocketDirPath = path.join(cwd, DOT_SOCKET_DIR)
  if (!existsSync(dotSocketDirPath)) {
    throw new InputError(
      `No ${DOT_SOCKET_DIR} directory found in current directory`,
    )
  }

  const manifestPath = path.join(dotSocketDirPath, MANIFEST_JSON)
  if (!existsSync(manifestPath)) {
    throw new InputError(
      `No ${MANIFEST_JSON} found in ${DOT_SOCKET_DIR} directory`,
    )
  }

  const spinner = getSpinner()

  await handlePatchStatus({
    cwd,
    filters: {
      applied,
      downloaded,
      failed,
    },
    outputKind,
    spinner,
  })
}
