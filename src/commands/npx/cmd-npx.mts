import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { FLAG_DRY_RUN, FLAG_HELP, NPX } from '../../constants.mts'
import { commonFlags } from '../../flags.mts'
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

const CMD_NAME = NPX

const description = 'Wraps npx with Socket security scanning'

const hidden = false

export const cmdNpx = {
  description,
  hidden,
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
    hidden,
    flags: {
      ...commonFlags,
    },
    help: (command, _config) => `
    Usage
      $ ${command} ...

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Note: Everything after "${NPX}" is passed to the ${NPX} command.
          Only the \`${FLAG_DRY_RUN}\` and \`${FLAG_HELP}\` flags are caught here.

    Use \`socket wrapper on\` to alias this command as \`${NPX}\`.

    Examples
      $ ${command} cowsay
      $ ${command} cowsay@1.6.0 hello
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

  const shadowNpxBin = /*@__PURE__*/ require(constants.shadowNpxBinPath)

  process.exitCode = 1

  // Track subprocess start.
  const subprocessStartTime = await trackSubprocessStart(NPX)

  const { spawnPromise } = await shadowNpxBin(argv, { stdio: 'inherit' })

  // Handle exit codes and signals using event-based pattern.
  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on(
    'exit',
    (code: number | null, signalName: NodeJS.Signals | null) => {
      // Track subprocess exit and flush telemetry before exiting.
      // Use .then() to ensure telemetry completes before process.exit().
      void trackSubprocessExit(NPX, subprocessStartTime, code).then(() => {
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
