import { promises as fs } from 'node:fs'
import path from 'node:path'

import { globWithGitIgnore } from '../../utils/glob.mts'
import { excludePathToScanIgnores } from '../scan/exclude-paths.mts'

import type { BuildTool } from './scripts/build-tool.mts'
import type { SocketJson } from '../../utils/socket-json.mts'

const BUILD_TOOLS: BuildTool[] = ['gradle', 'maven', 'sbt']

// One glob-suffix set per ecosystem's build-descriptor marker(s); `settings.gradle(.kts)`
// covers Kotlin-DSL roots that have no root `build.gradle`.
const MARKERS_BY_TOOL: Record<BuildTool, string[]> = {
  __proto__: null,
  gradle: [
    'build.gradle',
    'build.gradle.kts',
    'settings.gradle',
    'settings.gradle.kts',
  ],
  maven: ['pom.xml'],
  sbt: ['build.sbt'],
} as unknown as Record<BuildTool, string[]>

const TOOL_BY_MARKER: Record<string, BuildTool> = {
  __proto__: null,
} as unknown as Record<string, BuildTool>
for (const tool of BUILD_TOOLS) {
  for (const marker of MARKERS_BY_TOOL[tool]) {
    TOOL_BY_MARKER[marker] = tool
  }
}

export async function realpathOrResolved(dir: string): Promise<string> {
  try {
    return await fs.realpath(dir)
  } catch {
    return path.resolve(dir)
  }
}

function sortByDepthThenPath(dirs: readonly string[], cwd: string): string[] {
  return [...dirs].sort((a, b) => {
    const relA = path.relative(cwd, a)
    const relB = path.relative(cwd, b)
    const depthA = relA === '' ? 0 : relA.split(path.sep).length
    const depthB = relB === '' ? 0 : relB.split(path.sep).length
    if (depthA !== depthB) {
      return depthA - depthB
    }
    return relA < relB ? -1 : relA > relB ? 1 : 0
  })
}

// Depth-sorted (root-most first) so the caller, using each build root's
// `subprojectDir` facts, visits a reactor root before its own members and can
// skip subprojects a parent root already covers.
export async function findBuildToolCandidates({
  cwd,
  excludePaths,
  sockJson,
}: {
  cwd: string
  excludePaths?: string[] | undefined
  sockJson: SocketJson
}): Promise<Map<BuildTool, string[]>> {
  const enabledTools = BUILD_TOOLS.filter(
    tool => !sockJson.defaults?.manifest?.[tool]?.disabled,
  )
  const result = new Map<BuildTool, string[]>()
  if (!enabledTools.length) {
    return result
  }

  const patterns = enabledTools.flatMap(tool =>
    MARKERS_BY_TOOL[tool].map(marker => `**/${marker}`),
  )
  const additionalIgnores = (excludePaths ?? []).flatMap(
    excludePathToScanIgnores,
  )
  const hits = await globWithGitIgnore(patterns, {
    absolute: true,
    additionalIgnores,
    cwd,
  })

  const dirSetsByTool = new Map<BuildTool, Set<string>>(
    enabledTools.map(tool => [tool, new Set<string>()]),
  )
  const resolvedHits = await Promise.all(
    hits.map(async hit => ({
      dir: await realpathOrResolved(path.dirname(hit)),
      tool: TOOL_BY_MARKER[path.basename(hit)],
    })),
  )
  for (const { dir, tool } of resolvedHits) {
    if (tool) {
      dirSetsByTool.get(tool)?.add(dir)
    }
  }

  const realCwd = await realpathOrResolved(cwd)
  for (const tool of enabledTools) {
    result.set(
      tool,
      sortByDepthThenPath([...(dirSetsByTool.get(tool) ?? [])], realCwd),
    )
  }
  return result
}
