import { parse, parseAllDocuments } from 'yaml'

interface PnpmLockPackage {
  resolution?: {
    integrity?: unknown
  }
}

interface PnpmLock {
  importers?: Record<
    string,
    | {
        dependencies?: Record<string, unknown>
        devDependencies?: Record<string, unknown>
        optionalDependencies?: Record<string, unknown>
      }
    | undefined
  >
  packages?: Record<string, PnpmLockPackage | undefined>
  patchedDependencies?: Record<
    string,
    { path?: string; hash?: string } | string
  >
}

/** Read the package graph from both single-document and split pnpm lockfiles. */
export function parsePnpmLock(
  source: string,
  workspaceSource?: string,
): PnpmLock {
  const packageDocuments: PnpmLock[] = []
  for (const document of parseAllDocuments(source)) {
    const value = document.toJS() as PnpmLock | undefined
    const packages = value?.packages
    if (!packages || typeof packages !== 'object' || Array.isArray(packages)) {
      continue
    }

    packageDocuments.push(value)
  }

  const selected =
    packageDocuments.findLast(hasProjectDependencies) ?? packageDocuments.at(-1)
  if (!selected) {
    throw new Error('pnpm-lock.yaml does not contain a packages graph')
  }

  if (workspaceSource && selected.patchedDependencies) {
    const workspace = parse(workspaceSource) as {
      patchedDependencies?: Record<string, string | undefined>
    }
    for (const [locator, patch] of Object.entries(
      selected.patchedDependencies,
    )) {
      if (typeof patch === 'string') {
        const patchPath = workspace.patchedDependencies?.[locator]
        if (!patchPath) {
          throw new Error(
            `pnpm-workspace.yaml has no path for patched dependency ${locator}`,
          )
        }
        selected.patchedDependencies[locator] = {
          hash: patch,
          path: patchPath,
        }
      }
    }
  }
  return selected
}

function hasProjectDependencies(lockfile: PnpmLock): boolean {
  return Object.values(lockfile.importers ?? {}).some(
    importer =>
      importer !== undefined &&
      [
        importer.dependencies,
        importer.devDependencies,
        importer.optionalDependencies,
      ].some(section => Object.keys(section ?? {}).length > 0),
  )
}

export function findLockedPackageIntegrity(
  source: string,
  packageName: string,
  version: string,
): string | undefined {
  const locator = `${packageName}@${version}`
  const integrity =
    parsePnpmLock(source).packages?.[locator]?.resolution?.integrity
  return typeof integrity === 'string' ? integrity : undefined
}
