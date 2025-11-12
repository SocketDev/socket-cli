import { YARN } from '@socketsecurity/lib/constants/agents'
import { WIN32 } from '@socketsecurity/lib/constants/platform'
import { getDefaultLogger } from '@socketsecurity/lib/logger'
import { spawn } from '@socketsecurity/lib/spawn'

import { DRY_RUN_BAILING_NOW } from '../../constants/cli.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { resolveSfw } from '../../utils/dlx/resolve-binary.mjs'
import { getFlagApiRequirementsOutput } from '../../utils/output/formatting.mts'
import { filterFlags } from '../../utils/process/cmd.mts'
import { spawnNode } from '../../utils/spawn/spawn-node.mjs'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

export const CMD_NAME = YARN

const description = 'Run yarn with Socket Firewall security'

const hidden = true

export const cmdYarn = {
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
          Socket Firewall provides real-time security scanning for yarn packages.

    Use \`socket wrapper on\` to alias this command as \`${YARN}\`.

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

  const resolution = resolveSfw()

  // Set default exit code to 1 (failure). Will be overwritten on success.
  process.exitCode = 1

  // Forward arguments to sfw (Socket Firewall).
  // Use local sfw if available, otherwise use yarn dlx with pinned version.
  const spawnPromise =
    resolution.type === 'local'
      ? spawnNode([resolution.path, 'yarn', ...filteredArgv], {
          shell: WIN32,
          stdio: 'inherit',
        })
      : spawn(
          'yarn',
          [
            'dlx',
            `${resolution.details.name}@${resolution.details.version}`,
            'yarn',
            ...filteredArgv,
          ],
          {
            shell: WIN32,
            stdio: 'inherit',
          },
        )

  // Handle exit codes and signals using event-based pattern.
  // See https://nodejs.org/api/child_process.html#event-exit.
  const { process: childProcess } = spawnPromise as any
  childProcess.on(
    'exit',
    (code: number | null, signalName: NodeJS.Signals | null) => {
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
