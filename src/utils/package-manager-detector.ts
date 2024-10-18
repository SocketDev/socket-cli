import path from 'node:path'

import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb'
import spawn from '@npmcli/promise-spawn'
import browserslist from 'browserslist'
import semver from 'semver'
import which from 'which'

import { existsSync, findUp, readFileBinary, readFileUtf8 } from './fs'
import { parseJSONObject } from './json'
import { getOwn, isObjectObject } from './objects'
import { isNonEmptyString } from './strings'

import type { Content as PackageJsonContent } from '@npmcli/package-json'

const PNPM_WORKSPACE = 'pnpm-workspace'

export const AGENTS = ['bun', 'npm', 'pnpm', 'yarn'] as const

export type AgentPlusBun = (typeof AGENTS)[number]
export type Agent = Exclude<AgentPlusBun, 'bun'>
export type StringKeyValueObject = { [key: string]: string }

export const LOCKS: Record<string, string> = {
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

const MAINTAINED_NODE_VERSIONS = browserslist('maintained node versions')
  // Trim value, e.g. 'node 22.5.0' to '22.5.0'
  .map(v => v.slice(5))

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
  pkgJson: PackageJsonContent | undefined
  pkgJsonPath: string | undefined
  pkgJsonStr: string | undefined
  supported: boolean
  targets: {
    browser: boolean
    node: boolean
  }
}>

type ReadLockFile = (
  lockPath: string,
  agentExecPath?: string
) => Promise<string | undefined>

const readLockFileByAgent: Record<AgentPlusBun, ReadLockFile> = (() => {
  const wrapReader =
    (
      reader: (
        lockPath: string,
        agentExecPath?: string
      ) => Promise<string | undefined>
    ): ReadLockFile =>
    async (lockPath: string, agentExecPath?: string) => {
      try {
        return await reader(lockPath, agentExecPath)
      } catch {}
      return undefined
    }
  return {
    bun: wrapReader(async (lockPath: string, agentExecPath?: string) => {
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
      return (await spawn(agentExecPath ?? 'bun', [lockPath])).stdout
    }),
    npm: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath)),
    pnpm: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath)),
    yarn: wrapReader(async (lockPath: string) => await readFileUtf8(lockPath))
  }
})()

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
    (isNonEmptyString(getOwn(pkgJson, 'packageManager'))
      ? pkgJson?.['packageManager']
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

  let lockSrc: string | undefined
  const targets = {
    browser: false,
    node: true
  }

  let isPrivate = false
  let isWorkspace = false
  if (pkgJson) {
    const pkgPath = path.dirname(pkgJsonPath!)
    isPrivate = !!pkgJson['private']
    isWorkspace =
      !!pkgJson['workspaces'] ||
      existsSync(path.join(pkgPath, `${PNPM_WORKSPACE}.yaml`)) ||
      existsSync(path.join(pkgPath, `${PNPM_WORKSPACE}.yml`))
    let browser: boolean | undefined
    let node: boolean | undefined
    const browserField = getOwn(pkgJson, 'browser')
    if (isNonEmptyString(browserField) || isObjectObject(browserField)) {
      browser = true
    }
    const nodeRange = getOwn(pkgJson['engines'], 'node')
    if (isNonEmptyString(nodeRange)) {
      node = MAINTAINED_NODE_VERSIONS.some(v => semver.satisfies(v, nodeRange))
    }
    const browserslistQuery = getOwn(pkgJson, 'browserslist')
    if (Array.isArray(browserslistQuery)) {
      const browserslistTargets = browserslist(browserslistQuery)
      const browserslistNodeTargets = browserslistTargets
        .filter(v => v.startsWith('node '))
        .map(v => v.slice(5))
      if (browser === undefined && browserslistTargets.length) {
        browser = browserslistTargets.length !== browserslistNodeTargets.length
      }
      if (node === undefined && browserslistNodeTargets.length) {
        node = MAINTAINED_NODE_VERSIONS.some(r =>
          browserslistNodeTargets.some(v => semver.satisfies(v, `^${r}`))
        )
      }
    }
    if (browser !== undefined) {
      targets.browser = browser
    }
    if (node !== undefined) {
      targets.node = node
    }
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
    pkgJson,
    pkgJsonPath,
    pkgJsonStr,
    supported: targets.browser || targets.node,
    targets
  }
}
