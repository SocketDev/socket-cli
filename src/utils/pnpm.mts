import { existsSync } from 'node:fs'

import yaml from 'js-yaml'
import semver from 'semver'

import { isObjectObject } from '@socketsecurity/registry/lib/objects'
import { stripBom } from '@socketsecurity/registry/lib/strings'

import { readFileUtf8 } from './fs.mts'
import { idToPurl } from './spec.mts'

import type { LockfileObject, PackageSnapshot } from '@pnpm/lockfile.fs'
import type { SemVer } from 'semver'

export function extractOverridesFromPnpmLockfileContent(
  lockfileContent: any,
): string {
  return typeof lockfileContent === 'string'
    ? (/^overrides:(\r?\n {2}.+)+(?:\r?\n)*/m.exec(lockfileContent)?.[0] ?? '')
    : ''
}

export async function extractPurlsFromPnpmLockfile(
  lockfile: LockfileObject,
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
      ...(pkg as any).devDependencies,
    }
    for (const depName in deps) {
      const ref = deps[depName]!
      const subKey = isPnpmDepPath(ref) ? ref : `/${depName}@${ref}`
      visit(subKey)
    }
  }
  for (const pkgPath of Object.keys(packages)) {
    visit(pkgPath)
  }
  return [...seen].map(p =>
    idToPurl(stripPnpmPeerSuffix(stripLeadingPnpmDepPathSlash(p))),
  )
}

export function isPnpmDepPath(maybeDepPath: string): boolean {
  return maybeDepPath.length > 0 && maybeDepPath.charCodeAt(0) === 47 /*'/'*/
}

export function parsePnpmLockfile(lockfileContent: any): LockfileObject | null {
  let result
  if (typeof lockfileContent === 'string') {
    try {
      result = yaml.load(stripBom(lockfileContent))
    } catch {}
  }
  return isObjectObject(result) ? (result as LockfileObject) : null
}

export function parsePnpmLockfileVersion(version: any): SemVer {
  return semver.coerce(version)!
}

export async function readPnpmLockfile(
  lockfilePath: string,
): Promise<string | null> {
  return existsSync(lockfilePath) ? await readFileUtf8(lockfilePath) : null
}

export function stripLeadingPnpmDepPathSlash(depPath: string): string {
  return isPnpmDepPath(depPath) ? depPath.slice(1) : depPath
}

export function stripPnpmPeerSuffix(depPath: string): string {
  const index = depPath.indexOf('(')
  return index === -1 ? depPath : depPath.slice(0, index)
}
