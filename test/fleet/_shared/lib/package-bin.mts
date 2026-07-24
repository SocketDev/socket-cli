/**
 * Resolve a JavaScript CLI from the package's declared `bin` entry. Tests run
 * the returned entrypoint through `process.execPath`, avoiding platform-
 * specific `node_modules/.bin` shims and PATH resolution.
 */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'

const require = createRequire(import.meta.url)

interface PackageManifest {
  bin?: string | Record<string, string> | undefined
  name?: string | undefined
}

function readPackageManifest(packageJsonPath: string): PackageManifest {
  return JSON.parse(readFileSync(packageJsonPath, 'utf8')) as PackageManifest
}

function resolvePackageJson(packageName: string): string {
  try {
    return require.resolve(`${packageName}/package.json`)
  } catch {
    // Packages may hide package.json behind an exports map. Resolve their
    // public entrypoint, then walk upward to the matching package boundary.
  }

  let dir = path.dirname(require.resolve(packageName))
  for (;;) {
    const packageJsonPath = path.join(dir, 'package.json')
    try {
      if (readPackageManifest(packageJsonPath).name === packageName) {
        return packageJsonPath
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw e
      }
    }

    const parent = path.dirname(dir)
    if (parent === dir) {
      throw new Error(`Could not locate package.json for ${packageName}`)
    }
    dir = parent
  }
}

export function resolvePackageBinEntrypoint(
  packageName: string,
  binName = packageName.split('/').at(-1) ?? packageName,
): string {
  const packageJsonPath = resolvePackageJson(packageName)
  const { bin } = readPackageManifest(packageJsonPath)
  const binRel = typeof bin === 'string' ? bin : bin?.[binName]
  if (!binRel) {
    throw new Error(`${packageName} package.json declares no ${binName} bin`)
  }
  return path.resolve(path.dirname(packageJsonPath), binRel)
}
