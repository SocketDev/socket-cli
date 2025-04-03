import { readWantedLockfile } from '@pnpm/lockfile.fs'

import { getManifestData } from '@socketsecurity/registry'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'

import constants from '../../constants'
import {
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findBestPatchVersion,
  findPackageNodes
} from '../../utils/lockfile/package-lock-json'
import { getAlertsMapFromPnpmLockfile } from '../../utils/lockfile/pnpm-lock-yaml'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'
import { runAgentInstall } from '../optimize/run-agent'

import type { EnvDetails } from '../../utils/package-environment'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { NPM, OVERRIDES, PNPM } = constants

type PnpmFixOptions = {
  cwd?: string | undefined
  spinner?: Spinner | undefined
  testScript?: string | undefined
}

export async function pnpmFix(
  pkgEnvDetails: EnvDetails,
  options?: PnpmFixOptions | undefined
) {
  const {
    cwd = process.cwd(),
    spinner,
    testScript = 'test'
  } = { __proto__: null, ...options } as PnpmFixOptions

  spinner?.start()

  const lockfile = await readWantedLockfile(cwd, { ignoreIncompatible: false })
  if (!lockfile) {
    spinner?.stop()
    return
  }

  const alertsMap = await getAlertsMapFromPnpmLockfile(lockfile, {
    consolidate: true,
    include: {
      existing: true,
      unfixable: false,
      upgradable: false
    },
    nothrow: true
  })

  const infoByPkg = getCveInfoByAlertsMap(alertsMap)
  if (!infoByPkg) {
    spinner?.stop()
    return
  }

  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })

  await arb.loadActual()

  const editablePkgJson = await readPackageJson(cwd, { editable: true })
  const { content: pkgJson } = editablePkgJson

  for (const { 0: name, 1: infos } of infoByPkg) {
    const tree = arb.actualTree!

    const hasUpgrade = !!getManifestData(NPM, name)
    if (hasUpgrade) {
      spinner?.info(`Skipping ${name}. Socket Optimize package exists.`)
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

    for (let i = 0, { length: nodesLength } = nodes; i < nodesLength; i += 1) {
      const node = nodes[i]!
      for (
        let j = 0, { length: infosLength } = infos;
        j < infosLength;
        j += 1
      ) {
        const { firstPatchedVersionIdentifier, vulnerableVersionRange } =
          infos[j]!
        const { version: oldVersion } = node
        const availableVersions = Object.keys(packument.versions)
        // Find the highest non-vulnerable version within the same major range
        const targetVersion = findBestPatchVersion(
          node,
          availableVersions,
          vulnerableVersionRange,
          firstPatchedVersionIdentifier
        )
        const targetPackument = targetVersion
          ? packument.versions[targetVersion]
          : undefined
        if (targetPackument) {
          const oldPnpm = (pkgJson as any)[PNPM]
          const oldOverrides = oldPnpm?.[OVERRIDES] as
            | { [key: string]: string }
            | undefined
          try {
            editablePkgJson.update({
              [PNPM]: {
                ...oldPnpm,
                [OVERRIDES]: {
                  [`${node.name}@${vulnerableVersionRange}`]: `^${targetVersion}`,
                  ...oldOverrides
                }
              }
            })
            // eslint-disable-next-line no-await-in-loop
            await runScript(testScript, [], { spinner, stdio: 'ignore' })

            spinner?.info(`Patched ${name} ${oldVersion} -> ${node.version}`)

            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
            // eslint-disable-next-line no-await-in-loop
            await runAgentInstall(pkgEnvDetails, { spinner })
          } catch {
            spinner?.error(`Reverting ${name} to ${oldVersion}`)
          }
        } else {
          spinner?.error(`Could not patch ${name} ${oldVersion}`)
        }
      }
    }
  }

  spinner?.stop()
}
