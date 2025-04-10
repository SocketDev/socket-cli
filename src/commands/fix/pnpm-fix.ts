import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { arrayUnique } from '@socketsecurity/registry/lib/arrays'
import { isDebug } from '@socketsecurity/registry/lib/debug'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'

import { enableAutoMerge, openGitHubPullRequest } from './open-pr'
import constants from '../../constants'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findBestPatchVersion,
  findPackageNode,
  findPackageNodes,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { getAlertsMapFromPnpmLockfile } from '../../utils/pnpm-lock-yaml'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'
import { runAgentInstall } from '../optimize/run-agent'

import type { NormalizedFixOptions } from './types'
import type { StringKeyValueObject } from '../../types'
import type { EnvDetails } from '../../utils/package-environment'
import type { PackageJson } from '@socketsecurity/registry/lib/packages'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { CI, NPM, OVERRIDES, PNPM } = constants

type InstallOptions = {
  spinner?: Spinner | undefined
}

async function install(
  pkgEnvDetails: EnvDetails,
  options: InstallOptions
): Promise<void> {
  const { spinner } = { __proto__: null, ...options } as InstallOptions
  await runAgentInstall(pkgEnvDetails, {
    args: ['--no-frozen-lockfile'],
    spinner,
    stdio: isDebug() ? 'inherit' : 'ignore'
  })
}

export async function pnpmFix(
  pkgEnvDetails: EnvDetails,
  {
    autoMerge,
    cwd,
    rangeStyle,
    spinner,
    test,
    testScript
  }: NormalizedFixOptions
) {
  const lockfile = await readWantedLockfile(cwd, { ignoreIncompatible: false })
  if (!lockfile) {
    return
  }

  const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
    consolidate: true,
    include: { existing: true, unfixable: false, upgradable: false },
    nothrow: true
  })

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    return
  }

  spinner?.start()

  const editablePkgJson = await readPackageJson(cwd, { editable: true })
  const { content: pkgJson } = editablePkgJson

  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  await arb.loadActual()

  for (const { 0: name, 1: infos } of infoByPkg) {
    if (getManifestData(NPM, name)) {
      spinner?.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }
    const specs = arrayUnique(
      findPackageNodes(arb.actualTree!, name).map(n => `${n.name}@${n.version}`)
    )
    const packument =
      specs.length && infos.length
        ? // eslint-disable-next-line no-await-in-loop
          await fetchPackagePackument(name)
        : null
    if (!packument) {
      continue
    }

    for (const spec of specs) {
      const lastAtSignIndex = spec.lastIndexOf('@')
      const name = spec.slice(0, lastAtSignIndex)
      const oldVersion = spec.slice(lastAtSignIndex + 1)
      for (const {
        firstPatchedVersionIdentifier,
        vulnerableVersionRange
      } of infos) {
        const node = findPackageNode(arb.actualTree!, name, oldVersion)
        if (!node) {
          continue
        }
        const oldSpec = `${name}@${oldVersion}`
        const availableVersions = Object.keys(packument.versions)
        const targetVersion = findBestPatchVersion(
          node,
          availableVersions,
          vulnerableVersionRange,
          firstPatchedVersionIdentifier
        )
        const targetPackument = targetVersion
          ? packument.versions[targetVersion]
          : undefined
        if (targetVersion && targetPackument) {
          const oldPnpm = pkgJson[PNPM] as StringKeyValueObject | undefined
          const pnpmKeyCount = oldPnpm ? Object.keys(oldPnpm).length : 0
          const oldOverrides = (oldPnpm as StringKeyValueObject)?.[OVERRIDES] as
            | Record<string, string>
            | undefined
          const overridesCount = oldOverrides
            ? Object.keys(oldOverrides).length
            : 0
          const overrideKey = `${node.name}@${vulnerableVersionRange}`
          const overrideRange = `^${targetVersion}`
          const fixSpec = `${name}@${overrideRange}`
          const updateData = {
            [PNPM]: {
              ...oldPnpm,
              [OVERRIDES]: {
                [overrideKey]: overrideRange,
                ...oldOverrides
              }
            }
          }
          const revertData = {
            [PNPM]: pnpmKeyCount
              ? {
                  ...oldPnpm,
                  [OVERRIDES]:
                    overridesCount === 1
                      ? undefined
                      : {
                          [overrideKey]: undefined,
                          ...oldOverrides
                        }
                }
              : undefined,
            ...(pkgJson.dependencies
              ? { dependencies: pkgJson.dependencies }
              : undefined),
            ...(pkgJson.optionalDependencies
              ? { optionalDependencies: pkgJson.optionalDependencies }
              : undefined),
            ...(pkgJson.peerDependencies
              ? { peerDependencies: pkgJson.peerDependencies }
              : undefined)
          } as PackageJson

          spinner?.info(`Installing ${fixSpec}`)

          let saved = false
          let installed = false
          try {
            editablePkgJson.update(updateData)
            updatePackageJsonFromNode(
              editablePkgJson,
              arb.actualTree!,
              node,
              rangeStyle
            )
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            saved = true

            // eslint-disable-next-line no-await-in-loop
            await install(pkgEnvDetails, { spinner })
            installed = true

            if (test) {
              spinner?.info(`Testing ${fixSpec}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }

            spinner?.successAndStop(`Fixed ${name}`)
            spinner?.start()

            // Lazily access constants.ENV[CI].
            if (constants.ENV[CI]) {
              // eslint-disable-next-line no-await-in-loop
              const prResponse = await openGitHubPullRequest(
                name,
                targetVersion,
                cwd
              )
              if (autoMerge) {
                // eslint-disable-next-line no-await-in-loop
                await enableAutoMerge(prResponse.data)
              }
            }
          } catch (e) {
            spinner?.error(`Reverting ${fixSpec}`, e)
            if (saved) {
              editablePkgJson.update(revertData)
              // eslint-disable-next-line no-await-in-loop
              await editablePkgJson.save()
            }
            if (installed) {
              // eslint-disable-next-line no-await-in-loop
              await install(pkgEnvDetails, { spinner })
              arb.actualTree = null
              // eslint-disable-next-line no-await-in-loop
              await arb.loadActual()
            }
            spinner?.failAndStop(`Failed to fix ${oldSpec}`)
          }
        } else {
          spinner?.failAndStop(`Could not patch ${oldSpec}`)
        }
      }
    }
  }
  spinner?.stop()
}
