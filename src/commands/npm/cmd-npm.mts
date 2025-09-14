import { createRequire } from 'node:module'

import { logger } from '@socketsecurity/registry/lib/logger'

import constants, { NPM } from '../../constants.mts'
import { commonFlags, outputFlags } from '../../flags.mts'
import { filterFlags } from '../../utils/cmd.mts'
import { meowOrExit } from '../../utils/meow-with-subcommands.mts'
import { getFlagApiRequirementsOutput } from '../../utils/output-formatting.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/meow-with-subcommands.mts'

const require = createRequire(import.meta.url)

export const CMD_NAME = NPM

const description = 'Run npm with the Socket wrapper'

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

    Note: Everything after "npm" is passed to the npm command.
          Only the \`--dry-run\` and \`--help\` flags are caught here.

    Use \`socket wrapper on\` to alias this command as \`npm\`.

    Examples
      $ ${command}
      $ ${command} install -g cowsay
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
    logger.log(constants.DRY_RUN_BAILING_NOW)
    return
  }

  const shadowBin = /*@__PURE__*/ require(constants.shadowNpmBinPath)

  process.exitCode = 1

  // Filter Socket flags from argv but keep --json for npm
  const argsToForward = filterFlags(argv, { ...commonFlags, ...outputFlags }, [
    '--json',
  ])
  const { spawnPromise } = await shadowBin(NPM, argsToForward, {
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
