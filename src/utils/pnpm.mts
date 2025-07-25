import { existsSync } from 'node:fs'

import yaml from 'js-yaml'
import semver from 'semver'

import { isObjectObject } from '@socketsecurity/registry/lib/objects'
import { stripBom } from '@socketsecurity/registry/lib/strings'

import { readFileUtf8 } from './fs.mts'
import { idToNpmPurl } from './spec.mts'

import type { LockfileObject, PackageSnapshot } from '@pnpm/lockfile.fs'
import type { SemVer } from 'semver'

export function extractOverridesFromPnpmLockSrc(lockfileContent: any): string {
  let match
  if (typeof lockfileContent === 'string') {
    match = /^overrides:(?:\r?\n {2}.+)+(?:\r?\n)*/m.exec(lockfileContent)?.[0]
  }
  return match ?? ''
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
  return Array.from(seen).map(p =>
    idToNpmPurl(stripPnpmPeerSuffix(stripLeadingPnpmDepPathSlash(p))),
  )
}

export function isPnpmDepPath(maybeDepPath: string): boolean {
  return maybeDepPath.length > 0 && maybeDepPath.charCodeAt(0) === 47 /*'/'*/
}

export function parsePnpmLockfile(
  lockfileContent: unknown,
): LockfileObject | null {
  let result
  if (typeof lockfileContent === 'string') {
    try {
      result = yaml.load(stripBom(lockfileContent))
    } catch {}
  }
  return isObjectObject(result) ? (result as LockfileObject) : null
}

export function parsePnpmLockfileVersion(version: unknown): SemVer | null {
  try {
    return semver.coerce(version as string)
  } catch {}
  return null
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
  const parenIndex = depPath.indexOf('(')
  const index = parenIndex === -1 ? depPath.indexOf('_') : parenIndex
  return index === -1 ? depPath : depPath.slice(0, index)
}
