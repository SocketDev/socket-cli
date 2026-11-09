import { createHash } from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import { Readable, type Writable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'

import type { StdioOptions } from 'node:child_process'

/**
 * SEA runtime adapters. Node 27 VFS Workers share the parent PID, so these are
 * for allowlisted JavaScript tools that are compatible with Worker threads;
 * native helpers use getBundledTool() and a real child process instead.
 */
export interface EmbeddedToolRunOptions {
  cwd?: string | URL | undefined
  env?: NodeJS.ProcessEnv | undefined
  /** True (default) merges process.env with env; false uses only defined env entries. */
  inheritEnv?: boolean | undefined
  /** Explicit Socket metadata for the Worker; this is workerData, not process IPC. */
  ipc?: Readonly<Record<string, string | boolean | undefined>> | undefined
  stdio?: StdioOptions | undefined
  stdin?:
    | string
    | Buffer
    | NodeJS.ReadableStream
    | AsyncIterable<string | Uint8Array>
    | undefined
  stdout?: Writable | undefined
  stderr?: Writable | undefined
  signal?: AbortSignal | undefined
}

export interface EmbeddedToolRunResult {
  code: number | null
  signal: NodeJS.Signals | null
  cancelled?: boolean
  stdout?: string
  stderr?: string
}

const sea = (() => {
  try {
    return createRequire(import.meta.url)('node:sea') as {
      isSea?: () => boolean
      getAsset?: (key: string) => ArrayBuffer | Uint8Array
    }
  } catch {
    // The regular Socket CLI supports Node releases predating `node:sea`.
    return {}
  }
})()

const extractedToolDirectories = new Map<string, string>()
type SeaGlobal = typeof globalThis & { __socketSeaVfsRoot?: string }

// These are the only JS entrypoints the Worker adapter may launch. The paths
// are staged under the archive root by a later helper-payload build slice;
// absent files remain unavailable and fail closed here.
const embeddedJsToolEntrypoints = Object.freeze({
  cdxgen: 'tools/cdxgen/sea-worker.mjs',
  synp: 'tools/synp/bin/synp.js',
})

const embeddedNativeToolPaths = Object.freeze({
  uv: (platform: string) =>
    `tools/uv/${platform === 'win32' ? 'uv.exe' : 'uv'}`,
})

function getVfsRoot(): string {
  const root = (globalThis as SeaGlobal).__socketSeaVfsRoot
  if (!root) {
    throw new Error('The standalone Socket VFS root is not available')
  }
  return root
}

function signalFromAbortReason(reason: unknown): NodeJS.Signals | null {
  const code =
    reason !== null && typeof reason === 'object'
      ? (reason as { code?: unknown }).code
      : undefined
  return typeof code === 'string' &&
    [
      'SIGABRT',
      'SIGALRM',
      'SIGBUS',
      'SIGCHLD',
      'SIGCONT',
      'SIGFPE',
      'SIGHUP',
      'SIGILL',
      'SIGINT',
      'SIGIO',
      'SIGIOT',
      'SIGKILL',
      'SIGPIPE',
      'SIGPOLL',
      'SIGPROF',
      'SIGPWR',
      'SIGQUIT',
      'SIGSEGV',
      'SIGSTKFLT',
      'SIGSTOP',
      'SIGSYS',
      'SIGTERM',
      'SIGTRAP',
      'SIGTSTP',
      'SIGTTIN',
      'SIGTTOU',
      'SIGURG',
      'SIGUSR1',
      'SIGUSR2',
      'SIGVTALRM',
      'SIGWINCH',
      'SIGXCPU',
      'SIGXFSZ',
    ].includes(code)
    ? (code as NodeJS.Signals)
    : null
}

export function isStandaloneSea(): boolean {
  return typeof sea.isSea === 'function' && sea.isSea()
}

export function getEmbeddedAsset(id: string): Buffer {
  if (!isStandaloneSea()) {
    throw new Error(
      `Embedded asset '${id}' is available only in the standalone Socket build`,
    )
  }
  const files: Record<string, string> = {
    'socket-patch': `resources/${process.platform === 'win32' ? 'socket-patch.exe' : 'socket-patch'}`,
    'socket-patch-sha256': 'resources/socket-patch.sha256',
  }
  const relative = files[id]
  const root = (globalThis as SeaGlobal).__socketSeaVfsRoot
  if (!relative || !root) {
    throw new Error(
      `Standalone Socket asset '${id}' is missing from this build`,
    )
  }
  try {
    return readFileSync(path.join(root, relative))
  } catch {
    throw new Error(
      `Standalone Socket asset '${id}' is missing from this build`,
    )
  }
}

/** Fail closed unless the build manifest explicitly advertises this tool. */
export function assertEmbeddedToolAvailable(
  id: 'cdxgen' | 'synp',
  capability?: 'manifest-cdxgen-npm-lock-v3' | 'manifest-cdxgen-yarn-classic',
): void {
  if (!isStandaloneSea()) {
    return
  }
  const root = (globalThis as SeaGlobal).__socketSeaVfsRoot
  let capabilities: unknown
  try {
    if (!root) {
      throw new Error('missing VFS root')
    }
    capabilities = JSON.parse(
      readFileSync(path.join(root, 'resources/capabilities.json'), 'utf8'),
    )
  } catch {
    throw new Error(
      `Embedded ${id} is unavailable because tool capabilities are missing or invalid in this build.`,
    )
  }
  if (
    capabilities === null ||
    typeof capabilities !== 'object' ||
    Array.isArray(capabilities) ||
    !Array.isArray((capabilities as { available?: unknown }).available) ||
    !Array.isArray((capabilities as { unavailable?: unknown }).unavailable)
  ) {
    throw new Error(
      `Embedded ${id} is unavailable because tool capabilities are missing or invalid in this build.`,
    )
  }
  const manifest = capabilities as {
    available: unknown[]
    unavailable: unknown[]
  }
  const required = capability
    ? [capability]
    : id === 'cdxgen'
      ? ['manifest-cdxgen-npm-lock-v3', 'manifest-cdxgen-yarn-classic']
      : ['synp']
  if (required.some(tool => manifest.available.includes(tool))) {
    return
  }
  const unavailableIds = id === 'cdxgen' ? [...required, id] : [id]
  const reasons = manifest.unavailable.flatMap(entry => {
    if (entry === null || typeof entry !== 'object') {
      return []
    }
    const { id: unavailableId, reason } = entry as {
      id?: unknown
      reason?: unknown
    }
    return unavailableIds.includes(unavailableId as string) &&
      typeof reason === 'string'
      ? [reason]
      : []
  })
  const reason = reasons.length ? ` ${[...new Set(reasons)].join(' ')}` : ''
  throw new Error(
    `Embedded ${id} is unavailable in this standalone build.${reason}`,
  )
}

export async function getBundledTool(id: string): Promise<string> {
  if (id !== 'socket-patch' && id !== 'uv') {
    throw new Error(
      `Bundled tool '${id}' is not configured in this SEA foundation`,
    )
  }
  if (!isStandaloneSea()) {
    throw new Error(
      `Bundled tool '${id}' is available only in the standalone Socket build`,
    )
  }

  if (id === 'uv') {
    const relative = embeddedNativeToolPaths.uv(process.platform)
    const source = path.join(getVfsRoot(), relative)
    const binary = await fs.readFile(source)
    const expectedDigest = await fs.readFile(
      path.join(getVfsRoot(), 'tools/uv/uv.sha256'),
      'utf8',
    )
    const actualDigest = createHash('sha256').update(binary).digest('hex')
    if (
      !/^[a-f0-9]{64}$/.test(expectedDigest.trim()) ||
      actualDigest !== expectedDigest.trim()
    ) {
      throw new Error('Embedded uv payload failed SHA-256 verification')
    }
    const directory = await fs.mkdtemp(
      path.join(os.tmpdir(), 'socket-cli-sea-'),
    )
    const filename = path.join(directory, path.basename(relative))
    try {
      await fs.writeFile(filename, binary, { flag: 'wx', mode: 0o700 })
      if (process.platform !== 'win32') {
        await fs.chmod(filename, 0o700)
      }
      extractedToolDirectories.set(filename, directory)
      return filename
    } catch (error) {
      await fs.rm(directory, { recursive: true, force: true })
      throw error
    }
  }

  const binary = getEmbeddedAsset('socket-patch')
  const expectedDigest = getEmbeddedAsset('socket-patch-sha256')
    .toString('utf8')
    .trim()
  const actualDigest = createHash('sha256').update(binary).digest('hex')
  if (
    !/^[a-f0-9]{64}$/.test(expectedDigest) ||
    actualDigest !== expectedDigest
  ) {
    throw new Error('Embedded socket-patch payload failed SHA-256 verification')
  }

  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'socket-cli-sea-'))
  const filename = path.join(
    directory,
    process.platform === 'win32' ? 'socket-patch.exe' : 'socket-patch',
  )
  try {
    await fs.writeFile(filename, binary, { flag: 'wx', mode: 0o700 })
    if (process.platform !== 'win32') {
      await fs.chmod(filename, 0o700)
    }
    extractedToolDirectories.set(filename, directory)
    return filename
  } catch (error) {
    await fs.rm(directory, { recursive: true, force: true })
    throw error
  }
}

export async function cleanupBundledTool(filename: string): Promise<void> {
  const directory = extractedToolDirectories.get(filename)
  if (!directory) {
    return
  }
  extractedToolDirectories.delete(filename)
  await fs.rm(directory, { recursive: true, force: true })
}

export async function runEmbeddedJsTool(
  id: string,
  args: readonly string[],
  options: EmbeddedToolRunOptions = {},
): Promise<EmbeddedToolRunResult> {
  if (!isStandaloneSea()) {
    throw new Error(
      `Embedded JavaScript tool '${id}' is available only in the standalone Socket build`,
    )
  }
  if (!Object.hasOwn(embeddedJsToolEntrypoints, id)) {
    throw new Error(`Embedded JavaScript tool '${id}' is not allowlisted`)
  }
  if (id === 'cdxgen' || id === 'synp') {
    assertEmbeddedToolAvailable(id)
  }
  if (options.signal?.aborted) {
    return {
      code: null,
      signal: signalFromAbortReason(options.signal.reason),
      cancelled: true,
    }
  }

  // Worker threads inherit cwd and Node does not support changing it per
  // Worker. Reject a different request rather than process.chdir() in the
  // shared parent process.
  const requestedCwd =
    options.cwd instanceof URL ? fileURLToPath(options.cwd) : options.cwd
  if (requestedCwd && path.resolve(requestedCwd) !== process.cwd()) {
    throw new Error(
      `Embedded JavaScript tool '${id}' cannot change cwd in a VFS Worker; ` +
        'run Socket from the target project directory.',
    )
  }

  const entrypoint = path.join(
    getVfsRoot(),
    embeddedJsToolEntrypoints[id as keyof typeof embeddedJsToolEntrypoints],
  )
  if (!existsSync(entrypoint)) {
    throw new Error(
      `Embedded JavaScript tool '${id}' is unavailable because its VFS entrypoint is not bundled for this target.`,
    )
  }

  const requestedStdio = options.stdio ?? 'inherit'
  if (
    requestedStdio !== 'inherit' &&
    requestedStdio !== 'ignore' &&
    requestedStdio !== 'pipe'
  ) {
    throw new Error(
      `Embedded JavaScript tool '${id}' supports only inherit, ignore, or pipe stdio in a VFS Worker.`,
    )
  }
  const stdio = requestedStdio
  const wantsStreams = stdio !== 'ignore'
  const pipeInput = options.stdin
  const captureStdout: Buffer[] = []
  const captureStderr: Buffer[] = []
  const worker = new Worker(entrypoint, {
    argv: [...args],
    env:
      options.inheritEnv === false
        ? Object.fromEntries(
            Object.entries(options.env ?? {}).filter(
              (entry): entry is [string, string] => entry[1] !== undefined,
            ),
          )
        : { ...process.env, ...options.env },
    execArgv: [],
    workerData: { socketIpc: options.ipc },
    stdin: wantsStreams,
    // Always capture Worker stdio. In ignore mode we drain it below so it
    // cannot inherit the CLI's streams or stall on a full pipe.
    stdout: true,
    stderr: true,
  })

  if (wantsStreams && worker.stdin) {
    if (pipeInput !== undefined) {
      const input =
        typeof pipeInput === 'string' || Buffer.isBuffer(pipeInput)
          ? Readable.from([pipeInput])
          : Symbol.asyncIterator in Object(pipeInput)
            ? Readable.from(pipeInput as AsyncIterable<string | Uint8Array>)
            : (pipeInput as NodeJS.ReadableStream)
      input.pipe(worker.stdin)
    } else if (stdio === 'inherit') {
      process.stdin.pipe(worker.stdin)
    } else {
      worker.stdin.end()
    }
  }

  const outputTarget = (kind: 'stdout' | 'stderr'): Writable | undefined => {
    const explicit = options[kind]
    if (explicit) {
      return explicit
    }
    if (stdio === 'inherit') {
      return kind === 'stdout' ? process.stdout : process.stderr
    }
    return undefined
  }
  const stdoutTarget = outputTarget('stdout')
  const stderrTarget = outputTarget('stderr')
  if (!wantsStreams) {
    worker.stdout?.resume()
    worker.stderr?.resume()
  }
  if (wantsStreams && worker.stdout) {
    if (stdoutTarget) {
      worker.stdout.pipe(stdoutTarget, { end: false })
    } else if (stdio === 'pipe') {
      worker.stdout.on('data', chunk => captureStdout.push(Buffer.from(chunk)))
    }
  }
  if (wantsStreams && worker.stderr) {
    if (stderrTarget) {
      worker.stderr.pipe(stderrTarget, { end: false })
    } else if (stdio === 'pipe') {
      worker.stderr.on('data', chunk => captureStderr.push(Buffer.from(chunk)))
    }
  }

  let cancelled = false
  const onAbort = () => {
    cancelled = true
    void worker.terminate()
  }
  options.signal?.addEventListener('abort', onAbort, { once: true })

  try {
    const code = await new Promise<number>((resolve, reject) => {
      worker.once('error', reject)
      worker.once('exit', resolve)
    })
    return {
      code: cancelled ? null : code,
      signal: cancelled ? signalFromAbortReason(options.signal?.reason) : null,
      ...(cancelled ? { cancelled: true } : {}),
      ...(stdio === 'pipe'
        ? {
            stdout: Buffer.concat(captureStdout).toString(),
            stderr: Buffer.concat(captureStderr).toString(),
          }
        : {}),
    }
  } finally {
    options.signal?.removeEventListener('abort', onAbort)
    if (stdio === 'inherit' && !pipeInput && worker.stdin) {
      process.stdin.unpipe(worker.stdin)
    }
    if (worker.stdout && stdoutTarget) {
      worker.stdout.unpipe(stdoutTarget)
    }
    if (worker.stderr && stderrTarget) {
      worker.stderr.unpipe(stderrTarget)
    }
  }
}
