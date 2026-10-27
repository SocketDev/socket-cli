import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { isAddressedByFile } from './scripts/build-tool.mts'
import { realpathOrResolved } from '../../utils/fs.mts'
import { globWithGitIgnore } from '../../utils/glob.mts'
import { excludePathToScanIgnores } from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { SocketFactsSbomProject } from './scripts/facts.mts'
import type { SocketJson } from '../../utils/socket-json.mts'
import type { SocketYml } from '@socketsecurity/config'

const BUILD_TOOLS: BuildTool[] = ['gradle', 'maven', 'sbt']

// One glob set per ecosystem's build-descriptor marker(s); `settings.gradle(.kts)`
// covers Kotlin-DSL roots that have no root `build.gradle`. Maven mirrors the
// `pomxml` pattern of the API's supported files, so every POM a scan uploads is
// also a build root here.
const MARKERS_BY_TOOL: Record<BuildTool, string[]> = {
  __proto__: null,
  gradle: [
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
  ],
  maven: ['{*-*.,}pom{.xml,}'],
  sbt: ['build.sbt'],
} as unknown as Record<BuildTool, string[]>

// Case-insensitive for POMs, as a scan matches them; Gradle and sbt look for
// their build files by exact name.
const MARKER_MATCHERS_BY_TOOL = new Map(
  BUILD_TOOLS.map(tool => {
    const options = { dot: true, nocase: tool === 'maven' }
    const matchers = MARKERS_BY_TOOL[tool].map(marker =>
      micromatch.matcher(marker, options),
    )
    return [tool, (basename: string) => matchers.some(m => m(basename))]
  }),
)

// `entryFile` (a basename in `dir`) is set only for a tool that addresses its
// builds by file, where one directory can hold several builds.
export type BuildRoot = { dir: string; entryFile?: string | undefined }

export function buildRootPath(root: BuildRoot): string {
  return path.join(root.dir, root.entryFile ?? '')
}

function markerTool(
  tools: readonly BuildTool[],
  basename: string,
): BuildTool | undefined {
  return tools.find(tool => MARKER_MATCHERS_BY_TOOL.get(tool)?.(basename))
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

// Gradle reports a project's build file even when absent, which covers
// nothing. A sibling outside the build root is independently locatable.
export async function addCoveredBuildFiles(
  covered: Set<string>,
  buildRoot: string,
  projects: readonly SocketFactsSbomProject[],
): Promise<void> {
  const realBuildRoot = await realpathOrResolved(buildRoot)
  const files = await Promise.all(
    projects
      .flatMap(project => project.manifestFiles ?? [])
      .map(async ({ file }) => {
        const resolved = path.resolve(buildRoot, file)
        return path.join(
          await realpathOrResolved(path.dirname(resolved)),
          path.basename(resolved),
        )
      }),
  )
  for (const file of files) {
    if (file.startsWith(`${realBuildRoot}${path.sep}`) && existsSync(file)) {
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
  if (root.entryFile) {
    return covered.has(buildRootPath(root))
  }
  return MARKERS_BY_TOOL[tool].some(marker =>
    covered.has(path.join(root.dir, marker)),
  )
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
      compareStrings(a.entryFile ?? '', b.entryFile ?? '')
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
  socketConfig?: SocketYml | undefined
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
  // Markers are matched in the filter, after the ignores, so --exclude-paths
  // and .gitignore stay case-sensitive as they are for a scan.
  const hits = await globWithGitIgnore(['**/*'], {
    absolute: true,
    additionalIgnores,
    cwd,
    filter: hit => !!markerTool(enabledTools, path.basename(hit)),
    socketConfig,
  })

  const rootsByTool = new Map<BuildTool, Map<string, BuildRoot>>(
    enabledTools.map(tool => [tool, new Map<string, BuildRoot>()]),
  )
  const resolvedHits = await Promise.all(
    hits.map(async hit => {
      const basename = path.basename(hit)
      return {
        basename,
        dir: await realpathOrResolved(path.dirname(hit)),
        // Set: the glob filter kept only marker hits.
        tool: markerTool(enabledTools, basename) as BuildTool,
      }
    }),
  )
  for (const { basename, dir, tool } of resolvedHits) {
    const root = {
      dir,
      entryFile: isAddressedByFile(tool) ? basename : undefined,
    }
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
