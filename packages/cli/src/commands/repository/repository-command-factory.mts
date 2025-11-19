import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  DRY_RUN_BAILING_NOW,
  FLAG_JSON,
  FLAG_MARKDOWN,
} from '../../constants/cli.mts'
import { V1_MIGRATION_GUIDE_URL } from '../../constants/socket.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output/formatting.mts'
import { getOutputKind } from '../../utils/output/mode.mjs'
import { determineOrgSlug } from '../../utils/socket/org-slug.mjs'
import { hasDefaultApiToken } from '../../utils/socket/sdk.mjs'
import { webLink } from '../../utils/terminal/link.mts'
import { checkCommandInput } from '../../utils/validation/check-input.mts'

import type { MeowFlags } from '../../flags.mts'
import type { OutputKind } from '../../types.mjs'
import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

type RepositoryCommandSpec = {
  commandName: string
  description: string
  extraFlags?: MeowFlags
  handler: (params: {
    orgSlug: string
    repoName: string
    outputKind: OutputKind
    flags: Record<string, unknown>
  }) => Promise<void>
  helpDescription?: string
  helpExamples: string[]
  hidden?: boolean
  needsRepoName?: boolean
}

export function createRepositoryCommand(spec: RepositoryCommandSpec) {
  return {
    description: spec.description,
    hidden: spec.hidden ?? false,
    async run(
      argv: string[] | readonly string[],
      importMeta: ImportMeta,
      { parentName }: CliCommandContext,
    ): Promise<void> {
      const config: CliCommandConfig = {
        commandName: spec.commandName,
        description: spec.description,
        flags: {
          ...commonFlags,
          ...outputFlags,
          interactive: {
            default: true,
            description:
              'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
            type: 'boolean',
          },
          org: {
            description:
              'Force override the organization slug, overrides the default org from config',
            type: 'string',
          },
          ...(spec.extraFlags || {}),
        },
        help: (command, config) => `
    Usage
      $ ${command} [options]${spec.needsRepoName !== false ? ' <REPO>' : ''}

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${spec.commandName}`)}
${spec.helpDescription ? `\n    ${spec.helpDescription}\n` : ''}
    Options
      ${getFlagListOutput(config.flags)}

    Examples
${spec.helpExamples.map(ex => `      $ ${command} ${ex}`).join('\n')}
  `,
        hidden: spec.hidden ?? false,
      }

      const cli = meowOrExit({
        argv,
        config,
        importMeta,
        parentName,
      })

      const { json, markdown, org: orgFlag } = cli.flags

      const dryRun = !!cli.flags['dryRun']

      const interactive = !!cli.flags['interactive']

      const noLegacy = !cli.flags['repoName']

      const [repoName = ''] = cli.input

      const hasApiToken = hasDefaultApiToken()

      const { 0: orgSlug } = await determineOrgSlug(
        String(orgFlag || ''),
        interactive,
        dryRun,
      )

      const outputKind = getOutputKind(json, markdown)

      const validations = [
        {
          fail: 'received legacy flags',
          message: `Legacy flags are no longer supported. See the ${webLink(V1_MIGRATION_GUIDE_URL, 'v1 migration guide')}.`,
          nook: true,
          test: noLegacy,
        },
        {
          fail: 'missing',
          message: 'Org name by default setting, --org, or auto-discovered',
          nook: true,
          test: !!orgSlug,
        },
      ]

      if (spec.needsRepoName !== false) {
        validations.push({
          fail: 'missing',
          message: 'Repository name as first argument',
          nook: false,
          test: !!repoName,
        })
      }

      validations.push(
        {
          fail: 'bad',
          message: `The \`${FLAG_JSON}\` and \`${FLAG_MARKDOWN}\` flags can not be used at the same time`,
          nook: true,
          test: !json || !markdown,
        },
        {
          fail: 'try `socket login`',
          message: 'This command requires a Socket API token for access',
          nook: true,
          test: hasApiToken,
        },
      )

      const wasValidInput = checkCommandInput(outputKind, ...validations)
      if (!wasValidInput) {
        return
      }

      if (dryRun) {
        logger.log(DRY_RUN_BAILING_NOW)
        return
      }

      await spec.handler({
        flags: cli.flags,
        orgSlug,
        outputKind,
        repoName,
      })
    },
  }
}
