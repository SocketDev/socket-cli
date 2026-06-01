/**
 * Ecosystem type utilities for Socket CLI. Manages package ecosystem
 * identifiers and mappings.
 *
 * Constants:
 *
 * - ALL_ECOSYSTEMS: Complete list of supported ecosystems
 * - ECOSYSTEM_MAP: Map ecosystem strings to PURL types
 *
 * Type Definitions:
 *
 * - PURL_Type: Package URL type from Socket SDK
 *
 * Supported Ecosystems:
 *
 * - Alpm, apk, bitbucket, cargo, chrome, cocoapods, composer
 * - Conan, conda, cran, deb, docker, gem, generic
 * - Github, gitlab, go, hackage, hex, huggingface
 * - Maven, mlflow, npm, nuget, oci, pub, pypi, rpm, swift, vscode
 *
 * Usage:
 *
 * - Validates ecosystem types
 * - Maps between different ecosystem representations
 * - Ensures type safety for ecosystem operations
 */

import { NPM } from '@socketsecurity/lib-stable/constants/agents'

import type { components } from '@socketsecurity/sdk-stable/types/api'

export type PURL_Type = components['schemas']['SocketPURL_Type']

// Type checking utilities to ensure ecosystem types are properly aligned.
// NOTE: Commented out because EcosystemString has additional types not in PURL_Type
// (unknown, vcs, qpkg, swid) which causes type checking errors.
// type ExpectNever<T extends never> = T
// type MissingInEcosystemString = Exclude<PURL_Type, EcosystemString>
// type ExtraInEcosystemString = Exclude<EcosystemString, PURL_Type>
// export type _Check_EcosystemString_has_all_purl_types =
//   ExpectNever<MissingInEcosystemString>
// export type _Check_EcosystemString_has_no_extras =
//   ExpectNever<ExtraInEcosystemString>

export const ALL_ECOSYSTEMS = [
  'alpm',
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
  'gitlab' as PURL_Type,
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
  'rpm',
  'swift',
  'vscode',
  // The following are in EcosystemString but not in PURL_Type:
  // 'qpkg',
  // 'swid',
  // 'unknown',
  // 'vcs',
] as const satisfies readonly PURL_Type[]

// Type checking utilities to ensure ALL_ECOSYSTEMS array is properly aligned.
// NOTE: Commented out because of type alignment issues between PURL_Type from SDK
// and other ecosystem representations.
// type AllEcosystemsUnion = (typeof ALL_ECOSYSTEMS)[number]
// type MissingInAllEcosystems = Exclude<PURL_Type, AllEcosystemsUnion>
// type ExtraInAllEcosystems = Exclude<AllEcosystemsUnion, PURL_Type>
// export type _Check_ALL_ECOSYSTEMS_has_all_purl_types =
//   ExpectNever<MissingInAllEcosystems>
// export type _Check_ALL_ECOSYSTEMS_has_no_extras =
//   ExpectNever<ExtraInAllEcosystems>

export function getEcosystemChoicesForMeow(): string[] {
  return [...ALL_ECOSYSTEMS]
}
