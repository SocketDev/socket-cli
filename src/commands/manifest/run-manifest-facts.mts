import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  looksLikeSbtBuild,
  resolveBuildToolBin,
} from './scripts/build-tool.mts'
import constants from '../../constants.mts'
import { isStandaloneSea } from '../../sea/runtime.mts'
import { spawnCoana } from '../../utils/coana-release.mts'
import { getErrorMessageOr } from '../../utils/errors.mts'
import { withTmpDir } from '../../utils/fs.mts'
import { getOrInsert } from '../../utils/get-or-insert.mts'
import { getDefaultOrgSlug } from '../ci/fetch-default-org-slug.mts'

import type { BuildTool } from './scripts/build-tool.mts'

export type BuildOption = 'excludeConfigs' | 'ignoreUnresolved' | 'verbose'

// Where the invoking command lets the user set each build option, so a remedy
// in Coana's failure report names something they can actually set.
export type BuildOptionHints = {
  // Reachability scans only: reachability cannot install a dependency that
  // `ignoreUnresolved` lets through, so it must be told to continue too.
  continueOnInstallErrorsFlag?: string | undefined
  // Taken as flags; every other option is set in `socketJson`.
  flags: ReadonlySet<BuildOption>
  // Wizard that writes `socketJson`.
  setupCommand: string
  socketJson: string
}

export const DSI_SETUP_COMMAND =
  'socket manifest setup --dynamic-sbom-inference'

export const REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG =
  '--reach-continue-on-install-errors'

// The single-build manifest commands take every option as a flag.
export const FLAG_HINTS: BuildOptionHints = {
  flags: new Set<BuildOption>([
    'excludeConfigs',
    'ignoreUnresolved',
    'verbose',
  ]),
  setupCommand: 'socket manifest setup',
  socketJson: constants.SOCKET_JSON,
}

// What a later Coana run needs of one generated build root; passed back to it
// unread.
export type SocketFactsSidecarEntry = {
  factsFile: string
  stateDir: string
}

// A directory socket-cli owns until the Coana run that reads it is done, and
// the entries of the build roots generated into it.
export type SocketFactsWorkDir = {
  dir: string
  entries: SocketFactsSidecarEntry[]
  // Reachability only: also install the dependencies the analysis reads.
  withFiles: boolean
}

export function sidecarEntryOf(
  workDir: SocketFactsWorkDir,
  factsFile: string,
): SocketFactsSidecarEntry | undefined {
  return workDir.entries.find(entry => entry.factsFile === factsFile)
}

// A facts file has one entry: the run that wrote it last.
export function setSidecarEntry(
  workDir: SocketFactsWorkDir,
  factsFile: string,
  entry: SocketFactsSidecarEntry | undefined,
): void {
  const kept = workDir.entries.filter(other => other.factsFile !== factsFile)
  workDir.entries.splice(0, workDir.entries.length, ...kept)
  if (entry) {
    workDir.entries.push(entry)
  }
}

export type SocketFactsContext = {
  // The Coana that reads `workDir` must be the one that wrote it.
  coanaVersion?: string | undefined
  orgSlug?: string | undefined
  workDir?: SocketFactsWorkDir | undefined
}

export type RunManifestFactsResult = {
  // Realpath-resolved build files the build covers.
  coveredBuildFiles: string[]
  factsPath: string
}

// `null` = a real failure (crash, missing config, blocking unresolved
// dependency); `undefined` = genuinely nothing to resolve, not a failure.
export type RunManifestFactsOutcome = RunManifestFactsResult | null | undefined

// The request `coana generate-socket-facts --request` reads.
type SocketFactsRequest = {
  buildRoot: string
  config: {
    bin?: string | undefined
    buildOpts: string[]
    excludeConfigs?: string | undefined
    ignoreUnresolved: boolean
    includeConfigs?: string | undefined
    javaHome?: string | undefined
    verbose: boolean
  }
  entryFile?: string | undefined
  excludeBase: string
  excludePaths?: string[] | undefined
  hints: {
    continueOnInstallErrorsFlag?: string | undefined
    flags: BuildOption[]
    setupCommand: string
    socketJson: string
  }
  tool: BuildTool
}

type SocketFactsResult =
  | {
      coveredBuildFiles: string[]
      factsPath: string
      sidecarEntry?: SocketFactsSidecarEntry | undefined
      status: 'generated'
    }
  | { status: 'empty' }
  | { status: 'failed' }

type SolutionMembers = { members: string[] | null }

let defaultOrgSlug: Promise<string | undefined> | undefined

// Resolved once: each build root is its own Coana run.
function orgSlugFor(context: SocketFactsContext): Promise<string | undefined> {
  if (context.orgSlug) {
    return Promise.resolve(context.orgSlug)
  }
  defaultOrgSlug ??= getDefaultOrgSlug(true).then(r =>
    r.ok ? r.data : undefined,
  )
  return defaultOrgSlug
}

function toRequestHints(hints: BuildOptionHints): SocketFactsRequest['hints'] {
  return {
    ...(hints.continueOnInstallErrorsFlag
      ? { continueOnInstallErrorsFlag: hints.continueOnInstallErrorsFlag }
      : {}),
    flags: [...hints.flags].sort(),
    setupCommand: hints.setupCommand,
    socketJson: hints.socketJson,
  }
}

async function runGenerateSocketFacts<T>(
  request: SocketFactsRequest,
  flags: string[],
  context: SocketFactsContext,
): Promise<{ message?: string | undefined; result: T | undefined }> {
  return await withTmpDir('socket-facts-request-', async tmpDir => {
    const requestFile = path.join(tmpDir, 'request.json')
    const resultFile = path.join(tmpDir, 'result.json')
    await fs.writeFile(requestFile, JSON.stringify(request), 'utf8')
    const spawned = await spawnCoana(
      [
        'generate-socket-facts',
        '--request',
        requestFile,
        '--output-file',
        resultFile,
        ...flags,
      ],
      await orgSlugFor(context),
      {
        coanaVersion: context.coanaVersion,
        cwd: request.buildRoot,
        // Coana logs to stdout; keep the command's own stdout machine-readable.
        stdio: ['inherit', 2, 'inherit'],
      },
    )
    const result = existsSync(resultFile)
      ? (JSON.parse(await fs.readFile(resultFile, 'utf8')) as T)
      : undefined
    return {
      message: spawned.ok
        ? undefined
        : [spawned.message, spawned.cause].filter(Boolean).join(': '),
      result,
    }
  })
}

// Resolves `bin` as the build tool's own runner would: the SOCKET_CLI_*_PATH
// override first, then the given bin, the project wrapper, PATH.
function requestBin(tool: BuildTool, dir: string, bin: string | undefined) {
  return resolveBuildToolBin(
    tool,
    dir,
    bin || undefined,
    tool !== 'dotnet' && isStandaloneSea(),
  )
}

const membersByRequest = new Map<string, Promise<string[] | undefined>>()

// The projects a dotnet solution builds; undefined when the SDK cannot read
// it, empty when the listing fails, which the build itself then reports.
export function listDotnetSolutionMembers({
  bin,
  buildOpts,
  context = {},
  dir,
  entryFile,
  excludeBase,
  excludePaths,
}: {
  bin?: string | undefined
  buildOpts: string[]
  context?: SocketFactsContext | undefined
  dir: string
  entryFile: string
  excludeBase?: string | undefined
  excludePaths?: string[] | undefined
}): Promise<string[] | undefined> {
  const key = JSON.stringify([
    bin,
    buildOpts,
    dir,
    entryFile,
    excludeBase,
    excludePaths,
  ])
  return getOrInsert(membersByRequest, key, async () => {
    let request: SocketFactsRequest
    try {
      request = {
        buildRoot: path.resolve(dir),
        config: {
          bin: requestBin('dotnet', dir, bin),
          buildOpts,
          ignoreUnresolved: false,
          verbose: false,
        },
        entryFile,
        excludeBase: path.resolve(excludeBase ?? dir),
        ...(excludePaths?.length ? { excludePaths } : {}),
        hints: toRequestHints(FLAG_HINTS),
        tool: 'dotnet',
      }
    } catch {
      return []
    }
    const { result } = await runGenerateSocketFacts<SolutionMembers>(
      request,
      ['--list-members'],
      context,
    )
    if (!result) {
      return []
    }
    return result.members ?? undefined
  })
}

// Generates one build root's `<entry>.socket.facts.json` with Coana. With a
// work dir in `context`, also collects what a later Coana run reads of it. A
// failure sets a non-zero exit code; Coana reports why.
export async function runManifestFacts({
  bin,
  buildOpts,
  context = {},
  cwd,
  ecosystem,
  entryFile,
  excludeBase,
  excludeConfigs,
  excludePaths,
  hints = FLAG_HINTS,
  ignoreUnresolved,
  includeConfigs,
  javaHome,
  verbose,
}: {
  bin: string
  buildOpts: string[]
  context?: SocketFactsContext | undefined
  cwd: string
  ecosystem: BuildTool
  // The file in `cwd` to build: Maven's POM (unset leaves Maven's default),
  // dotnet's solution or project (required).
  entryFile?: string | undefined
  // What `excludePaths` are relative to, as a build can reach modules outside
  // its own directory; `cwd` when unset.
  excludeBase?: string | undefined
  excludeConfigs: string
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  ignoreUnresolved: boolean
  includeConfigs: string
  // As written: Coana expands `$VAR` references itself.
  javaHome?: string | undefined
  verbose: boolean
}): Promise<RunManifestFactsOutcome> {
  if (ecosystem === 'sbt' && !looksLikeSbtBuild(cwd)) {
    process.exitCode = 1
    logger.fail(
      `No sbt build found at \`${cwd}\` (expected a build.sbt file or a project directory).`,
    )
    return null
  }

  let resolvedBin: string
  try {
    resolvedBin = requestBin(ecosystem, cwd, bin)
  } catch (e) {
    process.exitCode = 1
    logger.fail(
      `Could not run the ${ecosystem} build tool: ${getErrorMessageOr(e, String(e))}`,
    )
    return null
  }

  const request: SocketFactsRequest = {
    buildRoot: path.resolve(cwd),
    config: {
      bin: resolvedBin,
      buildOpts,
      ...(excludeConfigs ? { excludeConfigs } : {}),
      ignoreUnresolved,
      ...(includeConfigs ? { includeConfigs } : {}),
      ...(javaHome ? { javaHome } : {}),
      verbose,
    },
    ...(entryFile ? { entryFile } : {}),
    excludeBase: path.resolve(excludeBase ?? cwd),
    ...(excludePaths?.length ? { excludePaths } : {}),
    hints: toRequestHints(hints),
    tool: ecosystem,
  }
  const { workDir } = context
  const { message, result } = await runGenerateSocketFacts<SocketFactsResult>(
    request,
    workDir
      ? [
          ...(workDir.withFiles ? ['--with-files'] : []),
          '--work-dir',
          workDir.dir,
        ]
      : [],
    context,
  )

  if (!result || result.status === 'failed') {
    process.exitCode = 1
    if (!result) {
      logger.fail(
        `Could not generate Socket facts for the ${ecosystem} project at \`${cwd}\`${message ? `: ${message}` : '.'}`,
      )
    }
    return null
  }
  if (result.status === 'empty') {
    return undefined
  }
  if (workDir) {
    if (!result.sidecarEntry) {
      process.exitCode = 1
      logger.fail(
        `Coana did not keep what reachability analysis needs of \`${result.factsPath}\`.`,
      )
      return null
    }
    setSidecarEntry(workDir, result.factsPath, result.sidecarEntry)
  }
  return {
    coveredBuildFiles: result.coveredBuildFiles,
    factsPath: result.factsPath,
  }
}
