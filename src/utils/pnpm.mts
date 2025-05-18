import semver from 'semver'

import {
  idToPurl,
  isDepPath,
  stripLeadingSlash,
  stripPeerSuffix
} from './spec.mts'

import type { LockfileObject, PackageSnapshot } from '@pnpm/lockfile.fs'
import type { SemVer } from 'semver'

export async function extractPurlsFromPnpmLockfile(
  lockfile: LockfileObject
): Promise<string[]> {
  const packages = lockfile?.packages ?? {}
  const seen = new Set<string>()
  const visit = (pkgPath: string) => {
    if (seen.has(pkgPath)) {
      return
    }
    const pkg = (packages as any)[pkgPath] as PackageSnapshot
    if (!pkg) {
      return
    }
    seen.add(pkgPath)
    const deps: { [name: string]: string } = {
      __proto__: null,
      ...pkg.dependencies,
      ...pkg.optionalDependencies,
      ...(pkg as any).devDependencies
    }
    for (const depName in deps) {
      const ref = deps[depName]!
      const subKey = isDepPath(ref) ? ref : `/${depName}@${ref}`
      visit(subKey)
    }
  }
  for (const pkgPath of Object.keys(packages)) {
    visit(pkgPath)
  }
  return [...seen].map(p => idToPurl(stripPeerSuffix(stripLeadingSlash(p))))
}

export function parsePnpmLockfileVersion(version: string): SemVer {
  return semver.coerce(version)!
}
