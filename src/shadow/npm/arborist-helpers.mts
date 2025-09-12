import { debugFn } from '@socketsecurity/registry/lib/debug'
import { getOwn } from '@socketsecurity/registry/lib/objects'
import { parseUrl } from '@socketsecurity/registry/lib/url'

import constants from '../../constants.mts'
import { DiffAction } from './arborist/types.mts'
import { getAlertsMapFromPurls } from '../../utils/alerts-map.mts'
import { toFilterConfig } from '../../utils/filter-config.mts'
import { idToNpmPurl } from '../../utils/spec.mts'

import type { ArboristInstance, Diff, NodeClass } from './arborist/types.mts'
import type {
  AlertFilter,
  AlertsByPurl,
} from '../../utils/socket-package-alert.mts'
import type { Spinner } from '@socketsecurity/registry/lib/spinner'

function getUrlOrigin(input: string): string {
  // TODO: URL.parse is available in Node 22.1.0. We can use it when we drop Node 18.
  // https://nodejs.org/docs/latest-v22.x/api/url.html#urlparseinput-base
  // return URL.parse(input)?.origin ?? ''
  return parseUrl(input)?.origin ?? ''
}

export type GetAlertsMapFromArboristOptions = {
  apiToken?: string | undefined
  consolidate?: boolean | undefined
  filter?: AlertFilter | undefined
  nothrow?: boolean | undefined
  spinner?: Spinner | undefined
}

export async function getAlertsMapFromArborist(
  arb: ArboristInstance,
  needInfoOn: PackageDetail[],
  options?: GetAlertsMapFromArboristOptions | undefined,
): Promise<AlertsByPurl> {
  const opts = {
    __proto__: null,
    consolidate: false,
    nothrow: false,
    ...options,
    filter: toFilterConfig(getOwn(options, 'filter')),
  } as GetAlertsMapFromArboristOptions & { filter: AlertFilter }

  const purls = needInfoOn.map(d => idToNpmPurl(d.node.pkgid))

  let overrides: { [key: string]: string } | undefined
  const overridesMap = (
    arb.actualTree ??
    arb.idealTree ??
    (await arb.loadActual())
  )?.overrides?.children
  if (overridesMap) {
    overrides = Object.fromEntries(
      Array.from(overridesMap.entries()).map(([key, overrideSet]) => {
        return [key, overrideSet.value!]
      }),
    )
  }

  return await getAlertsMapFromPurls(purls, {
    overrides,
    ...opts,
  })
}

export type DiffQueryFilter = {
  existing?: boolean | undefined
  unknownOrigin?: boolean | undefined
}

export type DiffQueryOptions = {
  filter?: DiffQueryFilter | undefined
}

export type PackageDetail = {
  node: NodeClass
  existing?: NodeClass | undefined
}

export function getDetailsFromDiff(
  diff: Diff | null,
  options?: DiffQueryOptions | undefined,
): PackageDetail[] {
  const details: PackageDetail[] = []
  // `diff` is `null` when `npm install --package-lock-only` is passed.
  if (!diff) {
    debugFn('notice', `miss: diff is ${diff}`)
    return details
  }

  const { NPM_REGISTRY_URL } = constants

  const filterConfig = toFilterConfig({
    existing: false,
    unknownOrigin: true,
    ...getOwn(options, 'filter'),
  }) as DiffQueryFilter

  const queue: Diff[] = [...diff.children]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === constants.LOOP_SENTINEL) {
      throw new Error('Detected infinite loop while walking Arborist diff')
    }
    const currDiff = queue[pos++]!
    const { action } = currDiff
    if (action) {
      // The `pkgNode`, i.e. the `ideal` node, will be `undefined` if the diff
      // action is 'REMOVE'
      // The `oldNode`, i.e. the `actual` node, will be `undefined` if the diff
      // action is 'ADD'.
      const { actual: oldNode, ideal: pkgNode } = currDiff
      let existing: NodeClass | undefined
      let keep = false
      if (action === DiffAction.change) {
        if (pkgNode?.package.version !== oldNode?.package.version) {
          keep = true
          if (
            oldNode?.package.name &&
            oldNode.package.name === pkgNode?.package.name
          ) {
            existing = oldNode
          }
        }
      } else {
        keep = action !== DiffAction.remove
      }
      if (keep && pkgNode?.resolved && (!oldNode || oldNode.resolved)) {
        if (
          filterConfig.unknownOrigin ||
          getUrlOrigin(pkgNode.resolved) === NPM_REGISTRY_URL
        ) {
          details.push({
            node: pkgNode,
            existing,
          })
        }
      }
    }
    for (const child of currDiff.children) {
      queue[queueLength++] = child
    }
  }
  if (filterConfig.existing) {
    const { unchanged } = diff
    for (let i = 0, { length } = unchanged; i < length; i += 1) {
      const pkgNode = unchanged[i]!
      if (
        filterConfig.unknownOrigin ||
        getUrlOrigin(pkgNode.resolved!) === NPM_REGISTRY_URL
      ) {
        details.push({
          node: pkgNode,
          existing: pkgNode,
        })
      }
    }
  }
  return details
}
