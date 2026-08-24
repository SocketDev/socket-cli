import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'

import { assembleFacts } from './assemble.mts'
import { resolveBuildToolBin } from './build-tool.mts'
import { parseRecords } from './records.mts'
import { distPath } from '../../../constants/paths.mts'

import type { BuildTool } from './build-tool.mts'
import type { ResolvedArtifactPaths, SocketFactsSbom } from './facts.mts'
import type { ResolutionReport } from './resolution-report.mts'

export type ManifestScriptOptions = {
  // Unset ⇒ resolved to the project wrapper, else PATH (resolveBuildToolBin).
  bin?: string | undefined
  // Reachability-only: also materialize resolved artifact paths (artifactPaths).
  withFiles?: boolean | undefined
  // Newline-delimited GAV file scoping withFiles materialization; absent ⇒ all.
  populateFilesFor?: string | undefined
  includeConfigs?: string | undefined
  excludeConfigs?: string | undefined
  // Scan-root-relative `--exclude-paths`. Passed to the build script, which skips
  // resolving a wholly excluded subproject. Source-file-level exclusion is left to
  // the reachability analysis (coana's --exclude-dirs), not applied here.
  excludePaths?: string[] | undefined
  toolOpts?: string[] | undefined
  stdio?: 'inherit' | 'pipe' | undefined
  env?: NodeJS.ProcessEnv | undefined
  signal?: AbortSignal | undefined
}

// Internal shape threaded through the private per-tool runners once
// `projectDir` has been hoisted off the public options bag.
type ResolvedManifestScriptOptions = ManifestScriptOptions & {
  projectDir: string
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

// Bundled emitter assets, copied into dist by the build pipeline.
function manifestScriptsPath(...parts: string[]): string {
  return path.join(distPath, 'manifest-scripts', ...parts)
}

// Don't throw on a non-zero exit: the script emits failure records, so a usable
// records file still exists. A non-exit spawn error (e.g. missing executable)
// propagates.
async function runNeverThrow(
  bin: string,
  args: string[],
  config: ResolvedManifestScriptOptions,
): Promise<RunOutput> {
  const cfg = { __proto__: null, ...config } as ResolvedManifestScriptOptions
  try {
    const result = await spawn(bin, args, {
      cwd: cfg.projectDir,
      stdio: cfg.stdio ?? 'inherit',
      ...(cfg.env ? { env: cfg.env } : {}),
      ...(cfg.signal ? { signal: cfg.signal } : {}),
    })
    return {
      code: result.code,
      stdout: typeof result.stdout === 'string' ? result.stdout : '',
      stderr: typeof result.stderr === 'string' ? result.stderr : '',
    }
  } catch (e) {
    // A build tool that exits non-zero rejects with the spawn-result shape: a
    // numeric exit `code` plus captured stdout/stderr. Return it so the caller
    // can assemble failure records / surface the output. Anything else — e.g. a
    // missing executable, whose `code` is a string like 'ENOENT' — propagates.
    // A numeric `code` is a real process exit; `isSpawnError` is too broad here
    // because it also matches string-coded launch failures.
    if (
      e !== null &&
      typeof e === 'object' &&
      typeof (e as { code?: unknown | undefined }).code === 'number'
    ) {
      const err = e as {
        code: number
        stdout?: unknown | undefined
        stderr?: unknown | undefined
      }
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
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), prefix))
  try {
    return await fn(tmpDir)
  } finally {
    await safeDelete(tmpDir).catch(() => {})
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
    `Maven manifest extension jar not found at ${jarPath}. It is bundled in the published CLI; for local dev build it with: bash packages/cli/src/commands/manifest/scripts/maven-extension/build-jar.sh`,
  )
}

// Runs the build-tool script and assembles the records file it emits.
// Writes no files; the caller persists facts or consumes artifactPaths.
export async function runManifestScript(
  tool: BuildTool,
  projectDir: string,
  options?: ManifestScriptOptions | undefined,
): Promise<ManifestRunResult> {
  const cfg = {
    __proto__: null,
    ...options,
    projectDir,
  } as ResolvedManifestScriptOptions
  switch (tool) {
    case 'gradle':
      return await runGradle(cfg)
    case 'sbt':
      return await runSbt(cfg)
    case 'maven':
      return await runMaven(cfg)
    default:
      throw new Error(
        `Unsupported build tool. Where: runManifestScript. Saw: ${String(tool)}, wanted gradle, maven, or sbt. Fix: pass one of the supported BuildTool values.`,
      )
  }
}

function commonProps(
  config: ResolvedManifestScriptOptions,
  prefix: '-D' | '-P',
): string[] {
  const cfg = { __proto__: null, ...config } as ResolvedManifestScriptOptions
  const props: string[] = []
  if (cfg.withFiles) {
    props.push(`${prefix}socket.withFiles=true`)
  }
  if (cfg.populateFilesFor) {
    props.push(`${prefix}socket.populateFilesFor=${cfg.populateFilesFor}`)
  }
  if (cfg.includeConfigs) {
    props.push(`${prefix}socket.includeConfigs=${cfg.includeConfigs}`)
  }
  if (cfg.excludeConfigs) {
    props.push(`${prefix}socket.excludeConfigs=${cfg.excludeConfigs}`)
  }
  if (cfg.excludePaths?.length) {
    // CSV: `--exclude-paths` is comma-split at the CLI, so an entry can never
    // contain a comma.
    props.push(`${prefix}socket.excludePaths=${cfg.excludePaths.join(',')}`)
  }
  return props
}

async function runGradle(
  config: ResolvedManifestScriptOptions,
): Promise<ManifestRunResult> {
  const cfg = { __proto__: null, ...config } as ResolvedManifestScriptOptions
  const initScript = manifestScriptsPath('socket-facts.init.gradle')
  return await withTmpDir('socket-gradle-facts-', async tmp => {
    const recordsFile = path.join(tmp, 'records.tsv')
    const bin = resolveBuildToolBin('gradle', cfg.projectDir, cfg.bin)
    // Disable the configuration cache: the init script's legacy
    // resolvedConfiguration API and shared accumulator aren't cache-safe.
    const args = [
      '--init-script',
      initScript,
      '-Dorg.gradle.configuration-cache=false',
      `-Psocket.recordsFile=${recordsFile}`,
      ...commonProps(cfg, '-P'),
      ...(cfg.toolOpts ?? []),
      FACTS_TASK,
      '--no-daemon',
      '--console=plain',
    ]
    const out = await runNeverThrow(bin, args, cfg)
    return await assembleFromRecords(out, recordsFile)
  })
}

async function runSbt(
  config: ResolvedManifestScriptOptions,
): Promise<ManifestRunResult> {
  const cfg = { __proto__: null, ...config } as ResolvedManifestScriptOptions
  return await withTmpDir('socket-sbt-facts-', async globalBase => {
    await writeSbtPlugin(globalBase)
    const recordsFile = path.join(globalBase, 'records.tsv')
    const bin = resolveBuildToolBin('sbt', cfg.projectDir, cfg.bin)
    // Fresh per-run global base (not ~/.sbt): sbt executes everything under
    // plugins/, so a shared path is a code-injection surface. BSP off for this run.
    const props = [
      `-Dsbt.global.base=${globalBase}`,
      '-Dsbt.server.autostart=false',
      `-Dsocket.recordsFile=${recordsFile}`,
      ...commonProps(cfg, '-D'),
    ]
    // sbt's launcher doesn't always honor JAVA_HOME; never override a
    // caller-supplied --java-home.
    const javaHome = cfg.env?.['JAVA_HOME'] ?? process.env['JAVA_HOME']
    const javaHomeOpt =
      javaHome && !(cfg.toolOpts ?? []).includes('--java-home')
        ? ['--java-home', javaHome]
        : []
    const args = [
      ...javaHomeOpt,
      ...props,
      ...(cfg.toolOpts ?? []),
      '--batch',
      FACTS_TASK,
    ]
    const out = await runNeverThrow(bin, args, cfg)
    return await assembleFromRecords(out, recordsFile)
  })
}

async function runMaven(
  config: ResolvedManifestScriptOptions,
): Promise<ManifestRunResult> {
  const cfg = { __proto__: null, ...config } as ResolvedManifestScriptOptions
  const jarPath = manifestScriptsPath(
    'maven-extension',
    'coana-maven-extension.jar',
  )
  assertMavenExtensionBuilt(jarPath)
  return await withTmpDir('socket-maven-facts-', async tmp => {
    const recordsFile = path.join(tmp, 'records.tsv')
    const bin = resolveBuildToolBin('maven', cfg.projectDir, cfg.bin)
    // `validate` is the cheapest phase that triggers the afterSessionEnd
    // extension; no compile needed (analysis uses configured paths, not classes).
    const props = [
      `-Dmaven.ext.class.path=${jarPath}`,
      '-Dcoana.task=socket-facts',
      `-Dsocket.recordsFile=${recordsFile}`,
      ...commonProps(cfg, '-D'),
    ]
    const args = [...props, ...(cfg.toolOpts ?? []), '--batch-mode', 'validate']
    const out = await runNeverThrow(bin, args, cfg)
    return await assembleFromRecords(out, recordsFile)
  })
}
