import { execFile as execFileCallback } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { access, appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const execFile = promisify(execFileCallback)
const NODE_DIST_URL = 'https://nodejs.org/dist'
const EXACT_VERSION = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DESCRIPTION =
  'installs verified Node.js for Linux CI and adds its bin directory to GITHUB_PATH'

export type NodeSetupVersion =
  | { kind: 'exact'; version: string }
  | { kind: 'major'; major: number }

export type NodeSetupOptions = {
  arch?: string
  githubPath: string | undefined
  platform?: string
  runnerTemp: string | undefined
  version: string
}

export type NodeSetupInstallResult = { bin: string; version: string }

export type NodeSetupDependencies = {
  extract?: (archive: string, destination: string) => Promise<void>
  fetcher?: typeof fetch
}

export type NodeSetupRunDependencies = {
  env?: NodeJS.ProcessEnv
  install?: (options: NodeSetupOptions) => Promise<NodeSetupInstallResult>
  stderr?: (text: string) => void
  stdout?: (text: string) => void
}

export class NodeSetupError extends Error {
  readonly code: string

  constructor(code: string, location: string, observed: string) {
    super(
      '[setup-node] could not install Node.js.\n' +
        `  Where: ${location}.\n` +
        `  Saw: ${observed}; wanted a verified Linux Node.js release.\n` +
        '  Fix: check the version, runner paths, and nodejs.org availability, then retry.',
    )
    this.code = code
  }
}

export function parseNodeSetupVersion(wanted: string): NodeSetupVersion {
  const version = wanted.trim().replace(/^v/, '')
  if (EXACT_VERSION.test(version)) {
    return { kind: 'exact', version }
  }
  if (/^(0|[1-9]\d*)(?:\.x)?$/.test(version)) {
    return { kind: 'major', major: Number.parseInt(version, 10) }
  }
  throw new NodeSetupError(
    'INVALID_VERSION',
    '--version',
    'an unsupported version input',
  )
}

export function resolveNodeSetupVersion(
  wanted: string,
  indexVersions: readonly unknown[],
): string {
  const spec = parseNodeSetupVersion(wanted)
  if (spec.kind === 'exact') {
    return spec.version
  }
  let newest
  let newestParts: [number, number, number] | undefined
  for (const entry of indexVersions) {
    if (typeof entry !== 'string') {
      continue
    }
    const version = entry.replace(/^v/, '')
    if (!EXACT_VERSION.test(version)) {
      continue
    }
    const parts = version.split('.').map(Number) as [number, number, number]
    if (parts[0] !== spec.major) {
      continue
    }
    if (
      !newestParts ||
      parts[1] > newestParts[1] ||
      (parts[1] === newestParts[1] && parts[2] > newestParts[2])
    ) {
      newest = version
      newestParts = parts
    }
  }
  if (!newest) {
    throw new NodeSetupError(
      'VERSION_NOT_FOUND',
      `${NODE_DIST_URL}/index.json`,
      'no matching stable release',
    )
  }
  return newest
}

export function nodeSetupAsset(
  version: string,
  platform: string,
  arch: string,
): { archiveRoot: string; asset: string } {
  if (!EXACT_VERSION.test(version)) {
    throw new NodeSetupError(
      'INVALID_VERSION',
      'the resolved version',
      'a non-exact version',
    )
  }
  if (platform !== 'linux' || (arch !== 'x64' && arch !== 'arm64')) {
    throw new NodeSetupError(
      'UNSUPPORTED_PLATFORM',
      'the runner',
      'a platform outside Linux x64 or arm64',
    )
  }
  const archiveRoot = `node-v${version}-${platform}-${arch}`
  return { archiveRoot, asset: `${archiveRoot}.tar.gz` }
}

export function nodeSetupDigest(shasums: string, asset: string): string {
  const matches = shasums.split(/\r?\n/).flatMap(line => {
    const match = /^([a-f\d]{64})\s+\*?(\S+)\s*$/i.exec(line)
    if (!match || match[2] !== asset) {
      return []
    }
    return [match[1]!.toLowerCase()]
  })
  if (matches.length !== 1) {
    throw new NodeSetupError(
      'INVALID_CHECKSUM',
      'SHASUMS256.txt',
      'a missing or duplicate asset checksum',
    )
  }
  return matches[0]!
}

function validateRunnerPath(name: string, value: string | undefined): string {
  if (
    typeof value !== 'string' ||
    !path.isAbsolute(value) ||
    /[\r\n]/.test(value)
  ) {
    throw new NodeSetupError(
      'INVALID_RUNNER_PATH',
      name,
      'a missing or invalid absolute path',
    )
  }
  return value
}

async function fetchNodeResource(
  url: string,
  fetcher: typeof fetch,
): Promise<Buffer> {
  let response
  try {
    response = await fetcher(url, {
      redirect: 'error',
      signal: AbortSignal.timeout(120_000),
    })
    if (response.status !== 200) {
      throw new NodeSetupError(
        'DOWNLOAD_FAILED',
        url,
        `HTTP ${response.status}`,
      )
    }
    return Buffer.from(await response.arrayBuffer())
  } catch (error) {
    if (error instanceof NodeSetupError) {
      throw error
    }
    throw new NodeSetupError('DOWNLOAD_FAILED', url, 'a failed download')
  }
}

async function extractNodeArchive(
  archive: string,
  destination: string,
): Promise<void> {
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

export async function installNodeForCi(
  options: NodeSetupOptions,
  dependencies: NodeSetupDependencies = {},
): Promise<NodeSetupInstallResult> {
  const {
    arch = process.arch,
    githubPath,
    platform = process.platform,
    runnerTemp,
    version: wanted,
  } = options
  const runnerTempPath = validateRunnerPath('RUNNER_TEMP', runnerTemp)
  const githubPathFile = validateRunnerPath('GITHUB_PATH', githubPath)
  const fetcher = dependencies.fetcher ?? fetch
  const extract = dependencies.extract ?? extractNodeArchive
  const spec = parseNodeSetupVersion(wanted)
  nodeSetupAsset(
    spec.kind === 'exact' ? spec.version : `${spec.major}.0.0`,
    platform,
    arch,
  )
  let indexVersions = []
  if (spec.kind === 'major') {
    const indexUrl = `${NODE_DIST_URL}/index.json`
    try {
      const entries = JSON.parse(
        (await fetchNodeResource(indexUrl, fetcher)).toString('utf8'),
      )
      if (!Array.isArray(entries)) {
        throw new TypeError('Invalid release index')
      }
      indexVersions = entries.map(entry => entry?.version)
    } catch (error) {
      if (error instanceof NodeSetupError) {
        throw error
      }
      throw new NodeSetupError(
        'INVALID_RELEASE_INDEX',
        indexUrl,
        'a malformed release index',
      )
    }
  }
  const version = resolveNodeSetupVersion(wanted, indexVersions)
  const { archiveRoot, asset } = nodeSetupAsset(version, platform, arch)
  const releaseUrl = `${NODE_DIST_URL}/v${version}`
  const shasums = await fetchNodeResource(
    `${releaseUrl}/SHASUMS256.txt`,
    fetcher,
  )
  const digest = nodeSetupDigest(shasums.toString('utf8'), asset)
  const bytes = await fetchNodeResource(`${releaseUrl}/${asset}`, fetcher)
  if (createHash('sha256').update(bytes).digest('hex') !== digest) {
    throw new NodeSetupError(
      'CHECKSUM_MISMATCH',
      asset,
      'a SHA-256 digest mismatch',
    )
  }
  const directory = await mkdtemp(path.join(runnerTempPath, 'socket-node-'))
  try {
    const archive = path.join(directory, asset)
    const bin = path.join(directory, archiveRoot, 'bin')
    await writeFile(archive, bytes)
    await extract(archive, directory)
    await access(path.join(bin, 'node'), constants.X_OK)
    await rm(archive)
    await appendFile(githubPathFile, `${bin}\n`)
    return { bin, version }
  } catch {
    await rm(directory, { force: true, recursive: true })
    throw new NodeSetupError(
      'INSTALL_FAILED',
      directory,
      'an extraction, executable, or PATH update failure',
    )
  }
}

export async function runNodeSetup(
  argv: string[],
  dependencies: NodeSetupRunDependencies = {},
): Promise<number> {
  const stdout = dependencies.stdout ?? (text => process.stdout.write(text))
  const stderr = dependencies.stderr ?? (text => process.stderr.write(text))
  const env = dependencies.env ?? process.env
  const json = argv.includes('--json')
  try {
    if (argv.includes('--describe')) {
      stdout(
        json
          ? `${JSON.stringify({ description: DESCRIPTION })}\n`
          : `${DESCRIPTION}\n`,
      )
      return 0
    }
    if (argv.includes('--help') || argv.includes('-h')) {
      stdout(
        'Usage: node scripts/setup/node.mts --version <X.Y.Z|X|X.x> [--json]\n',
      )
      return 0
    }
    let version
    for (let index = 0; index < argv.length; index += 1) {
      const argument = argv[index]
      if (argument === '--version' && version === undefined) {
        version = argv[++index]
      } else if (argument !== '--json') {
        throw new NodeSetupError(
          'INVALID_ARGUMENT',
          'the command line',
          'an unsupported or repeated argument',
        )
      }
    }
    if (typeof version !== 'string') {
      throw new NodeSetupError(
        'INVALID_VERSION',
        '--version',
        'a missing version input',
      )
    }
    parseNodeSetupVersion(version)
    const install = dependencies.install ?? installNodeForCi
    const result = await install({
      githubPath: env['GITHUB_PATH'],
      runnerTemp: env['RUNNER_TEMP'],
      version,
    })
    stdout(
      json
        ? `${JSON.stringify(result)}\n`
        : `[setup-node] installed Node.js ${result.version}.\n`,
    )
    return 0
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const code =
      error instanceof NodeSetupError ? error.code : 'SETUP_NODE_FAILED'
    stderr(
      json ? `${JSON.stringify({ code, error: message })}\n` : `${message}\n`,
    )
    return 1
  }
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  process.exitCode = await runNodeSetup(process.argv.slice(2))
}
