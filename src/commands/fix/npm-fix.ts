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
  Arborist,
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findPackageNodes,
  getAlertsMapFromArborist,
  updateNode,
  updatePackageJsonFromNode
} from '../../utils/arborist-helpers'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'

import type { SafeNode } from '../../shadow/npm/arborist/lib/node'
import type { EnvDetails } from '../../utils/package-environment'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { CI, NPM } = constants

type InstallOptions = {
  cwd?: string | undefined
}

async function install(
  idealTree: SafeNode,
  options: InstallOptions
): Promise<void> {
  const { cwd = process.cwd() } = {
    __proto__: null,
    ...options
  } as InstallOptions
  const arb2 = new Arborist({ path: cwd })
  arb2.idealTree = idealTree
  await arb2.reify()
}

type NpmFixOptions = {
  cwd?: string | undefined
  spinner?: Spinner | undefined
  test?: boolean | undefined
  testScript?: string | undefined
}

export async function npmFix(
  _pkgEnvDetails: EnvDetails,
  options?: NpmFixOptions | undefined
) {
  const {
    cwd = process.cwd(),
    spinner,
    test = false,
    testScript = 'test'
  } = { __proto__: null, ...options } as NpmFixOptions

  spinner?.start()

  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })

  await arb.reify()

  const alertsMap = await getAlertsMapFromArborist(arb, {
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

  await arb.buildIdealTree()

  const editablePkgJson = await readPackageJson(cwd, { editable: true })

  for (const { 0: name, 1: infos } of infoByPkg) {
    const revertToIdealTree = arb.idealTree!
    arb.idealTree = null

    // eslint-disable-next-line no-await-in-loop
    await arb.buildIdealTree()
    const tree = arb.idealTree!

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

    for (const node of nodes) {
      for (const {
        firstPatchedVersionIdentifier,
        vulnerableVersionRange
      } of infos) {
        spinner?.stop()
        const { version: oldVersion } = node
        const oldSpec = `${name}@${oldVersion}`
        if (
          updateNode(
            node,
            packument,
            vulnerableVersionRange,
            firstPatchedVersionIdentifier
          )
        ) {
          const targetVersion = node.package.version!
          const fixSpec = `${name}@^${targetVersion}`
          try {
            spinner?.start()
            spinner?.info(`Installing ${fixSpec}`)
            // eslint-disable-next-line no-await-in-loop
            await install(arb.idealTree!, { cwd })
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
            arb.idealTree = revertToIdealTree
            // eslint-disable-next-line no-await-in-loop
            await install(arb.idealTree!, { cwd })
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
