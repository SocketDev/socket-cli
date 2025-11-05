/**
 * Package environment detection utilities for Socket CLI.
 * Analyzes project environment and package manager configuration.
 *
 * Key Functions:
 * - getPackageEnvironment: Detect package manager and project details
 * - makeConcurrentExecLimit: Calculate concurrent execution limits
 *
 * Environment Detection:
 * - Detects npm, pnpm, yarn, bun package managers
 * - Analyzes lockfiles for version information
 * - Determines Node.js and engine requirements
 * - Identifies workspace configurations
 *
 * Features:
 * - Browser target detection via browserslist
 * - Engine compatibility checking
 * - Package manager version detection
 * - Workspace and monorepo support
 *
 * Usage:
 * - Auto-detecting appropriate package manager
 * - Validating environment compatibility
 * - Configuring concurrent execution limits
 */

import { existsSync } from 'node:fs'
import path from 'node:path'

import browserslist from 'browserslist'
import semver from 'semver'

import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb/index.cjs'
import { whichBin } from '@socketsecurity/lib-internal/bin'
import {
  BUN,
  BUN_LOCK,
  BUN_LOCKB,
  NPM,
  NPM_SHRINKWRAP_JSON,
  PACKAGE_LOCK_JSON,
  PNPM,
  PNPM_LOCK_YAML,
  VLT,
  VLT_LOCK_JSON,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
  YARN_LOCK,
} from '@socketsecurity/lib-internal/constants/agents'
import { getMaintainedNodeVersions } from '@socketsecurity/lib-internal/constants/node'
import { WIN32 } from '@socketsecurity/lib-internal/constants/platform'
import { debugDirNs, debugNs } from '@socketsecurity/lib-internal/debug'
import { readFileBinary, readFileUtf8 } from '@socketsecurity/lib-internal/fs'
import {
  readPackageJson,
  toEditablePackageJson,
} from '@socketsecurity/lib-internal/packages'
import { naturalCompare } from '@socketsecurity/lib-internal/sorts'
import { spawn } from '@socketsecurity/lib-internal/spawn'
import { isNonEmptyString } from '@socketsecurity/lib-internal/strings'

import {
  getMinimumVersionByAgent,
  getNpmExecPath,
  getPnpmExecPath,
} from '../../constants/agents.mts'
import { FLAG_VERSION } from '../../constants/cli.mts'
import ENV from '../../constants/env.mts'
import {
  EXT_LOCK,
  EXT_LOCKB,
  NODE_MODULES,
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  PACKAGE_JSON,
} from '../../constants/packages.mts'
import { findUp } from '../fs/find-up.mts'
import { cmdPrefixMessage } from '../process/cmd.mts'

import type { CResult } from '../../types.mjs'
import type { Logger } from '@socketsecurity/lib-internal/logger'
import type { Remap } from '@socketsecurity/lib-internal/objects'
import type { EditablePackageJson } from '@socketsecurity/lib-internal/packages'
import type { SemVer } from 'semver'

const DOT_PACKAGE_LOCK_JSON = '.package-lock.json'

export const AGENTS = [BUN, NPM, PNPM, YARN_BERRY, YARN_CLASSIC, VLT] as const

const binByAgent = new Map<Agent, string>([
  [BUN, BUN],
  [NPM, NPM],
  [PNPM, PNPM],
  [YARN_BERRY, YARN],
  [YARN_CLASSIC, YARN],
  [VLT, VLT],
])

export type Agent = (typeof AGENTS)[number]

export type EnvBase = {
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
      editablePkgJson: EditablePackageJson
      lockName: string
      lockPath: string
      lockSrc: string
      pkgPath: string
    }
  >
>

export type DetectAndValidateOptions = {
  cmdName?: string | undefined
  logger?: Logger | undefined
  prod?: boolean | undefined
}

export type DetectOptions = {
  cwd?: string | undefined
  onUnknown?: (pkgManager: string | undefined) => void
}

export type PartialEnvDetails = Readonly<
  Remap<
    EnvBase & {
      agentVersion: SemVer | undefined
      editablePkgJson: EditablePackageJson | undefined
      lockName: string | undefined
      lockPath: string | undefined
      lockSrc: string | undefined
      pkgPath: string | undefined
    }
  >
>

export type ReadLockFile =
  | ((lockPath: string) => Promise<string | Buffer | undefined>)
  | ((
      lockPath: string,
      agentExecPath: string,
    ) => Promise<string | Buffer | undefined>)
  | ((
      lockPath: string,
      agentExecPath: string,
      cwd: string,
    ) => Promise<string | Buffer | undefined>)

const readLockFileByAgent: Map<Agent, ReadLockFile> = (() => {
  function wrapReader<T extends (...args: any[]) => Promise<any>>(
    reader: T,
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
    async (lockPath: string) => await readFileUtf8(lockPath),
  )

  return new Map([
    [
      BUN,
      wrapReader(
        async (
          lockPath: string,
          agentExecPath: string,
          cwd = process.cwd(),
        ) => {
          const ext = path.extname(lockPath)
          if (ext === EXT_LOCK) {
            return await defaultReader(lockPath)
          }
          if (ext === EXT_LOCKB) {
            const lockBuffer = await binaryReader(lockPath)
            if (lockBuffer) {
              try {
                return parseBunLockb(lockBuffer)
              } catch {}
            }
            // To print a Yarn lockfile to your console without writing it to disk
            // use `bun bun.lockb`.
            // https://bun.sh/guides/install/yarnlock
            return (
              await spawn(agentExecPath, [lockPath], {
                cwd,
                // On Windows, bun is often a .cmd file that requires shell execution.
                // The spawn function from @socketsecurity/registry will handle this properly
                // when shell is true.
                shell: WIN32,
              })
            ).stdout
          }
          return undefined
        },
      ),
    ],
    [NPM, defaultReader],
    [PNPM, defaultReader],
    [VLT, defaultReader],
    [YARN_BERRY, defaultReader],
    [YARN_CLASSIC, defaultReader],
  ])
})()

// The order of LOCKS properties IS significant as it affects iteration order.
const LOCKS: Record<string, Agent> = {
  [BUN_LOCK]: BUN,
  [BUN_LOCKB]: BUN,
  // If both package-lock.json and npm-shrinkwrap.json are present in the root
  // of a project, npm-shrinkwrap.json will take precedence and package-lock.json
  // will be ignored.
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#package-lockjson-vs-npm-shrinkwrapjson
  [NPM_SHRINKWRAP_JSON]: NPM,
  [PACKAGE_LOCK_JSON]: NPM,
  [PNPM_LOCK_YAML]: PNPM,
  [YARN_LOCK]: YARN_CLASSIC,
  [VLT_LOCK_JSON]: VLT,
  // Lastly, look for a hidden lockfile which is present if .npmrc has package-lock=false:
  // https://docs.npmjs.com/cli/v10/configuring-npm/package-lock-json#hidden-lockfiles
  //
  // Unlike the other LOCKS keys this key contains a directory AND filename so
  // it has to be handled differently.
  [`${NODE_MODULES}/${DOT_PACKAGE_LOCK_JSON}`]: NPM,
}

async function getAgentExecPath(agent: Agent): Promise<string> {
  const binName = binByAgent.get(agent)!
  if (binName === NPM) {
    // Try to use getNpmExecPath() first, but verify it exists.
    const npmPath = await getNpmExecPath()
    if (existsSync(npmPath)) {
      return npmPath
    }
    // Fall back to whichBin.
    const whichResult = await whichBin(binName, { nothrow: true })
    return (
      (Array.isArray(whichResult) ? whichResult[0] : whichResult) ?? binName
    )
  }
  if (binName === PNPM) {
    // Try to use getPnpmExecPath() first, but verify it exists.
    const pnpmPath = await getPnpmExecPath()
    if (existsSync(pnpmPath)) {
      return pnpmPath
    }
    // Fall back to whichBin.
    const whichResult = await whichBin(binName, { nothrow: true })
    return (
      (Array.isArray(whichResult) ? whichResult[0] : whichResult) ?? binName
    )
  }
  const whichResult = await whichBin(binName, { nothrow: true })
  return (Array.isArray(whichResult) ? whichResult[0] : whichResult) ?? binName
}

async function getAgentVersion(
  agent: Agent,
  agentExecPath: string,
  cwd: string,
): Promise<SemVer | undefined> {
  let result: any
  const quotedCmd = `\`${agent} ${FLAG_VERSION}\``
  debugNs('stdio', `spawn: ${quotedCmd}`)
  try {
    result =
      // Coerce version output into a valid semver version by passing it through
      // semver.coerce which strips leading v's, carets (^), comparators (<,<=,>,>=,=),
      // and tildes (~).
      semver.coerce(
        // All package managers support the "--version" flag.
        await (async () => {
          const spawnResult = await spawn(agentExecPath, [FLAG_VERSION], {
            cwd,
            // On Windows, package managers are often .cmd files that require shell execution.
            // The spawn function from @socketsecurity/registry will handle this properly
            // when shell is true.
            shell: WIN32,
          })
          return spawnResult.stdout?.toString() ?? ''
        })(),
      ) ?? undefined
  } catch (e) {
    debugNs('error', `Package manager command failed: ${quotedCmd}`)
    debugDirNs('inspect', { cmd: quotedCmd })
    debugDirNs('error', e)
  }
  return result
}

export async function detectPackageEnvironment({
  cwd = process.cwd(),
  onUnknown,
}: DetectOptions = {}): Promise<EnvDetails | PartialEnvDetails> {
  let lockPath = await findUp(Object.keys(LOCKS), { cwd })
  let lockName = lockPath ? path.basename(lockPath) : undefined
  const isHiddenLockFile = lockName === DOT_PACKAGE_LOCK_JSON
  const pkgJsonPath = lockPath
    ? path.resolve(
        lockPath,
        `${isHiddenLockFile ? '../' : ''}../${PACKAGE_JSON}`,
      )
    : await findUp(PACKAGE_JSON, { cwd })
  const pkgPath =
    pkgJsonPath && existsSync(pkgJsonPath)
      ? path.dirname(pkgJsonPath)
      : undefined
  const pkgJson = pkgPath ? await readPackageJson(pkgPath) : undefined
  const editablePkgJson = (
    pkgJson ? await toEditablePackageJson(pkgJson) : undefined
  ) as EditablePackageJson | undefined
  // Read Corepack `packageManager` field in package.json:
  // https://nodejs.org/api/packages.html#packagemanager
  const pkgManager = isNonEmptyString(editablePkgJson?.content?.packageManager)
    ? editablePkgJson?.content.packageManager
    : undefined

  let agent: Agent | undefined
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
  const agentVersion = await getAgentVersion(agent, agentExecPath, cwd)
  if (agent === YARN_CLASSIC && (agentVersion?.major ?? 0) > 1) {
    agent = YARN_BERRY
  }
  const maintainedNodeVersions = getMaintainedNodeVersions()
  const minSupportedAgentVersion = getMinimumVersionByAgent(agent)
  const minSupportedNodeMajor = semver.major(maintainedNodeVersions.last)
  const minSupportedNodeVersion = `${minSupportedNodeMajor}.0.0`
  const minSupportedNodeRange = `>=${minSupportedNodeMajor}`
  const nodeVersion = semver.coerce(process.version)!
  let lockSrc: string | undefined
  let pkgAgentRange: string | undefined
  let pkgNodeRange: string | undefined
  let pkgMinAgentVersion = minSupportedAgentVersion
  let pkgMinNodeVersion = minSupportedNodeVersion
  if (editablePkgJson?.content) {
    const { engines } = editablePkgJson.content
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
    const browserslistQuery = editablePkgJson.content['browserslist'] as
      | string[]
      | undefined
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
    const rawLockSrc =
      typeof lockPath === 'string'
        ? await readLockFileByAgent.get(agent)?.(lockPath, agentExecPath, cwd)
        : undefined
    lockSrc =
      typeof rawLockSrc === 'string'
        ? rawLockSrc
        : rawLockSrc instanceof Buffer
          ? rawLockSrc.toString()
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
  const nodeSupported = semver.satisfies(nodeVersion, minSupportedNodeRange)

  const npmExecPath =
    agent === NPM ? agentExecPath : await getAgentExecPath(NPM)
  const npmBuggyOverrides =
    agent === NPM &&
    !!agentVersion &&
    semver.lt(agentVersion, NPM_BUGGY_OVERRIDES_PATCHED_VERSION)

  const pkgMinAgentRange = `>=${pkgMinAgentVersion}`
  const pkgMinNodeRange = `>=${semver.major(pkgMinNodeVersion)}`

  return {
    agent,
    agentExecPath,
    agentSupported,
    agentVersion,
    editablePkgJson,
    features: { npmBuggyOverrides },
    lockName,
    lockPath,
    lockSrc,
    nodeSupported,
    nodeVersion,
    npmExecPath,
    pkgPath,
    pkgRequirements: {
      agent: pkgAgentRange ?? pkgMinAgentRange,
      node: pkgNodeRange ?? pkgMinNodeRange,
    },
    pkgSupports: {
      // Does our minimum supported agent version meet the package's requirements?
      agent: semver.satisfies(minSupportedAgentVersion, pkgMinAgentRange),
      // Does our supported Node versions meet the package's requirements?
      node: maintainedNodeVersions.some((v: string) =>
        semver.satisfies(v, pkgMinNodeRange),
      ),
    },
  }
}

export async function detectAndValidatePackageEnvironment(
  cwd: string,
  options?: DetectAndValidateOptions | undefined,
): Promise<CResult<EnvDetails>> {
  const {
    cmdName = '',
    logger,
    prod,
  } = {
    __proto__: null,
    ...options,
  } as DetectAndValidateOptions
  const details = await detectPackageEnvironment({
    cwd,
    onUnknown(pkgManager: string | undefined) {
      logger?.warn(
        cmdPrefixMessage(
          cmdName,
          `Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}, defaulting to ${NPM}`,
        ),
      )
    },
  })
  const { agent, nodeVersion, pkgRequirements } = details
  const agentVersion = details.agentVersion ?? 'unknown'
  if (!details.agentSupported) {
    const minVersion = getMinimumVersionByAgent(agent)
    return {
      ok: false,
      message: 'Version mismatch',
      cause: cmdPrefixMessage(
        cmdName,
        `Requires ${agent} >=${minVersion}. Current version: ${agentVersion}.`,
      ),
    }
  }
  if (!details.nodeSupported) {
    const minVersion = getMaintainedNodeVersions().last
    return {
      ok: false,
      message: 'Version mismatch',
      cause: cmdPrefixMessage(
        cmdName,
        `Requires Node >=${minVersion}. Current version: ${nodeVersion}.`,
      ),
    }
  }
  if (!details.pkgSupports.agent) {
    return {
      ok: false,
      message: 'Engine mismatch',
      cause: cmdPrefixMessage(
        cmdName,
        `Package engine "${agent}" requires ${pkgRequirements.agent}. Current version: ${agentVersion}`,
      ),
    }
  }
  if (!details.pkgSupports.node) {
    return {
      ok: false,
      message: 'Version mismatch',
      cause: cmdPrefixMessage(
        cmdName,
        `Package engine "node" requires ${pkgRequirements.node}. Current version: ${nodeVersion}`,
      ),
    }
  }
  const lockName = details.lockName ?? 'lockfile'
  if (details.lockName === undefined || details.lockSrc === undefined) {
    return {
      ok: false,
      message: 'Missing lockfile',
      cause: cmdPrefixMessage(cmdName, `No ${lockName} found`),
    }
  }
  if (details.lockSrc.trim() === '') {
    return {
      ok: false,
      message: 'Empty lockfile',
      cause: cmdPrefixMessage(cmdName, `${lockName} is empty`),
    }
  }
  if (details.pkgPath === undefined) {
    return {
      ok: false,
      message: 'Missing package.json',
      cause: cmdPrefixMessage(cmdName, `No ${PACKAGE_JSON} found`),
    }
  }
  if (prod && (agent === BUN || agent === YARN_BERRY)) {
    return {
      ok: false,
      message: 'Bad input',
      cause: cmdPrefixMessage(
        cmdName,
        `--prod not supported for ${agent}${agentVersion ? `@${agentVersion}` : ''}`,
      ),
    }
  }
  if (
    details.lockPath &&
    path.relative(cwd, details.lockPath).startsWith('.')
  ) {
    // Note: In tests we return <redacted> because otherwise snapshots will fail.
    logger?.warn(
      cmdPrefixMessage(
        cmdName,
        `Package ${lockName} found at ${ENV.VITEST ? '[REDACTED]' : details.lockPath}`,
      ),
    )
  }
  return { ok: true, data: details as EnvDetails }
}
