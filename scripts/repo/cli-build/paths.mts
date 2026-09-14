/**
 * Canonical paths for the Socket CLI build tools.
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'

function resolvePackageRoot(): string {
  let cur = path.dirname(fileURLToPath(import.meta.url))
  const root = path.parse(cur).root
  while (cur && cur !== root) {
    if (existsSync(path.join(cur, 'package.json'))) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      break
    }
    cur = parent
  }
  throw new Error(
    `Could not resolve package root from ${fileURLToPath(import.meta.url)}.`,
  )
}

export const PACKAGE_ROOT = resolvePackageRoot()
export const WORKSPACE_ROOT = PACKAGE_ROOT

export * from '../../fleet/paths.mts'

export function packageNodeModulesBinPath(packageRoot: string): string {
  return path.join(packageRoot, 'node_modules', '.bin')
}

export function sourceIndexPath(sourceRoot: string): string {
  return path.join(sourceRoot, 'src', 'index.mts')
}
