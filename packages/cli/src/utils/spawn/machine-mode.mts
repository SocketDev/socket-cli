/**
 * Machine-mode flag propagation for spawned child processes.
 *
 * Under machine-output mode, socket-cli promises stdout is payload-only.
 * For child tools we spawn, we need to propagate that promise downward:
 *
 *   - Tools with `--json` / equivalent → prepend the flag.
 *   - Tools with `--silent` / `--quiet` → prepend the flag to suppress
 *     informational chatter.
 *   - Tools that honor color env vars → inject NO_COLOR / FORCE_COLOR
 *     so ANSI doesn't contaminate captured stdout.
 *   - Tools that always misbehave → leave args alone and rely on the
 *     scrubber to clean up.
 *
 * Coverage is per (tool, subcommand). Flag forwarding is best-effort:
 * unknown subcommands get universal env vars only, no args injected
 * (safer than risking "unknown option" failures from strict parsers
 * like clipanion).
 */

export interface MachineModeInput {
  tool: string
  subcommand?: string | undefined
  args: readonly string[]
  env?: NodeJS.ProcessEnv | undefined
}

export interface MachineModeOutput {
  args: string[]
  env: NodeJS.ProcessEnv
}

/**
 * Universal env vars applied to every spawned child under machine
 * mode. Most tools respect at least one of these.
 */
const UNIVERSAL_ENV: NodeJS.ProcessEnv = {
  __proto__: null as never,
  CLICOLOR_FORCE: '0',
  FORCE_COLOR: '0',
  NO_COLOR: '1',
}

interface ToolRules {
  /**
   * Env vars specific to this tool. Merged on top of UNIVERSAL_ENV.
   */
  env?: NodeJS.ProcessEnv | undefined
  /**
   * Args used when the subcommand has no entry in `subcommands` (or
   * `subcommand` is omitted). Also applied to tools without a
   * `subcommands` map when `subcommand` is provided. Use when a tool
   * needs different flags in the JSON-emitting and non-JSON-emitting
   * cases and the flags would conflict if emitted together (e.g. pnpm's
   * `--reporter=json` vs `--reporter=silent`).
   */
  fallbackArgs?: readonly string[] | undefined
  /**
   * Args to prepend unconditionally for this tool, regardless of
   * subcommand. Use for tools with uniform support (e.g. vlt accepts
   * --view=json on every subcommand) or tool-wide quiet flags that do
   * not conflict with any per-subcommand args.
   */
  prependArgs?: readonly string[] | undefined
  /**
   * Per-subcommand arg forwarding. Key is the subcommand (the first
   * non-flag argv). Value is args inserted AFTER prependArgs and
   * BEFORE the caller's original args.
   */
  subcommands?: Record<string, readonly string[]> | undefined
}

const NPM_JSON_CMDS: readonly string[] = [
  'audit',
  'config',
  'ls',
  'outdated',
  'pack',
  'query',
  'view',
]

const PNPM_JSON_CMDS: readonly string[] = [
  'add',
  'audit',
  'install',
  'licenses',
  'list',
  'ls',
  'outdated',
  'remove',
  'update',
  'why',
]

const YARN_CLASSIC_JSON_CMDS: readonly string[] = [
  'add',
  'audit',
  'info',
  'install',
  'list',
  'outdated',
  'remove',
  'upgrade',
  'versions',
  'why',
]

const YARN_BERRY_JSON_CMDS: readonly string[] = [
  'add',
  'bin',
  'config',
  'constraints',
  'dedupe',
  'explain',
  'info',
  'install',
  'npm',
  'pack',
  'patch',
  'plugin',
  'run',
  'unplug',
  'version',
  'why',
  'workspaces',
]

const ZPM_JSON_CMDS: readonly string[] = [
  'config',
  'constraints',
  'dedupe',
  'info',
  'npm',
  'pack',
  'patch',
  'tasks',
  'version',
  'why',
  'workspaces',
]

const GO_JSON_CMDS: readonly string[] = ['build', 'list', 'test', 'vet']

const TOOLS: Record<string, ToolRules> = {
  __proto__: null as never,
  cargo: {
    prependArgs: ['-q'],
  },
  cdxgen: {
    // Data comes via -o <file>, not stdout. Caller arranges the
    // tempfile; here we just suppress stdout chatter where possible.
  },
  coana: {
    // Caller wires --silent --socket-mode <tempfile>; there's nothing
    // to prepend here (socket-mode takes a file path computed at the
    // call site).
  },
  gem: {
    prependArgs: ['--quiet', '--no-color'],
  },
  go: {
    subcommands: Object.fromEntries(
      GO_JSON_CMDS.map((c) => [c, ['-json']]),
    ),
  },
  npm: {
    prependArgs: ['--loglevel=error'],
    subcommands: Object.fromEntries(
      NPM_JSON_CMDS.map((c) => [c, ['--json']]),
    ),
  },
  nuget: {
    // Only pack/push accept --json. Scrubber handles the rest.
  },
  pip: {
    env: { PIP_NO_COLOR: '1' },
    prependArgs: ['-q'],
  },
  pip3: {
    env: { PIP_NO_COLOR: '1' },
    prependArgs: ['-q'],
  },
  pnpm: {
    // --reporter is applied per-subcommand: `json` for JSON-emitting
    // subcommands, `silent` for everything else. Emitting both relies on
    // pnpm's last-wins flag parsing (an undocumented implementation
    // detail) and risks warnings or rejection in future pnpm versions.
    //
    // Non-JSON subcommands inherit `--reporter=silent` via the
    // fallback path in applyMachineMode.
    subcommands: Object.fromEntries(
      PNPM_JSON_CMDS.map((c) => [c, ['--reporter=json']]),
    ),
    fallbackArgs: ['--reporter=silent'],
  },
  sfw: {
    // Transparent proxy — nothing to add at the sfw level; inner tool
    // rules apply when callers classify the inner command.
  },
  'socket-patch': {
    // Opaque Rust binary; scrubber catches anything it emits.
  },
  synp: {
    // No flags exist; scrubber adapter handles the "Created ..." line.
  },
  uv: {
    prependArgs: ['--quiet'],
  },
  vlt: {
    prependArgs: ['--view=json'],
  },
  vltpkg: {
    prependArgs: ['--view=json'],
  },
  yarn: {
    // Classic v1. For Berry/v4 and zpm/v6 callers should use keys
    // 'yarn-berry' or 'zpm' instead.
    subcommands: Object.fromEntries(
      YARN_CLASSIC_JSON_CMDS.map((c) => [c, ['--json', '--silent']]),
    ),
  },
  'yarn-berry': {
    env: {
      YARN_ENABLE_COLORS: '0',
      YARN_ENABLE_HYPERLINKS: '0',
      YARN_ENABLE_INLINE_BUILDS: '0',
      YARN_ENABLE_MESSAGE_NAMES: '0',
      YARN_ENABLE_PROGRESS_BARS: '0',
    },
    subcommands: Object.fromEntries(
      YARN_BERRY_JSON_CMDS.map((c) => [c, ['--json']]),
    ),
  },
  zpm: {
    subcommands: {
      ...Object.fromEntries(ZPM_JSON_CMDS.map((c) => [c, ['--json']])),
      add: ['--silent'],
      install: ['--silent'],
    },
  },
}

function mergeEnv(
  base: NodeJS.ProcessEnv | undefined,
  overrides: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  return { ...base, ...UNIVERSAL_ENV, ...overrides }
}

/**
 * Compute the spawn args and env for a child under machine-output
 * mode. Preserves the caller's original args and env; additions merge
 * in on top.
 *
 * For per-subcommand tools, the subcommand is expected in
 * `input.subcommand`; if omitted, only universal env vars and the
 * tool's unconditional `prependArgs` apply (no subcommand-specific
 * flags are injected, preventing "unknown option" errors on
 * unrecognized subcommands).
 */
export function applyMachineMode(
  input: MachineModeInput,
): MachineModeOutput {
  const rules = TOOLS[input.tool]
  if (!rules) {
    return {
      args: [...input.args],
      env: mergeEnv(input.env, {}),
    }
  }
  const extraEnv = rules.env ?? {}
  const args: string[] = []
  if (rules.prependArgs) {
    args.push(...rules.prependArgs)
  }
  const subcommandArgs = input.subcommand
    ? rules.subcommands?.[input.subcommand]
    : undefined
  if (subcommandArgs) {
    args.push(...subcommandArgs)
  } else if (rules.fallbackArgs) {
    args.push(...rules.fallbackArgs)
  }
  args.push(...input.args)
  return {
    args,
    env: mergeEnv(input.env, extraEnv),
  }
}
