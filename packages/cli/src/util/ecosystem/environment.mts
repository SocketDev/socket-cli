/* max-file-lines: legitimate — tracks one cohesive module domain; splitting would scatter tightly coupled helpers. */
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

import { whichReal } from '@socketsecurity/lib-stable/bin'
import {
  BUN,
  NPM,
  PNPM,
  VLT,
  YARN,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib-stable/constants/agents'
import { getMaintainedNodeVersions } from '@socketsecurity/lib-stable/constants/node'
import { WIN32 } from '@socketsecurity/lib-stable/constants/platform'
import { debugDirNs, debugNs } from '@socketsecurity/lib-stable/debug'
import {
  readPackageJson,
  toEditablePackageJson,
} from '@socketsecurity/lib-stable/packages'
import { naturalCompare } from '@socketsecurity/lib-stable/sorts'
import { spawn } from '@socketsecurity/lib-stable/spawn'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings'

import {
  getMinimumVersionByAgent,
  getNpmExecPath,
  getPnpmExecPath,
} from '../../constants/agents.mts'
import { FLAG_VERSION } from '../../constants/cli.mts'
import { VITEST } from '../../env/vitest.mts'
import {
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  PACKAGE_JSON,
} from '../../constants/packages.mts'
import { execPath, nodeNoWarningsFlags } from '../../constants/paths.mts'
import { findUp } from '../fs/find-up.mts'
import { cmdPrefixMessage } from '../process/cmd.mts'

import type { CResult } from '../../types.mjs'
import type { Logger } from '@socketsecurity/lib-stable/logger'
import type { Remap } from '@socketsecurity/lib-stable/objects'
import type { EditablePackageJson } from '@socketsecurity/lib-stable/packages'
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
  onUnknown?: ((pkgManager: string | undefined) => void) | undefined
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

// Lockfile registration + per-agent reader Map extracted to keep this file
// under the 1000-line cap. Re-export ReadLockFile for back-compat.
import { LOCKS, readLockFileByAgent } from './lockfile-readers.mts'

export type { ReadLockFile } from './lockfile-readers.mts'

// Windows-shim helpers extracted to keep this file under the 1000-line cap.
// Imported for local use AND re-exported so existing import paths keep working.
import { preferWindowsCmdShim, resolveBinPathSync } from './windows-shims.mts'

export { preferWindowsCmdShim, resolveBinPathSync }

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
        `Package ${lockName} found at ${VITEST ? '[REDACTED]' : details.lockPath}`,
      ),
    )
  }
  return { ok: true, data: details as EnvDetails }
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
    // Use > 0 to ensure there's a name before the @.
    if (atSignIndex > 0) {
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

export async function getAgentExecPath(agent: Agent): Promise<string> {
  const binName = binByAgent.get(agent)!
  if (binName === NPM) {
    // Try to use getNpmExecPath() first, but verify it exists.
    const npmPath = preferWindowsCmdShim(await getNpmExecPath(), NPM)
    if (existsSync(npmPath)) {
      return npmPath
    }
    // If getNpmExecPath() doesn't exist, try common locations.
    // Check npm in the same directory as node.
    const nodeDir = path.dirname(process.execPath)
    /* c8 ignore start - WIN32-only branch and existsSync(npm-in-node-dir) hit; tests run on macOS/Linux against test fixtures, not a real node install dir */
    if (WIN32) {
      const npmCmdInNodeDir = path.join(nodeDir, `${NPM}.cmd`)
      if (existsSync(npmCmdInNodeDir)) {
        return npmCmdInNodeDir
      }
    }
    const npmInNodeDir = path.join(nodeDir, NPM)
    if (existsSync(npmInNodeDir)) {
      return preferWindowsCmdShim(npmInNodeDir, NPM)
    }
    /* c8 ignore stop */
    // Fall back to which.
    const whichRealResult = await whichReal(binName, { nothrow: true })
    return (
      (Array.isArray(whichRealResult) ? whichRealResult[0] : whichRealResult) ??
      binName
    )
  }
  if (binName === PNPM) {
    // Try to use getPnpmExecPath() first, but verify it exists.
    const pnpmPath = await getPnpmExecPath()
    if (existsSync(pnpmPath)) {
      return pnpmPath
    }
    // Fall back to which.
    const whichRealResult = await whichReal(binName, { nothrow: true })
    return (
      (Array.isArray(whichRealResult) ? whichRealResult[0] : whichRealResult) ??
      binName
    )
  }
  const whichRealResult = await whichReal(binName, { nothrow: true })
  return (
    (Array.isArray(whichRealResult) ? whichRealResult[0] : whichRealResult) ??
    binName
  )
}

export async function getAgentVersion(
  agent: Agent,
  agentExecPath: string,
  cwd: string,
): Promise<SemVer | undefined> {
  let result: SemVer | undefined
  const quotedCmd = `\`${agent} ${FLAG_VERSION}\``
  debugNs('stdio', `spawn: ${quotedCmd}`)
  try {
    let stdout: string

    // Some package manager "executables" may resolve to non-executable wrapper scripts
    // (e.g. the extensionless `npm` shim on Windows). Resolve the underlying entrypoint
    // and run it with Node when it is a JS file.
    let shouldRunWithNode: string | undefined = undefined
    /* c8 ignore start - WIN32-only branch for resolving JS shim entrypoints; tests run on macOS/Linux */
    if (WIN32) {
      try {
        const resolved = resolveBinPathSync(agentExecPath)
        const ext = path.extname(resolved).toLowerCase()
        if (ext === '.cjs' || ext === '.js' || ext === '.mjs') {
          shouldRunWithNode = resolved
        }
      } catch (e) {
        debugNs(
          'warn',
          `Failed to resolve bin path for ${agentExecPath}, falling back to direct spawn.`,
        )
        debugDirNs('error', e)
      }
    }

    if (shouldRunWithNode) {
      const result = await spawn(
        execPath,
        [...nodeNoWarningsFlags, shouldRunWithNode, FLAG_VERSION],
        { cwd },
      )

      if (!result) {
        return undefined
      }

      stdout =
        typeof result.stdout === 'string'
          ? result.stdout
          : result.stdout.toString()
      /* c8 ignore stop */
    } else {
      const result = await spawn(agentExecPath, [FLAG_VERSION], {
        cwd,
        // On Windows, package managers are often .cmd files that require shell execution.
        // The spawn function from @socketsecurity/registry will handle this properly
        // when shell is true.
        shell: WIN32,
      })

      if (!result) {
        return undefined
      }

      stdout =
        typeof result.stdout === 'string'
          ? result.stdout
          : result.stdout.toString()
    }

    result =
      // Coerce version output into a valid semver version by passing it through
      // semver.coerce which strips leading v's, carets (^), comparators (<,<=,>,>=,=),
      // and tildes (~).
      semver.coerce(stdout) ?? undefined
  } catch (e) {
    debugNs('error', `Package manager command failed: ${quotedCmd}`)
    debugDirNs('inspect', { cmd: quotedCmd })
    debugDirNs('error', e)
  }
  return result
}
