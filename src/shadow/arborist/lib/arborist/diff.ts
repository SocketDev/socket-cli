import constants from '../../../../constants'

import type { SafeNode } from '../node'
import type { Diff } from '@npmcli/arborist'

const { LOOP_SENTINEL, SOCKET_CLI_FIX_PACKAGE_LOCK_FILE } = constants

function toRepoUrl(resolved: string): string {
  try {
    return URL.parse(resolved)?.origin ?? ''
  } catch {}
  return ''
}

export type PackageDetail = {
  pkgid: SafeNode['pkgid']
  repository_url: string
  existing?: SafeNode['pkgid'] | undefined
}

type GetPackagesToQueryFromDiffOptions = { includeUnchanged?: boolean }

export function getPackagesToQueryFromDiff(
  diff_: Diff | null,
  options?: GetPackagesToQueryFromDiffOptions
): PackageDetail[] {
  const {
    // Lazily access constants.IPC.
    includeUnchanged = constants.IPC[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]
  } = <GetPackagesToQueryFromDiffOptions>{
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
      let existing
      let keep = false
      if (action === 'CHANGE') {
        if (pkgNode?.package.version !== oldNode?.package.version) {
          keep = true
          if (
            oldNode?.package.name &&
            oldNode.package.name === pkgNode?.package.name
          ) {
            existing = oldNode.pkgid
          }
        } else {
          // TODO: Add proper debug mode.
          // console.warn('SKIPPING META CHANGE ON', diff)
        }
      } else {
        keep = action !== 'REMOVE'
      }
      if (keep && pkgNode?.resolved && (!oldNode || oldNode.resolved)) {
        details.push({
          existing,
          pkgid: pkgNode.pkgid,
          repository_url: toRepoUrl(pkgNode.resolved)
        })
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
      details.push({
        existing: pkgNode.pkgid,
        pkgid: pkgNode.pkgid,
        repository_url: toRepoUrl(pkgNode.resolved!)
      })
    }
  }
  return details
}
