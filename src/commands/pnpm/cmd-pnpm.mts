import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { FLAG_DRY_RUN, FLAG_HELP, PNPM } from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
import { filterFlags } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagApiRequirementsOutput } from '../../utils/output-formatting.mts'
import {
  trackSubprocessExit,
  trackSubprocessStart,
} from '../../utils/telemetry/integration.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const require = createRequire(import.meta.url)

export const CMD_NAME = PNPM

const description = 'Wraps pnpm with Socket security scanning'

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

    Note: Everything after "${PNPM}" is passed to the ${PNPM} command.
          Only the \`${FLAG_DRY_RUN}\` and \`${FLAG_HELP}\` flags are caught here.

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
    parentName,
    importMeta,
  })

  const dryRun = !!cli.flags['dryRun']

  if (dryRun) {
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const shadowPnpmBin = /*@__PURE__*/ require(constants.shadowPnpmBinPath)

  process.exitCode = 1

  // Filter Socket flags from argv.
  const filteredArgv = filterFlags(argv, config.flags)

  // Track subprocess start.
  const subprocessStartTime = await trackSubprocessStart(PNPM)

  const { spawnPromise } = await shadowPnpmBin(filteredArgv, {
    stdio: 'inherit',
  })

  // Handle exit codes and signals using event-based pattern.
  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on(
    'exit',
    (code: number | null, signalName: NodeJS.Signals | null) => {
      // Track subprocess exit and flush telemetry before exiting.
      // Use .then() to ensure telemetry completes before process.exit().
      void trackSubprocessExit(PNPM, subprocessStartTime, code).then(() => {
        if (signalName) {
          process.kill(process.pid, signalName)
        } else if (typeof code === 'number') {
          // eslint-disable-next-line n/no-process-exit
          process.exit(code)
        }
      })
    },
  )

  await spawnPromise
}
