import { existsSync, promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import semver from 'semver'

import { whichBin } from '@socketsecurity/registry/lib/bin'

import { resolveBuildToolBin } from './build-tool.mts'

import type { BuildTool } from './build-tool.mts'

export type JavaInstallation = { home: string; feature: number }

export type JavaRange = { min: number; max: number }

export type BuildJavaHome = {
  // Undefined when no usable JDK is set in JAVA_HOME or found on PATH.
  current: JavaInstallation | undefined
  picked: JavaInstallation
  toolVersion: string
}

type JavaSupport = {
  // The first release of the tool that runs on each Java release.
  runsOnJavaFrom: ReadonlyArray<[number, string]>
  // The first major release that needs Java 17.
  java17FromMajor: number
}

const JAVA_SUPPORT: Partial<Record<BuildTool, JavaSupport>> = {
  // https://docs.gradle.org/current/userguide/compatibility.html
  gradle: {
    runsOnJavaFrom: [
      [8, '2.0.0'],
      [9, '4.3.0'],
      [10, '4.7.0'],
      [11, '5.0.0'],
      [12, '5.4.0'],
      [13, '6.0.0'],
      [14, '6.3.0'],
      [15, '6.7.0'],
      [16, '7.0.0'],
      [17, '7.3.0'],
      [18, '7.5.0'],
      [19, '7.6.0'],
      [20, '8.3.0'],
      [21, '8.5.0'],
      [22, '8.8.0'],
      [23, '8.10.0'],
      [24, '8.14.0'],
      [25, '9.1.0'],
    ],
    java17FromMajor: 9,
  },
  // LTS Java releases only. The sbt version is the project's, which the
  // launcher downloads and runs.
  sbt: {
    runsOnJavaFrom: [
      [8, '0.13.0'],
      [11, '0.13.0'],
      [17, '1.3.0'],
      [21, '1.9.0'],
      [25, '1.9.0'],
    ],
    java17FromMajor: 2,
  },
}

export function javaRange(
  tool: BuildTool,
  version: string,
): JavaRange | undefined {
  const support = JAVA_SUPPORT[tool]
  const parsed = semver.coerce(version)
  if (!support || !parsed) {
    return undefined
  }
  const { java17FromMajor, runsOnJavaFrom } = support
  const min = parsed.major >= java17FromMajor ? 17 : 8
  // Past the table's newest entry the tool may support newer Java than we know
  // of, so any Java counts as supported there.
  if (semver.gt(parsed, runsOnJavaFrom[runsOnJavaFrom.length - 1]![1])) {
    return { min, max: Number.POSITIVE_INFINITY }
  }
  let max = 0
  for (const [java, since] of runsOnJavaFrom) {
    if (semver.gte(parsed, since)) {
      max = java
    }
  }
  return { min, max }
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

async function readJavaInstallation(
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

function defaultJavaSearchDirs(): string[] {
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
  const runnerHomes = Object.entries(env).flatMap(([name, value]) =>
    value && /^JAVA_HOME_\d+_/i.test(name) ? [value] : [],
  )
  const searchDirHomes = await Promise.all(
    searchDirs.map(async dir => {
      let children: string[]
      try {
        children = await fs.readdir(dir)
      } catch {
        return []
      }
      return children
        .sort()
        .flatMap(child => [
          path.join(dir, child),
          path.join(dir, child, 'Contents', 'Home'),
        ])
    }),
  )
  const installations = await Promise.all(
    [...runnerHomes, ...searchDirHomes.flat()].map(async candidate => {
      const installation = await readJavaInstallation(candidate)
      return installation
        ? { ...installation, home: await fs.realpath(candidate) }
        : undefined
    }),
  )
  const seen = new Set<string>()
  const found: JavaInstallation[] = []
  for (const installation of installations) {
    if (installation && !seen.has(installation.home)) {
      seen.add(installation.home)
      found.push(installation)
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
  const range = toolVersion ? javaRange(tool, toolVersion) : undefined
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
  return picked ? { current, picked, toolVersion } : undefined
}
