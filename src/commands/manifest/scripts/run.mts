import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { spawn } from '@socketsecurity/registry/lib/spawn'

import { assembleFacts } from './assemble.mts'
import { resolveBuildToolBin } from './build-tool.mts'
import { parseRecords } from './records.mts'
import constants from '../../../constants.mts'

import type { BuildTool } from './build-tool.mts'
import type { ResolvedArtifactPaths, SocketFactsSbom } from './facts.mts'
import type { ResolutionReport } from './resolution-report.mts'

export type ManifestScriptOptions = {
  projectDir: string
  // Unset ⇒ resolved to the project wrapper, else PATH (resolveBuildToolBin).
  bin?: string | undefined
  // Reachability-only: also materialize resolved artifact paths (artifactPaths).
  withFiles?: boolean | undefined
  // Newline-delimited GAV file scoping withFiles materialization; absent ⇒ all.
  populateFilesFor?: string | undefined
  includeConfigs?: string | undefined
  excludeConfigs?: string | undefined
  toolOpts?: string[] | undefined
  stdio?: 'inherit' | 'pipe' | undefined
  env?: NodeJS.ProcessEnv | undefined
  signal?: AbortSignal | undefined
}

export type ManifestRunResult = {
  code: number
  facts: SocketFactsSbom
  report: ResolutionReport
  artifactPaths: ResolvedArtifactPaths
  // Captured build-tool output (empty when stdio is 'inherit').
  stderr: string
  stdout: string
}

type RunOutput = { code: number; stdout: string; stderr: string }

const FACTS_TASK = 'socketFacts'
const SBT_PLUGIN_FILENAME = 'SocketFactsPlugin.scala'

// Bundled emitter assets, copied into dist by the rollup build.
function manifestScriptsPath(...parts: string[]): string {
  return path.join(constants.distPath, 'manifest-scripts', ...parts)
}

// Don't throw on a non-zero exit: the script emits failure records, so a usable
// records file still exists. A non-exit spawn error (e.g. missing executable)
// propagates.
async function runNeverThrow(
  bin: string,
  args: string[],
  opts: ManifestScriptOptions,
): Promise<RunOutput> {
  try {
    const result = await spawn(bin, args, {
      cwd: opts.projectDir,
      stdio: opts.stdio ?? 'inherit',
      ...(opts.env ? { env: opts.env } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    })
    return {
      code: result.code,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    }
  } catch (e) {
    // A non-zero exit rejects with the spawn-result shape: a numeric `code` plus
    // captured stdout/stderr. Return it so the caller can assemble failure
    // records. Anything else (e.g. a missing executable, whose `code` is the
    // string 'ENOENT') propagates. Duck-typed on purpose: the registry's
    // isSpawnError is unreliable, so the numeric-code check is the real signal.
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

async function withTmpDir<T>(
  prefix: string,
  fn: (tmpDir: string) => Promise<T>,
): Promise<T> {
  const tmpDir = await fs.mkdtemp(path.join(tmpdir(), prefix))
  try {
    return await fn(tmpDir)
  } finally {
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function writeSbtPlugin(globalBase: string): Promise<void> {
  const src = await fs.readFile(
    manifestScriptsPath('socket-facts.plugin.scala'),
    'utf8',
  )
  const pluginsDir = path.join(globalBase, 'plugins')
  await fs.mkdir(pluginsDir, { recursive: true })
  await fs.writeFile(path.join(pluginsDir, SBT_PLUGIN_FILENAME), src)
}

async function assembleFromRecords(
  out: RunOutput,
  recordsFile: string,
): Promise<ManifestRunResult> {
  const text = existsSync(recordsFile)
    ? await fs.readFile(recordsFile, 'utf8')
    : ''
  const { artifactPaths, facts, report } = assembleFacts(parseRecords(text))
  return {
    code: out.code,
    facts,
    report,
    artifactPaths,
    stderr: out.stderr,
    stdout: out.stdout,
  }
}

// Missing only in an unbuilt local checkout. Fail loudly: without the extension,
// Maven silently emits an empty SBOM.
function assertMavenExtensionBuilt(jarPath: string): void {
  if (existsSync(jarPath)) {
    return
  }
  throw new Error(
    `Maven manifest extension jar not found at ${jarPath}. It is bundled in the published CLI; for local dev build it with: bash src/commands/manifest/scripts/maven-extension/build-jar.sh`,
  )
}

// Runs the build-tool script (which emits a records file) and assembles it.
// Writes no files; the caller persists facts or consumes artifactPaths.
export async function runManifestScript(
  tool: BuildTool,
  opts: ManifestScriptOptions,
): Promise<ManifestRunResult> {
  switch (tool) {
    case 'gradle':
      return await runGradle(opts)
    case 'sbt':
      return await runSbt(opts)
    case 'maven':
      return await runMaven(opts)
  }
}

function commonProps(
  opts: ManifestScriptOptions,
  prefix: '-D' | '-P',
): string[] {
  const props: string[] = []
  if (opts.withFiles) {
    props.push(`${prefix}socket.withFiles=true`)
  }
  if (opts.populateFilesFor) {
    props.push(`${prefix}socket.populateFilesFor=${opts.populateFilesFor}`)
  }
  if (opts.includeConfigs) {
    props.push(`${prefix}socket.includeConfigs=${opts.includeConfigs}`)
  }
  if (opts.excludeConfigs) {
    props.push(`${prefix}socket.excludeConfigs=${opts.excludeConfigs}`)
  }
  return props
}

async function runGradle(
  opts: ManifestScriptOptions,
): Promise<ManifestRunResult> {
  const initScript = manifestScriptsPath('socket-facts.init.gradle')
  return await withTmpDir('socket-gradle-facts-', async tmp => {
    const recordsFile = path.join(tmp, 'records.tsv')
    const bin = resolveBuildToolBin('gradle', opts.projectDir, opts.bin)
    // Disable the configuration cache: the init script's legacy
    // resolvedConfiguration API and shared accumulator aren't cache-safe.
    const args = [
      '--init-script',
      initScript,
      '-Dorg.gradle.configuration-cache=false',
      `-Psocket.recordsFile=${recordsFile}`,
      ...commonProps(opts, '-P'),
      ...(opts.toolOpts ?? []),
      FACTS_TASK,
      '--no-daemon',
      '--console=plain',
    ]
    const out = await runNeverThrow(bin, args, opts)
    return await assembleFromRecords(out, recordsFile)
  })
}

async function runSbt(opts: ManifestScriptOptions): Promise<ManifestRunResult> {
  return await withTmpDir('socket-sbt-facts-', async globalBase => {
    await writeSbtPlugin(globalBase)
    const recordsFile = path.join(globalBase, 'records.tsv')
    const bin = resolveBuildToolBin('sbt', opts.projectDir, opts.bin)
    // Fresh per-run global base (not ~/.sbt): sbt executes everything under
    // plugins/, so a shared path is a code-injection surface. BSP off for this run.
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
      FACTS_TASK,
    ]
    const out = await runNeverThrow(bin, args, opts)
    return await assembleFromRecords(out, recordsFile)
  })
}

async function runMaven(
  opts: ManifestScriptOptions,
): Promise<ManifestRunResult> {
  const jarPath = manifestScriptsPath(
    'maven-extension',
    'coana-maven-extension.jar',
  )
  assertMavenExtensionBuilt(jarPath)
  return await withTmpDir('socket-maven-facts-', async tmp => {
    const recordsFile = path.join(tmp, 'records.tsv')
    const bin = resolveBuildToolBin('maven', opts.projectDir, opts.bin)
    // `validate` is the cheapest phase that triggers the afterSessionEnd
    // extension; no compile needed (analysis uses configured paths, not classes).
    const props = [
      `-Dmaven.ext.class.path=${jarPath}`,
      '-Dcoana.task=socket-facts',
      `-Dsocket.recordsFile=${recordsFile}`,
      ...commonProps(opts, '-D'),
    ]
    const args = [
      ...props,
      ...(opts.toolOpts ?? []),
      '--batch-mode',
      'validate',
    ]
    const out = await runNeverThrow(bin, args, opts)
    return await assembleFromRecords(out, recordsFile)
  })
}
