import { handlePurlsShallowScore } from './handle-purls-shallow-score.mts'
import { parsePackageSpecifiers } from './parse-package-specifiers.mts'
import { outputDryRunFetch } from '../../util/dry-run/output.mts'
import { defineFlags } from '../../meow.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../util/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../util/output/formatting.mts'
import { getOutputKind } from '../../util/output/mode.mjs'
import { checkCommandInput } from '../../util/validation/check-input.mts'

import type { CliCommandContext } from '../../util/cli/with-subcommands.mjs'
import type { MeowFlags } from '../../flags.mts'

export const CMD_NAME = 'shallow'

const description =
  'Look up info regarding one or more packages but not their transitives'

const hidden = false

export const cmdPackageShallow = {
  alias: {
    shallowScore: {
      description,
      hidden: true,
      argv: [],
    },
  },
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
      ...outputFlags,
    }),
    help: (command: string, helpConfig: { flags: MeowFlags }) => `
    Usage
      $ ${command} [options] <<ECOSYSTEM> <PKGNAME> [<PKGNAME> ...] | <PURL> [<PURL> ...]>

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Options
      ${getFlagListOutput(helpConfig.flags)}

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

  const dryRun = cli.flags['dryRun']

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
    outputDryRunFetch('package information', {
      packages: purls.length ? purls.join(', ') : '(none)',
      count: purls.length,
    })
    return
  }

  await handlePurlsShallowScore({
    outputKind,
    purls,
  })
}
