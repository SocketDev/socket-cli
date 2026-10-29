import crypto from 'node:crypto'
import { lstat, readFile } from 'node:fs/promises'
import path from 'node:path'
import { spawnNativePackageProcess } from './process.mts'
import { qualifyDarwinPackageArtifact } from './gatekeeper.mts'
import type {
  NativePackageProcessResult,
  NativePackageSpawnProcess,
} from './process.mts'
export type {
  NativePackageProcessResult,
  NativePackageSpawnProcess,
} from './process.mts'
import { resolveSeaTarget, SEA_TARGETS } from '../targets.mts'
import { redactDiagnosticText } from '../diagnostic/redact.mts'

const PACKAGE_BINARIES = {
  socket: 'dist/socket.js',
  'socket-npm': 'dist/socket-npm.js',
  'socket-npx': 'dist/socket-npx.js',
  'socket-pnpm': 'dist/socket-pnpm.js',
  'socket-yarn': 'dist/socket-yarn.js',
} as const
const PACKAGE_PAYLOAD = 'dist/cli.js'
const PACKAGE_MANIFEST = 'dist/sea/manifest.generated.json'
const PACKAGE_BINARY_DIRECTORY = 'dist/sea'
const PACKAGE_TARGET_COUNT = 8
const COMMAND_TIMEOUT_MS = 60_000
const MAX_CAPTURE_BYTES = 16 * 1024
const MAX_DIAGNOSTIC_CHARS = 2000

type NativePackageManifest = {
  mode: 'production'
  payload: string
  binaries: Record<string, string>
  entrypoints: Record<string, string>
}

export interface NativePackageEntrypointVersion {
  entrypoint: string
  version: string
}

export interface NativePackageVerificationResult {
  requestedTarget: string
  launcherTarget: string
  entrypoints: NativePackageEntrypointVersion[]
}

export interface NativePackageEntrypointFailure {
  entrypoint: string
  error: Error
}

export class NativePackageEntrypointFailures extends Error {
  readonly failures: NativePackageEntrypointFailure[]

  constructor(failures: NativePackageEntrypointFailure[]) {
    super(
      failures
        .map(({ entrypoint, error }) => `${entrypoint}: ${error.message}`)
        .join('\n'),
    )
    this.name = 'NativePackageEntrypointFailures'
    this.failures = failures
  }
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(entry => typeof entry === 'string')
  )
}

function hashPackageBytes(bytes: Buffer): string {
  return crypto.createHash('sha256').update(bytes).digest('hex')
}

function assertExactKeys(
  value: Record<string, string>,
  expected: readonly string[],
  label: string,
): void {
  const actualKeys = Object.keys(value).toSorted()
  const expectedKeys = [...expected].toSorted()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(
      `Invalid native package ${label}: expected exactly ${expectedKeys.join(', ')}.`,
    )
  }
}

function packageFilePath(packageRoot: string, relativeFile: string): string {
  const file = path.resolve(packageRoot, relativeFile)
  const relative = path.relative(packageRoot, file)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(
      `Invalid native package path ${relativeFile}: file must stay within the package root.`,
    )
  }
  return file
}

async function readPackageFile(
  packageRoot: string,
  relativeFile: string,
): Promise<Buffer> {
  const rootInfo = await lstat(packageRoot)
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error('Invalid native package root: expected a real directory.')
  }
  const file = packageFilePath(packageRoot, relativeFile)
  const relative = path.relative(packageRoot, file)
  const parts = relative.split(path.sep)
  let cursor = packageRoot
  for (const [index, part] of parts.entries()) {
    cursor = path.join(cursor, part)
    const info = await lstat(cursor)
    if (info.isSymbolicLink()) {
      throw new Error(
        `Invalid native package file ${relativeFile}: symlinks are not allowed.`,
      )
    }
    const isLast = index === parts.length - 1
    if ((isLast && !info.isFile()) || (!isLast && !info.isDirectory())) {
      throw new Error(
        `Invalid native package file ${relativeFile}: expected a regular in-root file.`,
      )
    }
  }
  return readFile(file)
}

function parseNativePackageManifest(bytes: Buffer): NativePackageManifest {
  let value: unknown
  try {
    value = JSON.parse(bytes.toString('utf8')) as unknown
  } catch {
    throw new Error('Invalid native package manifest: expected valid JSON.')
  }
  if (
    typeof value !== 'object' ||
    value === null ||
    !('payload' in value) ||
    typeof value.payload !== 'string' ||
    !('binaries' in value) ||
    !isStringRecord(value.binaries) ||
    !('entrypoints' in value) ||
    !isStringRecord(value.entrypoints)
  ) {
    throw new Error(
      'Invalid native package manifest: required hashes are missing.',
    )
  }
  if (!('mode' in value) || value.mode !== 'production') {
    throw new Error('Invalid native package manifest: mode must be production.')
  }
  return {
    mode: 'production',
    payload: value.payload,
    binaries: value.binaries,
    entrypoints: value.entrypoints,
  }
}

function nativeBinaryRelativePath(target: string): string {
  return path.posix.join(
    PACKAGE_BINARY_DIRECTORY,
    `socket-${target}${target.startsWith('win32-') ? '.exe' : ''}`,
  )
}

function launcherTarget(): string {
  const glibc = (
    process.report.getReport() as {
      header: { glibcVersionRuntime?: string | undefined }
    }
  ).header.glibcVersionRuntime
  return resolveSeaTarget(process.platform, process.arch, { glibc })
}

function formatNativePackageOutput(output: Buffer): string {
  const text = redactDiagnosticText(output.toString()).trim()
  if (!text) {
    return ''
  }
  return text.length > MAX_DIAGNOSTIC_CHARS
    ? `[${text.length - MAX_DIAGNOSTIC_CHARS} characters omitted]\n${text.slice(-MAX_DIAGNOSTIC_CHARS)}`
    : text
}

async function runNativePackageCommand(
  spawnProcess: NativePackageSpawnProcess,
  packageRoot: string,
  command: string,
  args: readonly string[],
  description: string,
  target: string,
  hostTarget: string,
): Promise<string> {
  let result: NativePackageProcessResult
  try {
    result = await spawnProcess(command, args, {
      cwd: packageRoot,
      timeoutMs: COMMAND_TIMEOUT_MS,
      maxOutputBytes: MAX_CAPTURE_BYTES,
    })
  } catch (error) {
    throw new Error(
      `Native package command could not start for ${description} (requested target ${target}; launcher target ${hostTarget}): ${redactDiagnosticText(String(error))}`,
    )
  }
  if (
    result.timedOut ||
    result.outputLimitExceeded ||
    !!result.signal ||
    result.code !== 0 ||
    !result.stdout.toString().trim()
  ) {
    const details = formatNativePackageOutput(result.stderr)
    throw new Error(
      `Native package command failed for ${description} (requested target ${target}; launcher target ${hostTarget}; exit ${result.code}; signal ${result.signal ?? 'none'}${result.timedOut ? '; timed out' : ''}${result.outputLimitExceeded ? '; output limit exceeded' : ''})${details ? `: ${details}` : ''}. Rebuild the native package.`,
    )
  }
  return result.stdout.toString().trim()
}

function verifyNativePackageMetadata(
  packageJsonBytes: Buffer,
  expectedBin: Record<string, string>,
): void {
  let packageJson: unknown
  try {
    packageJson = JSON.parse(packageJsonBytes.toString('utf8')) as unknown
  } catch {
    throw new Error(
      'Invalid native package metadata: package.json is not valid JSON.',
    )
  }
  if (
    typeof packageJson !== 'object' ||
    packageJson === null ||
    !('bin' in packageJson) ||
    !isStringRecord(packageJson.bin)
  ) {
    throw new Error(
      'Invalid native package metadata: expected five bin mappings.',
    )
  }
  const packageBin = packageJson.bin
  const binNames = Object.keys(expectedBin)
  assertExactKeys(packageBin, binNames, 'bin mappings')
  for (let i = 0, { length } = binNames; i < length; i += 1) {
    const name = binNames[i]!
    if (packageBin[name] !== expectedBin[name]) {
      throw new Error(
        `Invalid native package bin mapping ${name}: expected ${expectedBin[name]}.`,
      )
    }
  }
}

function assertNativeQualificationTarget(config: {
  gatekeeper?: boolean | undefined
  target: string
  hostTarget: string
}): void {
  const { gatekeeper, target, hostTarget } = config
  if (gatekeeper && (!target.startsWith('darwin-') || target !== hostTarget)) {
    throw new Error(
      'Gatekeeper qualification requires the matching macOS host target.',
    )
  }
}

async function verifyNativePackageEntrypoints(config: {
  launcherFiles: string[]
  packageRoot: string
  spawnProcess: NativePackageSpawnProcess
  target: string
  hostTarget: string
}): Promise<NativePackageEntrypointVersion[]> {
  const { launcherFiles, packageRoot, spawnProcess, target, hostTarget } =
    config
  const entrypoints: NativePackageEntrypointVersion[] = []
  const failures: NativePackageEntrypointFailure[] = []
  for (let index = 0, { length } = launcherFiles; index < length; index += 1) {
    const relativeFile = launcherFiles[index]!
    const launcher = path.resolve(packageRoot, relativeFile)
    const entrypoint = path.posix.basename(
      relativeFile,
      path.posix.extname(relativeFile),
    )
    try {
      const version = await runNativePackageCommand(
        spawnProcess,
        packageRoot,
        process.execPath,
        [launcher, '--version'],
        `launcher ${relativeFile}`,
        target,
        hostTarget,
      )
      entrypoints.push({ entrypoint, version })
    } catch (error) {
      failures.push({
        entrypoint,
        error: error instanceof Error ? error : new Error(String(error)),
      })
    }
  }
  if (failures.length > 0) {
    throw new NativePackageEntrypointFailures(failures)
  }
  return entrypoints
}

export async function verifyNativePackage(config: {
  packageRoot: string
  target: string
  gatekeeper?: boolean | undefined
  spawnProcess?: NativePackageSpawnProcess | undefined
}): Promise<NativePackageVerificationResult> {
  const opts = { __proto__: null, ...config } as typeof config
  const packageRoot = path.resolve(opts.packageRoot)
  const target = opts.target
  const spawnProcess = opts.spawnProcess ?? spawnNativePackageProcess
  if (SEA_TARGETS.length !== PACKAGE_TARGET_COUNT) {
    throw new Error(
      'Invalid native target registry: expected exactly eight targets.',
    )
  }
  if (!(SEA_TARGETS as readonly string[]).includes(target)) {
    throw new Error(
      `Invalid native target ${target}: select one of ${SEA_TARGETS.join(', ')}.`,
    )
  }
  const hostTarget = launcherTarget()
  assertNativeQualificationTarget({
    gatekeeper: opts.gatekeeper,
    target,
    hostTarget,
  })
  const packageJsonBytes = await readPackageFile(packageRoot, 'package.json')
  const packagePayload = await readPackageFile(packageRoot, PACKAGE_PAYLOAD)
  const manifestBytes = await readPackageFile(packageRoot, PACKAGE_MANIFEST)
  const manifest = parseNativePackageManifest(manifestBytes)
  const expectedBin = PACKAGE_BINARIES as Record<string, string>
  verifyNativePackageMetadata(packageJsonBytes, expectedBin)
  assertExactKeys(manifest.binaries, SEA_TARGETS, 'binary hashes')
  const entrypointNames = Object.values(expectedBin).map(file =>
    path.posix.basename(file),
  )
  assertExactKeys(manifest.entrypoints, entrypointNames, 'launcher hashes')
  if (!/^[a-f0-9]{64}$/u.test(manifest.payload)) {
    throw new Error(
      'Invalid native package manifest: payload hash is malformed.',
    )
  }
  if (hashPackageBytes(packagePayload) !== manifest.payload) {
    throw new Error('Native package payload digest mismatch for dist/cli.js.')
  }
  for (const targetName of SEA_TARGETS) {
    const relativeFile = nativeBinaryRelativePath(targetName)
    const bytes = await readPackageFile(packageRoot, relativeFile)
    if (!/^[a-f0-9]{64}$/u.test(manifest.binaries[targetName]!)) {
      throw new Error(
        `Invalid native package manifest: malformed ${targetName} hash.`,
      )
    }
    if (hashPackageBytes(bytes) !== manifest.binaries[targetName]) {
      throw new Error(
        `Native package binary digest mismatch for ${targetName}.`,
      )
    }
  }
  const launcherFiles = Object.values(expectedBin)
  for (let i = 0, { length } = launcherFiles; i < length; i += 1) {
    const relativeFile = launcherFiles[i]!
    const bytes = await readPackageFile(packageRoot, relativeFile)
    const entrypointName = path.posix.basename(relativeFile)
    if (!/^[a-f0-9]{64}$/u.test(manifest.entrypoints[entrypointName]!)) {
      throw new Error(
        `Invalid native package manifest: malformed ${entrypointName} hash.`,
      )
    }
    if (hashPackageBytes(bytes) !== manifest.entrypoints[entrypointName]) {
      throw new Error(
        `Native package launcher digest mismatch for ${entrypointName}.`,
      )
    }
  }

  const binary = path.resolve(packageRoot, nativeBinaryRelativePath(target))
  if (opts.gatekeeper) {
    await qualifyDarwinPackageArtifact({ artifactPath: binary, spawnProcess })
  }
  for (const args of [['--version'], ['--help'], ['npm', '--version']]) {
    await runNativePackageCommand(
      spawnProcess,
      packageRoot,
      binary,
      args,
      `binary ${target} ${args.join(' ')}`,
      target,
      hostTarget,
    )
  }
  const entrypoints = await verifyNativePackageEntrypoints({
    launcherFiles,
    packageRoot,
    spawnProcess,
    target,
    hostTarget,
  })
  return { requestedTarget: target, launcherTarget: hostTarget, entrypoints }
}
