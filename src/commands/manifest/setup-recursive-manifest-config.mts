import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import {
  findBuildToolCandidates,
  realpathOrResolved,
  withoutDisabledFlags,
} from './discover-manifest-roots.mts'
import { enumerateWorkspaces } from './enumerate-workspaces.mts'
import { resolveEcosystemConfig } from './generate-recursive-manifests.mts'
import { setupGradle, setupMaven, setupSbt } from './setup-manifest-config.mts'
import { SOCKET_JSON } from '../../constants.mts'
import {
  readOrDefaultSocketJson,
  readSocketJsonCascade,
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'
import {
  excludePathToScanIgnores,
  projectIgnorePathsToReachExcludePaths,
} from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { CResult } from '../../types.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

// A single discovered build root - a directory with its own gradle/sbt/maven
// marker file.
type Candidate = { dir: string; ecosystem: BuildTool }

const ROOT_ECOSYSTEMS: BuildTool[] = ['maven', 'gradle', 'sbt']

const ECOSYSTEM_LABELS: Record<BuildTool, string> = {
  __proto__: null,
  gradle: 'Gradle',
  maven: 'Maven',
  sbt: 'sbt',
} as unknown as Record<BuildTool, string>

// The shallowest directory matching `--exclude-paths`, not necessarily a
// project dir itself - one write here covers every project beneath it.
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

// Depth-then-path sort: for exclusion roots it's just stable log ordering;
// for candidates it's load-bearing, since a parent must be prompted before
// its children so a child's shown default reflects a parent's just-written
// cascade instead of its pre-run value.
export function sortCandidatesForDisplay<T extends { dir: string }>(
  candidates: readonly T[],
  cwd: string,
): T[] {
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

// Shallowest prefix of `relDir` that matches an --exclude-paths pattern -
// the directory to write `disabled` to, so one write covers everything
// beneath it, even if that directory isn't itself a build root.
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

export type ScannedBuildRoots = {
  fullByTool: Map<BuildTool, string[]>
  includedByTool: Map<BuildTool, string[]>
}

// Both the unfiltered and --exclude-paths-filtered scans, once, so ecosystem
// detection and later include/exclude grouping (see discoverBuildRoots)
// never re-walk the same tree.
export async function scanBuildRoots({
  cwd,
  excludePaths,
  sockJson,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  sockJson: SocketJson
}): Promise<ScannedBuildRoots> {
  const [fullByTool, includedByTool] = await Promise.all([
    findBuildToolCandidates({ cwd, sockJson }),
    findBuildToolCandidates({ cwd, excludePaths, sockJson }),
  ])
  return { fullByTool, includedByTool }
}

export type DiscoveredBuildRoots = {
  excluded: ExclusionRoot[]
  // Every candidate --exclude-paths didn't rule out - these get the
  // interactive configure-or-inherit walk instead of a bulk write.
  included: Candidate[]
}

// Splits an already-scanned candidate set into `included` (the interactive
// walk) and `excluded`, grouped by the shallowest --exclude-paths match (see
// findExclusionRoot). `cwd` is excluded from both (it got its own wizard
// pass) and realpath-resolved to match findBuildToolCandidates' own
// resolution - otherwise macOS's /tmp -> /private/tmp breaks the comparison.
export async function discoverBuildRoots({
  cwd,
  excludePaths,
  fullByTool,
  includedByTool,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  fullByTool: Map<BuildTool, string[]>
  includedByTool: Map<BuildTool, string[]>
}): Promise<DiscoveredBuildRoots> {
  const realCwd = await realpathOrResolved(cwd)
  const included: Candidate[] = []
  const ignorePatterns = (excludePaths ?? []).flatMap(excludePathToScanIgnores)
  const ecosystemsByRoot = new Map<string, Set<BuildTool>>()
  for (const [ecosystem, fullDirs] of fullByTool) {
    const includedDirs = new Set(includedByTool.get(ecosystem) ?? [])
    for (const dir of fullDirs) {
      if (dir === realCwd) {
        continue
      }
      if (includedDirs.has(dir)) {
        included.push({ dir, ecosystem })
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

  return {
    excluded: [...ecosystemsByRoot].map(([dir, ecosystems]) => ({
      dir,
      ecosystems: [...ecosystems].sort(),
    })),
    included,
  }
}

// Enumerates one build root's declared workspace members (see
// enumerate-workspaces.mts) and folds them into `coveredByEcosystem`, so a
// later candidate matching one is recognized as a reactor member rather than
// independent. Called per-candidate right after its own prompt, not as a
// bulk pass, so the build invocation never blocks candidates that don't need
// it. A disabled candidate is skipped (no point invoking an off build tool);
// otherwise this fails closed, same reasoning as generateRecursiveManifests -
// if enumeration fails there's no way to tell covered from independent, so
// the caller aborts rather than guess.
export async function markWorkspaceCoverage({
  candidate,
  coveredByEcosystem,
  cwd,
  excludePaths,
  rootSockJson,
}: {
  candidate: Candidate
  coveredByEcosystem: Map<BuildTool, Set<string>>
  cwd: string
  excludePaths?: string[] | undefined
  rootSockJson: SocketJson
}): Promise<CResult<undefined>> {
  const cascade = readSocketJsonCascade(candidate.dir, cwd, rootSockJson)
  const { bin, buildOpts, javaHome, skipReason } = resolveEcosystemConfig(
    candidate.ecosystem,
    candidate.dir,
    cascade,
  )
  if (skipReason) {
    return { ok: true, data: undefined }
  }

  const excludePathsForCandidate = projectIgnorePathsToReachExcludePaths(
    excludePaths,
    { cwd, target: candidate.dir },
  )

  const enumResult = await enumerateWorkspaces({
    bin,
    buildOpts,
    cwd: candidate.dir,
    ecosystem: candidate.ecosystem,
    excludePaths: excludePathsForCandidate,
    javaHome,
    verbose: false,
  })
  if (!enumResult) {
    const relDir = path.relative(cwd, candidate.dir) || '.'
    return {
      ok: false,
      message: `Could not determine ${candidate.ecosystem} workspace layout for ${relDir}; aborting rather than risk misclassifying its members.`,
    }
  }

  const set = coveredByEcosystem.get(candidate.ecosystem) ?? new Set<string>()
  set.add(candidate.dir)
  const resolvedSubprojectDirs = await Promise.all(
    enumResult.projects.map(project =>
      realpathOrResolved(path.resolve(candidate.dir, project.subprojectDir)),
    ),
  )
  for (const subprojectDir of resolvedSubprojectDirs) {
    set.add(subprojectDir)
  }
  coveredByEcosystem.set(candidate.ecosystem, set)
  return { ok: true, data: undefined }
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

// Dispatches to the right ecosystem-specific wizard. `factsOnly` skips the
// facts/pom question - dynamic-sbom-inference never generates a pom.xml, it
// just skips a project resolved to `facts: false` (see
// generateRecursiveManifests' skipReason), so offering that choice here
// would be misleading.
async function runEcosystemWizard(
  ecosystem: BuildTool,
  config: Record<string, unknown>,
): Promise<CResult<{ canceled: boolean }>> {
  if (ecosystem === 'gradle') {
    return await setupGradle(
      config as NonNullable<
        NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['gradle']
      >,
      { factsOnly: true },
    )
  }
  if (ecosystem === 'maven') {
    return await setupMaven(
      config as NonNullable<
        NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['maven']
      >,
    )
  }
  return await setupSbt(
    config as NonNullable<
      NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['sbt']
    >,
    { factsOnly: true },
  )
}

// Seeds the wizard with this candidate's effective (cascaded) value for any
// field its own file doesn't already set, so accepting every prompt
// unchanged preserves what it currently inherits, while an actual change
// writes an explicit override.
export async function configureCandidate({
  cwd,
  dir,
  ecosystem,
  rootSockJson,
}: {
  cwd: string
  dir: string
  ecosystem: BuildTool
  rootSockJson: SocketJson
}): Promise<CResult<{ canceled: boolean }>> {
  const relDir = path.relative(cwd, dir) || '.'
  const ownSockJson = readOrDefaultSocketJson(dir)
  if (!ownSockJson.defaults) {
    ownSockJson.defaults = {}
  }
  if (!ownSockJson.defaults.manifest) {
    ownSockJson.defaults.manifest = {}
  }

  const cascade = readSocketJsonCascade(dir, cwd, rootSockJson)
  const seed: Record<string, unknown> = {
    ...getEcosystemSection(cascade, ecosystem),
    ...getEcosystemSection(ownSockJson, ecosystem),
  }

  const result = await runEcosystemWizard(ecosystem, seed)
  if (!result.ok || result.data.canceled) {
    return result
  }
  // Nothing inherited and nothing set - writing an empty section would just
  // be noise (own file unaffected, `dir` keeps inheriting exactly as before).
  if (!Object.keys(seed).length) {
    logger.log(`No changes for ${relDir} (${ecosystem}); nothing written.`)
    return notCanceled()
  }

  const manifest = ownSockJson.defaults.manifest as Record<string, unknown>
  manifest[ecosystem] = seed

  const writeResult = await writeSocketJson(dir, ownSockJson)
  if (!writeResult.ok) {
    return writeResult
  }
  logger.success(`Configured ${relDir} (${ecosystem})`)
  return notCanceled()
}

type CandidateAction = 'configure' | 'inherit'

// No disable choice here - that's --exclude-paths' job (see
// findExclusionRoot), so a whole subtree still collapses to one write
// instead of one per candidate.
async function askCandidateAction(
  relDir: string,
  ecosystem: BuildTool,
): Promise<CandidateAction | null> {
  return (await select({
    message: `${relDir} (${ecosystem})`,
    choices: [
      {
        name: 'Leave as-is',
        value: 'inherit',
        description:
          "Make no change - keep this project's current effective configuration",
      },
      {
        name: 'Configure',
        value: 'configure',
        description: 'Set bin/JDK/opts/etc. for this project specifically',
      },
    ],
    default: 'inherit',
  })) as CandidateAction | null
}

type CandidateOutcome = 'configured' | 'inherited' | 'skipped'

// Asks the standard configure-or-leave-as-is question and applies the
// answer. Shared by the normal path and the post-re-enable path below, so
// re-enabling a candidate isn't a dead end that skips straight past its own
// bin/JDK/opts configuration.
async function askAndApplyAction({
  cwd,
  dir,
  ecosystem,
  relDir,
  rootSockJson,
}: {
  cwd: string
  dir: string
  ecosystem: BuildTool
  relDir: string
  rootSockJson: SocketJson
}): Promise<
  CResult<{ canceled: boolean; outcome: 'configured' | 'inherited' }>
> {
  const action = await askCandidateAction(relDir, ecosystem)
  if (action === undefined || action === null) {
    canceledByUser()
    return { ok: true, data: { canceled: true, outcome: 'inherited' } }
  }
  if (action === 'configure') {
    const result = await configureCandidate({
      cwd,
      dir,
      ecosystem,
      rootSockJson,
    })
    if (!result.ok) {
      return result
    }
    return { ok: true, data: { ...result.data, outcome: 'configured' } }
  }
  // 'inherit', or any unexpected value - the safe no-op default.
  return { ok: true, data: { canceled: false, outcome: 'inherited' } }
}

// Prompts for configure/inherit, unless the cascade shows the candidate
// disabled: offer to re-enable if that's its own file, then continue into
// the normal prompt; stay silent if it's only inherited from an ancestor's
// bulk write (that's noise for a large excluded subtree).
export async function processCandidate({
  cwd,
  dir,
  ecosystem,
  rootSockJson,
}: {
  cwd: string
  dir: string
  ecosystem: BuildTool
  rootSockJson: SocketJson
}): Promise<
  CResult<{ canceled: boolean; outcome: CandidateOutcome; reenabled: boolean }>
> {
  const relDir = path.relative(cwd, dir) || '.'
  const cascade = readSocketJsonCascade(dir, cwd, rootSockJson)
  if (getEcosystemSection(cascade, ecosystem)['disabled'] === true) {
    const ownSockJson = readOrDefaultSocketJson(dir)
    if (getEcosystemSection(ownSockJson, ecosystem)['disabled'] !== true) {
      // Inherited from an ancestor, not this candidate's own file - stay silent.
      return {
        ok: true,
        data: { canceled: false, outcome: 'skipped', reenabled: false },
      }
    }

    const wantsReenable = await askYesNo(
      `${relDir} (${ecosystem}) is disabled - re-enable it?`,
    )
    if (wantsReenable === undefined || wantsReenable === null) {
      canceledByUser()
      return {
        ok: true,
        data: { canceled: true, outcome: 'skipped', reenabled: false },
      }
    }
    if (!wantsReenable) {
      return {
        ok: true,
        data: { canceled: false, outcome: 'skipped', reenabled: false },
      }
    }
    if (!ownSockJson.defaults) {
      ownSockJson.defaults = {}
    }
    if (!ownSockJson.defaults.manifest) {
      ownSockJson.defaults.manifest = {}
    }
    const manifest = ownSockJson.defaults.manifest as Record<string, unknown>
    manifest[ecosystem] = {
      ...getEcosystemSection(ownSockJson, ecosystem),
      disabled: false,
    }
    const writeResult = await writeSocketJson(dir, ownSockJson)
    if (!writeResult.ok) {
      return writeResult
    }
    logger.success(`Re-enabled ${relDir} (${ecosystem})`)

    const result = await askAndApplyAction({
      cwd,
      dir,
      ecosystem,
      relDir,
      rootSockJson,
    })
    if (!result.ok) {
      return result
    }
    return { ok: true, data: { ...result.data, reenabled: true } }
  }

  const result = await askAndApplyAction({
    cwd,
    dir,
    ecosystem,
    relDir,
    rootSockJson,
  })
  if (!result.ok) {
    return result
  }
  return { ok: true, data: { ...result.data, reenabled: false } }
}

// Accepting every prompt's default leaves an ecosystem's section genuinely
// empty (see askForBin in setup-manifest-config.mts) - drop it so
// `configuredAny` reflects what was actually configured, not just which
// ecosystems the user said "yes" to.
function dropIfEmpty(
  manifest: Record<string, unknown>,
  ecosystem: BuildTool,
): boolean {
  const section = manifest[ecosystem] as Record<string, unknown> | undefined
  if (section && Object.keys(section).length) {
    return true
  }
  delete manifest[ecosystem]
  return false
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

// Unlike the plain single-project wizard, cwd here is often just a common
// ancestor - so `ecosystemsAtCwd` (a subset of `ecosystems`) picks the
// wording: cwd's own build root gets "configure this project's settings",
// everything else gets "configure defaults for nested projects". A
// pre-existing `disabled: true` gets a re-enable question first, otherwise
// there'd be no way back from a prior disable. Declining everything is
// normal, not an abort.
async function setupRecursiveRootDefaults(
  cwd: string,
  defaultOnReadError: boolean,
  ecosystems: readonly BuildTool[],
  ecosystemsAtCwd: readonly BuildTool[],
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
  logger.log('      setting the flag.')
  logger.log('')
  logger.log(`This command will generate a ${SOCKET_JSON} file in ${cwd}.`)
  logger.log('socket.json properties are inherited by nested paths.')
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
  const manifest = sockJson.defaults.manifest as Record<string, unknown>

  let configuredAny = false

  for (const ecosystem of ecosystems) {
    const label = ECOSYSTEM_LABELS[ecosystem]
    const existingSection = manifest[ecosystem] as
      | Record<string, unknown>
      | undefined
    if (existingSection?.['disabled'] === true) {
      // eslint-disable-next-line no-await-in-loop
      const wantsReenable = await askYesNo(
        `${label} is currently disabled here - re-enable it?`,
      )
      if (wantsReenable === undefined || wantsReenable === null) {
        return canceledByUser()
      }
      if (!wantsReenable) {
        continue
      }
      existingSection['disabled'] = false
      configuredAny = true
    }

    const message = ecosystemsAtCwd.includes(ecosystem)
      ? `Configure ${label} settings for this project?`
      : `Configure ${label} defaults for any nested projects?`
    // eslint-disable-next-line no-await-in-loop
    const wants = await askYesNo(message)
    if (wants === undefined || wants === null) {
      return canceledByUser()
    }
    if (!wants) {
      continue
    }
    if (!manifest[ecosystem]) {
      manifest[ecosystem] = {}
    }
    // eslint-disable-next-line no-await-in-loop
    const result = await runEcosystemWizard(
      ecosystem,
      manifest[ecosystem] as Record<string, unknown>,
    )
    if (!result.ok || result.data.canceled) {
      return result
    }
    if (dropIfEmpty(manifest, ecosystem)) {
      configuredAny = true
    }
  }

  if (!configuredAny) {
    logger.log('')
    logger.log('No root-level defaults configured.')
    return notCanceled()
  }

  logger.log('')
  logger.log(`Writing ${SOCKET_JSON} to ${jsonPath}`)
  logger.log('')

  const writeResult = await writeSocketJson(cwd, sockJson)
  if (!writeResult.ok) {
    return writeResult
  }
  return notCanceled()
}

// `socket manifest setup --dynamic-sbom-inference`: the up-front scan (see
// scanBuildRoots) only ever answers "which build tools exist", never "which
// projects to configure". `--exclude-paths` matches are bulk-disabled
// unconditionally, independent of the interactive walk below, so re-running
// later with one more entry (or none) never re-answers settled decisions.
// Everything else gets a configure-or-inherit prompt (see processCandidate),
// except a workspace member a parent build already declares - learned via
// markWorkspaceCoverage right after the parent's own prompt, not a separate
// bulk pass, so a reactor member is silently skipped instead of prompted.
export async function setupRecursiveManifestConfig(
  cwd: string,
  defaultOnReadError: boolean,
  excludePaths?: string[] | undefined,
): Promise<CResult<{ canceled: boolean }>> {
  logger.log('')
  logger.log(`Configuring ${cwd} ...`)

  const initialSockJson = readOrDefaultSocketJson(cwd)
  // Resolved once here for sortCandidatesForDisplay/disableExclusionRoot's
  // relative-path math, consistent with discoverBuildRoots' own internal
  // resolution (see its comment for why this matters).
  const realCwd = await realpathOrResolved(cwd)

  logger.log('')
  logger.log('Scanning for build roots ...')
  const { fullByTool, includedByTool } = await scanBuildRoots({
    cwd,
    excludePaths,
    sockJson: withoutDisabledFlags(initialSockJson),
  })
  // includedByTool (not the unfiltered fullByTool), so an ecosystem whose
  // only candidate is about to be excluded this same run isn't offered
  // either - there'd be nothing left for its root defaults to apply to.
  const detectedEcosystems = ROOT_ECOSYSTEMS.filter(
    ecosystem => (includedByTool.get(ecosystem)?.length ?? 0) > 0,
  )
  if (detectedEcosystems.length) {
    logger.log(
      `Detected: ${detectedEcosystems.map(ecosystem => ECOSYSTEM_LABELS[ecosystem]).join(', ')}.`,
    )
  } else {
    logger.log(`No gradle/maven/sbt build roots found beneath ${cwd}.`)
  }
  logger.log('')

  // Which detected ecosystems cwd is itself a build root for - see
  // setupRecursiveRootDefaults' wording split.
  const ecosystemsAtCwd = ROOT_ECOSYSTEMS.filter(ecosystem =>
    (fullByTool.get(ecosystem) ?? []).includes(realCwd),
  )

  const rootResult = await setupRecursiveRootDefaults(
    cwd,
    defaultOnReadError,
    detectedEcosystems,
    ecosystemsAtCwd,
  )
  if (!rootResult.ok) {
    return rootResult
  }
  if (rootResult.data.canceled) {
    return canceledByUser()
  }

  // Re-read: the root wizard may have just written a new socket.json.
  const rootSockJson = readOrDefaultSocketJson(cwd)
  const { excluded, included } = await discoverBuildRoots({
    cwd,
    excludePaths,
    fullByTool,
    includedByTool,
  })

  // Applies regardless of the interactive walk below - see the module doc
  // comment on why --exclude-paths is unconditional.
  if (excludePaths?.length) {
    if (!excluded.length) {
      logger.log('None matched --exclude-paths; nothing disabled.')
    } else {
      const orderedExcluded = sortCandidatesForDisplay(excluded, realCwd)
      for (const candidate of orderedExcluded) {
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
    }
  }

  if (!included.length) {
    logger.log('')
    logger.success('Recursive setup complete.')
    return notCanceled()
  }

  logger.log('')
  const wantsIndividual = await askYesNo(
    'Configure other build roots found beneath this one, individually?',
  )
  if (wantsIndividual === undefined || wantsIndividual === null) {
    return canceledByUser()
  }
  if (!wantsIndividual) {
    logger.log('')
    logger.success('Recursive setup complete.')
    return notCanceled()
  }

  logger.log('')
  logger.log(
    'For each one, choose to configure it or leave it as-is. To disable one,',
  )
  logger.log('re-run with --exclude-paths instead.')
  logger.log('')

  const coveredByEcosystem = new Map<BuildTool, Set<string>>()
  // cwd never appears in `included`, but a reactor root often sits exactly
  // at cwd - seed coverage from it first so its declared members still get
  // recognized.
  for (const ecosystem of ecosystemsAtCwd) {
    // eslint-disable-next-line no-await-in-loop
    const coverageResult = await markWorkspaceCoverage({
      candidate: { dir: realCwd, ecosystem },
      coveredByEcosystem,
      cwd: realCwd,
      excludePaths,
      rootSockJson,
    })
    if (!coverageResult.ok) {
      return coverageResult
    }
  }

  const counts = {
    configured: 0,
    covered: 0,
    inherited: 0,
    reenabled: 0,
    skipped: 0,
  }
  const orderedIncluded = sortCandidatesForDisplay(included, realCwd)
  for (const candidate of orderedIncluded) {
    const covered = coveredByEcosystem.get(candidate.ecosystem)
    if (covered?.has(candidate.dir)) {
      counts.covered += 1
      continue
    }

    // eslint-disable-next-line no-await-in-loop
    const result = await processCandidate({
      cwd: realCwd,
      dir: candidate.dir,
      ecosystem: candidate.ecosystem,
      rootSockJson,
    })
    if (!result.ok) {
      return result
    }
    if (result.data.canceled) {
      // The cancellation itself (select Esc/Ctrl+C, or a sub-wizard's own
      // cancel) already logged "User canceled" - don't log it twice.
      return { ok: true, data: { canceled: true } }
    }
    counts[result.data.outcome] += 1
    if (result.data.reenabled) {
      // A qualifier on the 'configured'/'inherited' bucket just incremented
      // above, not a separate bucket - avoids double-counting the candidate.
      counts.reenabled += 1
    }

    // Interleaved rather than a bulk pre-pass, so this (possibly slow)
    // build-tool invocation only runs for a project already prompted about.
    // eslint-disable-next-line no-await-in-loop
    const coverageResult = await markWorkspaceCoverage({
      candidate,
      coveredByEcosystem,
      cwd: realCwd,
      excludePaths,
      rootSockJson,
    })
    if (!coverageResult.ok) {
      return coverageResult
    }
  }

  logger.log('')
  logger.log(
    `${counts.configured} configured (${counts.reenabled} re-enabled), ${counts.inherited} left as-is, ${counts.skipped} left disabled, ${counts.covered} covered by a parent build.`,
  )

  logger.log('')
  logger.success('Recursive setup complete.')
  return notCanceled()
}
