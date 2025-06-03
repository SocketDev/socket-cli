import semver from 'semver'

import { PackageURL } from '@socketregistry/packageurl-js'

import { stripPnpmPeerSuffix } from './pnpm.mts'

export function idToNpmPurl(id: string): string {
  return `pkg:npm/${id}`
}

export function idToPurl(id: string, type: string): string {
  return `pkg:${type}/${id}`
}

export function resolvePackageVersion(purlObj: PackageURL): string {
  const { version } = purlObj
  if (!version) {
    return ''
  }
  const { type } = purlObj
  return (
    semver.coerce(type === 'npm' ? stripPnpmPeerSuffix(version) : version)
      ?.version ?? ''
  )
}
