import { existsSync } from 'node:fs'
import path from 'node:path'

import { handlePatchGet } from './handle-patch-get.mts'
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

export const CMD_NAME = 'get'

const description = 'Download patch files to local directory'

export const cmdPatchGet: CliSubcommand = {
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
      output: {
        type: 'string',
        description: 'Output directory for patch files',
        shortFlag: 'o',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} <PURL> [CWD=.] [options]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command} pkg:npm/on-headers@1.0.2
      $ ${command} pkg:npm/lodash@4.17.21 ./path/to/project
      $ ${command} pkg:npm/react@18.0.0 --output ./patches
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

  const { json, markdown, output } = cli.flags as unknown as {
    json: boolean
    markdown: boolean
    output: string | undefined
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

  const [purl, cwdArg] = cli.input
  if (!purl) {
    throw new InputError('PURL is required')
  }

  let cwd = cwdArg || '.'
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

  await handlePatchGet({
    cwd,
    outputDir: output,
    outputKind,
    purl,
    spinner,
  })
}
