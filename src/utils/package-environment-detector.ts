import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import browserslist from 'browserslist'
import semver from 'semver'
import which from 'which'

import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb/index.cjs'
import { isObjectObject } from '@socketsecurity/registry/lib/objects'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { findUp, readFileBinary, readFileUtf8 } from './fs'
import constants from '../constants'

import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'
import type { SemVer } from 'semver'

const {
  BINARY_LOCK_EXT,
  BUN,
  LOCK_EXT,
  NPM,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC
} = constants

export const AGENTS = [BUN, NPM, PNPM, YARN_BERRY, YARN_CLASSIC, VLT] as const
export type Agent = (typeof AGENTS)[number]
export type StringKeyValueObject = { [key: string]: string }

const binByAgent = {
  __proto__: null,
  [BUN]: BUN,
  [NPM]: NPM,
  [PNPM]: PNPM,
  [YARN_BERRY]: YARN,
  [YARN_CLASSIC]: YARN,
  [VLT]: VLT
}

async function getAgentExecPath(agent: Agent): Promise<string> {
  const binName = binByAgent[agent]
  return (await which(binName, { nothrow: true })) ?? binName
}

async function getAgentVersion(
  agentExecPath: string,
  cwd: string
): Promise<SemVer | undefined> {
  let result
  try {
    result =
      semver.coerce(
        // All package managers support the "--version" flag.
        (await spawn(agentExecPath, ['--version'], { cwd })).stdout
      ) ?? undefined
  } catch {}
  return result
}

// The order of LOCKS properties IS significant as it affects iteration order.
const LOCKS: Record<string, Agent> = {
  [`bun${LOCK_EXT}`]: BUN,
  [`bun${BINARY_LOCK_EXT}`]: BUN,
  // If both package-lock.json and npm-shrinkwrap.json are present in the root
  // of a project, npm-shrinkwrap.json will take precedence and package-lock.json
  // will be ignored.
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#package-lockjson-vs-npm-shrinkwrapjson
  'npm-shrinkwrap.json': NPM,
  'package-lock.json': NPM,
  'pnpm-lock.yaml': PNPM,
  'pnpm-lock.yml': PNPM,
  [`yarn${LOCK_EXT}`]: YARN_CLASSIC,
  'vlt-lock.json': VLT,
  // Lastly, look for a hidden lock file which is present if .npmrc has package-lock=false:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#hidden-lockfiles
  //
  // Unlike the other LOCKS keys this key contains a directory AND filename so
  // it has to be handled differently.
  'node_modules/.package-lock.json': NPM
}

type ReadLockFile =
  | ((lockPath: string) => Promise<string | undefined>)
  | ((lockPath: string, agentExecPath: string) => Promise<string | undefined>)

const readLockFileByAgent: Record<Agent, ReadLockFile> = (() => {
  function wrapReader<T extends (...args: any[]) => Promise<any>>(
    reader: T
  ): (...args: Parameters<T>) => Promise<Awaited<ReturnType<T>> | undefined> {
    return async (...args: any[]): Promise<any> => {
      try {
        return await reader(...args)
      } catch {}
      return undefined
    }
  }

  const binaryReader = wrapReader(readFileBinary)

  const defaultReader = wrapReader(
    async (lockPath: string) => await readFileUtf8(lockPath)
  )

  return {
    [BUN]: wrapReader(async (lockPath: string, agentExecPath: string) => {
      const ext = path.extname(lockPath)
      if (ext === LOCK_EXT) {
        return await defaultReader(lockPath)
      }
      if (ext === BINARY_LOCK_EXT) {
        const lockBuffer = await binaryReader(lockPath)
        if (lockBuffer) {
          try {
            return parseBunLockb(lockBuffer)
          } catch {}
        }
        // To print a Yarn lockfile to your console without writing it to disk
        // use `bun bun.lockb`.
        // https://bun.sh/guides/install/yarnlock
        return (await spawn(agentExecPath, [lockPath])).stdout.trim()
      }
      return undefined
    }),
    [NPM]: defaultReader,
    [PNPM]: defaultReader,
    [VLT]: defaultReader,
    [YARN_BERRY]: defaultReader,
    [YARN_CLASSIC]: defaultReader
  }
})()

export type GetPackageEnvironmentOptions = {
  cwd?: string | undefined
  onUnknown?: (pkgManager: string | undefined) => void
}

export type PartialPackageEnvironmentDetails = Readonly<{
  agent: Agent
  agentExecPath: string
  agentVersion: SemVer | undefined
  lockName: string | undefined
  lockPath: string | undefined
  lockSrc: string | undefined
  minimumNodeVersion: string
  npmExecPath: string
  pkgJson: EditablePackageJson | undefined
  pkgPath: string | undefined
  supported: boolean
  targets: {
    browser: boolean
    node: boolean
  }
}>

export type PackageEnvironmentDetails = Readonly<{
  agent: Agent
  agentExecPath: string
  agentVersion: SemVer
  lockName: string
  lockPath: string
  lockSrc: string
  minimumNodeVersion: string
  npmExecPath: string
  pkgJson: EditablePackageJson
  pkgPath: string
  supported: boolean
  targets: {
    browser: boolean
    node: boolean
  }
}>

export async function detectPackageEnvironment({
  cwd = process.cwd(),
  onUnknown
}: GetPackageEnvironmentOptions = {}): Promise<
  PackageEnvironmentDetails | PartialPackageEnvironmentDetails
> {
  let lockPath = await findUp(Object.keys(LOCKS), { cwd })
  let lockName = lockPath ? path.basename(lockPath) : undefined
  const isHiddenLockFile = lockName === '.package-lock.json'
  const pkgJsonPath = lockPath
    ? path.resolve(lockPath, `${isHiddenLockFile ? '../' : ''}../package.json`)
    : await findUp('package.json', { cwd })
  const pkgPath =
    pkgJsonPath && existsSync(pkgJsonPath)
      ? path.dirname(pkgJsonPath)
      : undefined
  const editablePkgJson = pkgPath
    ? await readPackageJson(pkgPath, { editable: true })
    : undefined
  const pkgJson = editablePkgJson?.content
  // Read Corepack `packageManager` field in package.json:
  // https://nodejs.org/api/packages.html#packagemanager
  const pkgManager = isNonEmptyString(pkgJson?.packageManager)
    ? pkgJson.packageManager
    : undefined

  let agent: Agent | undefined
  let agentVersion: SemVer | undefined
  if (pkgManager) {
    const atSignIndex = pkgManager.lastIndexOf('@')
    if (atSignIndex !== -1) {
      const name = <Agent>pkgManager.slice(0, atSignIndex)
      const version = pkgManager.slice(atSignIndex + 1)
      if (version && AGENTS.includes(name)) {
        agent = name
        agentVersion = semver.coerce(version) ?? undefined
      }
    }
  }
  if (
    agent === undefined &&
    !isHiddenLockFile &&
    typeof pkgJsonPath === 'string' &&
    typeof lockName === 'string'
  ) {
    agent = <Agent>LOCKS[lockName]
  }
  if (agent === undefined) {
    agent = NPM
    onUnknown?.(pkgManager)
  }
  const agentExecPath = await getAgentExecPath(agent)

  const npmExecPath =
    agent === NPM ? agentExecPath : await getAgentExecPath(NPM)
  if (agentVersion === undefined) {
    agentVersion = await getAgentVersion(agentExecPath, cwd)
  }
  if (agent === YARN_CLASSIC && (agentVersion?.major ?? 0) > 1) {
    agent = YARN_BERRY
  }
  const targets = {
    browser: false,
    node: true
  }
  let lockSrc: string | undefined
  // Lazily access constants.maintainedNodeVersions.
  let minimumNodeVersion = constants.maintainedNodeVersions.last
  if (pkgJson) {
    const browserField = pkgJson.browser
    if (isNonEmptyString(browserField) || isObjectObject(browserField)) {
      targets.browser = true
    }
    const nodeRange = pkgJson.engines?.['node']
    if (isNonEmptyString(nodeRange)) {
      const coerced = semver.coerce(nodeRange)
      if (coerced && semver.lt(coerced, minimumNodeVersion)) {
        minimumNodeVersion = coerced.version
      }
    }
    const browserslistQuery = <string[] | undefined>pkgJson['browserslist']
    if (Array.isArray(browserslistQuery)) {
      const browserslistTargets = browserslist(browserslistQuery)
        .map(s => s.toLowerCase())
        .sort(naturalCompare)
      const browserslistNodeTargets = browserslistTargets
        .filter(v => v.startsWith('node '))
        .map(v => v.slice(5 /*'node '.length*/))
      if (!targets.browser && browserslistTargets.length) {
        targets.browser =
          browserslistTargets.length !== browserslistNodeTargets.length
      }
      if (browserslistNodeTargets.length) {
        const coerced = semver.coerce(browserslistNodeTargets[0])
        if (coerced && semver.lt(coerced, minimumNodeVersion)) {
          minimumNodeVersion = coerced.version
        }
      }
    }
    // Lazily access constants.maintainedNodeVersions.
    targets.node = constants.maintainedNodeVersions.some(v =>
      semver.satisfies(v, `>=${minimumNodeVersion}`)
    )
    lockSrc =
      typeof lockPath === 'string'
        ? await readLockFileByAgent[agent](lockPath, agentExecPath)
        : undefined
  } else {
    lockName = undefined
    lockPath = undefined
  }
  return {
    agent,
    agentExecPath,
    agentVersion,
    lockName,
    lockPath,
    lockSrc,
    minimumNodeVersion,
    npmExecPath,
    pkgJson: editablePkgJson,
    pkgPath,
    supported: targets.browser || targets.node,
    targets
  }
}
