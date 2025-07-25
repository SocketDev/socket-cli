import { promises as fs } from 'node:fs'

import { debugDir, debugFn, isDebug } from '@socketsecurity/registry/lib/debug'
import { hasKeys } from '@socketsecurity/registry/lib/objects'

import { agentFix } from './agent-fix.mts'
import { getActualTree } from './get-actual-tree.mts'
import { getFixAlertsMapOptions } from './shared.mts'
import constants from '../../constants.mts'
import { runAgentInstall } from '../../utils/agent.mts'
import {
  getAlertsMapFromPnpmLockfile,
  getAlertsMapFromPurls,
} from '../../utils/alerts-map.mts'
import { readLockfile } from '../../utils/lockfile.mts'
import {
  extractOverridesFromPnpmLockSrc,
  parsePnpmLockfile,
  parsePnpmLockfileVersion,
} from '../../utils/pnpm.mts'
import { applyRange } from '../../utils/semver.mts'
import { getOverridesDataPnpm } from '../optimize/get-overrides-by-agent.mts'

import type { FixConfig, InstallOptions } from './agent-fix.mts'
import type { NodeClass } from '../../shadow/npm/arborist/types.mts'
import type { CResult, StringKeyValueObject } from '../../types.mts'
import type { EnvDetails } from '../../utils/package-environment.mts'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'

const { OVERRIDES, PNPM } = constants

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions,
): Promise<NodeClass | null> {
  const {
    args: extraArgs,
    cwd,
    spinner,
  } = {
    __proto__: null,
    ...options,
  } as InstallOptions
  const args = [
    // Do not execute any scripts defined in the project package.json and its dependencies.
    // https://pnpm.io/9.x/cli/install#--ignore-scripts
    '--ignore-scripts',
    // Enable pnpm updates to pnpm-lock.yaml in CI environments.
    // https://pnpm.io/cli/install#--frozen-lockfile
    '--no-frozen-lockfile',
    // Enable a non-interactive pnpm install
    // https://github.com/pnpm/pnpm/issues/6778
    '--config.confirmModulesPurge=false',
    ...(extraArgs ?? []),
  ]
  const quotedCmd = `\`${pkgEnvDetails.agent} install ${args.join(' ')}\``
  debugFn('stdio', `spawn: ${quotedCmd}`)

  const isSpinning = spinner?.isSpinning
  spinner?.stop()

  let errored = false
  try {
    await runAgentInstall(pkgEnvDetails, {
      args,
      spinner,
      stdio: isDebug('stdio') ? 'inherit' : 'ignore',
    })
  } catch (e) {
    debugFn('error', `caught: ${quotedCmd} failed`)
    debugDir('inspect', { error: e })
    errored = true
  }

  let actualTree: NodeClass | null = null
  if (!errored) {
    try {
      actualTree = await getActualTree(cwd)
    } catch (e) {
      debugFn('error', 'caught: Arborist error')
      debugDir('inspect', { error: e })
    }
  }
  if (isSpinning) {
    spinner.start()
  }
  return actualTree
}

export async function pnpmFix(
  pkgEnvDetails: EnvDetails,
  fixConfig: FixConfig,
): Promise<CResult<{ fixed: boolean }>> {
  const { cwd, purls, spinner } = fixConfig

  spinner?.start()

  let actualTree: NodeClass | undefined
  let lockSrc: string | null = pkgEnvDetails.lockSrc
  let lockfile = parsePnpmLockfile(lockSrc)
  // Update pnpm-lock.yaml if its version is older than what the installed pnpm
  // produces.
  if (
    pkgEnvDetails.agentVersion.major >= 10 &&
    (parsePnpmLockfileVersion(lockfile?.lockfileVersion)?.major ?? 0) <= 6
  ) {
    const maybeActualTree = await install(pkgEnvDetails, {
      args: ['--lockfile-only'],
      cwd,
      spinner,
    })
    lockSrc = maybeActualTree
      ? await readLockfile(pkgEnvDetails.lockPath)
      : null
    if (lockSrc && maybeActualTree) {
      actualTree = maybeActualTree
      lockfile = parsePnpmLockfile(lockSrc)
    } else {
      lockfile = null
    }
  }

  // Exit early if pnpm-lock.yaml is not found or usable.
  // Check !lockSrc to make TypeScript happy.
  if (!lockfile || !lockSrc) {
    spinner?.stop()
    return {
      ok: false,
      message: 'Missing lockfile',
      cause: 'Required pnpm-lock.yaml not found or usable',
    }
  }

  let alertsMap
  try {
    alertsMap = purls.length
      ? await getAlertsMapFromPurls(purls, getFixAlertsMapOptions())
      : await getAlertsMapFromPnpmLockfile(lockfile, getFixAlertsMapOptions())
  } catch (e) {
    spinner?.stop()
    debugFn('error', 'caught: PURL API')
    debugDir('inspect', { error: e })
    return {
      ok: false,
      message: 'API Error',
      cause: (e as Error)?.message || 'Unknown Socket batch PURL API error.',
    }
  }

  let revertData: PackageJson | undefined
  let revertOverrides: PackageJson | undefined
  let revertOverridesSrc = ''

  return await agentFix(
    pkgEnvDetails,
    actualTree,
    alertsMap,
    install,
    {
      async beforeInstall(
        editablePkgJson,
        packument,
        oldVersion,
        newVersion,
        vulnerableVersionRange,
        options,
      ) {
        const isWorkspaceRoot =
          editablePkgJson.filename === pkgEnvDetails.editablePkgJson.filename
        // Get current overrides for revert logic.
        const { overrides: oldOverrides } = getOverridesDataPnpm(
          pkgEnvDetails,
          editablePkgJson.content,
        )
        const oldPnpmSection = editablePkgJson.content[PNPM] as
          | StringKeyValueObject
          | undefined
        const overrideKey = `${packument.name}@${vulnerableVersionRange}`

        lockSrc = await readLockfile(pkgEnvDetails.lockPath)
        revertOverrides = undefined
        revertOverridesSrc = extractOverridesFromPnpmLockSrc(lockSrc)

        if (isWorkspaceRoot) {
          revertOverrides = {
            [PNPM]: oldPnpmSection
              ? {
                  ...oldPnpmSection,
                  [OVERRIDES]: hasKeys(oldOverrides)
                    ? {
                        ...oldOverrides,
                        [overrideKey]: undefined,
                      }
                    : undefined,
                }
              : undefined,
          } as PackageJson
          // Update overrides in the root package.json so that when `pnpm install`
          // generates pnpm-lock.yaml it updates transitive dependencies too.
          editablePkgJson.update({
            [PNPM]: {
              ...oldPnpmSection,
              [OVERRIDES]: {
                ...oldOverrides,
                [overrideKey]: applyRange(
                  oldOverrides?.[overrideKey] ?? oldVersion,
                  newVersion,
                  options.rangeStyle,
                ),
              },
            },
          })
        }

        revertData = {
          ...revertOverrides,
          ...(editablePkgJson.content.dependencies && {
            dependencies: { ...editablePkgJson.content.dependencies },
          }),
          ...(editablePkgJson.content.optionalDependencies && {
            optionalDependencies: {
              ...editablePkgJson.content.optionalDependencies,
            },
          }),
          ...(editablePkgJson.content.peerDependencies && {
            peerDependencies: { ...editablePkgJson.content.peerDependencies },
          }),
        } as PackageJson
      },
      async afterInstall(editablePkgJson) {
        if (revertOverrides) {
          // Revert overrides metadata in package.json now that pnpm-lock.yaml
          // has been updated.
          editablePkgJson.update(revertOverrides)
        }
        await editablePkgJson.save({ ignoreWhitespace: true })

        lockSrc = await readLockfile(pkgEnvDetails.lockPath)
        const updatedOverridesContent = extractOverridesFromPnpmLockSrc(lockSrc)
        if (updatedOverridesContent) {
          lockSrc = lockSrc!.replace(
            updatedOverridesContent,
            revertOverridesSrc,
          )
          await fs.writeFile(pkgEnvDetails.lockPath, lockSrc, 'utf8')
        }
      },
      async revertInstall(editablePkgJson) {
        if (revertData) {
          editablePkgJson.update(revertData)
        }
      },
    },
    fixConfig,
  )
}
