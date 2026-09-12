import { promises as fs } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

// Match static, bare, and dynamic relative JavaScript imports in built ESM.
const RELATIVE_JAVASCRIPT_IMPORT =
  /(?:from\s*|import\s*(?:\(\s*)?)['"](\.\/[A-Za-z0-9._-]+\.js)['"]/g

export interface CopyPastoralistAssetsOptions {
  sourceEntry?: string | undefined
}

function pastoralistRelativeImports(source: string): string[] {
  return [...source.matchAll(RELATIVE_JAVASCRIPT_IMPORT)].map(
    match => match[1]!,
  )
}

export async function copyPastoralistAssets(
  packageRoot: string,
  options: CopyPastoralistAssetsOptions = {},
): Promise<string[]> {
  const { sourceEntry: configuredSourceEntry } = {
    __proto__: null,
    ...options,
  }
  const sourceEntry =
    configuredSourceEntry ?? fileURLToPath(import.meta.resolve('pastoralist'))
  const sourceDist = path.dirname(sourceEntry)
  const sourcePackage = path.dirname(sourceDist)
  const destination = path.join(packageRoot, 'dist', 'pastoralist')
  const pending = [path.basename(sourceEntry)]
  const copied = new Set<string>()

  await fs.mkdir(destination, { recursive: true })
  while (pending.length > 0) {
    const relative = pending.shift()!
    if (copied.has(relative)) {
      continue
    }
    const sourcePath = path.join(sourceDist, relative)
    const source = await fs.readFile(sourcePath, 'utf8')
    await fs.copyFile(sourcePath, path.join(destination, relative))
    copied.add(relative)
    for (const imported of pastoralistRelativeImports(source)) {
      const dependency = imported.slice(2)
      if (!copied.has(dependency)) {
        pending.push(dependency)
      }
    }
  }
  for (const file of ['LICENSE', 'package.json']) {
    await fs.copyFile(
      path.join(sourcePackage, file),
      path.join(destination, file),
    )
  }
  return [...copied].toSorted()
}
