/**
 * @fileoverview Package manager agent for executing npm, pnpm, and yarn commands.
 * Provides cross-platform utilities with optimized flags and security defaults.
 *
 * SECURITY: Array-Based Arguments Prevent Command Injection
 *
 * All functions in this module (execNpm, execPnpm, execYarn) use array-based
 * arguments when calling spawn(). This is the PRIMARY DEFENSE against command
 * injection attacks.
 *
 * When arguments are passed as an array:
 *   spawn(cmd, ['install', packageName, '--flag'], options)
 *
 * Node.js handles escaping automatically. Each argument is passed directly to
 * the OS without shell interpretation. Shell metacharacters like ; | & $ ( )
 * are treated as LITERAL STRINGS, not as commands.
 *
 * Example: If packageName = "lodash; rm -rf /", the package manager will try to
 * install a package literally named "lodash; rm -rf /" (which doesn't exist),
 * rather than executing the malicious command.
 *
 * This approach is secure even when shell: true is used on Windows for .cmd
 * file resolution, because Node.js properly escapes each array element.
 */

import { getCI } from '#env/ci'

import { WIN32 } from '#constants/platform'
import { execBin } from './bin'
import { isDebug } from './debug'
import { findUpSync } from './fs'
import { getOwn } from './objects'
import type { SpawnOptions } from './spawn'
import { spawn } from './spawn'

// Note: npm flag checking is done with regex patterns in the is*Flag functions below.

const pnpmIgnoreScriptsFlags = new Set([
  '--ignore-scripts',
  '--no-ignore-scripts',
])

const pnpmFrozenLockfileFlags = new Set([
  '--frozen-lockfile',
  '--no-frozen-lockfile',
])

const pnpmInstallCommands = new Set(['install', 'i'])

// Commands that support --ignore-scripts flag in pnpm:
// Installation-related: install, add, update, remove, link, unlink, import, rebuild.
const pnpmInstallLikeCommands = new Set([
  'install',
  'i',
  'add',
  'update',
  'up',
  'remove',
  'rm',
  'link',
  'ln',
  'unlink',
  'import',
  'rebuild',
  'rb',
])

// Commands that support --ignore-scripts flag in yarn:
// Similar to npm/pnpm: installation-related commands.
const yarnInstallLikeCommands = new Set([
  'install',
  'add',
  'upgrade',
  'remove',
  'link',
  'unlink',
  'import',
])

/**
 * Execute npm commands with optimized flags and settings.
 *
 * SECURITY: Uses array-based arguments to prevent command injection. All elements
 * in the args array are properly escaped by Node.js when passed to spawn().
 */
/*@__NO_SIDE_EFFECTS__*/
export function execNpm(args: string[], options?: SpawnOptions | undefined) {
  const useDebug = isDebug()
  const terminatorPos = args.indexOf('--')
  const npmArgs = (
    terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  ).filter(
    (a: string) =>
      !isNpmAuditFlag(a) && !isNpmFundFlag(a) && !isNpmProgressFlag(a),
  )
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)
  const logLevelArgs =
    // The default value of loglevel is "notice". We default to "warn" which is
    // one level quieter.
    useDebug || npmArgs.some(isNpmLoglevelFlag) ? [] : ['--loglevel', 'warn']
  // SECURITY: Array-based arguments prevent command injection. Each element is
  // passed directly to the OS without shell interpretation.
  //
  // NOTE: We don't apply hardening flags to npm because:
  // 1. npm is a trusted system tool installed with Node.js
  // 2. npm requires full system access (filesystem, network, child processes)
  // 3. Hardening flags would prevent npm from functioning (even with --allow-* grants)
  // 4. The permission model is intended for untrusted user code, not package managers
  //
  // We also use the npm binary wrapper instead of calling cli.js directly because
  // cli.js exports a function that needs to be invoked with process as an argument.
  const npmBin = /*@__PURE__*/ require('#constants/agents').NPM_BIN_PATH
  return spawn(
    npmBin,
    [
      // Even though '--loglevel=error' is passed npm will still run through
      // code paths for 'audit' and 'fund' unless '--no-audit' and '--no-fund'
      // flags are passed.
      '--no-audit',
      '--no-fund',
      // Add `--no-progress` and `--silent` flags to fix input being swallowed
      // by the spinner when running the command with recent versions of npm.
      '--no-progress',
      // Add '--loglevel=error' if a loglevel flag is not provided and the
      // SOCKET_DEBUG environment variable is not truthy.
      ...logLevelArgs,
      ...npmArgs,
      ...otherArgs,
    ],
    {
      __proto__: null,
      // On Windows, npm is a .cmd file that requires shell to execute.
      shell: WIN32,
      ...options,
    } as SpawnOptions,
  )
}

export interface PnpmOptions extends SpawnOptions {
  allowLockfileUpdate?: boolean
}

/**
 * Execute pnpm commands with optimized flags and settings.
 *
 * SECURITY: Uses array-based arguments to prevent command injection. All elements
 * in the args array are properly escaped by Node.js when passed to execBin().
 */
/*@__NO_SIDE_EFFECTS__*/

export function execPnpm(args: string[], options?: PnpmOptions | undefined) {
  const { allowLockfileUpdate, ...extBinOpts } = {
    __proto__: null,
    ...options,
  } as PnpmOptions
  const useDebug = isDebug()
  const terminatorPos = args.indexOf('--')
  const pnpmArgs = (
    terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  ).filter((a: string) => !isNpmProgressFlag(a))
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)

  const firstArg = pnpmArgs[0]
  const supportsIgnoreScripts = firstArg
    ? pnpmInstallLikeCommands.has(firstArg)
    : false

  // pnpm uses --loglevel for all commands.
  const logLevelArgs =
    useDebug || pnpmArgs.some(isPnpmLoglevelFlag) ? [] : ['--loglevel', 'warn']

  // Only add --ignore-scripts for commands that support it.
  const hasIgnoreScriptsFlag = pnpmArgs.some(isPnpmIgnoreScriptsFlag)
  const ignoreScriptsArgs =
    !supportsIgnoreScripts || hasIgnoreScriptsFlag ? [] : ['--ignore-scripts']

  // In CI environments, pnpm uses --frozen-lockfile by default which prevents lockfile updates.
  // For commands that need to update the lockfile (like install with new packages/overrides),
  // we need to explicitly add --no-frozen-lockfile in CI mode if not already present.
  const frozenLockfileArgs = []
  if (
    getCI() &&
    allowLockfileUpdate &&
    firstArg &&
    isPnpmInstallCommand(firstArg) &&
    !pnpmArgs.some(isPnpmFrozenLockfileFlag)
  ) {
    frozenLockfileArgs.push('--no-frozen-lockfile')
  }

  // Note: pnpm doesn't have a --no-progress flag. It uses --reporter instead.
  // We removed --no-progress as it causes "Unknown option" errors with pnpm.

  // SECURITY: Array-based arguments prevent command injection. Each element is
  // passed directly to the OS without shell interpretation.
  return execBin(
    'pnpm',
    [
      // Add '--loglevel=warn' if a loglevel flag is not provided and debug is off.
      ...logLevelArgs,
      // Add '--ignore-scripts' by default for security (only for installation commands).
      ...ignoreScriptsArgs,
      // Add '--no-frozen-lockfile' in CI when lockfile updates are needed.
      ...frozenLockfileArgs,
      ...pnpmArgs,
      ...otherArgs,
    ],
    extBinOpts,
  )
}

/**
 * Execute yarn commands with optimized flags and settings.
 *
 * SECURITY: Uses array-based arguments to prevent command injection. All elements
 * in the args array are properly escaped by Node.js when passed to execBin().
 */
/*@__NO_SIDE_EFFECTS__*/
export function execYarn(
  args: string[],
  options?: import('./spawn').SpawnOptions,
) {
  const useDebug = isDebug()
  const terminatorPos = args.indexOf('--')
  const yarnArgs = (
    terminatorPos === -1 ? args : args.slice(0, terminatorPos)
  ).filter((a: string) => !isNpmProgressFlag(a))
  const otherArgs = terminatorPos === -1 ? [] : args.slice(terminatorPos)

  const firstArg = yarnArgs[0]
  const supportsIgnoreScripts = firstArg
    ? yarnInstallLikeCommands.has(firstArg)
    : false

  // Yarn uses --silent flag for quieter output.
  const logLevelArgs =
    useDebug || yarnArgs.some(isNpmLoglevelFlag) ? [] : ['--silent']

  // Only add --ignore-scripts for commands that support it.
  const hasIgnoreScriptsFlag = yarnArgs.some(isPnpmIgnoreScriptsFlag)
  const ignoreScriptsArgs =
    !supportsIgnoreScripts || hasIgnoreScriptsFlag ? [] : ['--ignore-scripts']

  // SECURITY: Array-based arguments prevent command injection. Each element is
  // passed directly to the OS without shell interpretation.
  return execBin(
    'yarn',
    [
      // Add '--silent' if a loglevel flag is not provided and debug is off.
      ...logLevelArgs,
      // Add '--ignore-scripts' by default for security (only for installation commands).
      ...ignoreScriptsArgs,
      ...yarnArgs,
      ...otherArgs,
    ],
    {
      __proto__: null,
      ...options,
    } as SpawnOptions,
  )
}

/**
 * Check if a command argument is an npm audit flag.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isNpmAuditFlag(cmdArg: string): boolean {
  return /^--(no-)?audit(=.*)?$/.test(cmdArg)
}

/**
 * Check if a command argument is an npm fund flag.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isNpmFundFlag(cmdArg: string): boolean {
  return /^--(no-)?fund(=.*)?$/.test(cmdArg)
}

/**
 * Check if a command argument is an npm loglevel flag.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isNpmLoglevelFlag(cmdArg: string): boolean {
  // https://docs.npmjs.com/cli/v11/using-npm/logging#setting-log-levels
  if (/^--loglevel(=.*)?$/.test(cmdArg)) {
    return true
  }
  // Check for long form flags
  if (/^--(silent|verbose|info|warn|error|quiet)$/.test(cmdArg)) {
    return true
  }
  // Check for shorthand flags
  return /^-(s|q|d|dd|ddd|v)$/.test(cmdArg)
}

/**
 * Check if a command argument is an npm node-options flag.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isNpmNodeOptionsFlag(cmdArg: string): boolean {
  // https://docs.npmjs.com/cli/v9/using-npm/config#node-options
  return /^--node-options(=.*)?$/.test(cmdArg)
}

/**
 * Check if a command argument is an npm progress flag.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isNpmProgressFlag(cmdArg: string): boolean {
  return /^--(no-)?progress(=.*)?$/.test(cmdArg)
}

/**
 * Check if a command argument is a pnpm ignore-scripts flag.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isPnpmIgnoreScriptsFlag(cmdArg: string): boolean {
  return pnpmIgnoreScriptsFlags.has(cmdArg)
}

/**
 * Check if a command argument is a pnpm frozen-lockfile flag.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isPnpmFrozenLockfileFlag(cmdArg: string): boolean {
  return pnpmFrozenLockfileFlags.has(cmdArg)
}

/**
 * Check if a command argument is a pnpm install command.
 */
/*@__NO_SIDE_EFFECTS__*/
export function isPnpmInstallCommand(cmdArg: string): boolean {
  return pnpmInstallCommands.has(cmdArg)
}

/**
 * Alias for isNpmLoglevelFlag for pnpm usage.
 */
export const isPnpmLoglevelFlag = isNpmLoglevelFlag

/**
 * Execute a package.json script using the appropriate package manager.
 * Automatically detects pnpm, yarn, or npm based on lockfiles.
 */
export interface ExecScriptOptions extends SpawnOptions {
  prepost?: boolean | undefined
}

/*@__NO_SIDE_EFFECTS__*/
export function execScript(
  scriptName: string,
  args?: string[] | readonly string[] | ExecScriptOptions | undefined,
  options?: ExecScriptOptions | undefined,
) {
  // Handle overloaded signatures: execScript(name, options) or execScript(name, args, options).
  let resolvedOptions: ExecScriptOptions | undefined
  let resolvedArgs: string[]
  if (!Array.isArray(args) && args !== null && typeof args === 'object') {
    resolvedOptions = args as ExecScriptOptions
    resolvedArgs = []
  } else {
    resolvedOptions = options
    resolvedArgs = (args || []) as string[]
  }
  const { prepost, ...spawnOptions } = {
    __proto__: null,
    ...resolvedOptions,
  } as ExecScriptOptions

  // If shell: true is passed, run the command directly as a shell command.
  if (spawnOptions.shell === true) {
    return spawn(scriptName, resolvedArgs, spawnOptions)
  }

  const useNodeRun =
    !prepost && /*@__PURE__*/ require('#constants/node').supportsNodeRun()

  // Detect package manager based on lockfile by traversing up from current directory.
  const cwd =
    (getOwn(spawnOptions, 'cwd') as string | undefined) ?? process.cwd()

  // Check for pnpm-lock.yaml.
  const pnpmLockPath = findUpSync(
    /*@__INLINE__*/ require('#constants/agents').PNPM_LOCK_YAML,
    { cwd },
  ) as string | undefined
  if (pnpmLockPath) {
    return execPnpm(['run', scriptName, ...resolvedArgs], spawnOptions)
  }

  // Check for package-lock.json.
  // When in an npm workspace, use npm run to ensure workspace binaries are available.
  const packageLockPath = findUpSync(
    /*@__INLINE__*/ require('#constants/agents').PACKAGE_LOCK_JSON,
    { cwd },
  ) as string | undefined
  if (packageLockPath) {
    return execNpm(['run', scriptName, ...resolvedArgs], spawnOptions)
  }

  // Check for yarn.lock.
  const yarnLockPath = findUpSync(
    /*@__INLINE__*/ require('#constants/agents').YARN_LOCK,
    { cwd },
  ) as string | undefined
  if (yarnLockPath) {
    return execYarn(['run', scriptName, ...resolvedArgs], spawnOptions)
  }

  return spawn(
    /*@__PURE__*/ require('#constants/node').getExecPath(),
    [
      .../*@__PURE__*/ require('#constants/node').getNodeNoWarningsFlags(),
      ...(useNodeRun
        ? ['--run']
        : [
            /*@__PURE__*/ require('#constants/agents').NPM_REAL_EXEC_PATH,
            'run',
          ]),
      scriptName,
      ...resolvedArgs,
    ],
    {
      ...spawnOptions,
    },
  )
}
