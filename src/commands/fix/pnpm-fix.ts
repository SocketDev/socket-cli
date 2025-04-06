import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { logger } from '@socketsecurity/registry/lib/logger'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'

import { openGitHubPullRequest } from './open-pr'
import constants from '../../constants'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findBestPatchVersion,
  findPackageNodes,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { getAlertsMapFromPnpmLockfile } from '../../utils/pnpm-lock-yaml'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'
import { runAgentInstall } from '../optimize/run-agent'

import type { EnvDetails } from '../../utils/package-environment'
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
    stdio: 'ignore'
  })
}

type PnpmFixOptions = {
  cwd?: string | undefined
  spinner?: Spinner | undefined
  test?: boolean | undefined
  testScript?: string | undefined
}

export async function pnpmFix(
  pkgEnvDetails: EnvDetails,
  options?: PnpmFixOptions
) {
  const {
    cwd = process.cwd(),
    spinner,
    test = false,
    testScript = 'test'
  } = { __proto__: null, ...options } as PnpmFixOptions

  const lockfile = await readWantedLockfile(cwd, { ignoreIncompatible: false })
  if (!lockfile) {
    return spinner?.stop()
  }

  const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
    consolidate: true,
    include: { existing: true, unfixable: false, upgradable: false },
    nothrow: true
  })

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    return spinner?.stop()
  }

  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  await arb.loadActual()

  const editablePkgJson = await readPackageJson(cwd, { editable: true })
  const { content: pkgJson } = editablePkgJson

  spinner?.stop()

  for (const { 0: name, 1: infos } of infoByPkg) {
    const tree = arb.actualTree!

    if (getManifestData(NPM, name)) {
      logger.info(`Skipping ${name}. Socket Optimize package exists.`)
      continue
    }

    const nodes = findPackageNodes(tree, name)
    const packument =
      nodes.length && infos.length
        ? // eslint-disable-next-line no-await-in-loop
          await fetchPackagePackument(name)
        : null
    if (!packument) {
      continue
    }

    for (const node of nodes) {
      for (const {
        firstPatchedVersionIdentifier,
        vulnerableVersionRange
      } of infos) {
        spinner?.stop()
        const { version: oldVersion } = node
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
          const oldPnpm = (pkgJson as any)[PNPM]
          const oldOverrides = oldPnpm?.[OVERRIDES] as
            | Record<string, string>
            | undefined
          const overrideKey = `${node.name}@${vulnerableVersionRange}`
          const overrideRange = `^${targetVersion}`
          const fixSpec = `${name}@${overrideRange}`
          const data = {
            [PNPM]: {
              ...oldPnpm,
              [OVERRIDES]: {
                [overrideKey]: overrideRange,
                ...oldOverrides
              }
            }
          }
          try {
            editablePkgJson.update(data)
            spinner?.start()
            spinner?.info(`Installing ${fixSpec}`)
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            // eslint-disable-next-line no-await-in-loop
            await install(pkgEnvDetails, { spinner })
            if (test) {
              spinner?.info(`Testing ${fixSpec}`)
              // eslint-disable-next-line no-await-in-loop
              await runScript(testScript, [], { spinner, stdio: 'ignore' })
            }
            // Lazily access constants.ENV[CI].
            if (constants.ENV[CI]) {
              // eslint-disable-next-line no-await-in-loop
              await openGitHubPullRequest(name, targetVersion, cwd)
            }
            updatePackageJsonFromNode(editablePkgJson, tree, node)
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            spinner?.info(`Fixed ${name}`)
          } catch {
            spinner?.error(`Reverting ${fixSpec}`)
            const pnpmKeyCount = Object.keys(data[PNPM]).length
            const overrideCount = Object.keys(data[PNPM][OVERRIDES]).length
            editablePkgJson.update(
              pnpmKeyCount === 1 && overrideCount === 1
                ? { [PNPM]: undefined as any }
                : {
                    [PNPM]: {
                      ...oldPnpm,
                      [OVERRIDES]:
                        overrideCount === 1
                          ? undefined
                          : {
                              [overrideKey]: undefined,
                              ...oldOverrides
                            }
                    }
                  }
            )
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            // eslint-disable-next-line no-await-in-loop
            await install(pkgEnvDetails, { spinner })
            spinner?.stop()
            logger.error(`Failed to fix ${oldSpec}`)
          }
        } else {
          spinner?.stop()
          logger.error(`Could not patch ${oldSpec}`)
        }
      }
    }
  }

  spinner?.stop()
}
