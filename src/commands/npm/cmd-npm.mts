import { createRequire } from 'node:module'

import { NPM } from '@socketsecurity/lib/constants/agents'
import { logger } from '@socketsecurity/lib/logger'

import {
  DRY_RUN_BAILING_NOW,
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
} from '../../constants/cli.mts'
import { getShadowNpmBinPath } from '../../constants/paths.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagApiRequirementsOutput } from '../../utils/output/formatting.mts'
import { filterFlags } from '../../utils/process/cmd.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const require = createRequire(import.meta.url)

export const CMD_NAME = NPM

const description = 'Wraps npm with Socket security scanning'

const hidden = false

export const cmdNpm = {
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

    Note: Everything after "${NPM}" is passed to the ${NPM} command.
          Only the \`${FLAG_DRY_RUN}\` and \`${FLAG_HELP}\` flags are caught here.

    Use \`socket wrapper on\` to alias this command as \`${NPM}\`.

    Examples
      $ ${command}
      $ ${command} install -g cowsay
      $ ${command} exec cowsay
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

  const shadowNpmBin = /*@__PURE__*/ require(getShadowNpmBinPath())

  process.exitCode = 1

  // Filter Socket flags from argv but keep --json for npm.
  const argsToForward = filterFlags(argv, { ...commonFlags, ...outputFlags }, [
    FLAG_JSON,
  ])
  const { spawnPromise } = await shadowNpmBin(argsToForward, {
    stdio: 'inherit',
  })

  // See https://nodejs.org/api/child_process.html#event-exit.
  spawnPromise.process.on(
    'exit',
    (code: string | null, signalName: NodeJS.Signals | null) => {
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
