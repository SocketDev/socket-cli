/**
 * @fileoverview Child process spawning utilities with cross-platform support.
 * Provides enhanced spawn functionality with stdio handling and error management.
 *
 * SECURITY: Array-Based Arguments Prevent Command Injection
 *
 * This module uses array-based arguments for all command execution, which is the
 * PRIMARY DEFENSE against command injection attacks. When you pass arguments as
 * an array to spawn():
 *
 *   spawn('npx', ['sfw', tool, ...args], { shell: true })
 *
 * Node.js handles escaping automatically. Each argument is passed directly to the
 * OS without shell interpretation. Shell metacharacters like ; | & $ ( ) ` are
 * treated as LITERAL STRINGS, not as commands. This approach is secure even when
 * shell: true is used on Windows for .cmd/.bat file resolution.
 *
 * UNSAFE ALTERNATIVE (not used in this codebase):
 *   spawn(`npx sfw ${tool} ${args.join(' ')}`, { shell: true })  // ✖ VULNERABLE
 *
 * String concatenation allows injection. For example, if tool = "foo; rm -rf /",
 * the shell would execute both commands. Array-based arguments prevent this.
 *
 * References:
 * - https://nodejs.org/api/child_process.html#child_processspawncommand-args-options
 * - https://cheatsheetseries.owasp.org/cheatsheets/Nodejs_Security_Cheat_Sheet.html
 */

import { getAbortSignal, getSpinner } from '#constants/process'

import { isArray } from './arrays'

const abortSignal = getAbortSignal()
const spinner = getSpinner()

import { getOwn, hasOwn } from './objects'
import { stripAnsi } from './strings'

// Define BufferEncoding type for TypeScript compatibility.
type BufferEncoding = globalThis.BufferEncoding

const windowsScriptExtRegExp = /\.(?:cmd|bat|ps1)$/i

let _child_process: typeof import('node:child_process') | undefined
/**
 * Lazily load the `child_process` module to avoid Webpack bundling issues.
 *
 * @returns The Node.js `child_process` module
 *
 * @example
 * const childProcess = getChildProcess()
 * childProcess.spawnSync('ls', ['-la'])
 */
/*@__NO_SIDE_EFFECTS__*/
function getChildProcess() {
  if (_child_process === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _child_process = /*@__PURE__*/ require('node:child_process')
  }
  return _child_process as typeof import('node:child_process')
}

/**
 * Options for spawning a child process with promise-based completion.
 *
 * @property {string | undefined} cwd - Current working directory for the process
 * @property {boolean | undefined} stdioString - Convert stdio output to strings (default: `true`)
 * @property {StdioType | undefined} stdio - Stdio configuration (`'pipe'`, `'ignore'`, `'inherit'`, or array)
 * @property {NodeJS.ProcessEnv | undefined} env - Environment variables for the process
 * @property {boolean | string | undefined} shell - Whether to run command in shell, or path to shell
 * @property {AbortSignal | undefined} signal - Signal to abort the process
 * @property {number | undefined} timeout - Maximum time in milliseconds before killing the process
 * @property {number | undefined} uid - User identity of the process (POSIX only)
 * @property {number | undefined} gid - Group identity of the process (POSIX only)
 */
export type PromiseSpawnOptions = {
  cwd?: string | undefined
  stdioString?: boolean | undefined
  stdio?: StdioType | undefined
  env?: NodeJS.ProcessEnv | undefined
  shell?: boolean | string | undefined
  signal?: AbortSignal | undefined
  timeout?: number | undefined
  uid?: number | undefined
  gid?: number | undefined
}

/**
 * Result returned by {@link spawn} when the child process completes.
 * This is a Promise that resolves with process exit information and output,
 * with additional properties for accessing the running process and stdin stream.
 *
 * @property {ChildProcessType} process - The running child process instance
 * @property {WritableStreamType | null} stdin - Writable stream for process stdin, or `null` if not piped
 *
 * @example
 * const result = spawn('echo', ['hello'])
 * result.stdin?.write('additional input\n')
 * const { code, stdout } = await result
 * console.log(stdout) // 'hello'
 */
export type PromiseSpawnResult = Promise<{
  cmd: string
  args: string[] | readonly string[]
  code: number
  signal: NodeJS.Signals | null
  stdout: string | Buffer
  stderr: string | Buffer
}> & {
  process: ChildProcessType
  stdin: WritableStreamType | null
}

let _npmCliPromiseSpawn:
  | ((
      cmd: string,
      args: string[],
      options?: PromiseSpawnOptions | undefined,
      extra?: SpawnExtra | undefined,
    ) => PromiseSpawnResult)
  | undefined
/**
 * Lazily load the `@npmcli/promise-spawn` module for async process spawning.
 *
 * @returns The promise-spawn module that provides Promise-based spawn functionality
 *
 * @example
 * const promiseSpawn = getNpmcliPromiseSpawn()
 * await promiseSpawn('git', ['status'])
 */
/*@__NO_SIDE_EFFECTS__*/
function getNpmcliPromiseSpawn() {
  if (_npmCliPromiseSpawn === undefined) {
    _npmCliPromiseSpawn = /*@__PURE__*/ require('@npmcli/promise-spawn')
  }
  return _npmCliPromiseSpawn as unknown as typeof import('@npmcli/promise-spawn')
}

let _path: typeof import('node:path') | undefined
/**
 * Lazily load the `path` module to avoid Webpack bundling issues.
 *
 * @returns The Node.js `path` module
 *
 * @example
 * const path = getPath()
 * const basename = path.basename('/foo/bar.txt')
 */
/*@__NO_SIDE_EFFECTS__*/
function getPath() {
  if (_path === undefined) {
    // Use non-'node:' prefixed require to avoid Webpack errors.

    _path = /*@__PURE__*/ require('node:path')
  }
  return _path as typeof import('node:path')
}

/**
 * Error object thrown when a spawned process fails.
 * Extends the standard Error with process-specific information including exit code,
 * signal, command details, and captured output.
 *
 * @property {string[]} args - Arguments passed to the command
 * @property {string} cmd - Command that was executed
 * @property {number} code - Process exit code
 * @property {string} name - Error name (typically `'Error'`)
 * @property {string} message - Error message describing the failure
 * @property {NodeJS.Signals | null} signal - Signal that terminated the process, if any
 * @property {string} stack - Stack trace of the error
 * @property {string | Buffer} stderr - Standard error output from the process
 * @property {string | Buffer} stdout - Standard output from the process
 *
 * @example
 * try {
 *   await spawn('exit', ['1'])
 * } catch (error) {
 *   if (isSpawnError(error)) {
 *     console.error(`Command failed with code ${error.code}`)
 *     console.error(`stderr: ${error.stderr}`)
 *   }
 * }
 */
export type SpawnError = {
  args: string[]
  cmd: string
  code: number
  name: string
  message: string
  signal: NodeJS.Signals | null
  stack: string
  stderr: string | Buffer
  stdout: string | Buffer
}

/**
 * Spawn error variant where stdout and stderr are guaranteed to be strings.
 * This type is used when `stdioString: true` is set in spawn options.
 *
 * @property {string} stdout - Standard output as a string
 * @property {string} stderr - Standard error as a string
 */
export type SpawnErrorWithOutputString = SpawnError & {
  stdout: string
  stderr: string
}

/**
 * Spawn error variant where stdout and stderr are guaranteed to be Buffers.
 * This type is used when `stdioString: false` is set in spawn options.
 *
 * @property {Buffer} stdout - Standard output as a Buffer
 * @property {Buffer} stderr - Standard error as a Buffer
 */
export type SpawnErrorWithOutputBuffer = SpawnError & {
  stdout: Buffer
  stderr: Buffer
}

/**
 * Extra options passed to the underlying promise-spawn implementation.
 * This is an open-ended object for passing additional metadata or configuration.
 */
export type SpawnExtra = Record<string, unknown>

/**
 * Valid values for individual stdio streams.
 * - `'pipe'` - Creates a pipe between child and parent (default)
 * - `'ignore'` - Ignores the stream
 * - `'inherit'` - Uses parent's stream
 * - `'overlapped'` - Windows-specific overlapped I/O
 */
export type IOType = 'pipe' | 'ignore' | 'inherit' | 'overlapped'

/**
 * Configuration for process stdio (stdin, stdout, stderr) streams.
 * Can be a single value applied to all streams, or an array specifying each stream individually.
 * - `'ipc'` - Creates an IPC channel for communication with the parent
 *
 * @example
 * // All streams piped
 * stdio: 'pipe'
 *
 * @example
 * // Custom configuration per stream: [stdin, stdout, stderr]
 * stdio: ['ignore', 'pipe', 'pipe']
 */
export type StdioType = IOType | 'ipc' | Array<IOType | 'ipc'>

/**
 * Result object returned by {@link spawnSync} when the child process completes synchronously.
 *
 * @template T - Type of stdout/stderr (string or Buffer)
 * @property {number} pid - Process ID of the spawned child
 * @property {Array<T | null>} output - Array containing stdout/stderr values
 * @property {T} stdout - Standard output from the process
 * @property {T} stderr - Standard error from the process
 * @property {number | null} status - Exit code, or `null` if killed by signal
 * @property {NodeJS.Signals | null} signal - Signal that terminated the process, or `null`
 * @property {Error | undefined} error - Error object if the spawn failed
 */
export interface SpawnSyncReturns<T> {
  pid: number
  output: Array<T | null>
  stdout: T
  stderr: T
  status: number | null
  signal: NodeJS.Signals | null
  error?: Error | undefined
}

/**
 * Check if a value is a spawn error with expected error properties.
 * Tests for common error properties from child process failures.
 *
 * @param {unknown} value - Value to check
 * @returns {boolean} `true` if the value has spawn error properties
 *
 * @example
 * try {
 *   await spawn('nonexistent-command')
 * } catch (error) {
 *   if (isSpawnError(error)) {
 *     console.error(`Spawn failed: ${error.code}`)
 *   }
 * }
 */
/*@__NO_SIDE_EFFECTS__*/
export function isSpawnError(value: unknown): value is SpawnError {
  if (value === null || typeof value !== 'object') {
    return false
  }
  // Check for spawn-specific error properties.
  const err = value as Record<string, unknown>
  return (
    (hasOwn(err, 'code') && typeof err['code'] !== 'undefined') ||
    (hasOwn(err, 'errno') && typeof err['errno'] !== 'undefined') ||
    (hasOwn(err, 'syscall') && typeof err['syscall'] === 'string')
  )
}

/**
 * Check if stdio configuration matches a specific type.
 * When called with one argument, validates if it's a valid stdio type.
 * When called with two arguments, checks if the stdio config matches the specified type.
 *
 * @param {string | string[]} stdio - Stdio configuration to check
 * @param {StdioType | undefined} type - Expected stdio type (optional)
 * @returns {boolean} `true` if stdio matches the type or is valid
 *
 * @example
 * // Check if valid stdio type
 * isStdioType('pipe') // true
 * isStdioType('invalid') // false
 *
 * @example
 * // Check if stdio matches specific type
 * isStdioType('pipe', 'pipe') // true
 * isStdioType(['pipe', 'pipe', 'pipe'], 'pipe') // true
 * isStdioType('ignore', 'pipe') // false
 */
/*@__NO_SIDE_EFFECTS__*/
export function isStdioType(
  stdio: string | string[],
  type?: StdioType | undefined,
): boolean {
  // If called with one argument, check if it's a valid stdio type.
  // biome-ignore lint/complexity/noArguments: Function overload detection for single vs two-arg calls.
  if (arguments.length === 1) {
    const validTypes = ['pipe', 'ignore', 'inherit', 'overlapped']
    return typeof stdio === 'string' && validTypes.includes(stdio)
  }
  // Original two-argument behavior.
  return (
    stdio === type ||
    ((stdio === null || stdio === undefined) && type === 'pipe') ||
    (isArray(stdio) &&
      stdio.length > 2 &&
      stdio[0] === type &&
      stdio[1] === type &&
      stdio[2] === type)
  )
}

/**
 * Strip ANSI escape codes from spawn result stdout and stderr.
 * Modifies the result object in place to remove color codes and formatting.
 *
 * @param {unknown} result - Spawn result object with stdout/stderr properties
 * @returns {unknown} The modified result object
 */
/*@__NO_SIDE_EFFECTS__*/
function stripAnsiFromSpawnResult(result: unknown): unknown {
  const res = result as {
    stdout?: string | Buffer
    stderr?: string | Buffer
  }
  const { stderr, stdout } = res
  if (typeof stdout === 'string') {
    res.stdout = stripAnsi(stdout)
  }
  if (typeof stderr === 'string') {
    res.stderr = stripAnsi(stderr)
  }
  return res
}

/*@__NO_SIDE_EFFECTS__*/
// Duplicated from Node.js child_process.SpawnOptions
// These are the options passed to child_process.spawn()
interface NodeSpawnOptions {
  cwd?: string | URL | undefined
  env?: NodeJS.ProcessEnv | undefined
  argv0?: string | undefined
  stdio?: any
  detached?: boolean | undefined
  uid?: number | undefined
  gid?: number | undefined
  serialization?: 'json' | 'advanced' | undefined
  shell?: boolean | string | undefined
  windowsVerbatimArguments?: boolean | undefined
  windowsHide?: boolean | undefined
  signal?: AbortSignal | undefined
  timeout?: number | undefined
  killSignal?: NodeJS.Signals | number | undefined
}

// Duplicated from Node.js child_process.ChildProcess
// This represents a spawned child process
interface ChildProcessType {
  stdin: NodeJS.WritableStream | null
  stdout: NodeJS.ReadableStream | null
  stderr: NodeJS.ReadableStream | null
  readonly channel?: any
  readonly stdio: [
    NodeJS.WritableStream | null,
    NodeJS.ReadableStream | null,
    NodeJS.ReadableStream | null,
    NodeJS.ReadableStream | NodeJS.WritableStream | null | undefined,
    NodeJS.ReadableStream | NodeJS.WritableStream | null | undefined,
  ]
  readonly killed: boolean
  readonly pid?: number | undefined
  readonly connected: boolean
  readonly exitCode: number | null
  readonly signalCode: NodeJS.Signals | null
  readonly spawnargs: string[]
  readonly spawnfile: string
  kill(signal?: NodeJS.Signals | number): boolean
  send(message: any, callback?: (error: Error | null) => void): boolean
  send(
    message: any,
    sendHandle?: any | undefined,
    callback?: (error: Error | null) => void,
  ): boolean
  send(
    message: any,
    sendHandle?: any | undefined,
    options?: any | undefined,
    callback?: (error: Error | null) => void,
  ): boolean
  disconnect(): void
  unref(): void
  ref(): void
}

// Duplicated from Node.js stream.Writable
interface WritableStreamType {
  writable: boolean
  writableEnded: boolean
  writableFinished: boolean
  writableHighWaterMark: number
  writableLength: number
  writableObjectMode: boolean
  writableCorked: number
  destroyed: boolean
  write(
    chunk: any,
    encoding?: BufferEncoding | undefined,
    callback?: (error?: Error | null) => void,
  ): boolean
  write(chunk: any, callback?: (error?: Error | null) => void): boolean
  end(cb?: () => void): this
  end(chunk: any, cb?: () => void): this
  end(chunk: any, encoding?: BufferEncoding | undefined, cb?: () => void): this
  cork(): void
  uncork(): void
  destroy(error?: Error | undefined): this
}

/**
 * Options for spawning a child process with {@link spawn}.
 * Extends Node.js spawn options with additional Socket-specific functionality.
 *
 * @property {import('./spinner').Spinner | undefined} spinner - Spinner instance to pause during execution
 * @property {boolean | undefined} stdioString - Convert output to strings (default: `true`)
 * @property {boolean | undefined} stripAnsi - Remove ANSI codes from output (default: `true`)
 * @property {string | URL | undefined} cwd - Current working directory
 * @property {NodeJS.ProcessEnv | undefined} env - Environment variables
 * @property {StdioType | undefined} stdio - Stdio configuration
 * @property {boolean | string | undefined} shell - Run command in shell
 * @property {number | undefined} timeout - Timeout in milliseconds
 * @property {AbortSignal | undefined} signal - Abort signal
 * @property {number | undefined} uid - User identity (POSIX)
 * @property {number | undefined} gid - Group identity (POSIX)
 */
export type SpawnOptions = import('./objects').Remap<
  NodeSpawnOptions & {
    spinner?: import('./spinner').Spinner | undefined
    stdioString?: boolean
    stripAnsi?: boolean
  }
>
export type SpawnResult = PromiseSpawnResult
/**
 * Result object returned when a spawned process completes.
 *
 * @property {string} cmd - Command that was executed
 * @property {string[] | readonly string[]} args - Arguments passed to the command
 * @property {number} code - Process exit code
 * @property {NodeJS.Signals | null} signal - Signal that terminated the process, if any
 * @property {string | Buffer} stdout - Standard output (string if `stdioString: true`, Buffer otherwise)
 * @property {string | Buffer} stderr - Standard error (string if `stdioString: true`, Buffer otherwise)
 */
export type SpawnStdioResult = {
  cmd: string
  args: string[] | readonly string[]
  code: number
  signal: NodeJS.Signals | null
  stdout: string | Buffer
  stderr: string | Buffer
}

/**
 * Spawn a child process and return a promise that resolves when it completes.
 * Provides enhanced error handling, output capture, and cross-platform support.
 *
 * SECURITY: This function uses array-based arguments which prevent command injection.
 * Arguments in the `args` array are passed directly to the OS without shell
 * interpretation. Shell metacharacters (;|&$()`) are treated as literal strings,
 * not as commands or operators. This is the PRIMARY SECURITY DEFENSE.
 *
 * Even when shell: true is used (on Windows for .cmd/.bat execution), the array-based
 * approach remains secure because Node.js properly escapes each argument before passing
 * to the shell.
 *
 * @param {string} cmd - Command to execute (not user-controlled)
 * @param {string[] | readonly string[] | undefined} args - Array of arguments (safe even with user input)
 * @param {SpawnOptions | undefined} options - Spawn options for process configuration
 * @param {SpawnExtra | undefined} extra - Extra options for promise-spawn
 * @returns {SpawnResult} Promise that resolves with process exit information
 *
 * @throws {SpawnError} When the process exits with non-zero code or is terminated by signal
 *
 * @example
 * // Basic usage - spawn and wait for completion
 * const result = await spawn('git', ['status'])
 * console.log(result.stdout)
 *
 * @example
 * // With options - set working directory and environment
 * const result = await spawn('npm', ['install'], {
 *   cwd: '/path/to/project',
 *   env: { NODE_ENV: 'production' }
 * })
 *
 * @example
 * // ✔ DO THIS - Array-based arguments (safe)
 * spawn('git', ['commit', '-m', userMessage])
 * // Each argument is properly escaped, even if userMessage = "foo; rm -rf /"
 *
 * @example
 * // ✖ NEVER DO THIS - String concatenation (vulnerable)
 * spawn(`git commit -m "${userMessage}"`, { shell: true })
 * // Vulnerable to injection if userMessage = '"; rm -rf / #'
 *
 * @example
 * // Access stdin for interactive processes
 * const result = spawn('cat', [])
 * result.stdin?.write('Hello\n')
 * result.stdin?.end()
 * const { stdout } = await result
 * console.log(stdout) // 'Hello'
 *
 * @example
 * // Handle errors with exit codes
 * try {
 *   await spawn('exit', ['1'])
 * } catch (error) {
 *   if (isSpawnError(error)) {
 *     console.error(`Failed with code ${error.code}`)
 *     console.error(error.stderr)
 *   }
 * }
 */
export function spawn(
  cmd: string,
  args?: string[] | readonly string[],
  options?: SpawnOptions | undefined,
  extra?: SpawnExtra | undefined,
): SpawnResult {
  // Windows cmd.exe command resolution for .cmd/.bat/.ps1 files:
  //
  // When shell: true is used on Windows with script files (.cmd, .bat, .ps1),
  // cmd.exe can have issues executing full paths. The solution is to use just
  // the command basename without extension and let cmd.exe find it via PATH.
  //
  // How cmd.exe resolves commands:
  // 1. Searches current directory first
  // 2. Then searches each directory in PATH environment variable
  // 3. For each directory, tries extensions from PATHEXT (.COM, .EXE, .BAT, .CMD, etc.)
  // 4. Executes the first match found
  //
  // Example: Given 'C:\pnpm\pnpm.cmd' with shell: true
  // 1. Extract basename without extension: 'pnpm'
  // 2. cmd.exe searches PATH directories for 'pnpm'
  // 3. PATHEXT causes it to try 'pnpm.com', 'pnpm.exe', 'pnpm.bat', 'pnpm.cmd', etc.
  // 4. Finds and executes 'C:\pnpm\pnpm.cmd'
  //
  // This approach is consistent with how other tools handle Windows execution:
  // - npm's promise-spawn: uses which.sync() to find commands in PATH
  // - cross-spawn: spawns cmd.exe with escaped arguments
  // - execa: uses cross-spawn under the hood for Windows support
  //
  // See: https://github.com/nodejs/node/issues/3675
  const shell = getOwn(options, 'shell')
  // Inline WIN32 constant for coverage mode compatibility
  const WIN32 = process.platform === 'win32'
  let actualCmd = cmd
  if (WIN32 && shell && windowsScriptExtRegExp.test(actualCmd)) {
    const path = getPath()
    // Extract just the command name without path and extension.
    actualCmd = path.basename(actualCmd, path.extname(actualCmd))
  }
  const {
    spinner: optionsSpinner = spinner,
    stripAnsi: shouldStripAnsi = true,
    ...spawnOptions
  } = { __proto__: null, ...options } as SpawnOptions
  const spinnerInstance = optionsSpinner
  const { env, stdio, stdioString = true } = spawnOptions
  // The stdio option can be a string or an array.
  // https://nodejs.org/api/child_process.html#optionsstdio
  const wasSpinning = !!spinnerInstance?.isSpinning
  const shouldStopSpinner =
    wasSpinning && !isStdioType(stdio, 'ignore') && !isStdioType(stdio, 'pipe')
  const shouldRestartSpinner = shouldStopSpinner
  if (shouldStopSpinner) {
    spinnerInstance.stop()
  }
  const npmCliPromiseSpawn = getNpmcliPromiseSpawn()
  // Use __proto__: null to prevent prototype pollution when passing to
  // third-party code, Node.js built-ins, or JavaScript built-in methods.
  // https://github.com/npm/promise-spawn
  // https://github.com/nodejs/node/blob/v24.0.1/lib/child_process.js#L674-L678
  // Preserve Windows process.env Proxy behavior when no custom env is provided.
  // On Windows, process.env is a Proxy that provides case-insensitive access
  // (PATH vs Path vs path). Spreading creates a plain object that loses this.
  // Only spread when we have custom environment variables to merge.
  const envToUse = env
    ? ({
        __proto__: null,
        ...process.env,
        ...env,
      } as unknown as NodeJS.ProcessEnv)
    : process.env

  const promiseSpawnOpts = {
    __proto__: null,
    cwd: typeof spawnOptions.cwd === 'string' ? spawnOptions.cwd : undefined,
    env: envToUse,
    signal: abortSignal,
    stdio: spawnOptions.stdio,
    stdioString,
    shell: spawnOptions.shell,
    timeout: spawnOptions.timeout,
    uid: spawnOptions.uid,
    gid: spawnOptions.gid,
  } as unknown as PromiseSpawnOptions
  const spawnPromise = npmCliPromiseSpawn(
    actualCmd,
    args ? [...args] : [],
    promiseSpawnOpts as Parameters<typeof npmCliPromiseSpawn>[2],
    extra,
  )
  const oldSpawnPromise = spawnPromise
  let newSpawnPromise: PromiseSpawnResult
  if (shouldStripAnsi && stdioString) {
    newSpawnPromise = spawnPromise
      .then(result => {
        const strippedResult = stripAnsiFromSpawnResult(result)
        // Add exitCode as an alias for code.
        if ('code' in (strippedResult as { code?: number })) {
          ;(strippedResult as { code: number; exitCode: number }).exitCode = (
            strippedResult as { code: number }
          ).code
        }
        return strippedResult
      })
      .catch(error => {
        throw stripAnsiFromSpawnResult(error)
      }) as PromiseSpawnResult
  } else {
    newSpawnPromise = spawnPromise.then(result => {
      // Add exitCode as an alias for code.
      if ('code' in result) {
        const res = result as typeof result & { exitCode: number }
        res.exitCode = result.code
        return res
      }
      return result
    }) as PromiseSpawnResult
  }
  if (shouldRestartSpinner) {
    newSpawnPromise = newSpawnPromise.finally(() => {
      spinnerInstance.start()
    }) as PromiseSpawnResult
  }
  // Copy process and stdin properties from original promise
  ;(newSpawnPromise as unknown as PromiseSpawnResult).process =
    oldSpawnPromise.process
  ;(newSpawnPromise as unknown as PromiseSpawnResult).stdin = (
    oldSpawnPromise as unknown as PromiseSpawnResult
  ).stdin
  return newSpawnPromise as SpawnResult
}

/*@__NO_SIDE_EFFECTS__*/
/**
 * Options for synchronously spawning a child process with {@link spawnSync}.
 * Same as {@link SpawnOptions} but excludes the `spinner` property (not applicable for synchronous execution).
 */
export type SpawnSyncOptions = Omit<SpawnOptions, 'spinner'>

/**
 * Synchronously spawn a child process and wait for it to complete.
 * Blocks execution until the process exits, returning all output and exit information.
 *
 * WARNING: This function blocks the event loop. Use {@link spawn} for async operations.
 *
 * @param {string} cmd - Command to execute
 * @param {string[] | readonly string[] | undefined} args - Array of arguments
 * @param {SpawnSyncOptions | undefined} options - Spawn options for process configuration
 * @returns {SpawnSyncReturns<string | Buffer>} Process result with exit code and captured output
 *
 * @example
 * // Basic synchronous spawn
 * const result = spawnSync('git', ['status'])
 * console.log(result.stdout)
 * console.log(result.status) // exit code
 *
 * @example
 * // With options
 * const result = spawnSync('npm', ['install'], {
 *   cwd: '/path/to/project',
 *   stdioString: true
 * })
 * if (result.status !== 0) {
 *   console.error(result.stderr)
 * }
 *
 * @example
 * // Get raw buffer output
 * const result = spawnSync('cat', ['binary-file'], {
 *   stdioString: false
 * })
 * console.log(result.stdout) // Buffer
 *
 * @example
 * // Handle process errors
 * const result = spawnSync('nonexistent-command')
 * if (result.error) {
 *   console.error('Failed to spawn:', result.error)
 * }
 */
export function spawnSync(
  cmd: string,
  args?: string[] | readonly string[],
  options?: SpawnSyncOptions | undefined,
): SpawnSyncReturns<string | Buffer> {
  // Windows cmd.exe command resolution for .cmd/.bat/.ps1 files:
  // See spawn() function above for detailed explanation of this approach.
  const shell = getOwn(options, 'shell')
  // Inline WIN32 constant for coverage mode compatibility
  const WIN32 = process.platform === 'win32'
  let actualCmd = cmd
  if (WIN32 && shell && windowsScriptExtRegExp.test(actualCmd)) {
    const path = getPath()
    // Extract just the command name without path and extension.
    actualCmd = path.basename(actualCmd, path.extname(actualCmd))
  }
  const { stripAnsi: shouldStripAnsi = true, ...rawSpawnOptions } = {
    __proto__: null,
    ...options,
  } as SpawnSyncOptions
  const { stdioString: rawStdioString = true } = rawSpawnOptions
  const rawEncoding = rawStdioString ? 'utf8' : 'buffer'
  const spawnOptions = {
    encoding: rawEncoding,
    ...rawSpawnOptions,
  } as NodeSpawnOptions & { encoding: BufferEncoding | 'buffer' }
  const stdioString = spawnOptions.encoding !== 'buffer'
  const result = getChildProcess().spawnSync(actualCmd, args, spawnOptions)
  if (stdioString) {
    const { stderr, stdout } = result
    if (stdout) {
      result.stdout = stdout.toString().trim()
    }
    if (stderr) {
      result.stderr = stderr.toString().trim()
    }
  }
  return (
    shouldStripAnsi && stdioString ? stripAnsiFromSpawnResult(result) : result
  ) as SpawnSyncReturns<string | Buffer>
}
