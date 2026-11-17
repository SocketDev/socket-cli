import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { joinAnd } from '@socketsecurity/registry/lib/arrays'
import { logger } from '@socketsecurity/registry/lib/logger'
import { select } from '@socketsecurity/registry/lib/prompts'
import { pluralize } from '@socketsecurity/registry/lib/words'

import {
  createBuildRootSettingsResolver,
  displayPath,
  socketJsonPath,
} from './build-root-config.mts'
import {
  addMembership,
  buildRootPath,
  emptyMembership,
  findBuildToolCandidates,
  isBuildCovered,
  isPathInside,
  realpathOrResolved,
  sortByDepthThenPath,
  withoutDisabledFlags,
} from './discover-manifest-roots.mts'
import {
  buildToolScriptOptions,
  resolveWalkConfig,
  socketFactsRunOptions,
} from './generate-recursive-manifests.mts'
import { loadBuild, withModules } from './load-build.mts'
import { DSI_SETUP_COMMAND, EXCLUDE_PATHS_FLAG } from './run-manifest-facts.mts'
import { BUILD_FILES, ECOSYSTEM_LABELS } from './scripts/build-tool.mts'
import {
  setupDotnet,
  setupGradle,
  setupMaven,
  setupSbt,
} from './setup-manifest-config.mts'
import { SOCKET_JSON } from '../../constants.mts'
import { loadSocketConfig } from '../../utils/config.mts'
import { getOrInsert } from '../../utils/get-or-insert.mts'
import {
  mergeSocketJsonChain,
  readOrDefaultSocketJson,
  readSocketJsonChain,
  readSocketJsonSync,
  writeSocketJson,
} from '../../utils/socket-json.mts'
import { excludePathToScanIgnores } from '../scan/exclude-paths.mts'

import type {
  DisabledBy,
  ResolvedBuildRootSettings,
} from './build-root-config.mts'
import type { BuildRoot, Membership } from './discover-manifest-roots.mts'
import type { LoadedBuild } from './load-build.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type { CResult } from '../../types.mts'
import type {
  ManifestDefaults,
  SocketJson,
  SocketJsonInDir,
} from '../../utils/socket-json.mts'

// The builds of one tool in one directory.
type Candidate = { dir: string; ecosystem: BuildTool; roots: BuildRoot[] }

const ROOT_ECOSYSTEMS: BuildTool[] = ['maven', 'gradle', 'sbt', 'dotnet']

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

type ScannedBuildRoots = {
  fullByTool: Map<BuildTool, BuildRoot[]>
  includedByTool: Map<BuildTool, BuildRoot[]>
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
  const socketConfig = loadSocketConfig(cwd)
  const [fullByTool, includedByTool] = await Promise.all([
    findBuildToolCandidates({ cwd, socketConfig, sockJson }),
    findBuildToolCandidates({ cwd, excludePaths, socketConfig, sockJson }),
  ])
  return { fullByTool, includedByTool }
}

type DiscoveredBuildRoots = {
  excluded: ExclusionRoot[]
  // Build files --exclude-paths matches in a directory whose other build files
  // it does not match.
  excludedBuilds: Array<{ ecosystem: BuildTool; root: BuildRoot }>
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
  fullByTool: Map<BuildTool, BuildRoot[]>
  includedByTool: Map<BuildTool, BuildRoot[]>
}): Promise<DiscoveredBuildRoots> {
  const realCwd = await realpathOrResolved(cwd)
  const included: Candidate[] = []
  const excludedBuilds: DiscoveredBuildRoots['excludedBuilds'] = []
  const ignorePatterns = (excludePaths ?? []).flatMap(excludePathToScanIgnores)
  const ecosystemsByRoot = new Map<string, Set<BuildTool>>()
  for (const [ecosystem, fullRoots] of fullByTool) {
    const includedPaths = new Set(
      (includedByTool.get(ecosystem) ?? []).map(buildRootPath),
    )
    const rootsByDir = new Map<string, BuildRoot[]>()
    for (const root of fullRoots) {
      if (root.dir === realCwd) {
        continue
      }
      const roots = rootsByDir.get(root.dir)
      if (roots) {
        roots.push(root)
      } else {
        rootsByDir.set(root.dir, [root])
      }
    }
    for (const { 0: dir, 1: roots } of rootsByDir) {
      const relDir = toPosixRelative(realCwd, dir)
      const includedRoots: BuildRoot[] = []
      const excludedRoots: BuildRoot[] = []
      for (const root of roots) {
        if (includedPaths.has(buildRootPath(root))) {
          includedRoots.push(root)
        } else {
          excludedRoots.push(root)
        }
      }
      if (includedRoots.length) {
        included.push({ dir, ecosystem, roots: includedRoots })
        // A section's `disabled` would also skip the included siblings.
        for (const root of excludedRoots) {
          excludedBuilds.push({ ecosystem, root })
        }
        continue
      }
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
    excludedBuilds,
    included,
  }
}

// Changes to socket.json files, kept until the user confirms them.
type SettingsDraft = {
  files: Map<string, SocketJson>
  // What changed in each file, for the confirmation.
  notes: Map<string, string[]>
  // Resolves against the files as they are now; dropped on every change.
  resolver: ResolveSettings | undefined
  warned: Set<string>
}

type ResolveSettings = (
  tool: BuildTool,
  root: BuildRoot,
) => ResolvedBuildRootSettings

function createSettingsDraft(): SettingsDraft {
  return {
    files: new Map(),
    notes: new Map(),
    resolver: undefined,
    warned: new Set(),
  }
}

function setDraftFile(
  draft: SettingsDraft,
  dir: string,
  sockJson: SocketJson,
): void {
  draft.files.set(dir, sockJson)
  draft.resolver = undefined
}

function cloneSocketJson(sockJson: SocketJson): SocketJson {
  return JSON.parse(JSON.stringify(sockJson)) as SocketJson
}

// `dir`'s own socket.json as it will be written.
function draftSettings(draft: SettingsDraft, dir: string): SocketJson {
  return cloneSocketJson(draft.files.get(dir) ?? readOrDefaultSocketJson(dir))
}

function stageSettings(
  draft: SettingsDraft,
  dir: string,
  sockJson: SocketJson,
  note: string,
): void {
  setDraftFile(draft, dir, sockJson)
  const notes = getOrInsert(draft.notes, dir, () => [])
  if (!notes.includes(note)) {
    notes.push(note)
  }
}

function manifestOf(sockJson: SocketJson): Record<string, unknown> {
  if (!sockJson.defaults) {
    sockJson.defaults = {}
  }
  if (!sockJson.defaults.manifest) {
    sockJson.defaults.manifest = {}
  }
  return sockJson.defaults.manifest as Record<string, unknown>
}

// The socket.json files from the filesystem root down to `dir`, as they will
// be written.
function draftChain(draft: SettingsDraft, dir: string): SocketJsonInDir[] {
  const byDir = new Map(
    readSocketJsonChain(dir).map(file => [file.dir, file.sockJson]),
  )
  for (const { 0: fileDir, 1: sockJson } of draft.files) {
    if (isPathInside(fileDir, dir)) {
      byDir.set(fileDir, sockJson)
    }
  }
  return [...byDir]
    .sort((a, b) => a[0].length - b[0].length)
    .map(({ 0: fileDir, 1: sockJson }) => ({ dir: fileDir, sockJson }))
}

function draftCascade(draft: SettingsDraft, dir: string): SocketJson {
  return mergeSocketJsonChain(draftChain(draft, dir))
}

function resolveDraftSettings(
  draft: SettingsDraft,
  ecosystem: BuildTool,
  root: BuildRoot,
): ResolvedBuildRootSettings {
  draft.resolver ??= createBuildRootSettingsResolver(
    dir => draftChain(draft, dir),
    draft.warned,
  )
  return draft.resolver(ecosystem, root)
}

// "other build", or "3 other builds".
function otherBuilds(count: number): string {
  return count === 1 ? 'other build' : `${count} other builds`
}

function relPath(cwd: string, file: string): string {
  return path.relative(cwd, file) || '.'
}

// One build of the walk; a directory holding several builds of one tool has
// a prompt, and settings, per build file.
type WalkBuild = { ecosystem: BuildTool; root: BuildRoot; sharesDir: boolean }

type Walk = {
  builds: WalkBuild[]
  counts: {
    configured: number
    covered: number
    inherited: number
    skipped: number
  }
  // What the builds left in, and the skipped builds, load: neither is asked
  // about again.
  covered: Map<BuildTool, Membership>
  cwd: string
  decided: Set<string>
  draft: SettingsDraft
  excludePaths: string[] | undefined
  skipped: Map<BuildTool, Membership>
}

function buildKey({ ecosystem, root }: WalkBuild): string {
  return `${ecosystem}\0${buildRootPath(root)}`
}

function buildLabel(cwd: string, { ecosystem, root, sharesDir }: WalkBuild) {
  const where = sharesDir
    ? relPath(cwd, buildRootPath(root))
    : root.dir === cwd
      ? 'This project'
      : relPath(cwd, root.dir)
  return `${where} (${ecosystem})`
}

// The build file a build's own `builds` entry is keyed by: the one its entry
// names, else the first one in its directory.
function buildsKeyOf(draft: SettingsDraft, { ecosystem, root }: WalkBuild) {
  const files = BUILD_FILES[ecosystem]
  if (files.byFile) {
    return root.entryFile ?? ''
  }
  return (
    resolveDraftSettings(draft, ecosystem, root).entryKey ??
    files.names.find(name => existsSync(path.join(root.dir, name))) ??
    files.names[0]!
  )
}

type BuildsEntries = Record<string, Record<string, unknown>>

// Whether a build's settings go in its own entry, rather than in its
// directory's section, which the builds beneath inherit.
function writesOwnEntry(draft: SettingsDraft, build: WalkBuild): boolean {
  return (
    build.sharesDir ||
    !!resolveDraftSettings(draft, build.ecosystem, build.root).entryKey
  )
}

function membershipFor(
  map: Map<BuildTool, Membership>,
  ecosystem: BuildTool,
): Membership {
  return getOrInsert(map, ecosystem, emptyMembership)
}

function buildConfig(walk: Walk, { ecosystem, root }: WalkBuild) {
  return resolveWalkConfig(
    ecosystem,
    root.dir,
    resolveDraftSettings(walk.draft, ecosystem, root).sockJson,
  )
}

// Whether a build `covered` stands for already loads `build`.
async function isLoadedBy(
  walk: Walk,
  covered: Membership,
  build: WalkBuild,
): Promise<boolean> {
  return await isBuildCovered(
    covered,
    build.ecosystem,
    build.root,
    buildToolScriptOptions(
      buildConfig(walk, build),
      walk.cwd,
      walk.excludePaths,
    ),
  )
}

// Keeps only answers that differ from what the build would inherit; a
// directory section also sets defaults for the builds beneath it.
async function configureBuild(
  draft: SettingsDraft,
  cwd: string,
  build: WalkBuild,
): Promise<CResult<{ canceled: boolean }>> {
  const { ecosystem, root } = build
  const key = buildsKeyOf(draft, build)
  const own = draftSettings(draft, root.dir)
  const manifest = manifestOf(own)
  const builds = { ...(manifest['builds'] as BuildsEntries | undefined) }
  const intoEntry = writesOwnEntry(draft, build)
  const target: Record<string, unknown> = intoEntry
    ? { ...builds[key] }
    : { ...getEcosystemSection(own, ecosystem) }
  const inherited = getEcosystemSection(
    draftCascade(draft, intoEntry ? root.dir : path.dirname(root.dir)),
    ecosystem,
  )
  const seed: Record<string, unknown> = {
    ...getEcosystemSection(
      resolveDraftSettings(draft, ecosystem, root).sockJson,
      ecosystem,
    ),
  }

  const seeded = Object.keys(seed)
  const result = await runEcosystemWizard(ecosystem, seed)
  if (!result.ok || result.data.canceled) {
    return result
  }

  const before = JSON.stringify(target)
  // An answer the wizard removed leaves the field to inheritance.
  for (const field of new Set([...seeded, ...Object.keys(seed)])) {
    if (!Object.hasOwn(seed, field) || seed[field] === inherited[field]) {
      delete target[field]
    } else {
      target[field] = seed[field]
    }
  }
  const label = buildLabel(cwd, build)
  if (JSON.stringify(target) === before) {
    logger.log(`No changes for ${label}.`)
    return notCanceled()
  }
  if (intoEntry) {
    manifest['builds'] = { ...builds, [key]: target }
    stageSettings(draft, root.dir, own, `configure ${key}`)
  } else {
    manifest[ecosystem] = target
    stageSettings(draft, root.dir, own, `configure ${ecosystem} builds`)
  }
  logger.success(`Configured ${label}`)
  return notCanceled()
}

// Sets `disabled` for every `ecosystems` in `dir`'s section, so their builds
// in and beneath it are skipped, unless the settings above already do.
function disableDirectory(
  draft: SettingsDraft,
  dir: string,
  ecosystems: readonly BuildTool[],
): BuildTool[] {
  const cascade = draftCascade(draft, dir)
  const needed = ecosystems.filter(
    ecosystem => getEcosystemSection(cascade, ecosystem)['disabled'] !== true,
  )
  if (needed.length) {
    const own = draftSettings(draft, dir)
    const manifest = manifestOf(own)
    for (const ecosystem of needed) {
      manifest[ecosystem] = {
        ...getEcosystemSection(own, ecosystem),
        disabled: true,
      }
    }
    stageSettings(
      draft,
      dir,
      own,
      `skip ${needed.join(', ')} builds in and beneath it`,
    )
  }
  return needed
}

// Skips just this build and what it loads, under its own build file.
function disableBuild(draft: SettingsDraft, build: WalkBuild): void {
  const { root } = build
  const key = buildsKeyOf(draft, build)
  const own = draftSettings(draft, root.dir)
  const manifest = manifestOf(own)
  const builds = (manifest['builds'] ?? {}) as Record<
    string,
    Record<string, unknown>
  >
  if (builds[key]?.['disabled'] === true) {
    return
  }
  manifest['builds'] = { ...builds, [key]: { ...builds[key], disabled: true } }
  stageSettings(draft, root.dir, own, `skip ${key}`)
}

// Turns a skipped build back on at the setting that skipped it: dropping that
// setting where nothing above skips the build too, else overriding it.
function enableBuild(
  draft: SettingsDraft,
  build: WalkBuild,
  disabledBy: DisabledBy,
): void {
  const { ecosystem, root } = build
  const own = draftSettings(draft, disabledBy.dir)
  const manifest = manifestOf(own)
  const target = disabledBy.key
    ? { ...(manifest['builds'] as BuildsEntries | undefined)?.[disabledBy.key] }
    : getEcosystemSection(own, ecosystem)
  delete target['disabled']
  const place = (value: Record<string, unknown>) => {
    if (disabledBy.key) {
      manifest['builds'] = {
        ...(manifest['builds'] as object),
        [disabledBy.key]: value,
      }
    } else {
      manifest[ecosystem] = value
    }
  }
  place(target)
  setDraftFile(draft, disabledBy.dir, own)
  if (resolveDraftSettings(draft, ecosystem, root).disabledBy) {
    place({ ...target, disabled: false })
  }
  stageSettings(
    draft,
    disabledBy.dir,
    own,
    disabledBy.key
      ? `build ${disabledBy.key} again`
      : `build ${ecosystem} builds here again`,
  )
}

type CantLoadAction = 'configure' | 'directory' | 'stop'

// The build tool could not load `build`. Fixing its settings comes first: a
// build Socket can load is built once with its modules, and skips exactly.
async function askCantLoad(
  walk: Walk,
  build: WalkBuild,
  allowDirectory: boolean,
): Promise<CantLoadAction | null> {
  const label = buildLabel(walk.cwd, build)
  const relDir = relPath(walk.cwd, build.root.dir)
  const beneath = walk.builds.filter(
    other =>
      other !== build &&
      isPathInside(build.root.dir, other.root.dir) &&
      !walk.decided.has(buildKey(other)),
  ).length
  const skipNotes = [
    ...(beneath
      ? [
          `Also skips the ${otherBuilds(beneath)} in and beneath ${relDir}/. To build one of them, run \`${DSI_SETUP_COMMAND}\` in its directory.`,
        ]
      : []),
    `Modules of ${relPath(walk.cwd, buildRootPath(build.root))} outside ${relDir}/ can't be found without loading it, so they are asked about separately.`,
  ]
  return (await select({
    message: `Socket could not load ${label} (see above). Builds Socket can load are built once with all their modules, and can be skipped without skipping the builds next to them. What should happen with it?`,
    choices: [
      {
        name: 'Configure it and try again',
        value: 'configure',
        description: 'Set the JDK, build tool or options, then load it again',
      },
      allowDirectory
        ? {
            name: `Skip ${relDir}/ and everything beneath it, without loading it`,
            value: 'directory',
            description: skipNotes.join(' '),
          }
        : {
            name: 'Go on without loading it',
            value: 'directory',
            description:
              'The builds it would include are asked about separately',
          },
      { name: 'Stop', value: 'stop' },
    ],
    default: 'configure',
  })) as CantLoadAction | null
}

type LoadOutcome = LoadedBuild | 'directory'

// Loads `build`, and while that fails, asks how to go on.
async function loadOrAsk(
  walk: Walk,
  build: WalkBuild,
  allowDirectory = true,
): Promise<CResult<{ canceled: boolean; loaded?: LoadOutcome | undefined }>> {
  for (;;) {
    const config = buildConfig(walk, build)
    // eslint-disable-next-line no-await-in-loop
    const loaded = await loadBuild({
      ...socketFactsRunOptions(build.ecosystem, build.root, config, {
        excludeBase: walk.cwd,
        excludePaths: walk.excludePaths,
        // A failure's remedy is this wizard's answers, for the scan to read.
        hints: {
          excludePathsFlag: EXCLUDE_PATHS_FLAG,
          flags: new Set(),
          setupCommand: DSI_SETUP_COMMAND,
          socketJson: socketJsonPath(build.root.dir),
        },
      }),
      scanRoot: walk.cwd,
    })
    if (loaded) {
      return { ok: true, data: { canceled: false, loaded } }
    }
    // eslint-disable-next-line no-await-in-loop
    const action = await askCantLoad(walk, build, allowDirectory)
    if (action === null || action === undefined) {
      return canceledByUser()
    }
    if (action === 'stop') {
      return {
        ok: false,
        message: `Stopped: Socket could not load ${buildLabel(walk.cwd, build)}.`,
      }
    }
    if (action === 'directory') {
      return { ok: true, data: { canceled: false, loaded: 'directory' } }
    }
    // eslint-disable-next-line no-await-in-loop
    const configured = await configureBuild(walk.draft, walk.cwd, build)
    if (!configured.ok || configured.data.canceled) {
      return configured
    }
  }
}

// Skips `build`'s directory and everything beneath it, unasked.
function skipDirectory(walk: Walk, build: WalkBuild): void {
  const beneath = walk.builds.filter(
    other => other !== build && isPathInside(build.root.dir, other.root.dir),
  )
  disableDirectory(walk.draft, build.root.dir, [
    ...new Set([build.ecosystem, ...beneath.map(other => other.ecosystem)]),
  ])
  for (const other of [build, ...beneath]) {
    if (!walk.decided.has(buildKey(other))) {
      walk.decided.add(buildKey(other))
      walk.counts.skipped += 1
    }
  }
  logger.success(
    `Skipped ${relPath(walk.cwd, build.root.dir)}/ and everything beneath it.`,
  )
}

// A scan skips the modules of a build skipped under its own name, so the
// wizard doesn't ask about them either.
async function loadInto(
  walk: Walk,
  build: WalkBuild,
  into: 'covered' | 'skipped',
  { allowDirectory = true, announce = true } = {},
): Promise<CResult<{ canceled: boolean }>> {
  const result = await loadOrAsk(walk, build, allowDirectory)
  if (!result.ok || result.data.canceled) {
    return result
  }
  const { loaded } = result.data
  if (loaded === 'directory') {
    if (allowDirectory) {
      skipDirectory(walk, build)
    }
  } else if (loaded) {
    addMembership(membershipFor(walk[into], build.ecosystem), loaded.membership)
    if (into === 'skipped') {
      disableBuild(walk.draft, build)
      walk.counts.skipped += 1
      if (announce) {
        logger.success(
          `Skipped ${withModules(relPath(walk.cwd, buildRootPath(build.root)), loaded.modules)}.`,
        )
      }
    }
  }
  return notCanceled()
}

type BuildAction = 'configure' | 'inherit' | 'skip'

async function askBuildAction(label: string): Promise<BuildAction | null> {
  return (await select({
    message: label,
    choices: [
      {
        name: 'Leave as-is',
        value: 'inherit',
        description: 'Build it with its current settings',
      },
      {
        name: 'Configure',
        value: 'configure',
        description: 'Set the JDK, build tool or options for it',
      },
      {
        name: 'Skip',
        value: 'skip',
        description: "Don't build it or its modules",
      },
    ],
    default: 'inherit',
  })) as BuildAction | null
}

type LoadDecision = { announce: boolean; into: 'covered' | 'skipped' }

function decided(
  load: LoadDecision,
): CResult<{ canceled: boolean; load: LoadDecision }> {
  return { ok: true, data: { canceled: false, load } }
}

// What to load `build` into, as decided; none for a build skipped unloaded.
async function reviewBuild(
  walk: Walk,
  build: WalkBuild,
): Promise<CResult<{ canceled: boolean; load?: LoadDecision | undefined }>> {
  walk.decided.add(buildKey(build))
  const label = buildLabel(walk.cwd, build)
  const { disabledBy } = resolveDraftSettings(
    walk.draft,
    build.ecosystem,
    build.root,
  )
  if (disabledBy) {
    // A directory skip from above covers this build silently; the setting
    // that names this build or its directory is offered back.
    if (!disabledBy.key && disabledBy.dir !== build.root.dir) {
      walk.counts.skipped += 1
      return notCanceled()
    }
    const again = await askYesNo(`${label} is skipped. Build it again?`)
    if (again === null || again === undefined) {
      return canceledByUser()
    }
    if (!again) {
      if (!disabledBy.key) {
        walk.counts.skipped += 1
        return notCanceled()
      }
      return decided({ announce: false, into: 'skipped' })
    }
    enableBuild(walk.draft, build, disabledBy)
  }

  const action = await askBuildAction(label)
  if (action === null || action === undefined) {
    return canceledByUser()
  }
  if (action === 'skip') {
    return decided({ announce: true, into: 'skipped' })
  }
  if (action === 'configure') {
    const configured = await configureBuild(walk.draft, walk.cwd, build)
    if (!configured.ok || configured.data.canceled) {
      return configured
    }
    walk.counts.configured += 1
  } else {
    walk.counts.inherited += 1
  }
  return decided({ announce: true, into: 'covered' })
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
  if (ecosystem === 'dotnet') {
    return await setupDotnet(config as ManifestDefaults<'dotnet'>)
  }
  if (ecosystem === 'gradle') {
    return await setupGradle(config as ManifestDefaults<'gradle'>, {
      factsOnly: true,
    })
  }
  if (ecosystem === 'maven') {
    return await setupMaven(config as ManifestDefaults<'maven'>)
  }
  return await setupSbt(config as ManifestDefaults<'sbt'>, { factsOnly: true })
}

// Accepting every prompt's default leaves an ecosystem's section empty (see
// askForBin in setup-manifest-config.mts); an empty one changes nothing.
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

// Defaults for the builds in and beneath cwd. A skip that applies here, from
// this directory's socket.json or one above it, is offered back first. A tool's
// only build at cwd, without an entry of its own, sets them from its prompt.
async function setupRootDefaults(
  draft: SettingsDraft,
  cwd: string,
  ecosystems: readonly BuildTool[],
  buildsAtCwd: (ecosystem: BuildTool) => BuildRoot[],
): Promise<CResult<{ canceled: boolean }>> {
  for (const ecosystem of ecosystems) {
    const label = ECOSYSTEM_LABELS[ecosystem]
    const { disabledBy } = resolveDraftSettings(draft, ecosystem, { dir: cwd })
    if (disabledBy && !disabledBy.key) {
      const where =
        disabledBy.dir === cwd
          ? `${label} builds here are skipped.`
          : `${socketJsonPath(disabledBy.dir)} skips ${label} builds in and beneath ${displayPath(disabledBy.dir)}, including this directory.`
      // eslint-disable-next-line no-await-in-loop
      const again = await askYesNo(`${where} Build the ${label} projects here?`)
      if (again === null || again === undefined) {
        return canceledByUser()
      }
      if (!again) {
        continue
      }
      const own = draftSettings(draft, cwd)
      const manifest = manifestOf(own)
      manifest[ecosystem] = {
        ...getEcosystemSection(own, ecosystem),
        disabled: false,
      }
      stageSettings(draft, cwd, own, `build ${label} projects here again`)
    }

    const atCwd = buildsAtCwd(ecosystem)
    if (
      atCwd.length === 1 &&
      !writesOwnEntry(draft, { ecosystem, root: atCwd[0]!, sharesDir: false })
    ) {
      continue
    }
    const message = atCwd.length
      ? `Configure ${label} defaults for the projects here and beneath?`
      : `Configure ${label} defaults for any nested projects?`
    // eslint-disable-next-line no-await-in-loop
    const wants = await askYesNo(message)
    if (wants === undefined || wants === null) {
      return canceledByUser()
    }
    if (!wants) {
      continue
    }
    const own = draftSettings(draft, cwd)
    const manifest = manifestOf(own)
    const section = { ...getEcosystemSection(own, ecosystem) }
    manifest[ecosystem] = section
    // eslint-disable-next-line no-await-in-loop
    const result = await runEcosystemWizard(ecosystem, section)
    if (!result.ok || result.data.canceled) {
      return result
    }
    if (dropIfEmpty(manifest, ecosystem)) {
      stageSettings(draft, cwd, own, `configure ${label} defaults`)
    }
  }
  return notCanceled()
}

async function confirmAndWrite(
  draft: SettingsDraft,
  cwd: string,
): Promise<CResult<{ canceled: boolean }>> {
  if (!draft.files.size) {
    logger.log('Nothing to write: no settings changed.')
    return notCanceled()
  }
  const dirs = [...draft.files.keys()].sort()
  const files = dirs.map(dir => relPath(cwd, path.join(dir, SOCKET_JSON)))
  const width = Math.max(...files.map(file => file.length))
  logger.log(`Ready to write ${dirs.length} ${pluralize('file', dirs.length)}:`)
  for (const { 0: index, 1: dir } of dirs.entries()) {
    logger.log(
      `  ${files[index]!.padEnd(width)}   ${(draft.notes.get(dir) ?? []).join('; ')}`,
    )
  }
  const write = await askYesNo(dirs.length === 1 ? 'Write it?' : 'Write them?')
  if (write === null || write === undefined) {
    return canceledByUser()
  }
  if (!write) {
    logger.log('Nothing written.')
    return notCanceled()
  }
  for (const dir of dirs) {
    // eslint-disable-next-line no-await-in-loop
    const result = await writeSocketJson(dir, draft.files.get(dir)!)
    if (!result.ok) {
      return result
    }
  }
  logger.success(`Wrote ${joinAnd(files)}`)
  return notCanceled()
}

// Nothing is written until the user confirms the draft.
export async function setupRecursiveManifestConfig(
  cwd: string,
  defaultOnReadError: boolean,
  excludePaths?: string[] | undefined,
): Promise<CResult<{ canceled: boolean }>> {
  logger.log('')
  logger.log(`Configuring ${cwd} ...`)

  const ownRead = readSocketJsonSync(cwd, defaultOnReadError)
  if (!ownRead.ok) {
    return ownRead
  }
  // Candidate dirs come back realpath-resolved; cwd must match.
  const realCwd = await realpathOrResolved(cwd)

  logger.log('')
  logger.log('Scanning for build roots ...')
  const { fullByTool, includedByTool } = await scanBuildRoots({
    cwd,
    excludePaths,
    sockJson: withoutDisabledFlags(ownRead.data),
  })
  // includedByTool, so an ecosystem whose only builds --exclude-paths
  // excludes isn't offered.
  const detectedEcosystems = ROOT_ECOSYSTEMS.filter(
    ecosystem => (includedByTool.get(ecosystem)?.length ?? 0) > 0,
  )
  if (detectedEcosystems.length) {
    logger.log(
      `Detected: ${detectedEcosystems.map(ecosystem => ECOSYSTEM_LABELS[ecosystem]).join(', ')}.`,
    )
  } else {
    logger.log(
      `No Gradle, Maven, sbt or .NET build roots found beneath ${cwd}.`,
    )
    // Builds that --exclude-paths excludes are a choice, not an absence.
    const hasAnyBuildRoot = ROOT_ECOSYSTEMS.some(
      ecosystem => (fullByTool.get(ecosystem)?.length ?? 0) > 0,
    )
    if (!hasAnyBuildRoot) {
      return {
        ok: false,
        code: 1,
        message: `No Gradle, sbt, Maven or .NET build root was found beneath ${cwd}.`,
      }
    }
  }
  logger.log('')

  const draft = createSettingsDraft()
  const atCwd = (ecosystem: BuildTool) =>
    (includedByTool.get(ecosystem) ?? []).filter(root => root.dir === realCwd)
  const rootResult = await setupRootDefaults(
    draft,
    realCwd,
    detectedEcosystems,
    atCwd,
  )
  if (!rootResult.ok || rootResult.data.canceled) {
    return rootResult
  }

  const { excluded, excludedBuilds, included } = await discoverBuildRoots({
    cwd,
    excludePaths,
    fullByTool,
    includedByTool,
  })
  for (const { ecosystem, root } of excludedBuilds) {
    disableBuild(draft, { ecosystem, root, sharesDir: true })
  }
  for (const { dir, ecosystems } of sortByDepthThenPath(excluded, realCwd)) {
    disableDirectory(draft, dir, ecosystems)
  }
  if (excludePaths?.length && !excluded.length && !excludedBuilds.length) {
    logger.log('None matched --exclude-paths; nothing skipped.')
  }

  const builds: WalkBuild[] = sortByDepthThenPath(included, realCwd).flatMap(
    ({ ecosystem, roots }) =>
      sortByDepthThenPath(roots, realCwd, ecosystem).map(root => ({
        ecosystem,
        root,
        sharesDir: roots.length > 1,
      })),
  )
  const walk: Walk = {
    builds,
    counts: { configured: 0, covered: 0, inherited: 0, skipped: 0 },
    covered: new Map(),
    cwd: realCwd,
    decided: new Set(),
    draft,
    excludePaths,
    skipped: new Map(),
  }

  // The builds at cwd are decided first, and loaded only for the review below:
  // what they include isn't asked about.
  const cwdBuilds: WalkBuild[] = ROOT_ECOSYSTEMS.flatMap(ecosystem => {
    const roots = atCwd(ecosystem)
    return roots.map(root => ({
      ecosystem,
      root,
      sharesDir: roots.length > 1,
    }))
  }).filter(build => {
    const { disabledBy } = resolveDraftSettings(
      draft,
      build.ecosystem,
      build.root,
    )
    return !disabledBy || !!disabledBy.key
  })
  const cwdLoads: Array<{ build: WalkBuild; into: LoadDecision['into'] }> = []
  for (const build of cwdBuilds) {
    // eslint-disable-next-line no-await-in-loop
    const result = await reviewBuild(walk, build)
    if (!result.ok || result.data.canceled) {
      return result
    }
    const { load } = result.data
    if (load) {
      if (load.into === 'skipped') {
        disableBuild(draft, build)
      }
      cwdLoads.push({ build, into: load.into })
    }
  }

  if (builds.length) {
    logger.log('')
    const review = await askYesNo(
      `Review the ${otherBuilds(builds.length)} found beneath this one?`,
    )
    if (review === null || review === undefined) {
      return canceledByUser()
    }
    if (review) {
      for (const { build, into } of cwdLoads) {
        // eslint-disable-next-line no-await-in-loop
        const result = await loadInto(walk, build, into, {
          allowDirectory: false,
          announce: false,
        })
        if (!result.ok || result.data.canceled) {
          return result
        }
      }
      for (const build of builds) {
        if (walk.decided.has(buildKey(build))) {
          continue
        }
        let loaded = false
        for (const into of ['covered', 'skipped'] as const) {
          if (
            !loaded &&
            // eslint-disable-next-line no-await-in-loop
            (await isLoadedBy(
              walk,
              membershipFor(walk[into], build.ecosystem),
              build,
            ))
          ) {
            loaded = true
            walk.decided.add(buildKey(build))
            walk.counts[into] += 1
          }
        }
        if (loaded) {
          continue
        }
        // eslint-disable-next-line no-await-in-loop
        const result = await reviewBuild(walk, build)
        if (!result.ok || result.data.canceled) {
          return result
        }
        const { load } = result.data
        if (load) {
          // eslint-disable-next-line no-await-in-loop
          const loaded = await loadInto(walk, build, load.into, {
            announce: load.announce,
          })
          if (!loaded.ok || loaded.data.canceled) {
            return loaded
          }
        }
      }
      const { configured, covered, inherited, skipped } = walk.counts
      logger.log('')
      logger.log(
        `${configured} configured, ${inherited} left as-is, ${skipped} skipped, ${covered} part of another build.`,
      )
    }
  }

  logger.log('')
  const written = await confirmAndWrite(draft, realCwd)
  if (!written.ok || written.data.canceled) {
    return written
  }
  logger.log('')
  logger.success('Recursive setup complete.')
  return notCanceled()
}
