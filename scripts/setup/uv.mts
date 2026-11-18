import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import {
  access,
  appendFile,
  lstat,
  mkdtemp,
  rm,
  writeFile,
} from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { isMainModule } from '../lib/is-main-module.mts'
import { runMain } from '../lib/run-main.mts'

const execFile = promisify(execFileCallback)
const UV_VERSION = '0.12.15'
const UV_DIGESTS = {
  arm64:
    'wtjxaDy/A91/eSUbn927LdJEsQy9JRpFfmaXqOxiSafoi+wHEFaNWvjxOpqwoMAky7UrBd0icT6PCttBpagKvA==',
  x64: 'HnyqtvfbH/vq3MTydIYAbCr6hS8kC8kuZpXxrGJ/Nr2dac/wJQA3Z6S9bx95TYCTBdOZ1kPbDjtrzfIgwi4xDw==',
}

export interface UvRelease {
  archiveRoot: string
  asset: string
  digest: string
  version: string
}

export interface UvSetupOptions {
  arch?: string
  githubPath: string | undefined
  platform?: string
  runnerTemp: string | undefined
}

export interface UvSetupDependencies {
  extract?: (archive: string, destination: string) => Promise<void>
  fetcher?: typeof fetch
  probe?: (executable: string) => Promise<string>
  release?: UvRelease
}

export class UvSetupError extends Error {
  readonly code: string

  constructor(code: string, location: string, observed: string) {
    super(
      '[setup-uv] could not install uv.\n' +
        '  Where: ' +
        location +
        '.\n' +
        '  Saw: ' +
        observed +
        '; wanted a verified Linux uv release.\n' +
        '  Fix: check runner paths and GitHub availability, then retry.',
    )
    this.code = code
  }
}

export function uvSetupRelease(platform: string, arch: string): UvRelease {
  if (platform !== 'linux' || (arch !== 'x64' && arch !== 'arm64')) {
    throw new UvSetupError(
      'UNSUPPORTED_PLATFORM',
      'the runner',
      'a platform outside Linux x64 or arm64',
    )
  }
  const target = arch === 'x64' ? 'x86_64' : 'aarch64'
  const archiveRoot = 'uv-' + target + '-unknown-linux-gnu'
  return {
    archiveRoot,
    asset: archiveRoot + '.tar.gz',
    digest: UV_DIGESTS[arch],
    version: UV_VERSION,
  }
}

function uvSetupPath(value: string | undefined, name: string): string {
  if (!value || !path.isAbsolute(value) || /[\r\n]/.test(value)) {
    throw new UvSetupError(
      'INVALID_RUNNER_PATH',
      name,
      'a missing or invalid absolute path',
    )
  }
  return value
}

async function extractUvArchive(archive: string, destination: string) {
  await execFile(
    'tar',
    [
      '-xzf',
      archive,
      '-C',
      destination,
      '--no-same-owner',
      '--no-same-permissions',
    ],
    { timeout: 120_000 },
  )
}

async function probeUvVersion(executable: string): Promise<string> {
  const { stdout } = await execFile(executable, ['--version'], {
    timeout: 15_000,
  })
  return stdout
}

export async function installUvForCi(
  options: UvSetupOptions,
  dependencies: UvSetupDependencies = {},
): Promise<{ bin: string; version: string }> {
  const pinnedRelease = uvSetupRelease(
    options.platform ?? process.platform,
    options.arch ?? process.arch,
  )
  const githubPath = uvSetupPath(options.githubPath, 'GITHUB_PATH')
  const runnerTemp = uvSetupPath(options.runnerTemp, 'RUNNER_TEMP')
  const release = dependencies.release ?? pinnedRelease
  const fetcher = dependencies.fetcher ?? fetch
  const extract = dependencies.extract ?? extractUvArchive
  const probe = dependencies.probe ?? probeUvVersion
  const url =
    'https://github.com/astral-sh/uv/releases/download/' +
    release.version +
    '/' +
    release.asset
  let bytes: Buffer
  try {
    const response = await fetcher(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(120_000),
    })
    if (response.status !== 200) {
      throw new UvSetupError('DOWNLOAD_FAILED', url, 'HTTP ' + response.status)
    }
    bytes = Buffer.from(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof UvSetupError) {
      throw error
    }
    throw new UvSetupError('DOWNLOAD_FAILED', url, 'a failed download')
  }
  if (createHash('sha512').update(bytes).digest('base64') !== release.digest) {
    throw new UvSetupError(
      'CHECKSUM_MISMATCH',
      release.asset,
      'a SHA-512 digest mismatch',
    )
  }
  const directory = await mkdtemp(path.join(runnerTemp, 'socket-uv-'))
  try {
    const archive = path.join(directory, release.asset)
    const bin = path.join(directory, release.archiveRoot)
    const executable = path.join(bin, 'uv')
    await writeFile(archive, bytes)
    await extract(archive, directory)
    if (!(await lstat(executable)).isFile()) {
      throw new UvSetupError('INSTALL_FAILED', executable, 'no regular uv file')
    }
    await access(executable, constants.X_OK)
    const version = (await probe(executable)).trim().split(/\s+/)
    if (version[0] !== 'uv' || version[1] !== release.version) {
      throw new UvSetupError(
        'VERSION_MISMATCH',
        executable,
        'an unexpected uv version',
      )
    }
    await rm(archive)
    await appendFile(githubPath, bin + '\n')
    return { bin, version: release.version }
  } catch (error) {
    await rm(directory, { force: true, recursive: true })
    if (error instanceof UvSetupError) {
      throw error
    }
    throw new UvSetupError(
      'INSTALL_FAILED',
      directory,
      'an extraction, executable, or PATH update failure',
    )
  }
}

if (isMainModule(import.meta.url)) {
  runMain(
    async () => {
      const argv = process.argv.slice(2)
      if (argv.some(argument => argument !== '--json')) {
        throw new UvSetupError(
          'INVALID_ARGUMENT',
          'the command line',
          'an unsupported argument',
        )
      }
      const result = await installUvForCi({
        githubPath: process.env['GITHUB_PATH'],
        runnerTemp: process.env['RUNNER_TEMP'],
      })
      process.stdout.write(
        argv.includes('--json')
          ? JSON.stringify(result) + '\n'
          : '[setup-uv] installed uv ' + result.version + '.\n',
      )
    },
    {
      describe: 'Install pinned, SHA-512 verified uv for Linux CI',
      help: 'Usage: pnpm run ci:setup-uv [--json]',
    },
  )
}
