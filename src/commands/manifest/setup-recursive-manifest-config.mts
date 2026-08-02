import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import {
  findBuildToolCandidates,
  realpathOrResolved,
} from './discover-manifest-roots.mts'
import { setupGradle, setupMaven, setupSbt } from './setup-manifest-config.mts'
import { SOCKET_JSON } from '../../constants.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'
import { excludePathToScanIgnores } from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { CResult } from '../../types.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

// One directory to mark `disabled: true` in, covering every ecosystem found
// excluded beneath it. `dir` is the shallowest directory that itself matches
// `--exclude-paths` - not necessarily a project dir of its own - so a single
// write covers every sibling/nested project underneath, instead of one write
// per matched project (which would miss sibling projects that don't happen to
// be descendants of whichever matched project was written first).
type ExclusionRoot = { dir: string; ecosystems: BuildTool[] }

function canceledByUser(): CResult<{ canceled: boolean }> {
  logger.log('')
  logger.info('User canceled')
  logger.log('')
  return { ok: true, data: { canceled: true } }
}

function notCanceled(): CResult<{ canceled: boolean }> {
  return { ok: true, data: { canceled: false } }
}

function getEcosystemSection(
  sockJson: SocketJson,
  ecosystem: BuildTool,
): Record<string, unknown> {
  return (
    (sockJson.defaults?.manifest?.[ecosystem] as
      | Record<string, unknown>
      | undefined) ?? {}
  )
}

// Depth-then-path sort, purely for stable/predictable log ordering - separate
// exclusion roots never nest inside one another (see findExclusionRoot), so
// there's no cascade-correctness dependency between the writes.
export function sortCandidatesForDisplay(
  candidates: readonly ExclusionRoot[],
  cwd: string,
): ExclusionRoot[] {
  return [...candidates].sort((a, b) => {
    const relA = path.relative(cwd, a.dir)
    const relB = path.relative(cwd, b.dir)
    const depthA = relA.split(path.sep).length
    const depthB = relB.split(path.sep).length
    if (depthA !== depthB) {
      return depthA - depthB
    }
    return relA < relB ? -1 : relA > relB ? 1 : 0
  })
}

function toPosixRelative(cwd: string, dir: string): string {
  return path.relative(cwd, dir).split(path.sep).join('/')
}

// Walks a matched candidate's path from shallowest to deepest and returns the
// first (shallowest) prefix that itself matches one of the --exclude-paths
// ignore patterns - i.e. the directory the exclusion should actually be
// written to. Writing there instead of at the matched candidate itself means
// one write covers every sibling/nested project beneath it, even when that
// directory isn't a build root of its own.
function findExclusionRoot(
  relDir: string,
  ignorePatterns: readonly string[],
): string {
  const segments = relDir.split('/')
  for (let depth = 1; depth <= segments.length; depth += 1) {
    const prefix = segments.slice(0, depth).join('/')
    if (micromatch.isMatch(prefix, ignorePatterns, { dot: true })) {
      return prefix
    }
  }
  return relDir
}

// Discovers every gradle/sbt/maven build root beneath `cwd` (a plain
// filesystem walk, no dependency resolution and no build-tool invocation -
// so no bin/javaHome is ever needed), diffs an unfiltered walk against an
// excludePaths-filtered walk (both via the same findBuildToolCandidates
// fast-glob machinery, which already treats --exclude-paths as anchored
// ignores that prevent descending into a matched subtree at all) to find
// every excluded project, then groups them by the shallowest directory that
// actually matched --exclude-paths (see findExclusionRoot) so a whole
// excluded subtree gets exactly one write, regardless of how many build roots
// or ecosystems it contains. `cwd` itself is excluded - it already got its
// own wizard pass. `cwd` is realpath-resolved before comparing: the
// discovered dirs findBuildToolCandidates returns already are (it resolves
// symlinks so results are stable), and on macOS /tmp -> /private/tmp alone is
// enough to otherwise break the comparison.
export async function discoverExcludedCandidates({
  cwd,
  excludePaths,
  rootSockJson,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  rootSockJson: SocketJson
}): Promise<ExclusionRoot[]> {
  const realCwd = await realpathOrResolved(cwd)
  const [fullByTool, includedByTool] = await Promise.all([
    findBuildToolCandidates({ cwd, sockJson: rootSockJson }),
    findBuildToolCandidates({ cwd, excludePaths, sockJson: rootSockJson }),
  ])

  const ignorePatterns = (excludePaths ?? []).flatMap(excludePathToScanIgnores)
  const ecosystemsByRoot = new Map<string, Set<BuildTool>>()
  for (const [ecosystem, fullDirs] of fullByTool) {
    const includedDirs = new Set(includedByTool.get(ecosystem) ?? [])
    for (const dir of fullDirs) {
      if (dir === realCwd || includedDirs.has(dir)) {
        continue
      }
      const relDir = toPosixRelative(realCwd, dir)
      const rootRelDir = findExclusionRoot(relDir, ignorePatterns)
      const rootDir = path.join(realCwd, rootRelDir)
      const ecosystems = ecosystemsByRoot.get(rootDir) ?? new Set<BuildTool>()
      ecosystems.add(ecosystem)
      ecosystemsByRoot.set(rootDir, ecosystems)
    }
  }

  return [...ecosystemsByRoot].map(([dir, ecosystems]) => ({
    dir,
    ecosystems: [...ecosystems].sort(),
  }))
}

// Marks one exclusion root's own socket.json `disabled: true` for whichever
// of its ecosystems aren't already disabled via cascade (an already-disabled
// ancestor from a prior run) - a no-op write is skipped entirely so re-running
// the wizard doesn't keep rewriting already-disabled roots.
export async function disableExclusionRoot({
  cwd,
  dir,
  ecosystems,
  rootSockJson,
}: {
  cwd: string
  dir: string
  ecosystems: readonly BuildTool[]
  rootSockJson: SocketJson
}): Promise<CResult<{ canceled: boolean }>> {
  const relDir = path.relative(cwd, dir) || '.'
  const cascade = readSocketJsonCascade(dir, cwd, rootSockJson)
  const needsWrite = ecosystems.filter(
    ecosystem => getEcosystemSection(cascade, ecosystem)['disabled'] !== true,
  )
  if (!needsWrite.length) {
    return notCanceled()
  }

  const ownSockJson = readOrDefaultSocketJson(dir)
  if (!ownSockJson.defaults) {
    ownSockJson.defaults = {}
  }
  if (!ownSockJson.defaults.manifest) {
    ownSockJson.defaults.manifest = {}
  }
  const manifest = ownSockJson.defaults.manifest as Record<string, unknown>
  for (const ecosystem of needsWrite) {
    manifest[ecosystem] = {
      ...getEcosystemSection(ownSockJson, ecosystem),
      disabled: true,
    }
  }

  const writeResult = await writeSocketJson(dir, ownSockJson)
  if (!writeResult.ok) {
    return writeResult
  }
  logger.success(`Disabled ${relDir} (${needsWrite.join(', ')})`)
  return notCanceled()
}

async function askYesNo(message: string): Promise<boolean | null> {
  return (await select({
    message,
    choices: [
      { name: 'Yes', value: true },
      { name: 'No', value: false },
    ],
  })) as boolean | null
}

// The recursive flow's root step: unlike the plain single-project wizard
// (`setupManifestConfig`, which assumes `cwd` IS a specific ecosystem's
// project and only lets you configure one before finishing), the recursion
// root is often just a common ancestor with no project of its own - so walk
// all three JVM ecosystems in a fixed order, asking yes/no whether to set
// baseline defaults for each, instead of picking one from a menu. Declining
// all three is a normal (non-canceled) outcome, not an abort - the
// exclude-paths-driven part of the recursive setup still proceeds.
async function setupRecursiveRootDefaults(
  cwd: string,
  defaultOnReadError: boolean,
): Promise<CResult<{ canceled: boolean }>> {
  const jsonPath = path.join(cwd, SOCKET_JSON)
  if (existsSync(jsonPath)) {
    logger.info(`Found ${SOCKET_JSON} at ${jsonPath}`)
  } else {
    logger.info(`No ${SOCKET_JSON} found at ${cwd}, will generate a new one`)
  }

  logger.log('')
  logger.log(
    'Note: This tool will set up flag and argument defaults for certain',
  )
  logger.log('      CLI commands. You can still override them by explicitly')
  logger.log('      setting the flag. It is meant to be a convenience tool.')
  logger.log('')
  logger.log(
    `This command will generate a ${SOCKET_JSON} file in the target cwd,`,
  )
  logger.log(
    'used as the fallback for every build root beneath it that inherits',
  )
  logger.log("(rather than overrides) a given field, instead of the CLI's")
  logger.log('own hardcoded defaults.')
  logger.log('')

  const sockJsonCResult = readSocketJsonSync(cwd, defaultOnReadError)
  if (!sockJsonCResult.ok) {
    return sockJsonCResult
  }
  const sockJson = sockJsonCResult.data
  if (!sockJson.defaults) {
    sockJson.defaults = {}
  }
  if (!sockJson.defaults.manifest) {
    sockJson.defaults.manifest = {}
  }

  let configuredAny = false

  const wantsMaven = await askYesNo('Configure Maven defaults?')
  if (wantsMaven === undefined || wantsMaven === null) {
    return canceledByUser()
  }
  if (wantsMaven) {
    if (!sockJson.defaults.manifest.maven) {
      sockJson.defaults.manifest.maven = {}
    }
    const result = await setupMaven(sockJson.defaults.manifest.maven)
    if (!result.ok || result.data.canceled) {
      return result
    }
    configuredAny = true
  }

  const wantsGradle = await askYesNo('Configure Gradle defaults?')
  if (wantsGradle === undefined || wantsGradle === null) {
    return canceledByUser()
  }
  if (wantsGradle) {
    if (!sockJson.defaults.manifest.gradle) {
      sockJson.defaults.manifest.gradle = {}
    }
    const result = await setupGradle(sockJson.defaults.manifest.gradle)
    if (!result.ok || result.data.canceled) {
      return result
    }
    configuredAny = true
  }

  const wantsSbt = await askYesNo('Configure sbt defaults?')
  if (wantsSbt === undefined || wantsSbt === null) {
    return canceledByUser()
  }
  if (wantsSbt) {
    if (!sockJson.defaults.manifest.sbt) {
      sockJson.defaults.manifest.sbt = {}
    }
    const result = await setupSbt(sockJson.defaults.manifest.sbt)
    if (!result.ok || result.data.canceled) {
      return result
    }
    configuredAny = true
  }

  if (!configuredAny) {
    logger.log('')
    logger.log('No root-level defaults configured.')
    return notCanceled()
  }

  logger.log('')
  logger.log(`Setup complete. Writing ${SOCKET_JSON}`)
  logger.log('')

  if (
    await select({
      message: `Do you want to write the new config to ${jsonPath} ?`,
      choices: [
        { name: 'yes', value: true, description: 'Update config' },
        { name: 'no', value: false, description: 'Do not update the config' },
      ],
    })
  ) {
    const writeResult = await writeSocketJson(cwd, sockJson)
    if (!writeResult.ok) {
      return writeResult
    }
    return notCanceled()
  }
  return canceledByUser()
}

// `socket manifest setup --dynamic-sbom-inference`: configures `cwd` via
// `setupRecursiveRootDefaults` first, then walks every gradle/sbt/maven
// build root beneath it and marks `disabled: true` on whatever matches
// `--exclude-paths` - a project not covered by it is assumed to be one the
// user wants included and is left completely untouched. To customize
// bin/JDK/config filters for a *specific* project, run the plain
// `socket manifest setup <path>` on it directly; this recursive mode only
// ever writes `disabled: true`, never per-field overrides. This sidesteps a
// real circularity the earlier "discover via enumeration, then prompt"
// design had: enumerating a nested project's own subprojects needs a
// resolved bin/javaHome for that specific project, which isn't known until
// after prompting for it - but prompting-before-discovery doesn't work when
// the discovery itself is what surfaces the project to prompt about. Pure
// path-based exclusion needs neither: it never invokes a build tool at all.
export async function setupRecursiveManifestConfig(
  cwd: string,
  defaultOnReadError: boolean,
  excludePaths?: string[] | undefined,
): Promise<CResult<{ canceled: boolean }>> {
  logger.log('')
  logger.log(`Configuring the root project at ${cwd} ...`)
  const rootResult = await setupRecursiveRootDefaults(cwd, defaultOnReadError)
  if (!rootResult.ok) {
    return rootResult
  }
  if (rootResult.data.canceled) {
    return canceledByUser()
  }

  logger.log('')
  const wantsDiscovery = await askYesNo('Recursively discover build roots?')
  if (wantsDiscovery === undefined || wantsDiscovery === null) {
    return canceledByUser()
  }
  if (!wantsDiscovery) {
    logger.log('')
    logger.success('Recursive setup complete.')
    return notCanceled()
  }

  // Re-read: the root wizard may have just written a new socket.json.
  const rootSockJson = readOrDefaultSocketJson(cwd)
  // Resolved once here for sortCandidatesForDisplay/disableExclusionRoot's
  // relative-path math, consistent with discoverExcludedCandidates' own
  // internal resolution (see its comment for why this matters).
  const realCwd = await realpathOrResolved(cwd)

  logger.log('')
  logger.log('Discovering build roots to exclude ...')
  const toDisable = await discoverExcludedCandidates({
    cwd,
    excludePaths,
    rootSockJson,
  })
  if (!toDisable.length) {
    logger.log('No excluded build roots found.')
    return notCanceled()
  }

  const ordered = sortCandidatesForDisplay(toDisable, realCwd)
  for (const candidate of ordered) {
    // eslint-disable-next-line no-await-in-loop
    const result = await disableExclusionRoot({
      cwd: realCwd,
      dir: candidate.dir,
      ecosystems: candidate.ecosystems,
      rootSockJson,
    })
    if (!result.ok) {
      return result
    }
  }

  logger.log('')
  logger.success('Recursive setup complete.')
  return notCanceled()
}
