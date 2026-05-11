/**
 * Factory for "ecosystem hand-off" commands like `socket npm`, `socket pip`,
 * `socket cargo`, etc. These commands all share the same shape:
 *
 *   1. Parse Socket CLI flags with meow (mostly to handle `--help`).
 *   2. Filter Socket-only flags out of argv.
 *   3. Optionally render dry-run output and bail.
 *   4. Optionally start a telemetry span for the subprocess.
 *   5. Spawn Socket Firewall (sfw) with the forwarded args.
 *   6. Forward the child's exit code / signal.
 *   7. Optionally end the telemetry span before exiting.
 *
 * Defining each wrapper through this helper kills ~100 lines of copy-paste
 * per ecosystem and makes future improvements (signal handling, telemetry,
 * dry-run formatting) ship to every wrapper at once.
 *
 * Usage:
 *   export const cmdCargo = defineHandoffCommand({
 *     name: 'cargo',
 *     description: 'Run cargo with Socket Firewall security',
 *     spawnMode: 'dlx',
 *     examples: ['install ripgrep', 'build', 'add serde'],
 *   })
 */

import { defineFlags } from '../../meow.mts'
import { commonFlags } from '../../flags.mts'
import { meowOrExit } from './with-subcommands.mts'
import { spawnSfw, spawnSfwDlx } from '../dlx/spawn.mjs'
import { outputDryRunExecute } from '../dry-run/output.mts'
import { getFlagApiRequirementsOutput } from '../output/formatting.mts'
import { filterFlags } from '../process/cmd.mts'
import {
  trackSubprocessExit,
  trackSubprocessStart,
} from '../telemetry/integration.mts'

import type { CliCommandContext } from './with-subcommands.mts'
import type { CliSubcommand } from './with-subcommands-shared.mts'

export interface DefineHandoffCommandOptions {
  /**
   * Command name as it appears under `socket`. Forwarded to sfw as the first
   * arg unless `binaryPicker` overrides it.
   */
  name: string
  /**
   * One-line description for the help bucket and `socket --help` listing.
   */
  description: string
  /**
   * Hide the command from `socket --help`. Defaults to false.
   */
  hidden?: boolean | undefined
  /**
   * Spawn strategy:
   *   - 'auto' (= spawnSfw): VFS-extract in SEA mode, dlx-download otherwise.
   *     Used by npm/npx because those binaries are bundled in the SEA.
   *   - 'dlx' (= spawnSfwDlx): always pnpm-dlx-download. Used by yarn / pip /
   *     cargo / go / etc. where the SEA doesn't bundle the binary.
   */
  spawnMode: 'auto' | 'dlx'
  /**
   * Examples to render under "Examples" in the help text. Each line is
   * automatically prefixed with "$ ${command} ". Pass the args portion only.
   */
  examples: readonly string[]
  /**
   * Optional dynamic binary picker. If provided, runs after flag parsing and
   * its return value replaces `name` as the first arg passed to sfw. Used by
   * `socket pip` to fall back to `pip3` when `pip` is missing.
   */
  binaryPicker?:
    | ((context: CliCommandContext) => Promise<string> | string)
    | undefined
  /**
   * Extra free-form notes appended after the standard "Note: Everything
   * after X is forwarded…" line. Each entry becomes one indented line.
   */
  helpNotes?: readonly string[] | undefined
  /**
   * If true, emit the "API Token Requirements" section in help by looking
   * up the cmdPath `<parent>:<name>` in the requirements registry.
   */
  showApiRequirements?: boolean | undefined
  /**
   * If true, append the "Use `socket wrapper on` to alias this command as X"
   * hint after the forwarding note.
   */
  wrapperHint?: boolean | undefined
  /**
   * If true, support `--dry-run` (renders sfw invocation and bails). Default true.
   */
  supportDryRun?: boolean | undefined
  /**
   * If true, surround the spawn with `trackSubprocessStart` /
   * `trackSubprocessExit` telemetry. Default true.
   */
  trackTelemetry?: boolean | undefined
}

const DEFAULT_HIDDEN = false
const DEFAULT_SUPPORT_DRY_RUN = true
const DEFAULT_TRACK_TELEMETRY = true

/**
 * Build the help-text generator function used by meow.
 */
function buildHelp(
  opts: DefineHandoffCommandOptions,
  parentName: string,
): (command: string) => string {
  const { examples, helpNotes, name, showApiRequirements, wrapperHint } = opts

  return (command: string) => {
    const lines: string[] = []
    lines.push('', '    Usage', `      $ ${command} ...`)

    if (showApiRequirements) {
      lines.push(
        '',
        '    API Token Requirements',
        `      ${getFlagApiRequirementsOutput(`${parentName}:${name}`)}`,
      )
    }

    lines.push(
      '',
      `    Note: Everything after "${name}" is forwarded to Socket Firewall (sfw).`,
      `          Socket Firewall provides real-time security scanning for ${name} packages.`,
    )

    if (helpNotes && helpNotes.length) {
      for (const note of helpNotes) {
        lines.push(`          ${note}`)
      }
    }

    if (wrapperHint) {
      lines.push(
        '',
        `    Use \`socket wrapper on\` to alias this command as \`${name}\`.`,
      )
    }

    if (examples.length) {
      lines.push('', '    Examples')
      for (const example of examples) {
        // Trim trailing whitespace so a bare-command example renders as
        // `$ socket npm` (no trailing space) instead of `$ socket npm `.
        lines.push(`      $ ${command} ${example}`.trimEnd())
      }
    }

    lines.push('')
    return lines.join('\n')
  }
}

/**
 * Wire the child process's exit/signal back to the parent. Optionally flushes
 * telemetry first. Centralized so all wrappers share the same lifecycle.
 */
function wireChildExit(
  childProcess: NodeJS.Process & { on: any },
  options: {
    name: string
    trackTelemetry: boolean
    subprocessStartTime: number | undefined
  },
): void {
  const { name, subprocessStartTime, trackTelemetry } = options
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
      if (trackTelemetry && subprocessStartTime !== undefined) {
        // .then/.catch so the exit happens even when telemetry flush fails.
        void trackSubprocessExit(name, subprocessStartTime, code)
          .then(exitProcess)
          .catch(exitProcess)
      } else {
        exitProcess()
      }
    },
  )
}

/**
 * Define a "hand-off" subcommand that proxies to Socket Firewall.
 *
 * Returns a CliSubcommand-shaped object ready to plug into the meow router.
 */
export function defineHandoffCommand(
  opts: DefineHandoffCommandOptions,
): CliSubcommand {
  const {
    description,
    hidden = DEFAULT_HIDDEN,
    name,
    spawnMode,
    supportDryRun = DEFAULT_SUPPORT_DRY_RUN,
    trackTelemetry = DEFAULT_TRACK_TELEMETRY,
  } = opts

  async function run(
    argv: string[] | readonly string[],
    importMeta: ImportMeta,
    context: CliCommandContext,
  ): Promise<void> {
    const { parentName } = {
      __proto__: null,
      ...context,
    } as CliCommandContext

    const config = {
      commandName: name,
      description,
      hidden,
      flags: defineFlags({ ...commonFlags }),
      help: buildHelp(opts, parentName),
    }

    const cli = meowOrExit({ argv, config, importMeta, parentName })

    // Pass an explicit empty `exceptions` array so test-side assertions
    // that match the legacy 3-arg call shape stay green.
    const filteredArgv = filterFlags(argv, config.flags, [])

    if (supportDryRun && cli.flags['dryRun']) {
      outputDryRunExecute(
        'sfw',
        [name, ...filteredArgv],
        `${name} with Socket security scanning`,
      )
      return
    }

    // Resolve the actual binary to forward (pip → pip/pip3 fallback, etc.).
    const binaryName = opts.binaryPicker
      ? await opts.binaryPicker(context)
      : name

    // Default to failure; child's exit listener overwrites on success.
    process.exitCode = 1

    const subprocessStartTime = trackTelemetry
      ? await trackSubprocessStart(name)
      : undefined

    const spawnFn = spawnMode === 'auto' ? spawnSfw : spawnSfwDlx
    const { spawnPromise } = await spawnFn([binaryName, ...filteredArgv], {
      stdio: 'inherit',
    })

    const { process: childProcess } = spawnPromise as any
    wireChildExit(childProcess, {
      name,
      subprocessStartTime,
      trackTelemetry,
    })

    await spawnPromise
  }

  return { description, hidden, run }
}
