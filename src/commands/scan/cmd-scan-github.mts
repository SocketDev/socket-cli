import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import { handleCreateGithubScan } from './handle-create-github-scan.mts'
import { outputScanGithub } from './output-scan-github.mts'
import { suggestOrgSlug } from './suggest-org-slug.mts'
import constants from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { checkCommandInput } from '../../utils/check-input.mts'
import { determineOrgSlug } from '../../utils/determine-org-slug.mts'
import { getOutputKind } from '../../utils/get-output-kind.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import {
  getFlagApiRequirementsOutput,
  getFlagListOutput,
} from '../../utils/output-formatting.mts'
import { hasDefaultApiToken } from '../../utils/sdk.mts'
import { readOrDefaultSocketJson } from '../../utils/socket-json.mts'

import type { CliCommandConfig } from '../../utils/meow-with-subcommands.mts'

export const CMD_NAME = 'github'

const DEFAULT_GITHUB_URL = 'https://api.github.com'

const description = 'Create a scan for given GitHub repo'

const hidden = true

export const cmdScanGithub = {
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
      all: {
        type: 'boolean',
        description:
          'Apply for all known repositories reported by the Socket API. Supersedes `repos`.',
      },
      githubToken: {
        type: 'string',
        description:
          'Required GitHub token for authentication.\nMay set environment variable GITHUB_TOKEN or SOCKET_CLI_GITHUB_TOKEN instead.',
      },
      githubApiUrl: {
        type: 'string',
        description: `Base URL of the GitHub API (default: ${DEFAULT_GITHUB_URL})`,
      },
      interactive: {
        type: 'boolean',
        default: true,
        description:
          'Allow for interactive elements, asking for input. Use --no-interactive to prevent any input questions, defaulting them to cancel/no.',
      },
      org: {
        type: 'string',
        description:
          'Force override the organization slug, overrides the default org from config',
      },
      orgGithub: {
        type: 'string',
        description:
          'Alternate GitHub Org if the name is different than the Socket Org',
      },
      repos: {
        type: 'string',
        description:
          'List of repos to target in a comma-separated format (e.g., repo1,repo2). If not specified, the script will pull the list from Socket and ask you to pick one. Use --all to use them all.',
      },
    },
    help: (command, config) => `
    Usage
      $ ${command} [options] [CWD=.]

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    This is similar to the \`socket scan create\` command except it pulls the files
    from GitHub. See the help for that command for more details.

    A GitHub Personal Access Token (PAT) will at least need read access to the repo
    ("contents", read-only) for this command to work.

    Note: This command cannot run the \`socket manifest auto\` things because that
    requires local access to the repo while this command runs entirely through the
    GitHub for file access.

    You can use \`socket scan setup\` to configure certain repo flag defaults.

    Options
      ${getFlagListOutput(config.flags)}

    Examples
      $ ${command}
      $ ${command} ./proj
  `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const {
    githubToken = constants.ENV.SOCKET_CLI_GITHUB_TOKEN,
    interactive = true,
    json,
    markdown,
    org: orgFlag,
  } = cli.flags as {
    githubToken: string
    interactive: boolean
    json: boolean
    markdown: boolean
    org: string
    orgGithub: string
  }

  const dryRun = !!cli.flags['dryRun']

  let { all, githubApiUrl, orgGithub, repos } = cli.flags as {
    all: boolean
    githubApiUrl: string
    orgGithub: string
    repos: string
  }

  let [cwd = '.'] = cli.input
  // Note: path.resolve vs .join:
  // If given path is absolute then cwd should not affect it.
  cwd = path.resolve(process.cwd(), cwd)

  let [orgSlug] = await determineOrgSlug(
    String(orgFlag || ''),
    interactive,
    dryRun,
  )
  const sockJson = readOrDefaultSocketJson(cwd)

  if (all === undefined) {
    if (sockJson.defaults?.scan?.github?.all !== undefined) {
      all = sockJson.defaults?.scan?.github?.all
    } else {
      all = false
    }
  }
  if (!githubApiUrl) {
    if (sockJson.defaults?.scan?.github?.githubApiUrl !== undefined) {
      githubApiUrl = sockJson.defaults.scan.github.githubApiUrl
    } else {
      githubApiUrl = DEFAULT_GITHUB_URL
    }
  }
  if (!orgGithub) {
    if (sockJson.defaults?.scan?.github?.orgGithub !== undefined) {
      orgGithub = sockJson.defaults.scan.github.orgGithub
    } else {
      // Default to Socket org slug. Often that's fine. Vanity and all that.
      orgGithub = orgSlug
    }
  }
  if (!all && !repos) {
    if (sockJson.defaults?.scan?.github?.repos !== undefined) {
      repos = sockJson.defaults.scan.github.repos
    } else {
      repos = ''
    }
  }

  // We will also be needing that GitHub token.
  const hasGithubApiToken = !!githubToken

  // We're going to need an api token to suggest data because those suggestions
  // must come from data we already know. Don't error on missing api token yet.
  // If the api-token is not set, ignore it for the sake of suggestions.
  const hasSocketApiToken = hasDefaultApiToken()

  const outputKind = getOutputKind(json, markdown)

  // If the current cwd is unknown and is used as a repo slug anyways, we will
  // first need to register the slug before we can use it.
  // Only do suggestions with an apiToken and when not in dryRun mode
  if (hasSocketApiToken && !dryRun && interactive) {
    if (!orgSlug) {
      const suggestion = await suggestOrgSlug()
      if (suggestion === undefined) {
        await outputScanGithub(
          {
            ok: false,
            message: 'Canceled by user',
            cause: 'Org selector was canceled by user',
          },
          outputKind,
        )
        return
      }
      if (suggestion) {
        orgSlug = suggestion
      }
    }
  }

  const wasValidInput = checkCommandInput(
    outputKind,
    {
      nook: true,
      test: !json || !markdown,
      message: 'The json and markdown flags cannot be both set, pick one',
      fail: 'omit one',
    },
    {
      nook: true,
      test: hasSocketApiToken,
      message: 'This command requires a Socket API token for access',
      fail: 'try `socket login`',
    },
    {
      test: hasGithubApiToken,
      message: 'This command requires a GitHub API token for access',
      fail: 'missing',
    },
  )
  if (!wasValidInput) {
    return
  }

  // Note exiting earlier to skirt a hidden auth requirement
  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  await handleCreateGithubScan({
    all: Boolean(all),
    githubApiUrl,
    githubToken,
    interactive: Boolean(interactive),
    orgSlug,
    orgGithub,
    outputKind,
    repos,
  })
}
