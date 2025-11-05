import { createRequire } from 'node:module'

import { NPX } from '@socketsecurity/lib/constants/agents'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import {
  DRY_RUN_BAILING_NOW,
  FLAG_DRY_RUN,
  FLAG_HELP,
} from '../../constants/cli.mts'
import { getShadowNpxBinPath } from '../../constants/paths.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { getFlagApiRequirementsOutput } from '../../utils/output/formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const require = createRequire(import.meta.url)
const logger = getDefaultLogger()

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
    logger.log(DRY_RUN_BAILING_NOW)
    return
  }

  const shadowNpxBin = /*@__PURE__*/ require(getShadowNpxBinPath())

  process.exitCode = 1

  const { spawnPromise } = await shadowNpxBin(argv, { stdio: 'inherit' })

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
