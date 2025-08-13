import type { components } from '@socketsecurity/sdk/types/api'

// Use the SDK type which matches what the API actually accepts
export type EcosystemString = components['schemas']['SocketPURL_Type']

// This array must contain ALL ecosystem values
// These match the SocketPURL_Type from the SDK
const ALL_ECOSYSTEMS = [
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
] as const

const COANA_SUPPORTED_ECOSYSTEMS: Set<EcosystemString> = new Set([
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
])

// Helper type to check if our array contains all possible EcosystemString values
type CheckExhaustive<T extends readonly EcosystemString[]> =
  EcosystemString extends T[number] ? T : never

// This will cause a TypeScript error if ALL_ECOSYSTEMS doesn't contain all EcosystemString values
export const ecosystemChoices: CheckExhaustive<typeof ALL_ECOSYSTEMS> =
  ALL_ECOSYSTEMS

// Type guard to check if a string is a valid ecosystem
export function isValidEcosystem(value: string): value is EcosystemString {
  return (ecosystemChoices as readonly string[]).includes(value)
}

// Parse and validate ecosystem values from string or array
export function parseEcosystems(
  value: string | string[] | undefined,
): EcosystemString[] {
  if (!value) {
    return []
  }

  const values =
    typeof value === 'string'
      ? value.split(',').map(v => v.trim().toLowerCase())
      : value.map(v => v.toLowerCase())

  return values.filter(isValidEcosystem)
}

// Get string array for use with meow choices
/**
 * Ecosystems/Purl types are slightly different in Coana.
 * This function converts the EcosystemString[] to a string of Coana compatible ecosystem names.
 * Ecosystems that are not supported by Coana are ignored.
 */
export function getEcosystemChoicesForMeow(): string[] {
  return ecosystemChoices as unknown as string[]
}

export function convertToCoanaEcosystems(
  ecosystems: EcosystemString[],
): string[] {
  return ecosystems
    .filter(ecosystem =>
      COANA_SUPPORTED_ECOSYSTEMS.has(ecosystem as EcosystemString),
    )
    .map(ecosystem => {
      switch (ecosystem) {
        case 'hex':
          return 'ERLANG'
        case 'github':
          return 'ACTIONS'
        case 'golang':
          return 'GO'
        case 'pypi':
          return 'PIP'
        case 'gem':
          return 'RUBYGEMS'
        case 'cargo':
          return 'RUST'
        default:
          return ecosystem.toUpperCase()
      }
    })
}
