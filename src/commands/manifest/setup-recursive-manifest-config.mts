import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'

import { detectManifestActions } from './detect-manifest-actions.mts'
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

// Depth-then-path sort. For exclusion roots this is purely for stable,
// predictable log ordering - separate exclusion roots never nest inside one
// another (see findExclusionRoot), so there's no cascade-correctness
// dependency between those writes. For plain candidates (the per-project
// configure-or-inherit walk) the order matters for a different reason: a
// parent must be processed before its children so that if the parent gets
// configured, a child's shown "inherited" default already reflects that
// change (via cascade) instead of the parent's pre-run value.
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

export type DiscoveredBuildRoots = {
  excluded: ExclusionRoot[]
  // Every candidate --exclude-paths didn't rule out - these get the
  // interactive configure-or-inherit walk instead of a bulk write.
  included: Candidate[]
  // Every gradle/sbt/maven candidate found beneath `cwd`, excluded or not -
  // reported so the wizard can show discovery actually walked the tree even
  // when nothing ends up excluded (no --exclude-paths given, or none of it
  // matched), instead of a bare "found nothing" that reads the same either way.
  totalCandidateCount: number
}

// Discovers every gradle/sbt/maven build root beneath `cwd` (a plain
// filesystem walk, no dependency resolution and no build-tool invocation -
// so no bin/javaHome is ever needed), diffs an unfiltered walk against an
// excludePaths-filtered walk (both via the same findBuildToolCandidates
// fast-glob machinery, which already treats --exclude-paths as anchored
// ignores that prevent descending into a matched subtree at all) to split
// candidates into `included` (the interactive per-project walk) and
// `excluded`, grouped by the shallowest directory that actually matched
// --exclude-paths (see findExclusionRoot) so a whole excluded subtree gets
// exactly one write, regardless of how many build roots or ecosystems it
// contains. `cwd` itself is excluded from both - it already got its own
// wizard pass. `cwd` is realpath-resolved before comparing: the discovered
// dirs findBuildToolCandidates returns already are (it resolves symlinks so
// results are stable), and on macOS /tmp -> /private/tmp alone is enough to
// otherwise break the comparison.
export async function discoverBuildRoots({
  cwd,
  excludePaths,
  rootSockJson,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  rootSockJson: SocketJson
}): Promise<DiscoveredBuildRoots> {
  const realCwd = await realpathOrResolved(cwd)
  const [fullByTool, includedByTool] = await Promise.all([
    findBuildToolCandidates({ cwd, sockJson: rootSockJson }),
    findBuildToolCandidates({ cwd, excludePaths, sockJson: rootSockJson }),
  ])

  let totalCandidateCount = 0
  const included: Candidate[] = []
  const ignorePatterns = (excludePaths ?? []).flatMap(excludePathToScanIgnores)
  const ecosystemsByRoot = new Map<string, Set<BuildTool>>()
  for (const [ecosystem, fullDirs] of fullByTool) {
    const includedDirs = new Set(includedByTool.get(ecosystem) ?? [])
    for (const dir of fullDirs) {
      if (dir === realCwd) {
        continue
      }
      totalCandidateCount += 1
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
    totalCandidateCount,
  }
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

// Dispatches to the right ecosystem-specific wizard - the three have
// different config shapes, but this is the only place that needs to know
// that; every caller just deals with `BuildTool` generically.
async function runEcosystemWizard(
  ecosystem: BuildTool,
  config: Record<string, unknown>,
): Promise<CResult<{ canceled: boolean }>> {
  if (ecosystem === 'gradle') {
    return await setupGradle(
      config as NonNullable<
        NonNullable<NonNullable<SocketJson['defaults']>['manifest']>['gradle']
      >,
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
  )
}

// Runs the same per-ecosystem wizard used for the root, seeded with this
// candidate's *effective* (cascaded) value for any field its own socket.json
// doesn't already set - so accepting every prompt unchanged preserves
// whatever it currently inherits, while an actual change writes an explicit
// override. Own-file values win over the cascaded seed, so re-running this
// against an already-configured candidate shows its own prior answers.
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

// Disabling a candidate is deliberately not offered here - that's
// --exclude-paths' job (a bulk, path-based write covering a whole subtree in
// one go, see findExclusionRoot). Offering it per-candidate too would
// undermine that: an interactive disable here only ever touches this one
// directory's own file, none of the "shallowest excluded ancestor" grouping
// that keeps the tree's disabled state coherent and cheap to re-derive.
async function askCandidateAction(
  relDir: string,
  ecosystem: BuildTool,
): Promise<CandidateAction | null> {
  return (await select({
    message: `${relDir} (${ecosystem})`,
    choices: [
      {
        name: 'Use inherited defaults',
        value: 'inherit',
        description:
          "Leave this project inheriting whatever cascades down from its ancestors' socket.json",
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

type CandidateOutcome =
  | 'configured'
  | 'inherited'
  // Already disabled via cascade (an ancestor disabled through
  // --exclude-paths, or a pre-existing config) - not re-prompted, since
  // asking about a project an --exclude-paths write already covers would be
  // noise.
  | 'skipped'

// Decides and applies one discovered, non-excluded candidate's fate: prompt
// for configure/inherit, unless its cascade already shows it disabled (in
// which case it's silently skipped - see the CandidateOutcome.skipped note).
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
}): Promise<CResult<{ canceled: boolean; outcome: CandidateOutcome }>> {
  const relDir = path.relative(cwd, dir) || '.'
  const cascade = readSocketJsonCascade(dir, cwd, rootSockJson)
  if (getEcosystemSection(cascade, ecosystem)['disabled'] === true) {
    return { ok: true, data: { canceled: false, outcome: 'skipped' } }
  }

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

// Accepting every prompt's shown default (now that askForBin no longer
// pre-fills a fabricated tool fallback, see setup-manifest-config.mts)
// leaves an ecosystem's section genuinely empty - no field actually differs
// from "inherit/use the tool default". Drop it so `configuredAny` and the
// write-confirmation prompt reflect what was actually configured, not just
// which ecosystems the user said "yes" to walking through.
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

// The recursive flow's root step: unlike the plain single-project wizard
// (`setupManifestConfig`, which assumes `cwd` IS a specific ecosystem's
// project and only lets you configure one before finishing), the recursion
// root is often just a common ancestor with no project of its own. Detecting
// what's actually here (the same marker-file check the plain wizard's
// `detectManifestActions` uses) lets the questions reflect that: a detected
// ecosystem is asked about first and phrased as "configure it", while an
// undetected one is asked afterward and phrased as "anyway" (for the case
// where a subproject further down needs it even though the root doesn't).
// Declining all three is a normal (non-canceled) outcome, not an abort - the
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
  logger.log('      setting the flag.')
  logger.log('')
  logger.log(`This command will generate a ${SOCKET_JSON} file in ${cwd}.`)
  logger.log('socket.json properties are inherited by nested paths.')
  logger.log('')

  const detected = await detectManifestActions(null, cwd)
  const detectedEcosystems = ROOT_ECOSYSTEMS.filter(
    ecosystem => detected[ecosystem],
  )
  if (detectedEcosystems.length) {
    logger.log(
      `Detected at this root: ${detectedEcosystems.map(ecosystem => ECOSYSTEM_LABELS[ecosystem]).join(', ')}.`,
    )
    logger.log('')
  }
  const orderedEcosystems = [
    ...detectedEcosystems,
    ...ROOT_ECOSYSTEMS.filter(ecosystem => !detected[ecosystem]),
  ]

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

  for (const ecosystem of orderedEcosystems) {
    const label = ECOSYSTEM_LABELS[ecosystem]
    const message = detected[ecosystem]
      ? `${label} was detected at this root - configure ${label} defaults?`
      : `${label} wasn't detected here - configure defaults for it anyway?`
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
// `setupRecursiveRootDefaults` first, then walks every gradle/sbt/maven build
// root beneath it. A candidate matching `--exclude-paths` is bulk-disabled by
// pure path matching (no build-tool invocation, no prompt - see
// findExclusionRoot); everything else gets an interactive per-project
// configure-or-inherit prompt (see processCandidate; disabling one
// individually isn't offered there - that stays --exclude-paths' job so a
// whole subtree keeps collapsing to one write instead of one per candidate).
// This sidesteps the
// circularity an earlier "discover via enumeration, then prompt" design hit
// (enumerating a nested project's own subprojects to prune already-covered
// reactor members needs a resolved bin/javaHome for that project, which isn't
// known until after prompting for it): this walk never tries to prune reactor
// members ahead of time, so it never needs to invoke a build tool to decide
// what to prompt about. The cost is that a reactor member (e.g. a Maven
// module) may get its own prompt and its own socket.json, which then goes
// unused once dynamic-sbom-inference's own coverage-tracking (driven by the
// parent build's actual output, not by socket.json) determines it's already
// covered - harmless, just a wasted prompt/file for that one candidate.
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
  // relative-path math, consistent with discoverBuildRoots' own internal
  // resolution (see its comment for why this matters).
  const realCwd = await realpathOrResolved(cwd)

  logger.log('')
  logger.log('Discovering build roots ...')
  const { excluded, included, totalCandidateCount } = await discoverBuildRoots({
    cwd,
    excludePaths,
    rootSockJson,
  })

  if (!totalCandidateCount) {
    logger.log(`No build roots found beneath ${cwd}.`)
    logger.log('')
    logger.success('Recursive setup complete.')
    return notCanceled()
  }
  logger.log(`Found ${totalCandidateCount} build root(s) beneath ${cwd}.`)

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

  if (included.length) {
    logger.log('')
    logger.log(
      'For each remaining build root, choose to configure it or leave it',
    )
    logger.log(
      "inheriting its ancestors' defaults. To disable one, re-run with",
    )
    logger.log('--exclude-paths instead.')
    logger.log(
      'Note: a project that turns out to be a module of a parent multi-module',
    )
    logger.log('build is already covered there - configuring it is safe, but')
    logger.log('may end up unused.')
    logger.log('')

    const counts = { configured: 0, inherited: 0, skipped: 0 }
    const orderedIncluded = sortCandidatesForDisplay(included, realCwd)
    for (const candidate of orderedIncluded) {
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
    }

    logger.log('')
    logger.log(
      `${counts.configured} configured, ${counts.inherited} left inheriting.`,
    )
  }

  logger.log('')
  logger.success('Recursive setup complete.')
  return notCanceled()
}
