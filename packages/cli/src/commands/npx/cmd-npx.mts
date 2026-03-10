import { NPX } from '@socketsecurity/lib/constants/agents'
import { getDefaultLogger } from '@socketsecurity/lib/logger'

import { commonFlags } from '../../flags.mts'
import { meowOrExit } from '../../utils/cli/with-subcommands.mjs'
import { spawnSfw } from '../../utils/dlx/spawn.mjs'
import { outputDryRunExecute } from '../../utils/dry-run/output.mts'
import { getFlagApiRequirementsOutput } from '../../utils/output/formatting.mts'
import { filterFlags } from '../../utils/process/cmd.mts'
import {
  trackSubprocessExit,
  trackSubprocessStart,
} from '../../utils/telemetry/integration.mts'

import type {
  CliCommandConfig,
  CliCommandContext,
} from '../../utils/cli/with-subcommands.mjs'

const logger = getDefaultLogger()

const CMD_NAME = NPX

const description = 'Run npx with Socket Firewall security'

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
    help: command => `
    Usage
      $ ${command} ...

    API Token Requirements
      ${getFlagApiRequirementsOutput(`${parentName}:${CMD_NAME}`)}

    Note: Everything after "${CMD_NAME}" is forwarded to Socket Firewall (sfw).
          Socket Firewall provides real-time security scanning for npx packages.

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

  // Filter Socket flags from argv.
  const filteredArgv = filterFlags(argv, config.flags)

  if (dryRun) {
    outputDryRunExecute('sfw', ['npx', ...filteredArgv], 'npx with Socket security scanning')
    return
  }

  // Set default exit code to 1 (failure). Will be overwritten on success.
  process.exitCode = 1

  // Track subprocess start.
  const subprocessStartTime = await trackSubprocessStart(NPX)

  // Forward arguments to sfw (Socket Firewall).
  // Auto-detects SEA vs npm CLI mode (VFS extraction vs dlx download).
  const { spawnPromise } = await spawnSfw(['npx', ...filteredArgv], {
    stdio: 'inherit',
  })

  // Handle exit codes and signals using event-based pattern.
  // See https://nodejs.org/api/child_process.html#event-exit.
  const { process: childProcess } = spawnPromise as any
  childProcess.on(
    'exit',
    (code: number | null, signalName: NodeJS.Signals | null) => {
      const exitProcess = () => {
        if (signalName) {
          process.kill(process.pid, signalName)
        } else if (typeof code === 'number') {
          // eslint-disable-next-line n/no-process-exit
          process.exit(code)
        }
      }
      // Track subprocess exit and flush telemetry before exiting.
      // Use .then()/.catch() to ensure process exits even if telemetry fails.
      void trackSubprocessExit(NPX, subprocessStartTime, code)
        .then(exitProcess)
        .catch(exitProcess)
    },
  )

  await spawnPromise
}
