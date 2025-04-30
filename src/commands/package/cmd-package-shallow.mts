import { logger } from '@socketsecurity/registry/lib/logger'

import { handlePurlsShallowScore } from './handle-purls-shallow-score.mts'
import { parsePackageSpecifiers } from './parse-package-specifiers.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output-formatting.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

const { DRY_RUN_BAILING_NOW } = constants

const config: CliCommandConfig = {
  commandName: 'shallow',
  description:
    '[beta] Look up info regarding one or more packages but not their transitives',
  hidden: false,
  flags: {
    ...commonFlags,
    ...outputFlags
  },
  help: (command, config) => `
    Usage
      $ ${command} <<ecosystem> <name> [<name> ...] | <purl> [<purl> ...]>

    API Token Requirements
      - Quota: 100 units
      - Permissions: packages:list

    Options
      ${getFlagListOutput(config.flags, 6)}

    Show scoring details for one or more packages purely based on their own package.
    This means that any dependency scores are not reflected by the score. You can
    use the \`socket package score <pkg>\` command to get its full transitive score.

    Only a few ecosystems are supported like npm, golang, and maven.

    A "purl" is a standard package name formatting: \`pkg:eco/name@version\`
    This command will automatically prepend "pkg:" when not present.

    If the first arg is an ecosystem, remaining args that are not a purl are
    assumed to be scoped to that ecosystem.

    Examples
      $ ${command} npm webtorrent
      $ ${command} npm webtorrent@1.9.1
      $ ${command} npm/webtorrent@1.9.1
      $ ${command} pkg:npm/webtorrent@1.9.1
      $ ${command} maven webtorrent babel
      $ ${command} npm/webtorrent golang/babel
      $ ${command} npm npm/webtorrent@1.0.1 babel
  `
}

export const cmdPackageShallow = {
  description: config.description,
  hidden: config.hidden,
  alias: {
    shallowScore: {
      description: config.description,
      hidden: true,
      argv: []
    }
  },
  run
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  { parentName }: { parentName: string }
): Promise<void> {
  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName
  })

  const { json, markdown } = cli.flags
  const outputKind = getOutputKind(json, markdown)

  const [ecosystem = '', ...pkgs] = cli.input

  const { purls, valid } = parsePackageSpecifiers(ecosystem, pkgs)

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      test: valid,
      message:
        'First parameter should be an ecosystem or all args must be purls',
      pass: 'ok',
      fail: 'bad'
    },
    {
      test: purls.length > 0,
      message: 'Expecting at least one package',
      pass: 'ok',
      fail: 'missing'
    },
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      pass: 'ok',
      fail: 'omit one'
    }
  )
  if (!wasValidInput) {
    return
  }

  if (cli.flags['dryRun']) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  await handlePurlsShallowScore({
    outputKind,
    purls
  })
}
