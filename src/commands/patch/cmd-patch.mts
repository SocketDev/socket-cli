import { existsSync } from 'node:fs'
import path from 'node:path'

import { arrayUnique } from '@socketsecurity/registry/lib/arrays'

import { handlePatch } from './handle-patch.mts'
import constants, { DOT_SOCKET, MANIFEST_JSON } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { cmdFlagValueToArray } from '../../utils/cmd.mts'
import { InputError } from '../../utils/errors.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { getPurlObject } from '../../utils/purl.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'
import type { PurlObject } from '../../utils/purl.mts'
import type { PackageURL } from '@socketregistry/packageurl-js'

export const CMD_NAME = 'patch'

const description = 'Apply CVE patches to dependencies'

const hidden = true

export const cmdPatch = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string },
): Promise<void> {
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
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
      $ ${command} --package lodash
      $ ${command} ./proj/tree --package lodash,react
    `,
  }

  const cli = meowOrExit({
    allowUnknownFlags: false,
    argv,
    config,
    importMeta,
    parentName,
  })

  const { dryRun, json, markdown } = cli.flags as {
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

  const dotSocketDirPath = path.join(cwd, DOT_SOCKET)
  if (!existsSync(dotSocketDirPath)) {
    throw new InputError(
      `No ${DOT_SOCKET} directory found in current directory`,
    )
  }

  const manifestPath = path.join(dotSocketDirPath, MANIFEST_JSON)
  if (!existsSync(manifestPath)) {
    throw new InputError(`No ${MANIFEST_JSON} found in ${DOT_SOCKET} directory`)
  }

  const { spinner } = constants

  const purlObjs = arrayUnique(cmdFlagValueToArray(cli.flags['purl']))
    .map(p => getPurlObject(p, { throws: false }))
    .filter(Boolean) as Array<PurlObject<PackageURL>>

  await handlePatch({
    cwd,
    dryRun,
    outputKind,
    purlObjs,
    spinner,
  })
}
