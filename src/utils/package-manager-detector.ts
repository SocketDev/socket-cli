import path from 'node:path'

import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb'
import spawn from '@npmcli/promise-spawn'
import browserslist from 'browserslist'
import semver from 'semver'
import which from 'which'

import { existsSync, findUp, readFileBinary, readFileUtf8 } from './fs'
import { parseJSONObject } from './json'
import { isObjectObject } from './objects'
import { isNonEmptyString } from './strings'

import type { Content as PackageJsonContent } from '@npmcli/package-json'

export const AGENTS = ['bun', 'npm', 'pnpm', 'yarn'] as const
export type AgentPlusBun = (typeof AGENTS)[number]
export type Agent = Exclude<AgentPlusBun, 'bun'>
export type StringKeyValueObject = { [key: string]: string }

const numericCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base'
})
const { compare: alphaNumericComparator } = numericCollator

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

const LOCKS: Record<string, string> = {
  'bun.lockb': 'bun',
  'pnpm-lock.yaml': 'pnpm',
  'pnpm-lock.yml': 'pnpm',
  'yarn.lock': 'yarn',
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

const PNPM_WORKSPACE = 'pnpm-workspace'

type ReadLockFile = (
  lockPath: string,
  agentExecPath: string
) => Promise<string | undefined>

const readLockFileByAgent: Record<AgentPlusBun, ReadLockFile> = (() => {
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
      return (await spawn(agentExecPath, [lockPath])).stdout
    }),
    npm: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath)),
    pnpm: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath)),
    yarn: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath))
  }
})()

export type DetectOptions = {
  cwd?: string
  onUnknown?: (pkgManager: string | undefined) => void
}

export type DetectResult = Readonly<{
  agent: AgentPlusBun
  agentExecPath: string
  agentVersion: string | undefined
  isPrivate: boolean
  isWorkspace: boolean
  lockPath: string | undefined
  lockSrc: string | undefined
  minimumNodeVersion: string
  pkgJson: PackageJsonContent | undefined
  pkgJsonPath: string | undefined
  pkgJsonStr: string | undefined
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
  // Read Corepack `packageManager` field in package.json:
  // https://nodejs.org/api/packages.html#packagemanager
  const pkgJsonStr = existsSync(pkgJsonPath)
    ? await readFileUtf8(pkgJsonPath)
    : undefined
  const pkgJson =
    typeof pkgJsonStr === 'string'
      ? (parseJSONObject(pkgJsonStr) ?? undefined)
      : undefined
  const pkgManager = <string | undefined>(
    (isNonEmptyString(pkgJson?.['packageManager'])
      ? pkgJson['packageManager']
      : undefined)
  )

  let agent: AgentPlusBun | undefined
  let agentVersion: string | undefined
  if (pkgManager) {
    const atSignIndex = pkgManager.lastIndexOf('@')
    if (atSignIndex !== -1) {
      const name = <AgentPlusBun>pkgManager.slice(0, atSignIndex)
      const version = pkgManager.slice(atSignIndex + 1)
      if (version && AGENTS.includes(name)) {
        agent = name
        agentVersion = version
      }
    }
  }
  if (
    agent === undefined &&
    !isHiddenLockFile &&
    typeof pkgJsonPath === 'string' &&
    typeof lockPath === 'string'
  ) {
    agent = <AgentPlusBun>LOCKS[path.basename(lockPath)]
  }
  if (agent === undefined) {
    agent = 'npm'
    onUnknown?.(pkgManager)
  }

  const agentExecPath = (await which(agent, { nothrow: true })) ?? agent
  const targets = {
    browser: false,
    node: true
  }
  let lockSrc: string | undefined
  let isPrivate = false
  let isWorkspace = false
  let minimumNodeVersion = maintainedNodeVersions.previous
  if (pkgJson) {
    const pkgPath = path.dirname(pkgJsonPath!)
    isPrivate = !!pkgJson['private']
    isWorkspace =
      !!pkgJson['workspaces'] ||
      existsSync(path.join(pkgPath, `${PNPM_WORKSPACE}.yaml`)) ||
      existsSync(path.join(pkgPath, `${PNPM_WORKSPACE}.yml`))
    const browserField = pkgJson['browser']
    if (isNonEmptyString(browserField) || isObjectObject(browserField)) {
      targets.browser = true
    }
    const nodeRange = (pkgJson as any)['engines']?.['node']
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
    isPrivate,
    isWorkspace,
    lockPath,
    lockSrc,
    minimumNodeVersion,
    pkgJson,
    pkgJsonPath,
    pkgJsonStr,
    supported: targets.browser || targets.node,
    targets
  }
}
