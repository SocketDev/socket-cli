/**
 * @file Canonical path constants for the packages/cli scripts. Self-contained
 *   (no root scripts/paths.mts ancestor exists to inherit from); every path
 *   this package's scripts need is constructed exactly once here.
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
