import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import browserslist from 'browserslist'
import semver from 'semver'
import which from 'which'

import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb/index.cjs'
import { Logger } from '@socketsecurity/registry/lib/logger'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { cmdPrefixMessage } from './cmd'
import { findUp, readFileBinary, readFileUtf8 } from './fs'
import constants from '../constants'

import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'
import type { SemVer } from 'semver'

const {
  BINARY_LOCK_EXT,
  BUN,
  HIDDEN_PACKAGE_LOCK_JSON,
  LOCK_EXT,
  NPM,
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  PACKAGE_JSON,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC
} = constants

export const AGENTS = [BUN, NPM, PNPM, YARN_BERRY, YARN_CLASSIC, VLT] as const
export type Agent = (typeof AGENTS)[number]
export type StringKeyValueObject = { [key: string]: string }

const binByAgent = new Map<Agent, string>([
  [BUN, BUN],
  [NPM, NPM],
  [PNPM, PNPM],
  [YARN_BERRY, YARN],
  [YARN_CLASSIC, YARN],
  [VLT, VLT]
])

async function getAgentExecPath(agent: Agent): Promise<string> {
  const binName = binByAgent.get(agent)!
  return (await which(binName, { nothrow: true })) ?? binName
}

async function getAgentVersion(
  agentExecPath: string,
  cwd: string
): Promise<SemVer | undefined> {
  let result
  try {
    result =
      // Coerce version output into a valid semver version by passing it through
      // semver.coerce which strips leading v's, carets (^), comparators (<,<=,>,>=,=),
      // and tildes (~).
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

const readLockFileByAgent: Map<Agent, ReadLockFile> = (() => {
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

  return new Map([
    [
      BUN,
      wrapReader(async (lockPath: string, agentExecPath: string) => {
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
      })
    ],
    [NPM, defaultReader],
    [PNPM, defaultReader],
    [VLT, defaultReader],
    [YARN_BERRY, defaultReader],
    [YARN_CLASSIC, defaultReader]
  ])
})()

export type DetectOptions = {
  cwd?: string | undefined
  onUnknown?: (pkgManager: string | undefined) => void
}

type EnvBase = {
  agent: Agent
  agentExecPath: string
  agentSupported: boolean
  features: {
    // Fixed by https://github.com/npm/cli/pull/8089.
    // Landed in npm v11.2.0.
    npmBuggyOverrides: boolean
  }
  nodeSupported: boolean
  nodeVersion: SemVer
  npmExecPath: string
  pkgRequirements: {
    agent: string
    node: string
  }
  pkgSupports: {
    agent: boolean
    node: boolean
  }
}

export type EnvDetails = Readonly<
  Remap<
    EnvBase & {
      agentVersion: SemVer
      lockName: string
      lockPath: string
      lockSrc: string
      pkgJson: EditablePackageJson
      pkgPath: string
    }
  >
>

export type PartialEnvDetails = Readonly<
  Remap<
    EnvBase & {
      agentVersion: SemVer | undefined
      lockName: string | undefined
      lockPath: string | undefined
      lockSrc: string | undefined
      pkgJson: EditablePackageJson | undefined
      pkgPath: string | undefined
    }
  >
>

export async function detectPackageEnvironment({
  cwd = process.cwd(),
  onUnknown
}: DetectOptions = {}): Promise<EnvDetails | PartialEnvDetails> {
  let lockPath = await findUp(Object.keys(LOCKS), { cwd })
  let lockName = lockPath ? path.basename(lockPath) : undefined
  const isHiddenLockFile = lockName === HIDDEN_PACKAGE_LOCK_JSON
  const pkgJsonPath = lockPath
    ? path.resolve(
        lockPath,
        `${isHiddenLockFile ? '../' : ''}../${PACKAGE_JSON}`
      )
    : await findUp(PACKAGE_JSON, { cwd })
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
    // A valid "packageManager" field value is "<package manager name>@<version>".
    // https://nodejs.org/api/packages.html#packagemanager
    const atSignIndex = pkgManager.lastIndexOf('@')
    if (atSignIndex !== -1) {
      const name = pkgManager.slice(0, atSignIndex) as Agent
      const version = pkgManager.slice(atSignIndex + 1)
      if (version && AGENTS.includes(name)) {
        agent = name
      }
    }
  }
  if (
    agent === undefined &&
    !isHiddenLockFile &&
    typeof pkgJsonPath === 'string' &&
    typeof lockName === 'string'
  ) {
    agent = LOCKS[lockName] as Agent
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
  // Lazily access constants.maintainedNodeVersions.
  const { maintainedNodeVersions } = constants
  // Lazily access constants.minimumVersionByAgent.
  const minSupportedAgentVersion = constants.minimumVersionByAgent.get(agent)!
  const minSupportedNodeVersion = maintainedNodeVersions.last
  const nodeVersion = semver.coerce(process.version)!
  let lockSrc: string | undefined
  let pkgAgentRange: string | undefined
  let pkgNodeRange: string | undefined
  let pkgMinAgentVersion = minSupportedAgentVersion
  let pkgMinNodeVersion = minSupportedNodeVersion
  if (pkgJson) {
    const { engines } = pkgJson
    const engineAgentRange = engines?.[agent]
    const engineNodeRange = engines?.['node']
    if (isNonEmptyString(engineAgentRange)) {
      pkgAgentRange = engineAgentRange
      // Roughly check agent range as semver.coerce will strip leading
      // v's, carets (^), comparators (<,<=,>,>=,=), and tildes (~).
      const coerced = semver.coerce(pkgAgentRange)
      if (coerced && semver.lt(coerced, pkgMinAgentVersion)) {
        pkgMinAgentVersion = coerced.version
      }
    }
    if (isNonEmptyString(engineNodeRange)) {
      pkgNodeRange = engineNodeRange
      // Roughly check Node range as semver.coerce will strip leading
      // v's, carets (^), comparators (<,<=,>,>=,=), and tildes (~).
      const coerced = semver.coerce(pkgNodeRange)
      if (coerced && semver.lt(coerced, pkgMinNodeVersion)) {
        pkgMinNodeVersion = coerced.version
      }
    }
    const browserslistQuery = pkgJson['browserslist'] as string[] | undefined
    if (Array.isArray(browserslistQuery)) {
      // List Node targets in ascending version order.
      const browserslistNodeTargets = browserslist(browserslistQuery)
        .filter(v => /^node /i.test(v))
        .map(v => v.slice(5 /*'node '.length*/))
        .sort(naturalCompare)
      if (browserslistNodeTargets.length) {
        // browserslistNodeTargets[0] is the lowest Node target version.
        const coerced = semver.coerce(browserslistNodeTargets[0])
        if (coerced && semver.lt(coerced, pkgMinNodeVersion)) {
          pkgMinNodeVersion = coerced.version
        }
      }
    }
    lockSrc =
      typeof lockPath === 'string'
        ? await readLockFileByAgent.get(agent)!(lockPath, agentExecPath)
        : undefined
  } else {
    lockName = undefined
    lockPath = undefined
  }
  // Does the system agent version meet our minimum supported agent version?
  const agentSupported =
    !!agentVersion &&
    semver.satisfies(agentVersion, `>=${minSupportedAgentVersion}`)

  // Does the system Node version meet our minimum supported Node version?
  const nodeSupported = semver.satisfies(
    nodeVersion,
    `>=${minSupportedNodeVersion}`
  )

  const npmBuggyOverrides =
    agent === NPM &&
    !!agentVersion &&
    semver.lt(agentVersion, NPM_BUGGY_OVERRIDES_PATCHED_VERSION)

  return {
    agent,
    agentExecPath,
    agentSupported,
    agentVersion,
    features: { npmBuggyOverrides },
    lockName,
    lockPath,
    lockSrc,
    nodeSupported,
    nodeVersion,
    npmExecPath,
    pkgJson: editablePkgJson,
    pkgPath,
    pkgRequirements: {
      agent: pkgAgentRange ?? `>=${pkgMinAgentVersion}`,
      node: pkgNodeRange ?? `>=${pkgMinNodeVersion}`
    },
    pkgSupports: {
      // Does our minimum supported agent version meet the package's requirements?
      agent: semver.satisfies(
        minSupportedAgentVersion,
        `>=${pkgMinAgentVersion}`
      ),
      // Does our supported Node versions meet the package's requirements?
      node: maintainedNodeVersions.some(v =>
        semver.satisfies(v, `>=${pkgMinNodeVersion}`)
      )
    }
  }
}

export type DetectAndValidateOptions = {
  cmdName?: string | undefined
  logger?: Logger | undefined
  prod?: boolean | undefined
}
export async function detectAndValidatePackageEnvironment(
  cwd: string,
  options?: DetectAndValidateOptions | undefined
): Promise<void | EnvDetails> {
  const {
    cmdName = '',
    logger,
    prod
  } = {
    __proto__: null,
    ...options
  } as DetectAndValidateOptions
  const details = await detectPackageEnvironment({
    cwd,
    onUnknown(pkgManager: string | undefined) {
      logger?.warn(
        cmdPrefixMessage(
          cmdName,
          `Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}, defaulting to npm`
        )
      )
    }
  })
  const { agent, nodeVersion, pkgRequirements } = details
  const agentVersion = details.agentVersion ?? 'unknown'
  if (!details.agentSupported) {
    const minVersion = constants.minimumVersionByAgent.get(agent)!
    logger?.fail(
      cmdPrefixMessage(
        cmdName,
        `Requires ${agent} >=${minVersion}. Current version: ${agentVersion}.`
      )
    )
    return
  }
  if (!details.nodeSupported) {
    const minVersion = constants.maintainedNodeVersions.last
    logger?.fail(
      cmdPrefixMessage(
        cmdName,
        `Requires Node >=${minVersion}. Current version: ${nodeVersion}.`
      )
    )
    return
  }
  if (!details.pkgSupports.agent) {
    logger?.fail(
      cmdPrefixMessage(
        cmdName,
        `Package engine "${agent}" requires ${pkgRequirements.agent}. Current version: ${agentVersion}`
      )
    )
    return
  }
  if (!details.pkgSupports.node) {
    logger?.fail(
      cmdPrefixMessage(
        cmdName,
        `Package engine "node" requires ${pkgRequirements.node}. Current version: ${nodeVersion}`
      )
    )
    return
  }
  if (agent === VLT) {
    logger?.fail(
      cmdPrefixMessage(
        cmdName,
        `${agent} does not support overrides. Soon, though ⚡`
      )
    )
    return
  }
  const lockName = details.lockName ?? 'lock file'
  if (details.lockName === undefined || details.lockSrc === undefined) {
    logger?.fail(cmdPrefixMessage(cmdName, `No ${lockName} found`))
    return
  }
  if (details.lockSrc.trim() === '') {
    logger?.fail(cmdPrefixMessage(cmdName, `${lockName} is empty`))
    return
  }
  if (details.pkgPath === undefined) {
    logger?.fail(cmdPrefixMessage(cmdName, `No ${PACKAGE_JSON} found`))
    return
  }
  if (prod && (agent === BUN || agent === YARN_BERRY)) {
    logger?.fail(
      cmdPrefixMessage(
        cmdName,
        `--prod not supported for ${agent}${agentVersion ? `@${agentVersion}` : ''}`
      )
    )
    return
  }
  if (
    details.lockPath &&
    path.relative(cwd, details.lockPath).startsWith('.')
  ) {
    logger?.warn(
      cmdPrefixMessage(
        cmdName,
        `Package ${lockName} found at ${details.lockPath}`
      )
    )
  }
  return details as EnvDetails
}
