/** @fileoverview NPM wrapper command for Socket CLI. Wraps npm with Socket security scanning by delegating to shadow npm binary. Intercepts package installations for security analysis while maintaining npm compatibility. */

import { createRequire } from 'node:module'

import constants, {
  FLAG_DRY_RUN,
  FLAG_HELP,
  FLAG_JSON,
  NPM,
} from '../../constants.mts'
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

  // Parse flags to handle --help
  meowOrExit({
    argv,
    config,
    importMeta,
    parentName,
  })

  const shadowNpmBin = /*@__PURE__*/ require(constants.shadowNpmBinPath)

  process.exitCode = 1

  // Filter Socket flags from argv but keep --json and --dry-run for npm.
  // npm supports --dry-run natively to show what would be installed without actually installing.
  const argsToForward = filterFlags(argv, { ...commonFlags, ...outputFlags }, [
    FLAG_JSON,
    'dry-run',
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
