import { existsSync } from 'node:fs'
import path from 'node:path'

import browserslist from 'browserslist'
import semver from 'semver'
import which from 'which'

import { parse as parseBunLockb } from '@socketregistry/hyrious__bun.lockb/index.cjs'
import { debugDir, debugFn } from '@socketsecurity/registry/lib/debug'
import { readFileBinary, readFileUtf8 } from '@socketsecurity/registry/lib/fs'
import { Logger } from '@socketsecurity/registry/lib/logger'
import { readPackageJson } from '@socketsecurity/registry/lib/packages'
import { naturalCompare } from '@socketsecurity/registry/lib/sorts'
import { spawn } from '@socketsecurity/registry/lib/spawn'
import { isNonEmptyString } from '@socketsecurity/registry/lib/strings'

import { cmdPrefixMessage } from './cmd.mts'
import { findUp } from './fs.mts'
import constants from '../constants.mts'

import type { CResult } from '../types.mts'
import type { Remap } from '@socketsecurity/registry/lib/objects'
import type { EditablePackageJson } from '@socketsecurity/registry/lib/packages'
import type { SemVer } from 'semver'

const {
  BINARY_LOCK_EXT,
  BUN,
  HIDDEN_PACKAGE_LOCK_JSON,
  LOCK_EXT,
  NODE_MODULES,
  NPM,
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  PACKAGE_JSON,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
} = constants

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
  | ((lockPath: string) => Promise<string | undefined>)
  | ((lockPath: string, agentExecPath: string) => Promise<string | undefined>)
  | ((
      lockPath: string,
      agentExecPath: string,
      cwd: string,
    ) => Promise<string | undefined>)

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
            return (
              await spawn(agentExecPath, [lockPath], {
                cwd,
                shell: constants.WIN32,
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
  [`${NODE_MODULES}/.package-lock.json`]: NPM,
}

async function getAgentExecPath(agent: Agent): Promise<string> {
  const binName = binByAgent.get(agent)!
  if (binName === NPM) {
    return constants.npmExecPath
  }
  return (await which(binName, { nothrow: true })) ?? binName
}

async function getAgentVersion(
  agent: Agent,
  agentExecPath: string,
  cwd: string,
): Promise<SemVer | undefined> {
  let result
  const quotedCmd = `\`${agent} --version\``
  debugFn('stdio', `spawn: ${quotedCmd}`)
  try {
    result =
      // Coerce version output into a valid semver version by passing it through
      // semver.coerce which strips leading v's, carets (^), comparators (<,<=,>,>=,=),
      // and tildes (~).
      semver.coerce(
        // All package managers support the "--version" flag.
        (
          await spawn(agentExecPath, ['--version'], {
            cwd,
            shell: constants.WIN32,
          })
        ).stdout,
      ) ?? undefined
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
  }
  return result
}

export async function detectPackageEnvironment({
  cwd = process.cwd(),
  onUnknown,
}: DetectOptions = {}): Promise<EnvDetails | PartialEnvDetails> {
  let lockPath = await findUp(Object.keys(LOCKS), { cwd })
  let lockName = lockPath ? path.basename(lockPath) : undefined
  const isHiddenLockFile = lockName === HIDDEN_PACKAGE_LOCK_JSON
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
  const editablePkgJson = pkgPath
    ? await readPackageJson(pkgPath, { editable: true })
    : undefined
  // Read Corepack `packageManager` field in package.json:
  // https://nodejs.org/api/packages.html#packagemanager
  const pkgManager = isNonEmptyString(editablePkgJson?.content?.packageManager)
    ? editablePkgJson.content.packageManager
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
  const { maintainedNodeVersions } = constants
  const minSupportedAgentVersion = constants.minimumVersionByAgent.get(agent)!
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
    lockSrc =
      typeof lockPath === 'string'
        ? await readLockFileByAgent.get(agent)!(lockPath, agentExecPath, cwd)
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
      node: maintainedNodeVersions.some(v =>
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
          `Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}, defaulting to npm`,
        ),
      )
    },
  })
  const { agent, nodeVersion, pkgRequirements } = details
  const agentVersion = details.agentVersion ?? 'unknown'
  if (!details.agentSupported) {
    const minVersion = constants.minimumVersionByAgent.get(agent)!
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
    const minVersion = constants.maintainedNodeVersions.last
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
  const lockName = details.lockName ?? 'lock file'
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
        `Package ${lockName} found at ${constants.ENV.VITEST ? constants.REDACTED : details.lockPath}`,
      ),
    )
  }
  return { ok: true, data: details as EnvDetails }
}
