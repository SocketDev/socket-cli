import path from 'node:path'

import semver from 'semver'

import { ManifestEntry, getManifestData } from '@socketsecurity/registry'

import constants from '../../constants.ts'
import { detect } from '../../utils/package-manager-detector.ts'

const { BUN, NPM, VLT, YARN_BERRY } = constants

const COMMAND_TITLE = 'Socket Optimize'

const manifestNpmOverrides = getManifestData(NPM)

export async function detectAndValidatePackageManager(
  cwd: string,
  prod: boolean
): Promise<
  | void
  | (Pick<
      Awaited<ReturnType<typeof detect>>,
      | 'agent'
      | 'agentExecPath'
      | 'lockBasename'
      | 'lockSrc'
      | 'npmExecPath'
      | 'pkgJson'
      | 'pkgPath'
    > & {
      lockName: string
      manifestEntries: Array<ManifestEntry>
      lockBasename: string
      lockSrc: string
      pkgPath: string
    })
> {
  const {
    agent,
    agentExecPath,
    agentVersion,
    lockBasename,
    lockPath,
    lockSrc,
    minimumNodeVersion,
    npmExecPath,
    pkgJson,
    pkgPath,
    supported
  } = await detect({
    cwd,
    onUnknown(pkgManager: string | undefined) {
      console.warn(
        `⚠️ ${COMMAND_TITLE}: Unknown package manager${pkgManager ? ` ${pkgManager}` : ''}, defaulting to npm`
      )
    }
  })
  if (!supported) {
    console.error(
      `✖️ ${COMMAND_TITLE}: No supported Node or browser range detected`
    )
    return
  }
  if (agent === VLT) {
    console.error(
      `✖️ ${COMMAND_TITLE}: ${agent} does not support overrides. Soon, though ⚡`
    )
    return
  }
  const lockName = lockPath && lockBasename ? lockBasename : 'lock file'
  if (lockBasename === undefined || lockSrc === undefined) {
    console.error(`✖️ ${COMMAND_TITLE}: No ${lockName} found`)
    return
  }
  if (lockSrc.trim() === '') {
    console.error(`✖️ ${COMMAND_TITLE}: ${lockName} is empty`)
    return
  }
  if (pkgPath === undefined) {
    console.error(`✖️ ${COMMAND_TITLE}: No package.json found`)
    return
  }
  if (prod && (agent === BUN || agent === YARN_BERRY)) {
    console.error(
      `✖️ ${COMMAND_TITLE}: --prod not supported for ${agent}${agentVersion ? `@${agentVersion.toString()}` : ''}`
    )
    return
  }
  if (lockPath && path.relative(cwd, lockPath).startsWith('.')) {
    console.warn(`⚠️ ${COMMAND_TITLE}: Package ${lockName} found at ${lockPath}`)
  }

  const nodeRange = `>=${minimumNodeVersion}`
  const manifestEntries = manifestNpmOverrides.filter(({ 1: data }) =>
    semver.satisfies(semver.coerce(data.engines.node)!, nodeRange)
  )

  return {
    agent,
    agentExecPath,
    lockBasename,
    lockName,
    lockSrc,
    manifestEntries,
    npmExecPath,
    pkgJson,
    pkgPath
  }
}
