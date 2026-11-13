import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { assembleFacts } from './assemble.mts'
import { resolveBuildToolBin } from './build-tool.mts'
import { serializeExcludePathPatterns } from './exclude-paths-glob.mts'
import { parseRecords } from './records.mts'
import constants from '../../../constants.mts'
import { isStandaloneSea } from '../../../sea/runtime.mts'
import { withTmpDir } from '../../../utils/fs.mts'
import { getOrInsert } from '../../../utils/get-or-insert.mts'
import { camelToKebab } from '../../../utils/strings.mts'

import type { BuildTool } from './build-tool.mts'
import type { SocketFactsSbomProject } from './facts.mts'

export type ManifestScriptOptions = {
  projectDir: string
  // Unset ⇒ resolved to the project wrapper, else PATH (resolveBuildToolBin).
  bin?: string | undefined
  // The file in projectDir to build: Maven's POM (unset leaves Maven's
  // default), dotnet's solution or project (required).
  entryFile?: string | undefined
  // `--exclude-paths`, relative to excludeBase. Passed to the build script,
  // which skips a wholly excluded subproject.
  excludePaths?: string[] | undefined
  // The scan root, which a build's modules can lie outside of (Maven `../x`
  // modules); projectDir when unset.
  excludeBase?: string | undefined
  toolOpts?: string[] | undefined
  stdio?: 'inherit' | 'pipe' | undefined
  env?: NodeJS.ProcessEnv | undefined
  signal?: AbortSignal | undefined
}

type RunOutput = { code: number; stdout: string; stderr: string }

const WORKSPACES_TASK = 'socketWorkspaces'
// Destination filename inside sbt's isolated plugins/ dir.
const SBT_WORKSPACES_PLUGIN_FILENAME = 'SocketWorkspacesPlugin.scala'

export type WorkspaceEnumerationResult = {
  // Absolute; what each project's subprojectDir and manifestFiles are relative to.
  buildRoot: string | undefined
  code: number
  projects: SocketFactsSbomProject[]
  stderr: string
  stdout: string
}

// Bundled emitter assets, copied into dist by the rollup build.
function manifestScriptsPath(...parts: string[]): string {
  return path.join(constants.distPath, 'manifest-scripts', ...parts)
}

// Streamed build output is a diagnostic: it goes to stderr so the command's own
// stdout (e.g. --json) stays machine-readable.
const STREAM_TO_STDERR = ['inherit', 2, 'inherit'] as const

// Don't throw on a non-zero exit: the script may still have written records. A
// non-exit spawn error (e.g. missing executable) propagates.
async function runNeverThrow(
  bin: string,
  args: string[],
  opts: ManifestScriptOptions,
): Promise<RunOutput> {
  try {
    const result = await spawn(bin, args, {
      cwd: opts.projectDir,
      stdio: opts.stdio === 'pipe' ? 'pipe' : [...STREAM_TO_STDERR],
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return {
      code: result.code,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    }
  } catch (e) {
    // A build tool that exits non-zero rejects with the spawn-result shape: a
    // numeric exit `code` plus captured stdout/stderr. Anything else — e.g. a
    // missing executable, whose `code` is a string like 'ENOENT' — propagates.
    // This mirrors how utils/dlx.mts classifies spawn failures (a numeric `code`
    // is a real process exit); the registry's isSpawnError is avoided here
    // because it is currently broken and never matches.
    if (
      e !== null &&
      typeof e === 'object' &&
      typeof (e as { code?: unknown }).code === 'number'
    ) {
      const err = e as { code: number; stdout?: unknown; stderr?: unknown }
      return {
        code: err.code,
        stdout: typeof err.stdout === 'string' ? err.stdout : '',
        stderr: typeof err.stderr === 'string' ? err.stderr : '',
      }
    }
    throw e
  }
}

async function writeSbtPlugin(globalBase: string): Promise<void> {
  const src = await fs.readFile(
    manifestScriptsPath('socket-workspaces.plugin.scala'),
    'utf8',
  )
  const pluginsDir = path.join(globalBase, 'plugins')
  await fs.mkdir(pluginsDir, { recursive: true })
  await fs.writeFile(path.join(pluginsDir, SBT_WORKSPACES_PLUGIN_FILENAME), src)
}

async function readRecordsFile(recordsFile: string): Promise<string> {
  return existsSync(recordsFile) ? await fs.readFile(recordsFile, 'utf8') : ''
}

function enumerationResult(
  out: RunOutput,
  text: string,
): WorkspaceEnumerationResult {
  const parsed = parseRecords(text)
  return {
    buildRoot: parsed.buildRoot || undefined,
    code: out.code,
    projects: assembleFacts(parsed).facts.projects ?? [],
    stderr: out.stderr,
    stdout: out.stdout,
  }
}

// Missing only in an unbuilt local checkout. Fail loudly: without the
// extension, Maven silently records nothing.
function assertBundledAssetBuilt(
  assetPath: string,
  description: string,
  // The package.json script that builds it, as the dist build names it too.
  buildScript: string,
): void {
  if (existsSync(assetPath)) {
    return
  }
  throw new Error(
    `${description} not found at ${assetPath}. It is bundled in the published CLI; for local dev build it with: pnpm run ${buildScript}`,
  )
}

// Emits only `project` records, never resolving dependencies.
export async function enumerateWorkspaces(
  tool: BuildTool,
  opts: ManifestScriptOptions,
): Promise<WorkspaceEnumerationResult> {
  switch (tool) {
    case 'dotnet':
      return await enumerateDotnetWorkspaces(opts)
    case 'gradle':
      return await enumerateGradleWorkspaces(opts)
    case 'sbt':
      return await enumerateSbtWorkspaces(opts)
    case 'maven':
      return await enumerateMavenWorkspaces(opts)
  }
}

// The options every build script reads, each in its own argument syntax.
function scriptOptions(opts: ManifestScriptOptions): Array<[string, string]> {
  const options: Array<[string, string]> = []
  // Globs compile to regex pattern sources HERE (exclude-paths-glob.mts is
  // the single glob implementation); the scripts just compile what they
  // receive.
  const excludePatterns = serializeExcludePathPatterns(opts.excludePaths)
  if (excludePatterns) {
    options.push(['excludePaths', excludePatterns])
    options.push(['excludeBase', opts.excludeBase ?? opts.projectDir])
  }
  return options
}

function commonProps(
  opts: ManifestScriptOptions,
  prefix: '-D' | '-P',
): string[] {
  return scriptOptions(opts).map(
    ({ 0: name, 1: value }) => `${prefix}socket.${name}=${value}`,
  )
}

// The dotnet tool's flags are the kebab-cased script option names.
function dotnetToolArgs(opts: ManifestScriptOptions): string[] {
  return scriptOptions(opts).flatMap(({ 0: name, 1: value }) => [
    `--${camelToKebab(name)}`,
    value,
  ])
}

async function enumerateGradleWorkspaces(
  opts: ManifestScriptOptions,
): Promise<WorkspaceEnumerationResult> {
  const bin = resolveBuildToolBin(
    'gradle',
    opts.projectDir,
    opts.bin,
    isStandaloneSea(),
  )
  const initScript = manifestScriptsPath('socket-workspaces.init.gradle')
  return await withTmpDir('socket-gradle-workspaces-', async tmp => {
    const recordsFile = path.join(tmp, 'records.tsv')
    // Disable the configuration cache: the init script's shared accumulator
    // isn't cache-safe.
    const args = [
      '--init-script',
      initScript,
      '-Dorg.gradle.configuration-cache=false',
      `-Psocket.recordsFile=${recordsFile}`,
      ...commonProps(opts, '-P'),
      ...(opts.toolOpts ?? []),
      WORKSPACES_TASK,
      '--no-daemon',
      '--console=plain',
    ]
    const out = await runNeverThrow(bin, args, opts)
    return enumerationResult(out, await readRecordsFile(recordsFile))
  })
}

async function invokeSbtIn(
  globalBase: string,
  opts: ManifestScriptOptions,
): Promise<WorkspaceEnumerationResult> {
  const bin = resolveBuildToolBin(
    'sbt',
    opts.projectDir,
    opts.bin,
    isStandaloneSea(),
  )
  await writeSbtPlugin(globalBase)
  const recordsFile = path.join(globalBase, 'records.tsv')
  // Fresh per-run global base (not ~/.sbt): sbt executes everything under
  // plugins/, so a shared path is a code-injection surface. BSP off for this
  // run.
  const props = [
    `-Dsbt.global.base=${globalBase}`,
    '-Dsbt.server.autostart=false',
    `-Dsocket.recordsFile=${recordsFile}`,
    ...commonProps(opts, '-D'),
  ]
  // sbt's launcher doesn't always honor JAVA_HOME; never override a
  // caller-supplied --java-home.
  const javaHome = opts.env?.['JAVA_HOME'] ?? process.env['JAVA_HOME']
  const javaHomeOpt =
    javaHome && !(opts.toolOpts ?? []).includes('--java-home')
      ? ['--java-home', javaHome]
      : []
  const args = [
    ...javaHomeOpt,
    ...props,
    ...(opts.toolOpts ?? []),
    '--batch',
    WORKSPACES_TASK,
  ]
  const out = await runNeverThrow(bin, args, opts)
  return enumerationResult(out, await readRecordsFile(recordsFile))
}

async function enumerateSbtWorkspaces(
  opts: ManifestScriptOptions,
): Promise<WorkspaceEnumerationResult> {
  return await withTmpDir('socket-sbt-workspaces-', globalBase =>
    invokeSbtIn(globalBase, opts),
  )
}

async function enumerateMavenWorkspaces(
  opts: ManifestScriptOptions,
): Promise<WorkspaceEnumerationResult> {
  const bin = resolveBuildToolBin(
    'maven',
    opts.projectDir,
    opts.bin,
    isStandaloneSea(),
  )
  const jarPath = manifestScriptsPath(
    'maven-extension',
    'coana-maven-extension.jar',
  )
  assertBundledAssetBuilt(
    jarPath,
    'Maven manifest extension jar',
    'build:maven-extension',
  )
  return await withTmpDir('socket-maven-workspaces-', async tmp => {
    const recordsFile = path.join(tmp, 'records.tsv')
    // `validate` is the cheapest phase that triggers the extension.
    const props = [
      `-Dmaven.ext.class.path=${jarPath}`,
      '-Dcoana.task=socket-workspaces',
      `-Dsocket.recordsFile=${recordsFile}`,
      ...commonProps(opts, '-D'),
    ]
    const fileOpts = opts.entryFile ? ['--file', opts.entryFile] : []
    const args = [
      ...props,
      ...fileOpts,
      ...(opts.toolOpts ?? []),
      '--batch-mode',
      'validate',
    ]
    const out = await runNeverThrow(bin, args, opts)
    return enumerationResult(out, await readRecordsFile(recordsFile))
  })
}

// The global.json the dotnet host applies in `dir`: the first one in it or
// any parent directory, the filesystem root included, which findUp skips.
// https://github.com/dotnet/runtime/blob/b4548da6edfce1996a1d6ffe1521c9ce6128be2e/src/native/corehost/fxr/sdk_resolver.cpp#L296-L321
function nearestGlobalJson(dir: string): string {
  for (let current = path.resolve(dir); ; ) {
    const file = path.join(current, 'global.json')
    if (existsSync(file)) {
      return file
    }
    const parent = path.dirname(current)
    if (parent === current) {
      return ''
    }
    current = parent
  }
}

// Keyed by the nearest global.json, the only per-directory input to the
// host's SDK selection; a failed probe is shared too.
const sdkVersionByPin = new Map<string, Promise<string>>()

function dotnetSdkVersion(
  bin: string,
  opts: ManifestScriptOptions,
): Promise<string> {
  // A relative path names a different host in each directory.
  const host =
    path.isAbsolute(bin) || path.basename(bin) === bin
      ? bin
      : path.resolve(opts.projectDir, bin)
  const key = `${host}\0${nearestGlobalJson(opts.projectDir)}`
  return getOrInsert(sdkVersionByPin, key, () =>
    readDotnetSdkVersion(bin, opts),
  )
}

async function readDotnetSdkVersion(
  bin: string,
  opts: ManifestScriptOptions,
): Promise<string> {
  const out = await runNeverThrow(bin, ['--version'], {
    ...opts,
    stdio: 'pipe',
  })
  if (out.code !== 0) {
    throw new Error(
      out.stderr.trim() ||
        out.stdout.trim() ||
        `\`${bin} --version\` exited with code ${out.code}`,
    )
  }
  return out.stdout.trim()
}

// Runs the bundled tool against the build's own dotnet in its restore-free
// workspaces mode.
async function enumerateDotnetWorkspaces(
  opts: ManifestScriptOptions,
): Promise<WorkspaceEnumerationResult> {
  if (!opts.entryFile) {
    throw new Error('A dotnet build needs a solution or project file.')
  }
  const toolDll = manifestScriptsPath('dotnet-tool', 'socket-facts-dotnet.dll')
  assertBundledAssetBuilt(toolDll, 'dotnet manifest tool', 'build:dotnet-tool')
  const bin = resolveBuildToolBin('dotnet', opts.projectDir, opts.bin)
  const sdkVersion = await dotnetSdkVersion(bin, opts)
  // The tool runs on the newest installed runtime (RollForward=LatestMajor),
  // which must be able to load the selected SDK's MSBuild; a preview SDK
  // needs a preview runtime, which roll-forward only picks when told to.
  const env = sdkVersion.includes('-')
    ? {
        ...(opts.env ?? process.env),
        DOTNET_ROLL_FORWARD_TO_PRERELEASE: '1',
      }
    : opts.env
  return await withTmpDir('socket-dotnet-workspaces-', async tmp => {
    const recordsFile = path.join(tmp, 'records.tsv')
    const args = [
      toolDll,
      '--records',
      recordsFile,
      '--entry',
      opts.entryFile!,
      '--dotnet',
      bin,
      '--workspaces',
      ...dotnetToolArgs(opts),
      ...(opts.stdio === 'inherit' ? ['--verbose'] : []),
      '--',
      ...(opts.toolOpts ?? []),
    ]
    const out = await runNeverThrow(bin, args, { ...opts, env })
    return enumerationResult(out, await readRecordsFile(recordsFile))
  })
}
