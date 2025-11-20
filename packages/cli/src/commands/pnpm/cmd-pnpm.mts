import { PNPM } from '@socketsecurity/lib/constants/agents'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { spawnSfwDlx } from '../../utils/dlx/spawn.mjs'
import { getFlagApiRequirementsOutput } from '../../utils/output/formatting.mts'
import { filterFlags } from '../../utils/process/cmd.mts'
import {
  trackSubprocessExit,
  trackSubprocessStart,
} from '../../utils/telemetry/integration.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

export const CMD_NAME = PNPM

const description = 'Run pnpm with Socket Firewall security'

const hidden = true

export const cmdPnpm = {
  description,
  hidden,
  run,
}

async function run(
  argv: string[] | readonly string[],
  importMeta: ImportMeta,
  context: CliCommandContext,
): Promise<void> {
  const { parentName } = { __proto__: null, ...context } as CliCommandContext
  const config: CliCommandConfig = {
    commandName: CMD_NAME,
    description,
    hidden,
    flags: {
      ...commonFlags,
    },
    help: command => `
    Usage
      $ ${command} ...

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Note: Everything after "${CMD_NAME}" is forwarded to Socket Firewall (sfw).
          Socket Firewall provides real-time security scanning for pnpm packages.

    Use \`socket wrapper on\` to alias this command as \`${PNPM}\`.

    Examples
      $ ${command}
      $ ${command} install
      $ ${command} add package-name
      $ ${command} dlx package-name
    `,
  }

  const cli = meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  // Filter Socket flags from argv.
  const filteredArgv = filterFlags(argv, config.flags)

  // Set default exit code to 1 (failure). Will be overwritten on success.
  process.exitCode = 1

  // Track subprocess start.
  const subprocessStartTime = await trackSubprocessStart(CMD_NAME)

  // Forward arguments to sfw (Socket Firewall) using Socket's dlx.
  const { spawnPromise } = await spawnSfwDlx(['pnpm', ...filteredArgv], {
    stdio: 'inherit',
  })

  // Handle exit codes and signals using event-based pattern.
  // See https://nodejs.org/api/child_process.html#event-exit.
  const { process: childProcess } = spawnPromise as any
  childProcess.on(
    'exit',
    async (code: number | null, signalName: NodeJS.Signals | null) => {
      // Track subprocess exit and flush telemetry.
      await trackSubprocessExit(CMD_NAME, subprocessStartTime, code)

      if (signalName) {
        process.kill(process.pid, signalName)
      } else if (typeof code === 'number') {
        // eslint-disable-next-line n/no-process-exit
        process.exit(code)
      }
    },
  )

  await spawnPromise
}
