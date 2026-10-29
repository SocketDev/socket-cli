import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { whichBin } from '@socketsecurity/registry/lib/bin'

import { resolveBuildToolBin } from './build-tool.mts'

import type { BuildTool } from './build-tool.mts'

export type JavaInstallation = { home: string; feature: number }

export type JavaRange = { min: number; max: number }

export type BuildJavaHome = {
  // Undefined when no usable JDK is set in JAVA_HOME or found on PATH.
  current: JavaInstallation | undefined
  picked: JavaInstallation
  tool: BuildTool
  toolVersion: string
}

type Version = number[]

// The first Gradle release that runs on each Java release, from
// https://docs.gradle.org/current/userguide/compatibility.html.
const GRADLE_RUNS_ON_JAVA_FROM: ReadonlyArray<[number, string]> = [
  [8, '2.0'],
  [9, '4.3'],
  [10, '4.7'],
  [11, '5.0'],
  [12, '5.4'],
  [13, '6.0'],
  [14, '6.3'],
  [15, '6.7'],
  [16, '7.0'],
  [17, '7.3'],
  [18, '7.5'],
  [19, '7.6'],
  [20, '8.3'],
  [21, '8.5'],
  [22, '8.8'],
  [23, '8.10'],
  [24, '8.14'],
  [25, '9.1'],
]

// The first sbt release that runs on each LTS Java release. The sbt version is
// the project's, which the launcher downloads and runs.
const SBT_RUNS_ON_JAVA_FROM: ReadonlyArray<[number, string]> = [
  [8, '0.13'],
  [11, '0.13'],
  [17, '1.3'],
  [21, '1.9'],
  [25, '1.9'],
]

function parseVersion(text: string): Version | undefined {
  const match = /^(\d+(?:\.\d+)*)/.exec(text.trim())
  return match ? match[1]!.split('.').map(Number) : undefined
}

function compareVersions(a: Version, b: Version): number {
  for (let i = 0, length = Math.max(a.length, b.length); i < length; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0)
    if (diff !== 0) {
      return diff
    }
  }
  return 0
}

// Past the table's newest entry the tool may support newer Java than we know
// of, so any Java counts as supported there.
function maxJavaFor(
  table: ReadonlyArray<[number, string]>,
  version: Version,
): number {
  const newest = table[table.length - 1]!
  if (compareVersions(version, parseVersion(newest[1])!) > 0) {
    return Number.POSITIVE_INFINITY
  }
  let max = 0
  for (const [java, since] of table) {
    if (compareVersions(version, parseVersion(since)!) >= 0) {
      max = java
    }
  }
  return max
}

export function gradleJavaRange(version: string): JavaRange | undefined {
  const parsed = parseVersion(version)
  if (!parsed) {
    return undefined
  }
  return {
    min: parsed[0]! >= 9 ? 17 : 8,
    max: maxJavaFor(GRADLE_RUNS_ON_JAVA_FROM, parsed),
  }
}

export function sbtJavaRange(version: string): JavaRange | undefined {
  const parsed = parseVersion(version)
  if (!parsed) {
    return undefined
  }
  return {
    min: parsed[0]! >= 2 ? 17 : 8,
    max: maxJavaFor(SBT_RUNS_ON_JAVA_FROM, parsed),
  }
}

// `JAVA_VERSION` in a JDK's `release` file: "1.8.0_462", "17.0.16", "25".
export function parseJavaFeatureVersion(release: string): number | undefined {
  const match = /^JAVA_VERSION="?(\d+)(?:\.(\d+))?/m.exec(release)
  if (!match) {
    return undefined
  }
  const first = Number(match[1])
  return first === 1 && match[2] ? Number(match[2]) : first
}

export async function readJavaInstallation(
  home: string,
): Promise<JavaInstallation | undefined> {
  if (!existsSync(path.join(home, 'bin', 'java'))) {
    return undefined
  }
  let release: string
  try {
    release = await fs.readFile(path.join(home, 'release'), 'utf8')
  } catch {
    return undefined
  }
  const feature = parseJavaFeatureVersion(release)
  return feature === undefined ? undefined : { home, feature }
}

export function defaultJavaSearchDirs(): string[] {
  const userHome = os.homedir()
  return [
    '/usr/lib/jvm',
    '/usr/lib64/jvm',
    '/usr/java',
    '/opt/java',
    '/Library/Java/JavaVirtualMachines',
    path.join(userHome, 'Library', 'Java', 'JavaVirtualMachines'),
    path.join(userHome, '.sdkman', 'candidates', 'java'),
    path.join(userHome, '.gradle', 'jdks'),
    path.join(userHome, '.jdks'),
  ]
}

// Installed JDKs: the children of each search dir (macOS bundles keep theirs
// under Contents/Home), and the JAVA_HOME_<release>_<arch> variables GitHub
// and Azure runners set.
export async function discoverJavaInstallations(
  env: NodeJS.ProcessEnv,
  searchDirs: readonly string[] = defaultJavaSearchDirs(),
): Promise<JavaInstallation[]> {
  const candidates: string[] = []
  for (const [name, value] of Object.entries(env)) {
    if (value && /^JAVA_HOME_\d+_/i.test(name)) {
      candidates.push(value)
    }
  }
  for (const dir of searchDirs) {
    let children: string[]
    try {
      children = await fs.readdir(dir)
    } catch {
      continue
    }
    for (const child of children.sort()) {
      candidates.push(path.join(dir, child))
      candidates.push(path.join(dir, child, 'Contents', 'Home'))
    }
  }
  const seen = new Set<string>()
  const found: JavaInstallation[] = []
  for (const candidate of candidates) {
    const installation = await readJavaInstallation(candidate)
    if (!installation) {
      continue
    }
    const home = await fs.realpath(candidate)
    if (!seen.has(home)) {
      seen.add(home)
      found.push({ ...installation, home })
    }
  }
  return found
}

// The JDK a build tool would run on: JAVA_HOME, else the `java` on PATH.
export async function currentJavaInstallation(
  env: NodeJS.ProcessEnv,
): Promise<JavaInstallation | undefined> {
  const javaHome = env['JAVA_HOME']
  if (javaHome) {
    return await readJavaInstallation(javaHome)
  }
  const java = await whichBin('java', { nothrow: true, path: env['PATH'] })
  if (typeof java !== 'string') {
    return undefined
  }
  const home = path.dirname(path.dirname(await fs.realpath(java)))
  // A JDK 8 `java` on PATH can be the one under <home>/jre/bin.
  return (
    (await readJavaInstallation(home)) ??
    (await readJavaInstallation(path.dirname(home)))
  )
}

async function readProperty(
  file: string,
  key: string,
): Promise<string | undefined> {
  let text: string
  try {
    text = await fs.readFile(file, 'utf8')
  } catch {
    return undefined
  }
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([^#!=:\s]+)\s*[=:]\s*(.*?)\s*$/.exec(line)
    if (match?.[1] === key) {
      return match[2]
    }
  }
  return undefined
}

// The version the project pins: the Gradle wrapper's distribution, or sbt's
// `sbt.version`. Undefined for a Gradle on PATH or a custom bin.
export async function projectBuildToolVersion(
  tool: BuildTool,
  projectDir: string,
  bin?: string | undefined,
): Promise<string | undefined> {
  if (tool === 'gradle') {
    if (resolveBuildToolBin('gradle', projectDir, bin) !== './gradlew') {
      return undefined
    }
    const url = await readProperty(
      path.join(projectDir, 'gradle', 'wrapper', 'gradle-wrapper.properties'),
      'distributionUrl',
    )
    return url ? /gradle-(\d+(?:\.\d+)*)[^/]*\.zip$/.exec(url)?.[1] : undefined
  }
  if (tool === 'sbt') {
    return await readProperty(
      path.join(projectDir, 'project', 'build.properties'),
      'sbt.version',
    )
  }
  return undefined
}

function javaRangeFor(tool: BuildTool, version: string): JavaRange | undefined {
  switch (tool) {
    case 'gradle':
      return gradleJavaRange(version)
    case 'sbt':
      return sbtJavaRange(version)
    case 'maven':
      return undefined
  }
}

// A JDK to run the project's build tool on, when the current one is outside
// the range the tool's pinned version runs on. Undefined keeps the current JDK.
export async function selectBuildJavaHome(
  tool: BuildTool,
  projectDir: string,
  opts: {
    bin?: string | undefined
    env: NodeJS.ProcessEnv
    searchDirs?: readonly string[] | undefined
  },
): Promise<BuildJavaHome | undefined> {
  const toolVersion = await projectBuildToolVersion(tool, projectDir, opts.bin)
  const range = toolVersion ? javaRangeFor(tool, toolVersion) : undefined
  if (!toolVersion || !range) {
    return undefined
  }
  const fits = ({ feature }: JavaInstallation) =>
    feature >= range.min && feature <= range.max
  const current = await currentJavaInstallation(opts.env)
  if (current && fits(current)) {
    return undefined
  }
  let picked: JavaInstallation | undefined
  for (const installation of await discoverJavaInstallations(
    opts.env,
    opts.searchDirs,
  )) {
    if (fits(installation) && installation.feature > (picked?.feature ?? 0)) {
      picked = installation
    }
  }
  return picked ? { current, picked, tool, toolVersion } : undefined
}
