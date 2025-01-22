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

export type InstallEffect = {
  pkgid: SafeNode['pkgid']
  repository_url: string
  existing?: SafeNode['pkgid'] | undefined
}

export type WalkOptions = { fix?: boolean }

export function walk(
  diff_: Diff | null,
  options?: WalkOptions
): InstallEffect[] {
  const {
    // Lazily access constants.IPC.
    fix = constants.IPC[SOCKET_CLI_FIX_PACKAGE_LOCK_FILE]
  } = <WalkOptions>{
    __proto__: null,
    ...options
  }
  const needInfoOn: InstallEffect[] = []
  // `diff_` is `null` when `npm install --package-lock-only` is passed.
  if (!diff_) {
    return needInfoOn
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
        needInfoOn.push({
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
  if (fix) {
    const { unchanged } = diff_!
    for (let i = 0, { length } = unchanged; i < length; i += 1) {
      const pkgNode = unchanged[i]!
      needInfoOn.push({
        existing: pkgNode.pkgid,
        pkgid: pkgNode.pkgid,
        repository_url: toRepoUrl(pkgNode.resolved!)
      })
    }
  }
  return needInfoOn
}
