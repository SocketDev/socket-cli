import { refToRelative } from '@pnpm/dependency-path'
import { detectDepTypes } from '@pnpm/lockfile.detect-dep-types'
import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'
import { resolvePackageName } from '@socketsecurity/registry/lib/packages'

import {
  idToPurl,
  resolvePackageVersion,
  stripLeadingSlash,
  stripPeerSuffix
} from './spec.mts'

import type { LockfileObject } from '@pnpm/lockfile.fs'
import type { SemVer } from 'semver'

export function extractPurlsFromPnpmLockfileV6(
  lockfile: LockfileObject
): string[] {
  const deps = new Set<string>()
  for (const importer of Object.values(lockfile.importers || {})) {
    if (importer.dependencies) {
      for (const { 0: alias, 1: ref } of Object.entries(
        importer.dependencies
      )) {
        const id = resolvePnpmPackageId(alias, ref)
        if (id) {
          deps.add(idToPurl(id))
        }
      }
    }
    if (importer.devDependencies) {
      for (const { 0: alias, 1: ref } of Object.entries(
        importer.devDependencies
      )) {
        const id = resolvePnpmPackageId(alias, ref)
        if (id) {
          deps.add(idToPurl(id))
        }
      }
    }
    if (importer.optionalDependencies) {
      for (const { 0: alias, 1: ref } of Object.entries(
        importer.optionalDependencies
      )) {
        const id = resolvePnpmPackageId(alias, ref)
        if (id) {
          deps.add(idToPurl(id))
        }
      }
    }
  }
  if (lockfile.packages) {
    for (const pkgPath of Object.keys(lockfile.packages)) {
      const id = resolvePnpmPackageIdFromPath(pkgPath, '')
      if (id) {
        deps.add(idToPurl(id))
      }
    }
  }
  return Array.from(deps)
}

export function extractPurlsFromPnpmLockfileV9(
  lockfile: LockfileObject
): string[] {
  const depTypes = detectDepTypes(lockfile)
  return Object.keys(depTypes).map(refId => {
    const purlObj = PackageURL.fromString(idToPurl(refId))
    const name = resolvePackageName(purlObj)
    const version = resolvePackageVersion(purlObj)
    return idToPurl(`${name}@${version}`)
  })
}

export function extractPurlsFromPnpmLockfile(
  lockfile: LockfileObject
): string[] {
  return parsePnpmLockfileVersion(lockfile.lockfileVersion).major <= 6
    ? extractPurlsFromPnpmLockfileV6(lockfile)
    : extractPurlsFromPnpmLockfileV9(lockfile)
}

export function parsePnpmLockfileVersion(version: string): SemVer {
  return semver.coerce(version)!
}

export function resolvePnpmPackageId(
  alias: string,
  ref: string
): string | null {
  return ref.startsWith('/')
    ? resolvePnpmPackageIdFromPath(ref, alias)
    : `${alias}@${stripPeerSuffix(ref)}`
}

export function resolvePnpmPackageIdFromPath(
  ref: string,
  alias: string
): string | null {
  const relative = refToRelative(ref, alias)
  if (relative) {
    const id = stripLeadingSlash(relative)
    const purlObj = PackageURL.fromString(idToPurl(id))
    const name = resolvePackageName(purlObj)
    const version = resolvePackageVersion(purlObj)
    return `${name}@${version}`
  }
  return null
}
