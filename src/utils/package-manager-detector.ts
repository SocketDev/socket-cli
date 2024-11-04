import path from 'node:path'

import EditablePackageJson from '@npmcli/package-json'
import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb'
import spawn from '@npmcli/promise-spawn'
import browserslist from 'browserslist'
import semver from 'semver'
import which from 'which'

import { existsSync, findUp, readFileBinary, readFileUtf8 } from './fs'
import { isObjectObject } from './objects'
import { isNonEmptyString } from './strings'

import type { Content as PackageJsonContent } from '@npmcli/package-json'
import type { SemVer } from 'semver'

export const AGENTS = [
  'bun',
  'npm',
  'pnpm',
  'yarn/berry',
  'yarn/classic'
] as const
export type Agent = (typeof AGENTS)[number]
export type StringKeyValueObject = { [key: string]: string }

const numericCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})
const { compare: alphaNumericComparator } = numericCollator

async function getAgentExecPath(agent: Agent): Promise<string> {
  return (await which(agent, { nothrow: true })) ?? agent
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

const maintainedNodeVersions = (() => {
  // Under the hood browserlist uses the node-releases package which is out of date:
  // https://github.com/chicoxyzzy/node-releases/issues/37
  // So we maintain a manual version list for now.
  // https://nodejs.org/en/about/previous-releases#looking-for-latest-release-of-a-version-branch
  const manualPrev = '18.20.4'
  const manualCurr = '20.18.0'
  const manualNext = '22.10.0'

  const query = browserslist('maintained node versions')
    // Trim value, e.g. 'node 22.5.0' to '22.5.0'.
    .map(s => s.slice(5 /*'node '.length*/))
    // Sort ascending.
    .toSorted(alphaNumericComparator)
  const queryPrev = query.at(0) ?? manualPrev
  const queryCurr = query.at(1) ?? manualCurr
  const queryNext = query.at(2) ?? manualNext

  const previous = semver.maxSatisfying(
    [queryPrev, manualPrev],
    `^${semver.major(queryPrev)}`
  )!
  const current = semver.maxSatisfying(
    [queryCurr, manualCurr],
    `^${semver.major(queryCurr)}`
  )!
  const next = semver.maxSatisfying(
    [queryNext, manualNext],
    `^${semver.major(queryNext)}`
  )!
  return Object.freeze(
    Object.assign([previous, current, next], {
      previous,
      current,
      next
    })
  )
})()

const LOCKS: Record<string, Agent> = {
  'bun.lockb': 'bun',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-lock.yml': 'pnpm',
  'yarn.lock': 'yarn/classic',
  // If both package-lock.json and npm-shrinkwrap.json are present in the root
  // of a project, npm-shrinkwrap.json will take precedence and package-lock.json
  // will be ignored.
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#package-lockjson-vs-npm-shrinkwrapjson
  'npm-shrinkwrap.json': 'npm',
  'package-lock.json': 'npm',
  // Look for a hidden lock file if .npmrc has package-lock=false:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#hidden-lockfiles
  //
  // Unlike the other LOCKS keys this key contains a directory AND filename so
  // it has to be handled differently.
  'node_modules/.package-lock.json': 'npm'
}

type ReadLockFile = (
  lockPath: string,
  agentExecPath: string
) => Promise<string | undefined>

const readLockFileByAgent: Record<Agent, ReadLockFile> = (() => {
  function wrapReader(
    reader: (
      lockPath: string,
      agentExecPath: string
    ) => Promise<string | undefined>
  ): ReadLockFile {
    return async (lockPath: string, agentExecPath: string) => {
      try {
        return await reader(lockPath, agentExecPath)
      } catch {}
      return undefined
    }
  }
  return {
    bun: wrapReader(async (lockPath: string, agentExecPath: string) => {
      let lockBuffer: Buffer | undefined
      try {
        lockBuffer = <Buffer>await readFileBinary(lockPath)
      } catch {
        return undefined
      }
      try {
        return <string>parseBunLockb(lockBuffer)
      } catch {}
      // To print a Yarn lockfile to your console without writing it to disk use `bun bun.lockb`.
      // https://bun.sh/guides/install/yarnlock
      return (await spawn(agentExecPath, [lockPath])).stdout.trim()
    }),
    npm: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath)),
    pnpm: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath)),
    'yarn/berry': wrapReader(
      async (lockPath: string) => await readFileUtf8(lockPath)
    ),
    'yarn/classic': wrapReader(
      async (lockPath: string) => await readFileUtf8(lockPath)
    )
  }
})()

export type DetectOptions = {
  cwd?: string
  onUnknown?: (pkgManager: string | undefined) => void
}

export type DetectResult = Readonly<{
  agent: Agent
  agentExecPath: string
  agentVersion: SemVer | undefined
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

export async function detect({
  cwd = process.cwd(),
  onUnknown
}: DetectOptions = {}): Promise<DetectResult> {
  let lockPath = await findUp(Object.keys(LOCKS), { cwd })
  const isHiddenLockFile = lockPath?.endsWith('.package-lock.json') ?? false
  const pkgJsonPath = lockPath
    ? path.resolve(lockPath, `${isHiddenLockFile ? '../' : ''}../package.json`)
    : await findUp('package.json', { cwd })
  const pkgPath = existsSync(pkgJsonPath)
    ? path.dirname(pkgJsonPath)
    : undefined
  const editablePkgJson = pkgPath
    ? await EditablePackageJson.load(pkgPath)
    : undefined
  const pkgJson: Readonly<PackageJsonContent> | undefined =
    editablePkgJson?.content
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
    typeof lockPath === 'string'
  ) {
    agent = <Agent>LOCKS[path.basename(lockPath)]
  }
  if (agent === undefined) {
    agent = 'npm'
    onUnknown?.(pkgManager)
  }
  const agentExecPath = await getAgentExecPath(agent)

  const npmExecPath =
    agent === 'npm' ? agentExecPath : await getAgentExecPath('npm')
  if (agentVersion === undefined) {
    agentVersion = await getAgentVersion(agentExecPath, cwd)
  }
  if (agent === 'yarn/classic' && (agentVersion?.major ?? 0) > 1) {
    agent = 'yarn/berry'
  }
  const targets = {
    browser: false,
    node: true
  }
  let lockSrc: string | undefined
  let minimumNodeVersion = maintainedNodeVersions.previous
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
        .toSorted(alphaNumericComparator)
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
    targets.node = maintainedNodeVersions.some(v =>
      semver.satisfies(v, `>=${minimumNodeVersion}`)
    )
    lockSrc =
      typeof lockPath === 'string'
        ? await readLockFileByAgent[agent](lockPath, agentExecPath)
        : undefined
  } else {
    lockPath = undefined
  }
  return <DetectResult>{
    agent,
    agentExecPath,
    agentVersion,
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
