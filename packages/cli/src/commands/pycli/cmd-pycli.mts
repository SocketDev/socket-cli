/**
 * Socket Python CLI (pycli) command.
 *
 * Explicit passthrough to the Socket Python CLI (socketsecurity) for features
 * not yet available in the Node.js CLI. This replaces implicit fallback behavior
 * with an explicit command that makes it clear when Python CLI is being used.
 *
 * Features available via Python CLI:
 * - --generate-license: Generate license metadata for packages
 * - --enable-sarif: Output in SARIF format
 * - --strict-blocking: Fail on any policy violations (not just new ones)
 * - --disable-blocking: Always exit 0
 * - --enable-gitlab-security: GitLab Dependency Scanning format
 * - --slack-webhook: Send notifications to Slack
 * - --save-manifest-tar: Archive manifests for audit trail
 */

import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mts'
import { getFlagListOutput } from '../../utils/output/formatting.mts'
import { filterFlags, isHelpFlag } from '../../utils/process/cmd.mts'
import { spawnSocketPyCli } from '../../utils/python/standalone.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mts'

const logger = getDefaultLogger()

// Flags interface for type safety.
interface PycliFlags {
  dryRun: boolean
}

const config: CliCommandConfig = {
  commandName: 'pycli',
  description: 'Run Socket Python CLI (socketsecurity) directly',
  hidden: false,
  flags: {
    ...commonFlags,
  },
  help: command => `
    Usage
      $ ${command} [python-cli-options] [TARGET...]

    Options
      ${getFlagListOutput(commonFlags)}

    This command passes all arguments directly to the Socket Python CLI
    (socketsecurity). Use this for features not yet available in the
    Node.js CLI.

    Python CLI Features:
      --generate-license       Generate license metadata for all packages
      --license-file-name      Output file for license data
      --enable-sarif           Output in SARIF format
      --enable-gitlab-security GitLab Dependency Scanning report format
      --strict-blocking        Fail on ANY policy violations (not just new)
      --disable-blocking       Always exit 0 regardless of findings
      --save-manifest-tar      Archive manifests for audit trail
      --slack-webhook          Send notifications to Slack webhook

    Common Options (passed to Python CLI):
      --repo <owner/repo>      Repository name
      --branch <name>          Branch name
      --commit-sha <sha>       Commit SHA
      --target-path <path>     Path to scan
      --pr-number <n>          Pull request number

    Examples
      $ ${command} --help
      $ ${command} --generate-license --repo owner/repo .
      $ ${command} --enable-sarif --strict-blocking .
      $ ${command} --slack-webhook https://hooks.slack.com/... .
  `,
}

export const cmdPyCli = {
  description: config.description,
  hidden: config.hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = {
    __proto__: null,
    ...context,
  } as CliCommandContext

  // Check for help flag - if present, show our help first then Python CLI help.
  const hasHelpFlag = argv.some(a => isHelpFlag(a))

  if (hasHelpFlag) {
    // Show Socket CLI wrapper help.
    meowOrExit({
      argv: ['--help'],
      config,
      importMeta,
      parentName,
    })
    // meowOrExit will exit here.
    return
  }

  const cli = meowOrExit({
    argv: argv.filter(a => !isHelpFlag(a)),
    config,
    importMeta,
    parentName,
  })

  const { dryRun } = cli.flags as unknown as PycliFlags

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  // Filter Socket-specific flags from argv, pass rest to Python CLI.
  const pyCliArgs = filterFlags(argv, commonFlags, [])

  logger.info('Invoking Socket Python CLI...')

  const result = await spawnSocketPyCli(pyCliArgs, {
    stdio: 'inherit',
  })

  if (!result.ok) {
    process.exitCode = 1
    if (result.message) {
      logger.fail(result.message)
    }
  }
}
