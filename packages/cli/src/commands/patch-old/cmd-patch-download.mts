import { existsSync } from 'node:fs'
import path from 'node:path'

import { DOT_SOCKET_DIR } from '@socketsecurity/lib/paths/dirnames'
import { getDefaultSpinner } from '@socketsecurity/lib/spinner'

import { handlePatchDownload } from './handle-patch-download.mts'
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

export const CMD_NAME = 'download'

const description = 'Download patches from Socket API'

export const cmdPatchDownload: CliSubcommand = {
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
      scan: {
        type: 'string',
        description: 'Download patches from scan results',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} <uuid...>
      $ ${command} --scan <scan-id>

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} 550e8400-e29b-41d4-a716-446655440000
      $ ${command} uuid1 uuid2 uuid3
      $ ${command} --scan scan-abc123
      $ ${command} --scan scan-abc123 --json
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

  const { json, markdown, scan } = cli.flags as unknown as {
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

  let uuids: string[] = []
  let cwd: string

  if (scan) {
    // When using --scan, we can use current directory
    cwd = process.cwd()
  } else {
    if (cli.input.length === 0) {
      throw new InputError('Must provide patch UUIDs or use --scan flag')
    }

    // First arg might be cwd if it's a directory
    const firstArg = cli.input[0]
    if (
      firstArg &&
      !firstArg.match(/^[0-9a-f-]{36}$/i) &&
      existsSync(firstArg)
    ) {
      cwd = firstArg
      uuids = cli.input.slice(1) as string[]
    } else {
      cwd = process.cwd()
      uuids = cli.input.slice() as string[]
    }
  }

  cwd = path.resolve(cwd)

  // Create .socket directory if it doesn't exist.
  const dotSocketDirPath = path.join(cwd, DOT_SOCKET_DIR)
  if (!existsSync(dotSocketDirPath)) {
    throw new InputError(
      `No ${DOT_SOCKET_DIR} directory found. Run 'socket scan create' first.`,
    )
  }

  const spinner = getDefaultSpinner()

  await handlePatchDownload({
    cwd,
    outputKind,
    ...(scan ? { scanId: scan } : {}),
    spinner,
    uuids,
  })
}
