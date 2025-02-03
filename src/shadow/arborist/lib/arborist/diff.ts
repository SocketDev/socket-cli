import constants from '../../../../constants'

import type { Diff } from './types'
import type { SafeNode } from '../node'

const { LOOP_SENTINEL, NPM_REGISTRY_URL } = constants

function getUrlOrigin(input: string): string {
  try {
    return URL.parse(input)?.origin ?? ''
  } catch {}
  return ''
}

export type PackageDetail = {
  node: SafeNode
  origin: string
  existing?: SafeNode | undefined
}

type GetPackagesToQueryFromDiffOptions = {
  includeUnchanged?: boolean
  includeUnknownOrigin?: boolean
}

export function getPackagesToQueryFromDiff(
  diff_: Diff | null,
  options?: GetPackagesToQueryFromDiffOptions
): PackageDetail[] {
  const { includeUnchanged = false, includeUnknownOrigin = false } = <
    GetPackagesToQueryFromDiffOptions
  >{
    __proto__: null,
    ...options
  }
  const details: PackageDetail[] = []
  // `diff_` is `null` when `npm install --package-lock-only` is passed.
  if (!diff_) {
    return details
  }
  const queue: Diff[] = [...diff_.children]
  let pos = 0
  let { length: queueLength } = queue
  while (pos < queueLength) {
    if (pos === LOOP_SENTINEL) {
      throw new Error('Detected infinite loop while walking Arborist diff')
    }
    const diff = queue[pos++]!
    const { action } = diff
    if (action) {
      // The `pkgNode`, i.e. the `ideal` node, will be `undefined` if the diff
      // action is 'REMOVE'
      // The `oldNode`, i.e. the `actual` node, will be `undefined` if the diff
      // action is 'ADD'.
      const { actual: oldNode, ideal: pkgNode } = diff
      let existing: SafeNode | undefined
      let keep = false
      if (action === 'CHANGE') {
        if (pkgNode?.package.version !== oldNode?.package.version) {
          keep = true
          if (
            oldNode?.package.name &&
            oldNode.package.name === pkgNode?.package.name
          ) {
            existing = oldNode
          }
        } else {
          // TODO: Add proper debug mode.
          // console.warn('SKIPPING META CHANGE ON', diff)
        }
      } else {
        keep = action !== 'REMOVE'
      }
      if (keep && pkgNode?.resolved && (!oldNode || oldNode.resolved)) {
        const origin = getUrlOrigin(pkgNode.resolved)
        if (includeUnknownOrigin || origin === NPM_REGISTRY_URL) {
          details.push({
            node: pkgNode,
            origin,
            existing
          })
        }
      }
    }
    for (const child of diff.children) {
      queue[queueLength++] = child
    }
  }
  if (includeUnchanged) {
    const { unchanged } = diff_!
    for (let i = 0, { length } = unchanged; i < length; i += 1) {
      const pkgNode = unchanged[i]!
      const origin = getUrlOrigin(pkgNode.resolved!)
      if (includeUnknownOrigin || origin === NPM_REGISTRY_URL) {
        details.push({
          node: pkgNode,
          origin,
          existing: pkgNode
        })
      }
    }
  }
  return details
}
