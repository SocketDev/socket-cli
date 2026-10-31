import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { logger } from '@socketsecurity/registry/lib/logger'

import { BUILD_FILES, isDotnetSolution } from './scripts/build-tool.mts'
import { listDotnetEntryProjects } from './scripts/run.mts'
import { realpathOrResolved } from '../../utils/fs.mts'
import { globWithGitIgnore } from '../../utils/glob.mts'
import { excludePathToScanIgnores } from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { SocketFactsSbomProject } from './scripts/facts.mts'
import type { ManifestScriptOptions } from './scripts/run.mts'
import type { SocketJson } from '../../utils/socket-json.mts'
import type { SocketYml } from '@socketsecurity/config'

const BUILD_TOOLS: BuildTool[] = ['dotnet', 'gradle', 'maven', 'sbt']

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

function solutionsFirst(file: string): number {
  return isDotnetSolution(file) ? 0 : 1
}

// Within one directory: solutions before projects (a solution covers the
// projects it lists), then by name.
export function compareEntryFiles(a: string, b: string): number {
  return solutionsFirst(a) - solutionsFirst(b) || compareStrings(a, b)
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

// Gradle reports a project's build file even when absent, which covers
// nothing. A sibling outside the build root is independently locatable,
// unless its projects resolve alone.
export async function addCoveredBuildFiles(
  covered: Set<string>,
  tool: BuildTool,
  buildRoot: string,
  projects: readonly SocketFactsSbomProject[],
): Promise<void> {
  const buildFiles = BUILD_FILES[tool]
  const anywhere = buildFiles.byFile && !!buildFiles.projectsResolveAlone
  const realBuildRoot = await realpathOrResolved(buildRoot)
  const files = await Promise.all(
    projects
      .flatMap(project => project.manifestFiles ?? [])
      .map(({ file }) => realFilePath(path.resolve(buildRoot, file))),
  )
  for (const file of files) {
    if (
      (anywhere || file.startsWith(`${realBuildRoot}${path.sep}`)) &&
      existsSync(file)
    ) {
      covered.add(file)
    }
  }
}

// `root.dir` must be realpath-resolved, as findBuildToolCandidates returns it.
export function isBuildRootCovered(
  covered: ReadonlySet<string>,
  tool: BuildTool,
  root: BuildRoot,
): boolean {
  const files = BUILD_FILES[tool]
  if (files.byFile) {
    return !!root.entryFile && covered.has(buildRootPath(root))
  }
  return files.names.some(name => covered.has(path.join(root.dir, name)))
}

// A dotnet solution is covered once every project it builds is, or, when the
// SDK cannot read it, by a same-named solution in the other format beside it
// (`dotnet sln migrate` writes App.slnx next to App.sln) that it can read.
export async function isSolutionCovered(
  covered: ReadonlySet<string>,
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
  if (!covered.size && !hasTwin) {
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
  const members = await Promise.all(listed.map(realFilePath))
  return !!members.length && members.every(member => covered.has(member))
}

function compareStrings(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
}

export function sortByDepthThenPath<T extends BuildRoot>(
  roots: readonly T[],
  cwd: string,
): T[] {
  return [...roots].sort((a, b) => {
    const relA = path.relative(cwd, a.dir)
    const relB = path.relative(cwd, b.dir)
    const depthA = relA === '' ? 0 : relA.split(path.sep).length
    const depthB = relB === '' ? 0 : relB.split(path.sep).length
    return (
      depthA - depthB ||
      compareStrings(relA, relB) ||
      compareEntryFiles(a.entryFile ?? '', b.entryFile ?? '')
    )
  })
}

// Depth-sorted (root-most first) so the caller visits a reactor root before
// its own members and can skip those whose build files it already covers.
export async function findBuildToolCandidates({
  cwd,
  excludePaths,
  sockJson,
  socketConfig,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  // The socket.yml a scan applies to its upload, so a build file a scan would
  // not upload is not built either.
  socketConfig: SocketYml | undefined
  sockJson: SocketJson
}): Promise<Map<BuildTool, BuildRoot[]>> {
  const enabledTools = BUILD_TOOLS.filter(
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
      ),
    )
  }
  return result
}
