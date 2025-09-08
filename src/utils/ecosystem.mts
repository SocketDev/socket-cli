import { NPM } from '../constants.mts'

import type { EcosystemString } from '@socketsecurity/registry'
import type { components } from '@socketsecurity/sdk/types/api'

export type PURL_Type = components['schemas']['SocketPURL_Type']

type ExpectNever<T extends never> = T

type MissingInEcosystemString = Exclude<PURL_Type, EcosystemString>
type ExtraInEcosystemString = Exclude<EcosystemString, PURL_Type>

export type _Check_EcosystemString_has_all_purl_types =
  ExpectNever<MissingInEcosystemString>
export type _Check_EcosystemString_has_no_extras =
  ExpectNever<ExtraInEcosystemString>

export const ALL_ECOSYSTEMS = [
  'apk',
  'bitbucket',
  'cargo',
  'chrome',
  'cocoapods',
  'composer',
  'conan',
  'conda',
  'cran',
  'deb',
  'docker',
  'gem',
  'generic',
  'github',
  'golang',
  'hackage',
  'hex',
  'huggingface',
  'maven',
  'mlflow',
  NPM,
  'nuget',
  'oci',
  'pub',
  'pypi',
  'qpkg',
  'rpm',
  'swift',
  'swid',
  'unknown',
] as const satisfies readonly PURL_Type[]

type AllEcosystemsUnion = (typeof ALL_ECOSYSTEMS)[number]
type MissingInAllEcosystems = Exclude<PURL_Type, AllEcosystemsUnion>
type ExtraInAllEcosystems = Exclude<AllEcosystemsUnion, PURL_Type>

export type _Check_ALL_ECOSYSTEMS_has_all_purl_types =
  ExpectNever<MissingInAllEcosystems>
export type _Check_ALL_ECOSYSTEMS_has_no_extras =
  ExpectNever<ExtraInAllEcosystems>

export const ALL_SUPPORTED_ECOSYSTEMS = new Set<string>(ALL_ECOSYSTEMS)

export function getEcosystemChoicesForMeow(): string[] {
  return [...ALL_ECOSYSTEMS]
}

export function isValidEcosystem(value: string): value is PURL_Type {
  return ALL_SUPPORTED_ECOSYSTEMS.has(value)
}

export function parseEcosystems(
  value: string | string[] | undefined,
): PURL_Type[] {
  if (!value) {
    return []
  }
  const values =
    typeof value === 'string'
      ? value.split(',').map(v => v.trim().toLowerCase())
      : value.map(v => String(v).toLowerCase())

  return values.filter(isValidEcosystem)
}
