import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  looksLikeSbtBuild,
  resolveBuildToolBin,
} from './scripts/build-tool.mts'
import { COANA_CLI_VERSION, SOCKET_JSON } from '../../constants.mts'
import { isStandaloneSea } from '../../sea/runtime.mts'
import { spawnCoana } from '../../utils/coana-release.mts'
import { getErrorMessageOr } from '../../utils/errors.mts'
import { realpathOrResolved, withTmpDir } from '../../utils/fs.mts'
import { getOrInsert } from '../../utils/get-or-insert.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { CResult } from '../../types.mts'
import type { ReachabilityBuild } from '../../utils/socket-json.mts'

export type BuildOption = 'excludeConfigs' | 'ignoreUnresolved' | 'verbose'

// Where the invoking command lets the user set each build option, so a remedy
// in Coana's failure report names something they can actually set.
export type BuildOptionHints = {
  // Reachability scans only: reachability cannot install a dependency that
  // `ignoreUnresolved` lets through, so it must be told to continue too.
  continueOnInstallErrorsFlag?: string | undefined
  // The invoking command's option that leaves paths out of the scan.
  excludePathsFlag?: string | undefined
  // Taken as flags; every other option is set in `socketJson`.
  flags: ReadonlySet<BuildOption>
  // Wizard that writes `socketJson`.
  setupCommand: string
  socketJson: string
}

export const DSI_SETUP_COMMAND =
  'socket manifest setup --dynamic-sbom-inference'

export const EXCLUDE_PATHS_FLAG = '--exclude-paths'

export const REACH_CONTINUE_ON_INSTALL_ERRORS_FLAG =
  '--reach-continue-on-install-errors'

// The single-build manifest commands take every option as a flag.
export const FLAG_HINTS: BuildOptionHints = {
  excludePathsFlag: EXCLUDE_PATHS_FLAG,
  flags: new Set<BuildOption>([
    'excludeConfigs',
    'ignoreUnresolved',
    'verbose',
  ]),
  setupCommand: 'socket manifest setup',
  socketJson: SOCKET_JSON,
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
  // By the facts file's real path, as Coana's and the walk's paths to one
  // file may differ in a symlinked directory.
  entries: Map<string, SocketFactsSidecarEntry>
  // Reachability only: also install the dependencies the analysis reads.
  withFiles: boolean
}

export async function sidecarEntryOf(
  workDir: SocketFactsWorkDir,
  factsFile: string,
): Promise<SocketFactsSidecarEntry | undefined> {
  return workDir.entries.get(await realpathOrResolved(factsFile))
}

// A facts file has one entry: the run that wrote it last.
export async function setSidecarEntry(
  workDir: SocketFactsWorkDir,
  factsFile: string,
  entry: SocketFactsSidecarEntry | undefined,
): Promise<void> {
  const key = await realpathOrResolved(factsFile)
  workDir.entries.delete(key)
  if (entry) {
    workDir.entries.set(key, entry)
  }
}

export type SocketFactsContext = {
  // The Coana that reads `workDir` must be the one that wrote it.
  coanaVersion?: string | undefined
  orgSlug?: string | undefined
  workDir?: SocketFactsWorkDir | undefined
}

// A project the build loaded, with absolute paths. Gradle reports a project's
// build file even when absent.
export type SocketFactsProject = { buildFiles: string[]; dir: string }

export type RunManifestFactsResult = {
  factsPath: string
  projects: SocketFactsProject[]
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
    reachability?:
      | { build?: ReachabilityBuild | undefined; javaHome?: string | undefined }
      | undefined
    verbose: boolean
  }
  entryFile?: string | undefined
  excludeBase: string
  excludePaths?: string[] | undefined
  hints: {
    continueOnInstallErrorsFlag?: string | undefined
    excludePathsFlag?: string | undefined
    flags: BuildOption[]
    setupCommand: string
    socketJson: string
  }
  tool: BuildTool
}

type SocketFactsResult =
  | {
      factsPath: string
      projects: SocketFactsProject[]
      sidecarEntry?: SocketFactsSidecarEntry | undefined
      status: 'generated'
    }
  | { status: 'empty' }
  | { status: 'failed' }

type SolutionMembers = { members: string[] | null }

type ProjectList =
  | { projects: SocketFactsProject[]; status: 'listed' }
  | { status: 'failed' }

// Coana rejects a command or flag it predates, so it writes no result.
function warnIfPinnedCoanaPredatesFacts(context: SocketFactsContext): void {
  const pinned = context.coanaVersion
  if (pinned && pinned !== COANA_CLI_VERSION) {
    logger.info(
      `The pinned Coana ${pinned} may predate Socket facts generation; pin ${COANA_CLI_VERSION}, the version this Socket CLI bundles, or newer.`,
    )
  }
}

async function readResult<T>(
  resultFile: string,
): Promise<{ error?: string | undefined; result: T | undefined }> {
  if (!existsSync(resultFile)) {
    return { result: undefined }
  }
  try {
    return { result: JSON.parse(await fs.readFile(resultFile, 'utf8')) as T }
  } catch (e) {
    return {
      error: `Coana's result is unreadable (${getErrorMessageOr(e, String(e))})`,
      result: undefined,
    }
  }
}

function toRequestHints(hints: BuildOptionHints): SocketFactsRequest['hints'] {
  return {
    ...(hints.continueOnInstallErrorsFlag
      ? { continueOnInstallErrorsFlag: hints.continueOnInstallErrorsFlag }
      : {}),
    ...(hints.excludePathsFlag
      ? { excludePathsFlag: hints.excludePathsFlag }
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
      context.orgSlug,
      {
        coanaVersion: context.coanaVersion,
        // Coana logs to stdout; keep the command's own stdout machine-readable.
        stdio: ['inherit', 2, 'inherit'],
      },
    )
    const { error, result } = await readResult<T>(resultFile)
    const failure = spawned.ok
      ? undefined
      : [spawned.message, spawned.cause].filter(Boolean).join(': ')
    return {
      message: [failure, error].filter(Boolean).join('; ') || undefined,
      result,
    }
  })
}

export type SocketFactsRequestOptions = {
  bin?: string | undefined
  buildOpts: string[]
  cwd: string
  ecosystem: BuildTool
  // The file in `cwd` to build: Maven's POM (unset leaves Maven's default),
  // dotnet's solution or project (required).
  entryFile?: string | undefined
  // What `excludePaths` are relative to, as a build can reach modules outside
  // its own directory; `cwd` when unset.
  excludeBase?: string | undefined
  excludeConfigs?: string | undefined
  excludePaths?: string[] | undefined
  hints?: BuildOptionHints | undefined
  ignoreUnresolved?: boolean | undefined
  includeConfigs?: string | undefined
  // As written: Coana expands `$VAR` references itself.
  javaHome?: string | undefined
  // Unused by facts generation: Coana keeps it for the reachability run.
  reachability?:
    | { build?: ReachabilityBuild | undefined; javaHome?: string | undefined }
    | undefined
  verbose?: boolean | undefined
}

export type SocketFactsRunOptions = SocketFactsRequestOptions & {
  context?: SocketFactsContext | undefined
}

// SOCKET_CLI_*_PATH, else `bin`, the project wrapper, then PATH; standalone,
// JVM tools take only SOCKET_CLI_*_PATH, as no JVM tooling is bundled.
function toSocketFactsRequest({
  bin,
  buildOpts,
  cwd,
  ecosystem,
  entryFile,
  excludeBase,
  excludeConfigs,
  excludePaths,
  hints = FLAG_HINTS,
  ignoreUnresolved = false,
  includeConfigs,
  javaHome,
  reachability,
  verbose = false,
}: SocketFactsRequestOptions): CResult<SocketFactsRequest> {
  let resolvedBin: string
  try {
    resolvedBin = resolveBuildToolBin(
      ecosystem,
      cwd,
      bin || undefined,
      ecosystem !== 'dotnet' && isStandaloneSea(),
    )
  } catch (e) {
    return {
      ok: false,
      message: `Could not run the ${ecosystem} build tool`,
      cause: getErrorMessageOr(e, String(e)),
    }
  }
  return {
    ok: true,
    data: {
      buildRoot: path.resolve(cwd),
      config: {
        bin: resolvedBin,
        buildOpts,
        ...(excludeConfigs ? { excludeConfigs } : {}),
        ignoreUnresolved,
        ...(includeConfigs ? { includeConfigs } : {}),
        ...(javaHome ? { javaHome } : {}),
        ...(reachability?.build || reachability?.javaHome
          ? {
              reachability: {
                ...(reachability.build ? { build: reachability.build } : {}),
                ...(reachability.javaHome
                  ? { javaHome: reachability.javaHome }
                  : {}),
              },
            }
          : {}),
        verbose,
      },
      ...(entryFile ? { entryFile } : {}),
      excludeBase: path.resolve(excludeBase ?? cwd),
      ...(excludePaths?.length ? { excludePaths } : {}),
      hints: toRequestHints(hints),
      tool: ecosystem,
    },
  }
}

const membersByRequest = new Map<string, Promise<string[] | undefined>>()

// The projects a dotnet solution builds; undefined when the SDK cannot read
// it, empty when the listing fails, which the build itself then reports.
export async function listDotnetSolutionMembers({
  context = {},
  ...options
}: Omit<SocketFactsRequestOptions, 'ecosystem'> & {
  context?: SocketFactsContext | undefined
}): Promise<string[] | undefined> {
  const request = toSocketFactsRequest({ ...options, ecosystem: 'dotnet' })
  if (!request.ok) {
    // Left for the build itself to report.
    return []
  }
  return await getOrInsert(
    membersByRequest,
    JSON.stringify(request.data),
    async () => {
      const { result } = await runGenerateSocketFacts<SolutionMembers>(
        request.data,
        ['--list-members'],
        context,
      )
      if (!result) {
        return []
      }
      return result.members ?? undefined
    },
  )
}

// Resolves nothing; undefined, after reporting why, when the build cannot list
// its projects.
export async function listBuildProjects({
  context = {},
  ...options
}: SocketFactsRunOptions): Promise<SocketFactsProject[] | undefined> {
  const { cwd, ecosystem } = options
  const request = toSocketFactsRequest(options)
  if (!request.ok) {
    logger.fail(`${request.message}: ${request.cause}`)
    return undefined
  }
  const { message, result } = await runGenerateSocketFacts<ProjectList>(
    request.data,
    ['--list-projects'],
    context,
  )
  if (!result) {
    logger.fail(
      `Could not list the projects of the ${ecosystem} build at \`${cwd}\`${message ? `: ${message}` : '.'}`,
    )
    return undefined
  }
  return result.status === 'listed' ? result.projects : undefined
}

// A failure sets a non-zero exit code; only a failed build is Coana's to
// report.
export async function runManifestFacts({
  context = {},
  ...options
}: SocketFactsRunOptions): Promise<RunManifestFactsOutcome> {
  const { cwd, ecosystem } = options
  if (ecosystem === 'sbt' && !looksLikeSbtBuild(cwd)) {
    process.exitCode = 1
    logger.fail(
      `No sbt build found at \`${cwd}\` (expected a build.sbt file or a project directory).`,
    )
    return null
  }

  const request = toSocketFactsRequest(options)
  if (!request.ok) {
    process.exitCode = 1
    logger.fail(`${request.message}: ${request.cause}`)
    return null
  }

  const { workDir } = context
  const { message, result } = await runGenerateSocketFacts<SocketFactsResult>(
    request.data,
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
      warnIfPinnedCoanaPredatesFacts(context)
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
    await setSidecarEntry(workDir, result.factsPath, result.sidecarEntry)
  }
  return {
    factsPath: result.factsPath,
    projects: result.projects,
  }
}
