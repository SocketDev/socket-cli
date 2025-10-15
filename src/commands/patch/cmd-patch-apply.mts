import { existsSync } from 'node:fs'
import path from 'node:path'

import { arrayUnique } from '@socketsecurity/registry/lib/arrays'

import { handlePatchApply } from './handle-patch-apply.mts'
import constants, { DOT_SOCKET_DIR, MANIFEST_JSON } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { InputError } from '../../utils/error/errors.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { cmdFlagValueToArray } from '../../utils/process/cmd.mts'
import { getPurlObject } from '../../utils/purl/parse.mjs'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
  CliSubcommand,
} from '../../utils/cli/with-subcommands.mjs'
import type { PurlObject } from '../../utils/purl/parse.mjs'
import type { PackageURL } from '@socketregistry/packageurl-js'

export const CMD_NAME = 'apply'

const description = 'Apply CVE patches to dependencies'

export const cmdPatchApply: CliSubcommand = {
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
      purl: {
        type: 'string',
        default: [],
        description:
          'Specify purls to patch, as either a comma separated value or as multiple flags',
        isMultiple: true,
        shortFlag: 'p',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} --purl pkg:npm/lodash@4.17.21
      $ ${command} ./path/to/project --purl pkg:npm/lodash@4.17.21,pkg:npm/react@18.0.0
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

  const { dryRun, json, markdown } = cli.flags as unknown as {
    dryRun: boolean
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

  const { spinner } = constants

  const purlObjs = arrayUnique(cmdFlagValueToArray(cli.flags.purl))
    .map(p => getPurlObject(p, { throws: false }))
    .filter(Boolean) as Array<PurlObject<PackageURL>>

  await handlePatchApply({
    cwd,
    dryRun,
    outputKind,
    purlObjs,
    spinner,
  })
}
