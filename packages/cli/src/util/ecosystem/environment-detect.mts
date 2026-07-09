import { existsSync } from 'node:fs'
import path from 'node:path'

import browserslist from 'browserslist'

import {
  BUN,
  NPM,
  YARN_BERRY,
  YARN_CLASSIC,
} from '@socketsecurity/lib-stable/constants/agents'
import { getMaintainedNodeVersions } from '@socketsecurity/lib-stable/constants/node'
import { toEditablePackageJson } from '@socketsecurity/lib-stable/packages/edit'
import { readPackageJson } from '@socketsecurity/lib-stable/packages/read'
import { naturalCompare } from '@socketsecurity/lib-stable/sorts/natural'
import { isNonEmptyString } from '@socketsecurity/lib-stable/strings/predicates'
// socket-lint: allow bare-semver -- lib-stable 6.0.9 doesn't publish ./external/semver; semver is bundled at build so no runtime dep leaks.
import semver from 'semver'

import { getMinimumVersionByAgent } from '../../constants/agents.mts'
import {
  NPM_BUGGY_OVERRIDES_PATCHED_VERSION,
  PACKAGE_JSON,
} from '../../constants/packages.mts'
import { VITEST } from '../../env/vitest.mts'
import { findUp } from '../fs/find-up.mts'
import { cmdPrefixMessage } from '../process/cmd.mts'
import { getAgentExecPath, getAgentVersion } from './environment-agent.mts'
import { LOCKS, readLockFileByAgent } from './lockfile-readers.mts'
import { AGENTS } from './supported-agents.mts'

import type {
  DetectAndValidateOptions,
  DetectOptions,
  EnvDetails,
  PartialEnvDetails,
} from './environment.mts'
import type { Agent } from './supported-agents.mts'
import type { CResult } from '../../types.mjs'
import type { EditablePackageJson } from '@socketsecurity/lib-stable/packages/types'

const DOT_PACKAGE_LOCK_JSON = '.package-lock.json'

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
        .toSorted(naturalCompare)
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
