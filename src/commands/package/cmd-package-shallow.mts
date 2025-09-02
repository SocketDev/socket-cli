import { logger } from '@socketsecurity/registry/lib/logger'

import { handlePurlsShallowScore } from './handle-purls-shallow-score.mts'
import { parsePackageSpecifiers } from './parse-package-specifiers.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'shallow'

const description =
  'Look up info regarding one or more packages but not their transitives'

const hidden = false

export const cmdPackageShallow = {
  description,
  hidden,
  alias: {
    shallowScore: {
      description,
      hidden: true,
      argv: [],
    },
  },
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
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] <<ECOSYSTEM> <PKGNAME> [<PKGNAME> ...] | <PURL> [<PURL> ...]>

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(config.flags)}

    Show scoring details for one or more packages purely based on their own package.
    This means that any dependency scores are not reflected by the score. You can
    use the \`socket package score <pkg>\` command to get its full transitive score.

    Only a few ecosystems are supported like npm, pypi, nuget, gem, golang, and maven.

    A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
    This command will automatically prepend "pkg:" when not present.

    If the first arg is an ecosystem, remaining args that are not a purl are
    assumed to be scoped to that ecosystem. The \`pkg:\` prefix is optional.

    Note: if a package cannot be found, it may be too old or perhaps was removed
          before we had the opportunity to process it.

    Examples
      $ ${command} npm webtorrent
      $ ${command} npm webtorrent@1.9.1
      $ ${command} npm/webtorrent@1.9.1
      $ ${command} pkg:npm/webtorrent@1.9.1
      $ ${command} maven webtorrent babel
      $ ${command} npm/webtorrent golang/babel
      $ ${command} npm npm/webtorrent@1.0.1 babel
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const { json, markdown } = cli.flags

  const dryRun = !!cli.flags['dryRun']

  const [ecosystem = '', ...pkgs] = cli.input

  const outputKind = getOutputKind(json, markdown)

  const { purls, valid } = parsePackageSpecifiers(ecosystem, pkgs)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: valid,
      message:
        'First parameter should be an ecosystem or all args must be purls',
      fail: 'bad',
    },
    {
      test: purls.length > 0,
      message: 'Expecting at least one package',
      fail: 'missing',
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
  )
  if (!wasValidInput) {
    return
  }

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handlePurlsShallowScore({
    outputKind,
    purls,
  })
}
