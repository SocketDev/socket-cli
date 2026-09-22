import { spawn as spawnChildProcess } from 'node:child_process'
import { constants, readFileSync, realpathSync } from 'node:fs'
import { access, lstat, readFile, realpath, statfs } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'

type ScriptMeta = {
  describe: string
  help: string
  json?: 'native' | 'result' | undefined
}

type ScratchSystem = {
  access: (path: string, mode: number) => Promise<void>
  lstat: (
    path: string,
  ) => Promise<{ dev: number; ino: number; isDirectory: () => boolean }>
  realpath: (path: string) => Promise<string>
  statfs: (
    path: string,
  ) => Promise<{ bavail: bigint; bsize: bigint; type: bigint }>
}

export type RunnerResourceScratch = {
  mount: string
  path: string
  device: number
  inode: number
  bytes: number
  filesystemType: number
}

export const RUNNER_RESOURCE_SCRIPT_META = {
  describe:
    'prepares bounded swap capacity on small GitHub-hosted Linux runners',
  help: 'Usage: node .github/actions/fleet/setup-and-install/setup-runner-resources.mts [--json]',
  json: 'native' as const,
}

function scriptBasename(): string {
  return process.argv[1]?.split(/[\\/]/u).pop() || 'script'
}

function repoVersion(): string {
  try {
    const parsed = JSON.parse(readFileSync('package.json', 'utf8')) as {
      version?: string | undefined
    }
    return parsed.version || '0.0.0'
  } catch {
    return '0.0.0'
  }
}

function scriptError(error: unknown): string {
  // oxlint-disable-next-line socket/prefer-error-message-helper, socket/prefer-socket-lib-error-message -- dependency-free preinstall
  return error instanceof Error ? error.message : String(error)
}

export async function readRunnerResource(
  path: string,
): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8')
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return undefined
    }
    throw new Error(
      'Runner resource preparation failed. Where: hosted Linux setup. Saw unreadable resource metadata; wanted verified memory and swap capacity. Fix: use a runner with sufficient resources and a visible cgroup v2 hierarchy.',
    )
  }
}

async function readRunnerScratchStats(
  path: string,
): Promise<{ bavail: bigint; bsize: bigint; type: bigint }> {
  return await statfs(path, { bigint: true })
}

function isValidRunnerScratchStats(
  info: { dev: number; ino: number },
  bytes: number,
  filesystemType: number,
): boolean {
  return (
    Number.isSafeInteger(info.dev) &&
    info.dev >= 0 &&
    Number.isSafeInteger(info.ino) &&
    info.ino >= 0 &&
    Number.isSafeInteger(bytes) &&
    bytes >= 0 &&
    Number.isSafeInteger(filesystemType)
  )
}

export async function selectRunnerResourceScratch(
  candidates: string[],
  system: ScratchSystem = {
    access,
    lstat,
    realpath,
    statfs: readRunnerScratchStats,
  },
): Promise<RunnerResourceScratch> {
  const seen = new Set<string>()
  const available: RunnerResourceScratch[] = []
  for (let index = 0, { length } = candidates; index < length; index += 1) {
    const candidate = candidates[index]!
    if (!candidate || !path.isAbsolute(candidate)) {
      continue
    }
    try {
      const path = await system.realpath(candidate)
      if (seen.has(path)) {
        continue
      }
      seen.add(path)
      const info = await system.lstat(path)
      if (!info.isDirectory()) {
        continue
      }
      // oxlint-disable-next-line socket/prefer-exists-sync -- writability probe
      await system.access(path, constants.W_OK)
      const stats = await system.statfs(path)
      const bytes = Number(stats.bavail * stats.bsize)
      const filesystemType = Number(stats.type)
      if (isValidRunnerScratchStats(info, bytes, filesystemType)) {
        available.push({
          mount: candidate,
          path,
          device: info.dev,
          inode: info.ino,
          bytes,
          filesystemType,
        })
      }
    } catch {}
  }
  available.sort((left, right) => right.bytes - left.bytes)
  const selected = available[0]
  if (!selected) {
    throw new Error(
      'Runner resource preparation failed. Where: hosted Linux scratch selection. Saw no writable filesystem with measurable free space; wanted verified swap storage. Fix: use a runner with a writable temporary or /mnt directory.',
    )
  }
  return selected
}

function renderScriptResult(error: string): string {
  return JSON.stringify({ ok: false, exitCode: 1, error })
}

function bareDoubleDashMessage(): string {
  const name = scriptBasename()
  return (
    'a bare `--` in the command line\n' +
    `  Where: the argv for ${name}.\n` +
    '  Saw:   flags after `--`. The argv parser truncates there, so those flags were NOT applied and the script ran with its defaults.\n' +
    `  Fix:   drop the \`--\`, e.g. \`pnpm run ${name} --dry-run\`.`
  )
}

function describeManifest(meta: ScriptMeta): string {
  return JSON.stringify(
    {
      $schema:
        'https://raw.githubusercontent.com/SocketDev/socket-wheelhouse/main/schemas/cli-describe.schema.json',
      name: scriptBasename(),
      version: repoVersion(),
      description: meta.describe,
    },
    undefined,
    2,
  )
}

export function isRunnerResourceMain(url: string): boolean {
  const entry = process.argv[1]
  if (!entry) {
    return false
  }
  try {
    return pathToFileURL(realpathSync(entry)).href === url
  } catch {
    return false
  }
}

export async function runRunnerResourceMain(
  main: () => Promise<void>,
  meta: ScriptMeta,
): Promise<void> {
  const argv = process.argv.slice(2)
  const json = argv.includes('--json')
  if (argv.includes('--describe')) {
    // oxlint-disable-next-line socket/no-direct-stream-write -- dep-0
    process.stdout.write(`${json ? describeManifest(meta) : meta.describe}\n`)
    process.exitCode = 0
    return
  }
  if (argv.includes('-h') || argv.includes('--help')) {
    // oxlint-disable-next-line socket/no-direct-stream-write -- dep-0
    process.stdout.write(`${meta.describe}\n\n${meta.help}\n`)
    process.exitCode = 0
    return
  }
  if (json && !meta.json) {
    // oxlint-disable-next-line socket/no-direct-stream-write -- dep-0
    process.stdout.write(
      `${renderScriptResult('This script has not declared JSON execution support.')}\n`,
    )
    process.exitCode = 1
    return
  }
  if (argv.includes('--')) {
    const error = bareDoubleDashMessage()
    ;(json ? process.stdout : process.stderr).write(
      `${json ? renderScriptResult(error) : error}\n`,
    )
    process.exitCode = 1
    return
  }
  try {
    await main()
    process.exitCode ??= 0
  } catch (error) {
    const message = scriptError(error)
    ;(json ? process.stdout : process.stderr).write(
      `${json ? renderScriptResult(message) : message}\n`,
    )
    process.exitCode = 1
  }
}

export function writeRunnerResourceResult(result: unknown): void {
  // oxlint-disable-next-line socket/no-direct-stream-write -- dep-0
  process.stdout.write(
    `${process.argv.includes('--json') ? JSON.stringify(result) : `Runner resources: ${JSON.stringify(result)}`}\n`,
  )
}

export function spawnRunnerResourceCommand(
  command: string,
  args: string[],
  stdio: 'ignore',
  timeout: number,
): Promise<{ code: number }> {
  return new Promise(resolve => {
    const child = spawnChildProcess(command, args, {
      detached: true,
      stdio,
    })
    let settled = false
    function finish(code: number): void {
      if (!settled) {
        settled = true
        clearTimeout(timer)
        resolve({ code })
      }
    }
    const timer = setTimeout(() => {
      try {
        if (child.pid) {
          process.kill(-child.pid, 'SIGKILL')
        }
      } catch {
        child.kill('SIGKILL')
      }
      finish(-1)
    }, timeout)
    child.once('error', () => finish(-1))
    child.once('exit', code => finish(code ?? -1))
  })
}
