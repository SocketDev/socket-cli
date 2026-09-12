import { readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
import {
  containsRepositoryPath,
  repositoryContainsTarget,
} from './repo-containment.mts'

export function repositorySourceRoot(root: string, file: string): string {
  const relative = normalizePath(path.relative(root, file))
  // The canonical composition tiers contain repository-relative payloads.
  const match =
    /^(?<layer>template\/(?:base\/universal|base\/conditional\/[^/]+|preset\/universal|preset\/conditional\/[^/]+|overrides\/[^/]+))\/(?<destination>.+)$/u.exec(
      relative,
    )
  if (!match) {
    return root
  }
  const { layer, destination } = match.groups!
  if (!layer || !destination) {
    return root
  }
  try {
    const composition = repositoryComposition(root)
    if (!composition) {
      return root
    }
    const { mirror, files } = composition
    const owned =
      Object.hasOwn(files, destination) ||
      mirror.some((entry: unknown) => {
        if (!entry || typeof entry !== 'object') {
          return false
        }
        const target: unknown = Reflect.get(entry, 'path')
        return (
          typeof target === 'string' &&
          (target === destination ||
            (Reflect.get(entry, 'type') === 'dir' &&
              destination.startsWith(`${target}/`)))
        )
      })
    const logical = path.join(root, layer)
    return owned && containsRepositoryPath(root, logical) ? logical : root
  } catch {
    return root
  }
}

interface RepositoryComposition {
  mirror: unknown[]
  files: object
}
const compositionCache = new Map<
  string,
  { stamp: string; value: RepositoryComposition | undefined }
>()
function repositoryComposition(
  root: string,
): RepositoryComposition | undefined {
  const manifestRoot = path.join(root, 'scripts/repo/commit-cascade/manifest')
  const bundlePath = path.join(manifestRoot, 'bundle.json')
  const inventoryPath = path.join(manifestRoot, 'fleet-files.json')
  if (
    !repositoryContainsTarget(root, bundlePath) ||
    !repositoryContainsTarget(root, inventoryPath)
  ) {
    return undefined
  }
  const stamp = `${statSync(bundlePath).mtimeMs}:${statSync(inventoryPath).mtimeMs}`
  const cached = compositionCache.get(root)
  if (cached?.stamp === stamp) {
    return cached.value
  }
  const bundle: unknown = JSON.parse(readFileSync(bundlePath, 'utf8'))
  const inventory: unknown = JSON.parse(readFileSync(inventoryPath, 'utf8'))
  if (
    !bundle ||
    typeof bundle !== 'object' ||
    !inventory ||
    typeof inventory !== 'object'
  ) {
    return undefined
  }
  const mirror: unknown = Reflect.get(bundle, 'mirror')
  const files: unknown = Reflect.get(inventory, 'files')
  const value =
    Array.isArray(mirror) && files && typeof files === 'object'
      ? { mirror, files }
      : undefined
  if (compositionCache.size >= 4) {
    compositionCache.clear()
  }
  compositionCache.set(root, { stamp, value })
  return value
}
