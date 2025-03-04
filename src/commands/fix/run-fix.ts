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
  getCveInfoByPackage,
  getPackagesAlerts,
  updateNode
} from '../../shadow/npm/arborist/lib/arborist/reify'
// import { detect } from '../../utils/package-environment-detector'

import type { SafeNode } from '../../shadow/npm/arborist/lib/node'

const { NPM } = constants

function isTopLevel(tree: SafeNode, node: SafeNode): boolean {
  return tree.children.get(node.name) === node
}

export async function runFix() {
  // Lazily access constants.spinner.
  const { spinner } = constants

  spinner.start()

  const cwd = process.cwd()
  const editablePkgJson = await readPackageJson(cwd, { editable: true })
  // const agentDetails = await detect()

  const arb = new SafeArborist({
    path: cwd,
    ...SAFE_ARBORIST_REIFY_OPTIONS_OVERRIDES
  })
  await arb.reify()
  const alerts = await getPackagesAlerts(arb as any, {
    consolidate: true,
    includeExisting: true,
    includeUnfixable: false
  })
  const infoByPkg = getCveInfoByPackage(alerts)
  await arb.buildIdealTree()
  if (infoByPkg) {
    for (const { 0: name, 1: infos } of infoByPkg) {
      let revertToIdealTree = arb.idealTree!
      arb.idealTree = null
      // eslint-disable-next-line no-await-in-loop
      await arb.buildIdealTree()
      const tree = arb.idealTree!
      const hasUpgrade = !!getManifestData(NPM, name)
      if (hasUpgrade) {
        spinner.info(`Skipping ${name}. Socket Optimize package exists.`)
        continue
      }
      const nodes = findPackageNodes(tree, name)
      const packument =
        nodes.length && infos.length
          ? // eslint-disable-next-line no-await-in-loop
            await fetchPackagePackument(name)
          : null
      if (packument) {
        for (
          let i = 0, { length: nodesLength } = nodes;
          i < nodesLength;
          i += 1
        ) {
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
                spinner.info(`Patched ${name} ${oldVersion} -> ${node.version}`)
                if (isTopLevel(tree, node)) {
                  for (const depField of [
                    'dependencies',
                    'optionalDependencies',
                    'peerDependencies'
                  ]) {
                    const oldVersion = (
                      editablePkgJson.content[depField] as any
                    )?.[name]
                    if (oldVersion) {
                      const decorator = /^[~^]/.exec(oldVersion)?.[0] ?? ''
                      ;(editablePkgJson as any).content[depField][name] =
                        `${decorator}${node.version}`
                    }
                  }
                }
                // eslint-disable-next-line no-await-in-loop
                await editablePkgJson.save()
              } catch {
                spinner.error(`Reverting ${name} to ${oldVersion}`)
                arb.idealTree = revertToIdealTree
              }
            } else {
              spinner.error(`Could not patch ${name} ${oldVersion}`)
            }
          }
        }
      }
    }
  }
  const arb2 = new Arborist({ path: cwd })
  arb2.idealTree = arb.idealTree
  await arb2.reify()
  spinner.stop()
}
