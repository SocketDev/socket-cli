import path from 'node:path'

import { safeDelete } from '@socketsecurity/lib-stable/fs/safe'

import type { RemoveOptions } from '@socketsecurity/lib-stable/fs/types'

export interface StrictDeleteOptions extends RemoveOptions {
  readonly base?: string | undefined
}

export function deleteRefusalReason(
  target: string,
  base?: string | undefined,
): string | undefined {
  const trimmed = target.trim()
  if (!trimmed || trimmed === '.' || trimmed === './') {
    return 'the target is empty or resolves to the current directory'
  }
  const resolved = path.resolve(trimmed)
  if (resolved === path.parse(resolved).root) {
    return 'the target is a filesystem root'
  }
  if (base !== undefined) {
    const resolvedBase = path.resolve(base)
    if (resolved === resolvedBase) {
      return 'the target is the base directory'
    }
    if (!resolved.startsWith(`${resolvedBase}${path.sep}`)) {
      return 'the target sits outside the base directory'
    }
  }
  return undefined
}

export async function strictDelete(
  target: string,
  options?: StrictDeleteOptions | undefined,
): Promise<void> {
  const opts = { __proto__: null, ...options }
  const reason = deleteRefusalReason(target, opts.base)
  if (reason !== undefined) {
    throw new Error(
      `Refusing to delete a root-resolving path. Where: ${JSON.stringify(target)}. Saw: ${reason}; wanted a target strictly below the base directory. Fix: reject the path before deletion.`,
    )
  }
  await safeDelete(target, opts)
}
