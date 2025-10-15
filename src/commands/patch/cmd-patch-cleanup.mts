import { existsSync } from 'node:fs'
import path from 'node:path'

import { handlePatchCleanup } from './handle-patch-cleanup.mts'
import constants, { DOT_SOCKET_DIR, MANIFEST_JSON } from '../../constants.mts'
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

export const CMD_NAME = 'cleanup'

const description = 'Clean up orphaned patch backups'

export const cmdPatchCleanup: CliSubcommand = {
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
      all: {
        type: 'boolean',
        default: false,
        description: 'Clean up all backups, including those in manifest',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [UUID] [CWD=.] [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --all
      $ ${command} abc123-def456-789
      $ ${command} ./path/to/project
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

  const { all, json, markdown } = cli.flags as unknown as {
    all: boolean
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

  const [uuidOrCwd, cwdArg] = cli.input
  let uuid: string | undefined
  let cwd: string

  // Determine if first argument is UUID or CWD.
  if (uuidOrCwd && existsSync(uuidOrCwd)) {
    // First argument is a directory path.
    cwd = uuidOrCwd
  } else if (uuidOrCwd) {
    // First argument is a UUID.
    uuid = uuidOrCwd
    cwd = cwdArg || '.'
  } else {
    cwd = '.'
  }

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

  const { spinner } = constants

  await handlePatchCleanup({
    all,
    cwd,
    outputKind,
    spinner,
    uuid,
  })
}
