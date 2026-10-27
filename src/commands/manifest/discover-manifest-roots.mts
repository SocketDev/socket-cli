import { existsSync } from 'node:fs'
import path from 'node:path'

import micromatch from 'micromatch'

import { defaultEntryFile, isAddressedByFile } from './scripts/build-tool.mts'
import { findSocketYmlSync } from '../../utils/config.mts'
import { realpathOrResolved } from '../../utils/fs.mts'
import { globWithGitIgnore } from '../../utils/glob.mts'
import { excludePathToScanIgnores } from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { SocketFactsSbomProject } from './scripts/facts.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

const BUILD_TOOLS: BuildTool[] = ['gradle', 'maven', 'sbt']

// In the pattern, not the walk, whose ignores (--exclude-paths, .gitignore)
// stay case-sensitive. Assumes every letter in the pattern is a literal.
function foldCase(pattern: string): string {
  return pattern.replace(
    /[a-z]/gi,
    c => `[${c.toLowerCase()}${c.toUpperCase()}]`,
  )
}

// One glob-suffix set per ecosystem's build-descriptor marker(s); `settings.gradle(.kts)`
// covers Kotlin-DSL roots that have no root `build.gradle`. Maven mirrors the
// `pomxml` pattern of the API's supported files, case-insensitively as a scan
// matches it, so every POM a scan uploads is also a build root here.
const MARKERS_BY_TOOL: Record<BuildTool, string[]> = {
  __proto__: null,
  gradle: [
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
  ],
  maven: [foldCase('{*-*.,}pom{.xml,}')],
  sbt: ['build.sbt'],
} as unknown as Record<BuildTool, string[]>

const MARKER_MATCHERS_BY_TOOL = Object.fromEntries(
  BUILD_TOOLS.map(tool => [
    tool,
    MARKERS_BY_TOOL[tool].map(marker =>
      micromatch.matcher(marker, { dot: true }),
    ),
  ]),
) as Record<BuildTool, Array<(basename: string) => boolean>>

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
  return tools.find(tool =>
    MARKER_MATCHERS_BY_TOOL[tool].some(matches => matches(basename)),
  )
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
  const entryFile = root.entryFile ?? defaultEntryFile(tool)
  if (entryFile) {
    return covered.has(path.join(root.dir, entryFile))
  }
  return MARKERS_BY_TOOL[tool].some(marker =>
    covered.has(path.join(root.dir, marker)),
  )
}

function sortByDepthThenPath(
  roots: readonly BuildRoot[],
  cwd: string,
): BuildRoot[] {
  return [...roots].sort((a, b) => {
    const relA = path.relative(cwd, a.dir)
    const relB = path.relative(cwd, b.dir)
    const depthA = relA === '' ? 0 : relA.split(path.sep).length
    const depthB = relB === '' ? 0 : relB.split(path.sep).length
    if (depthA !== depthB) {
      return depthA - depthB
    }
    if (relA !== relB) {
      return relA < relB ? -1 : 1
    }
    const entryA = a.entryFile ?? ''
    const entryB = b.entryFile ?? ''
    return entryA < entryB ? -1 : entryA > entryB ? 1 : 0
  })
}

// Depth-sorted (root-most first) so the caller visits a reactor root before
// its own members and can skip those whose build files it already covers.
export async function findBuildToolCandidates({
  cwd,
  excludePaths,
  sockJson,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  sockJson: SocketJson
}): Promise<Map<BuildTool, BuildRoot[]>> {
  const enabledTools = BUILD_TOOLS.filter(
    tool => !sockJson.defaults?.manifest?.[tool]?.disabled,
  )
  const result = new Map<BuildTool, BuildRoot[]>()
  if (!enabledTools.length) {
    return result
  }

  const patterns = enabledTools.flatMap(tool =>
    MARKERS_BY_TOOL[tool].map(marker => `**/${marker}`),
  )
  const additionalIgnores = (excludePaths ?? []).flatMap(
    excludePathToScanIgnores,
  )
  // The same socket.yml a scan applies to its upload, so a build file a scan
  // would not upload is not built either.
  const socketYml = findSocketYmlSync(cwd)
  const hits = await globWithGitIgnore(patterns, {
    absolute: true,
    additionalIgnores,
    cwd,
    socketConfig: socketYml.ok ? socketYml.data?.parsed : undefined,
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
        tool: markerTool(enabledTools, basename),
      }
    }),
  )
  for (const { basename, dir, tool } of resolvedHits) {
    if (!tool) {
      continue
    }
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
