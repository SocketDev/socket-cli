import { getManifestData } from '@socketsecurity/registry'
import { runScript } from '@socketsecurity/registry/lib/npm'
import {
  fetchPackagePackument,
  readPackageJson
} from '@socketsecurity/registry/lib/packages'

import constants from '../../constants'
import {
  Arborist,
  SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES,
  SafeArborist
} from '../../shadow/npm/arborist/lib/arborist'
import {
  findPackageNodes,
  getAlertsMapFromArborist,
  updateNode
} from '../../utils/lockfile/package-lock-json'
import { getCveInfoByAlertsMap } from '../../utils/socket-package-alert'

import type { SafeNode } from '../../shadow/npm/arborist/lib/node'
import type { EnvDetails } from '../../utils/package-environment'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

const { NPM } = constants

function isTopLevel(tree: SafeNode, node: SafeNode): boolean {
  return tree.children.get(node.name) === node
}

type NpmFixOptions = {
  spinner?: Spinner | undefined
}

export async function npmFix(
  _pkgEnvDetails: EnvDetails,
  cwd: string,
  options?: NpmFixOptions | undefined
) {
  const { spinner } = { __proto__: null, ...options } as NpmFixOptions

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
      upgrade: false
    }
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
        if (
          updateNode(
            node,
            packument,
            vulnerableVersionRange,
            firstPatchedVersionIdentifier
          )
        ) {
          try {
            // eslint-disable-next-line no-await-in-loop
            await runScript('test', [], { spinner, stdio: 'ignore' })

            spinner?.info(`Patched ${name} ${oldVersion} -> ${node.version}`)

            if (isTopLevel(tree, node)) {
              for (const depField of [
                'dependencies',
                'optionalDependencies',
                'peerDependencies'
              ]) {
                const { content: pkgJson } = editablePkgJson
                const oldVersion = (pkgJson[depField] as any)?.[name]
                if (oldVersion) {
                  const decorator = /^[~^]/.exec(oldVersion)?.[0] ?? ''
                  ;(pkgJson as any)[depField][name] =
                    `${decorator}${node.version}`
                }
              }
            }
            // eslint-disable-next-line no-await-in-loop
            await editablePkgJson.save()
          } catch {
            spinner?.error(`Reverting ${name} to ${oldVersion}`)
            arb.idealTree = revertToIdealTree
          }
        } else {
          spinner?.error(`Could not patch ${name} ${oldVersion}`)
        }
      }
    }
  }

  const arb2 = new Arborist({ path: cwd })
  arb2.idealTree = arb.idealTree
  await arb2.reify()

  spinner?.stop()
}
