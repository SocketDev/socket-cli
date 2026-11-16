import { existsSync } from 'node:fs'
import path from 'node:path'

import { logger } from '@socketsecurity/registry/lib/logger'
import { isObjectObject } from '@socketsecurity/registry/lib/objects'

import { isBuildFile } from './discover-manifest-roots.mts'
import { BUILD_FILES, BUILD_TOOLS } from './scripts/build-tool.mts'
import { SOCKET_JSON } from '../../constants.mts'
import { InputError } from '../../utils/errors.mts'
import {
  mergeSocketJsonChain,
  readSocketJsonChain,
} from '../../utils/socket-json.mts'

import type { BuildRoot } from './discover-manifest-roots.mts'
import type { BuildTool } from './scripts/build-tool.mts'
import type {
  SocketJson,
  SocketJsonBuildEntry,
  SocketJsonInDir,
} from '../../utils/socket-json.mts'

// The setting that makes the effective `disabled` true.
export type DisabledBy = {
  // The directory of the socket.json that sets it.
  dir: string
  // The `defaults.manifest.builds` key, when it is the build's own setting.
  key?: string | undefined
}

export type ResolvedBuildRootSettings = {
  disabledBy: DisabledBy | undefined
  // The key of the build's own `defaults.manifest.builds` entry.
  entryKey: string | undefined
  // The cascaded settings, the build's own entries applied last.
  sockJson: SocketJson
}

// Gradle and sbt name a build by any build file of its directory.
function namesBuildFile(key: string): boolean {
  return BUILD_TOOLS.some(tool => {
    const files = BUILD_FILES[tool]
    return files.byFile ? isBuildFile(tool, key) : files.names.includes(key)
  })
}

function validateBuilds({ dir, sockJson }: SocketJsonInDir): void {
  const builds: unknown = sockJson.defaults?.manifest?.builds
  if (builds === undefined) {
    return
  }
  const file = socketJsonPath(dir)
  if (!isObjectObject(builds)) {
    throw new InputError(
      `defaults.manifest.builds in ${file} must be an object keyed by build file name.`,
    )
  }
  for (const { 0: key, 1: entry } of Object.entries(builds)) {
    if (key.includes('/') || key.includes('\\') || !namesBuildFile(key)) {
      throw new InputError(
        `${buildsSetting(key)} in ${file} must be keyed by the name of a build file in that directory, such as pom.xml or build.gradle.`,
      )
    }
    if (!isObjectObject(entry)) {
      throw new InputError(
        `${buildsSetting(key)} in ${file} must be an object.`,
      )
    }
    if (
      entry['disabled'] !== undefined &&
      typeof entry['disabled'] !== 'boolean'
    ) {
      throw new InputError(
        `${buildsSetting(key)}.disabled in ${file} must be true or false.`,
      )
    }
  }
  for (const tool of BUILD_TOOLS) {
    const files = BUILD_FILES[tool]
    const keys = files.byFile
      ? []
      : files.names.filter(
          name =>
            Object.hasOwn(builds, name) && existsSync(path.join(dir, name)),
        )
    if (keys.length > 1) {
      throw new InputError(
        `${keys.map(buildsSetting).join(' and ')} in ${file} configure the same ${tool} build. Keep one of them.`,
      )
    }
  }
}

function warnMissingFiles(
  { dir, sockJson }: SocketJsonInDir,
  warned: Set<string>,
): void {
  for (const key of Object.keys(sockJson.defaults?.manifest?.builds ?? {})) {
    const file = path.join(dir, key)
    if (!warned.has(file) && !existsSync(file)) {
      warned.add(file)
      logger.warn(
        `${buildsSetting(key)} in ${socketJsonPath(dir)} names a file that is not there, so it applies to no build.`,
      )
    }
  }
}

export function buildsSetting(key: string): string {
  return `defaults.manifest.builds[${JSON.stringify(key)}]`
}

// Resolves the socket.json settings of build roots, reading and validating
// each socket.json once. `readChain` lists a directory's socket.json files,
// farthest first; resolvers sharing `warned` warn about a file once.
export function createBuildRootSettingsResolver(
  readChain: (dir: string) => SocketJsonInDir[] = readSocketJsonChain,
  warned: Set<string> = new Set(),
): (tool: BuildTool, root: BuildRoot) => ResolvedBuildRootSettings {
  const chains = new Map<string, SocketJsonInDir[]>()
  const validated = new Set<string>()

  const chainFor = (dir: string): SocketJsonInDir[] => {
    let chain = chains.get(dir)
    if (!chain) {
      chain = readChain(dir)
      for (const file of chain) {
        if (!validated.has(file.dir)) {
          validated.add(file.dir)
          validateBuilds(file)
          warnMissingFiles(file, warned)
        }
      }
      chains.set(dir, chain)
    }
    return chain
  }

  return (tool, root) => {
    const chain = chainFor(root.dir)
    const merged = mergeSocketJsonChain(chain)
    const section: Record<string, unknown> = {
      ...merged.defaults?.manifest?.[tool],
    }
    let sectionDisabledBy: DisabledBy | undefined
    for (const { dir, sockJson } of chain) {
      if (sockJson.defaults?.manifest?.[tool]?.disabled !== undefined) {
        sectionDisabledBy = { dir }
      }
    }
    const directorySkip = section['disabled'] === true

    const own = chain.at(-1)
    const builds =
      own?.dir === root.dir
        ? own.sockJson.defaults?.manifest?.builds
        : undefined
    const files = BUILD_FILES[tool]
    const names = files.byFile
      ? [root.entryFile ?? '']
      : files.names.filter(name => existsSync(path.join(root.dir, name)))
    // Validation leaves at most one.
    const entryKey = builds
      ? names.find(name => Object.hasOwn(builds, name))
      : undefined
    let entryDisabledBy: DisabledBy | undefined
    if (entryKey) {
      const entry = builds![entryKey] as SocketJsonBuildEntry
      Object.assign(section, entry)
      if (entry.disabled !== undefined) {
        entryDisabledBy = { dir: root.dir, key: entryKey }
      }
    }

    // An entry can turn a build in a skipped directory back on; skipping it
    // there too changes nothing, as nothing in the directory is loaded.
    let disabledBy: DisabledBy | undefined
    if (section['disabled']) {
      disabledBy = directorySkip ? sectionDisabledBy : entryDisabledBy
    }

    return {
      disabledBy,
      entryKey,
      sockJson: {
        ...merged,
        defaults: {
          ...merged.defaults,
          manifest: { ...merged.defaults?.manifest, [tool]: section },
        },
      } as SocketJson,
    }
  }
}

// The setting that skips builds, as `<socket.json> sets <setting>`.
export function describeDisabledBy(
  tool: BuildTool,
  { dir, key }: DisabledBy,
): string {
  const setting = key
    ? `${buildsSetting(key)}.disabled`
    : `defaults.manifest.${tool}.disabled`
  return `${socketJsonPath(dir)} sets ${setting}`
}

// Relative to the user's shell when inside it, else absolute.
export function displayPath(file: string): string {
  const rel = path.relative(process.cwd(), file)
  return rel.startsWith('..') || path.isAbsolute(rel) ? file : rel || '.'
}

export function socketJsonPath(dir: string): string {
  return displayPath(path.join(dir, SOCKET_JSON))
}
