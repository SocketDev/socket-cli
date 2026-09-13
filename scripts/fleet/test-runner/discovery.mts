import { lstatSync } from 'node:fs'
import path from 'node:path'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isGeneratedPath } from '../constants/generated-globs.mts'

function isRegularSourcePath(repoRoot: string, relative: string): boolean {
  const segments = relative.split('/')
  let current = repoRoot
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]!)
    const stats = lstatSync(current, { throwIfNoEntry: false })
    if (!stats || stats.isSymbolicLink()) {
      return false
    }
    if (index === segments.length - 1) {
      return stats.isFile()
    }
    if (!stats.isDirectory()) {
      return false
    }
  }
  return false
}

export function isAuthoredBuildTestPath(
  filename: string,
  repoRoot: string,
): boolean {
  const normalized = normalizePath(filename)
  const relative = path.isAbsolute(normalized)
    ? normalizePath(path.relative(repoRoot, normalized))
    : normalized
  const match =
    // Optional workspace prefix, fleet or repo test lane, and matching build source stem.
    /^(.*?)test\/(?:fleet|repo)\/(?:e2e|integration|unit)\/build\/(.+)\.test\.mts$/.exec(
      relative,
    )
  if (!match || relative.split('/').includes('..')) {
    return false
  }
  const prefix = match[1]!
  const suffix = match[2]!
  if (prefix && !prefix.endsWith('/')) {
    return false
  }
  for (const namespace of ['fleet', 'repo']) {
    const source = `${prefix}scripts/${namespace}/build/${suffix}.mts`
    if (isGeneratedPath(source)) {
      continue
    }
    for (const base of ['', 'template/base/universal/']) {
      if (isRegularSourcePath(repoRoot, `${base}${source}`)) {
        return true
      }
    }
  }
  return false
}

export function isGeneratedTestPath(
  filename: string,
  repoRoot: string,
): boolean {
  return (
    isGeneratedPath(filename) && !isAuthoredBuildTestPath(filename, repoRoot)
  )
}

export function resolveGeneratedTestExcludes(config: {
  repoRoot: string
  include: readonly string[]
  exclude: readonly string[]
}): string[] {
  const { repoRoot, include, exclude } = config
  const buildGlob = '**/build/**'
  if (!exclude.includes(buildGlob)) {
    return [...exclude]
  }
  const candidateExcludes = exclude.filter(pattern => pattern !== buildGlob)
  const candidates = globSync([...include], {
    cwd: repoRoot,
    ignore: candidateExcludes,
  }).map(filename => normalizePath(filename))
  if (
    !candidates.some(filename => isAuthoredBuildTestPath(filename, repoRoot))
  ) {
    return [...exclude]
  }
  return [
    ...candidateExcludes,
    ...candidates
      .filter(filename => isGeneratedTestPath(filename, repoRoot))
      .map(filename =>
        filename.replace(/[*?[\]{}()!+@]/g, character => `[${character}]`),
      ),
  ]
}
