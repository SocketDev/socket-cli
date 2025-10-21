import type { PackageURL } from '@socketregistry/packageurl-js'

import { NPM } from '@socketsecurity/lib/constants/agents'
import semver from 'semver'
import { stripPnpmPeerSuffix } from '../pnpm/lockfile.mts'

export function idToNpmPurl(id: string): string {
  return `pkg:${NPM}/${id}`
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
    semver.coerce(type === NPM ? stripPnpmPeerSuffix(version) : version)
      ?.version ?? ''
  )
}
