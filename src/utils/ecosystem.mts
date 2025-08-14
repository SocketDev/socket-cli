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
  'npm',
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

const COANA_SUPPORTED_LIST = [
  'composer',
  'hex',
  'github',
  'golang',
  'maven',
  'npm',
  'nuget',
  'pypi',
  'pub',
  'gem',
  'cargo',
  'swift',
] as const satisfies readonly PURL_Type[]

export const ALL_SUPPORTED_ECOSYSTEMS = new Set<string>(ALL_ECOSYSTEMS)

export const COANA_SUPPORTED_ECOSYSTEMS = new Set<string>(COANA_SUPPORTED_LIST)

/**
 * Ecosystems/Purl types are slightly different in Coana.  This function converts
 * the PURL_Type[] to a string of Coana compatible ecosystem names. Ecosystems that
 * are not supported by Coana are ignored.
 */
export function convertToCoanaEcosystems(ecosystems: PURL_Type[]): string[] {
  return ecosystems
    .filter(ecosystem => COANA_SUPPORTED_ECOSYSTEMS.has(ecosystem as PURL_Type))
    .map(ecosystem => {
      switch (ecosystem) {
        case 'cargo':
          return 'RUST'
        case 'gem':
          return 'RUBYGEMS'
        case 'github':
          return 'ACTIONS'
        case 'golang':
          return 'GO'
        case 'hex':
          return 'ERLANG'
        case 'pypi':
          return 'PIP'
        default:
          return ecosystem.toUpperCase()
      }
    })
}

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
