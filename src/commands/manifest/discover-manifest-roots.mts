import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { logger } from '@socketsecurity/registry/lib/logger'

import {
  BUILD_FILES,
  BUILD_TOOLS,
  FACTS_PURL_TYPES,
  buildToolsFor,
  isDotnetSolution,
} from './scripts/build-tool.mts'
import { listDotnetEntryProjects } from './scripts/run.mts'
import { realpathOrResolved } from '../../utils/fs.mts'
import { getOrInsert } from '../../utils/get-or-insert.mts'
import { globWithGitIgnore } from '../../utils/glob.mts'
import { excludePathToScanIgnores } from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { SocketFactsSbomProject } from './scripts/facts.mts'
import type { ManifestScriptOptions } from './scripts/run.mts'
import type { PURL_Type } from '../../utils/ecosystem.mts'
import type { SocketJson } from '../../utils/socket-json.mts'
import type { SocketYml } from '@socketsecurity/config'

const BUILD_FILE_MATCHERS = new Map(
  BUILD_TOOLS.map(tool => {
    const files = BUILD_FILES[tool]
    return [
      tool,
      files.byFile
        ? micromatch.matcher(files.nocaseGlob, { dot: true, nocase: true })
        : (basename: string) => files.names.includes(basename),
    ]
  }),
)

function pathKey(value: string): string {
  return value.replaceAll('\\', '/')
}

function containsPath(paths: ReadonlySet<string>, value: string): boolean {
  const key = pathKey(value)
  for (const candidate of paths) {
    if (pathKey(candidate) === key) {
      return true
    }
  }
  return false
}

// `entryFile` (a basename in `dir`) is set only for a tool that addresses its
// builds by file, where one directory can hold several builds.
export type BuildRoot = { dir: string; entryFile?: string | undefined }

export function buildRootPath(root: BuildRoot): string {
  return path.join(root.dir, root.entryFile ?? '')
}

export function isBuildFile(tool: BuildTool, basename: string): boolean {
  return !!BUILD_FILE_MATCHERS.get(tool)?.(basename)
}

function buildFileTool(
  tools: readonly BuildTool[],
  basename: string,
): BuildTool | undefined {
  return tools.find(tool => isBuildFile(tool, basename))
}

export function compareEntryFiles(
  tool: BuildTool,
  a: string,
  b: string,
): number {
  const files = BUILD_FILES[tool]
  const rank = files.byFile ? files.entryRank : undefined
  return (rank ? rank(a) - rank(b) : 0) || compareStrings(a, b)
}

// A disabled ecosystem is skipped entirely by the glob scan below, so a
// nested socket.json re-enabling it would never even be searched for. Callers
// that need the cascade (not just the root file) to decide skip vs. include
// must strip `disabled` here first, and let their own per-directory cascade
// check apply it instead.
export function withoutDisabledFlags(sockJson: SocketJson): SocketJson {
  const manifest = sockJson.defaults?.manifest
  if (!manifest) {
    return sockJson
  }
  const stripped: Record<string, unknown> = { ...manifest }
  for (const tool of BUILD_TOOLS) {
    const section = manifest[tool]
    if (section?.disabled) {
      stripped[tool] = { ...section, disabled: false }
    }
  }
  return {
    ...sockJson,
    defaults: { ...sockJson.defaults, manifest: stripped },
  } as SocketJson
}

export { realpathOrResolved }

// Coverage compares files by their realpath-resolved directory.
async function realFilePath(file: string): Promise<string> {
  return path.join(
    await realpathOrResolved(path.dirname(file)),
    path.basename(file),
  )
}

// What a build loaded: its projects' directories and build files,
// realpath-resolved. Gradle reports a project's build file even when absent,
// which names nothing.
export type Membership = { dirs: Set<string>; files: Set<string> }

export function emptyMembership(): Membership {
  return { dirs: new Set(), files: new Set() }
}

export function addMembership(into: Membership, from: Membership): void {
  for (const dir of from.dirs) {
    into.dirs.add(dir)
  }
  for (const file of from.files) {
    into.files.add(file)
  }
}

export function unionMemberships(
  memberships: Iterable<Membership>,
): Membership {
  const union = emptyMembership()
  for (const membership of memberships) {
    addMembership(union, membership)
  }
  return union
}

export function isPathInside(dir: string, file: string): boolean {
  return file === dir || file.startsWith(`${dir}${path.sep}`)
}

// Paths are relative to `buildRoot`. Only what lies inside `scanRoot` (when
// given) counts, as only that can be a candidate.
export async function membershipOf(
  buildRoot: string,
  projects: readonly SocketFactsSbomProject[],
  scanRoot?: string | undefined,
): Promise<Membership> {
  const realScanRoot = scanRoot ? await realpathOrResolved(scanRoot) : undefined
  const inScan = (p: string) => !realScanRoot || isPathInside(realScanRoot, p)
  const membership = emptyMembership()
  const [dirs, files] = await Promise.all([
    Promise.all(
      projects.map(({ subprojectDir }) =>
        realpathOrResolved(path.resolve(buildRoot, subprojectDir)),
      ),
    ),
    Promise.all(
      projects
        .flatMap(project => project.manifestFiles ?? [])
        .map(({ file }) => realFilePath(path.resolve(buildRoot, file))),
    ),
  ])
  for (const dir of dirs) {
    if (inScan(dir)) {
      membership.dirs.add(dir)
    }
  }
  for (const file of files) {
    if (inScan(file) && existsSync(file)) {
      membership.files.add(file)
    }
  }
  return membership
}

const rootMarkerByDir = new Map<string, boolean>()

export function hasRootMarker(tool: BuildTool, root: BuildRoot): boolean {
  const files = BUILD_FILES[tool]
  if (files.byFile) {
    return false
  }
  return getOrInsert(rootMarkerByDir, `${tool}\0${root.dir}`, () =>
    files.rootMarkers.some(marker => existsSync(path.join(root.dir, marker))),
  )
}

// Whether a build loaded `root`'s project; a build of its own (see
// hasRootMarker) is more than that project. `root.dir` must be
// realpath-resolved, as findBuildToolCandidates returns it.
export function isBuildRootCovered(
  covered: Membership,
  tool: BuildTool,
  root: BuildRoot,
): boolean {
  const files = BUILD_FILES[tool]
  if (files.byFile) {
    return !!root.entryFile && containsPath(covered.files, buildRootPath(root))
  }
  return (
    containsPath(covered.dirs, root.dir) ||
    files.names.some(name =>
      containsPath(covered.files, path.join(root.dir, name)),
    )
  )
}

// A dotnet solution is covered once every project it builds is, or, when the
// SDK cannot read it, by a same-named solution in the other format beside it
// (`dotnet sln migrate` writes App.slnx next to App.sln) that it can read.
async function isSolutionCovered(
  covered: Membership,
  root: BuildRoot,
  opts: Pick<
    ManifestScriptOptions,
    'bin' | 'excludeBase' | 'excludePaths' | 'toolOpts'
  >,
  listMembers: typeof listDotnetEntryProjects = listDotnetEntryProjects,
): Promise<boolean> {
  const { entryFile } = root
  if (!entryFile || !isDotnetSolution(entryFile)) {
    return false
  }
  const twin = entryFile.replace(/\.slnx?$/i, ext =>
    ext.toLowerCase() === '.sln' ? '.slnx' : '.sln',
  )
  const hasTwin = existsSync(path.join(root.dir, twin))
  if (!covered.files.size && !hasTwin) {
    return false
  }
  const list = (file: string) =>
    listMembers({ ...opts, entryFile: file, projectDir: root.dir })
  const listed = await list(entryFile)
  if (!listed) {
    // Unless the twin is readable, this one is built and its failure shows.
    if (!hasTwin || !(await list(twin))) {
      return false
    }
    logger.warn(
      `Skipping ${buildRootPath(root)}: the .NET SDK could not read it; ${twin} beside it is built instead.`,
    )
    return true
  }
  const members = await realMembers(listed)
  return (
    !!members.length &&
    members.every(member => containsPath(covered.files, member))
  )
}

// The SDK's member listings are memoized, so their resolved paths are too.
const realMembersByListing = new WeakMap<readonly string[], Promise<string[]>>()

function realMembers(listed: readonly string[]): Promise<string[]> {
  let members = realMembersByListing.get(listed)
  if (!members) {
    members = Promise.all(listed.map(realFilePath))
    realMembersByListing.set(listed, members)
  }
  return members
}

// Whether earlier builds cover `root`: its own build files, or every project
// a solution builds. isBuildRootCovered alone is the cheap first half.
export async function isRootCovered(
  covered: Membership,
  tool: BuildTool,
  root: BuildRoot,
  opts: Pick<
    ManifestScriptOptions,
    'bin' | 'excludeBase' | 'excludePaths' | 'toolOpts'
  >,
  listMembers: typeof listDotnetEntryProjects = listDotnetEntryProjects,
): Promise<boolean> {
  return (
    isBuildRootCovered(covered, tool, root) ||
    (tool === 'dotnet' &&
      (await isSolutionCovered(covered, root, opts, listMembers)))
  )
}

// A build of its own (see hasRootMarker) is covered only by builds that load
// all of `own`, what it loads itself.
export async function isBuildCovered(
  covered: Membership,
  tool: BuildTool,
  root: BuildRoot,
  opts: Parameters<typeof isRootCovered>[3],
  own?: Membership | undefined,
): Promise<boolean> {
  if (!hasRootMarker(tool, root)) {
    return await isRootCovered(covered, tool, root, opts)
  }
  const pick = (membership: Membership) =>
    BUILD_FILES[tool].byFile ? membership.files : membership.dirs
  const members = own ? pick(own) : new Set<string>()
  const loaded = pick(covered)
  return !!members.size && [...members].every(member => loaded.has(member))
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

// `tool` orders the entry files of one tool's builds in the same directory.
export function sortByDepthThenPath<T extends BuildRoot>(
  roots: readonly T[],
  cwd: string,
  tool?: BuildTool | undefined,
): T[] {
  return [...roots].sort((a, b) => {
    const relA = path.relative(cwd, a.dir)
    const relB = path.relative(cwd, b.dir)
    const depthA = relA === '' ? 0 : relA.split(path.sep).length
    const depthB = relB === '' ? 0 : relB.split(path.sep).length
    return (
      depthA - depthB ||
      compareStrings(relA, relB) ||
      (tool
        ? compareEntryFiles(tool, a.entryFile ?? '', b.entryFile ?? '')
        : compareStrings(a.entryFile ?? '', b.entryFile ?? ''))
    )
  })
}

// Depth-sorted (root-most first) so the caller visits a reactor root before
// its own members and can skip those whose build files it already covers.
export async function findBuildToolCandidates({
  cwd,
  excludePaths,
  purlTypes = FACTS_PURL_TYPES,
  sockJson,
  socketConfig,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  purlTypes?: readonly PURL_Type[] | undefined
  // The socket.yml a scan applies to its upload, so a build file a scan would
  // not upload is not built either.
  socketConfig: SocketYml | undefined
  sockJson: SocketJson
}): Promise<Map<BuildTool, BuildRoot[]>> {
  const enabledTools = buildToolsFor(purlTypes).filter(
    tool => !sockJson.defaults?.manifest?.[tool]?.disabled,
  )
  const result = new Map<BuildTool, BuildRoot[]>()
  if (!enabledTools.length) {
    return result
  }

  const additionalIgnores = (excludePaths ?? []).flatMap(
    excludePathToScanIgnores,
  )
  // Build files are matched after the walk, as a scan matches them after its
  // ignores, so --exclude-paths and .gitignore stay case-sensitive.
  const hits = await globWithGitIgnore(
    enabledTools.flatMap(tool => {
      const files = BUILD_FILES[tool]
      return (files.byFile ? [files.walkGlob] : files.names).map(
        glob => `**/${glob}`,
      )
    }),
    { absolute: true, additionalIgnores, cwd, socketConfig },
  )

  const rootsByTool = new Map<BuildTool, Map<string, BuildRoot>>(
    enabledTools.map(tool => [tool, new Map<string, BuildRoot>()]),
  )
  const matched = hits.flatMap(hit => {
    const basename = path.basename(hit)
    const tool = buildFileTool(enabledTools, basename)
    return tool ? [{ basename, hit, tool }] : []
  })
  const roots = await Promise.all(
    matched.map(async ({ basename, hit, tool }) => ({
      root: {
        dir: await realpathOrResolved(path.dirname(hit)),
        entryFile: BUILD_FILES[tool].byFile ? basename : undefined,
      },
      tool,
    })),
  )
  for (const { root, tool } of roots) {
    rootsByTool.get(tool)?.set(buildRootPath(root), root)
  }

  const realCwd = await realpathOrResolved(cwd)
  for (const tool of enabledTools) {
    result.set(
      tool,
      sortByDepthThenPath(
        [...(rootsByTool.get(tool)?.values() ?? [])],
        realCwd,
        tool,
      ),
    )
  }
  return result
}
