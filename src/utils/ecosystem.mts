/**
 * Ecosystem type utilities for Socket CLI.
 * Manages package ecosystem identifiers and mappings.
 *
 * Constants:
 * - ALL_ECOSYSTEMS: Complete list of supported ecosystems
 * - ECOSYSTEM_MAP: Map ecosystem strings to PURL types
 *
 * Type Definitions:
 * - PURL_Type: Package URL type from Socket SDK
 *
 * Supported Ecosystems:
 * - alpm, apk, bitbucket, cargo, chrome, cocoapods, composer
 * - conan, conda, cran, deb, docker, gem, generic
 * - github, gitlab, go, hackage, hex, huggingface
 * - maven, mlflow, npm, nuget, oci, pub, pypi, qpkg, rpm
 * - swift, swid, unknown, vscode
 *
 * Usage:
 * - Validates ecosystem types
 * - Maps between different ecosystem representations
 * - Ensures type safety for ecosystem operations
 */

import { joinAnd } from '@socketsecurity/registry/lib/arrays'

import { NPM } from '../constants.mts'
import { InputError } from './errors.mts'

import type { EcosystemString } from '@socketsecurity/registry'
import type { components } from '@socketsecurity/sdk/types/api'

export type PURL_Type = components['schemas']['SocketPURL_Type']

type ExpectNever<T extends never> = T

// Temporarily commented out due to dependency version mismatch.
// SDK has "alpm" but registry's EcosystemString doesn't yet.
// type MissingInEcosystemString = Exclude<PURL_Type, EcosystemString>
type ExtraInEcosystemString = Exclude<EcosystemString, PURL_Type>

// export type _Check_EcosystemString_has_all_purl_types =
//   ExpectNever<MissingInEcosystemString>
export type _Check_EcosystemString_has_no_extras =
  ExpectNever<ExtraInEcosystemString>

export const ALL_ECOSYSTEMS = [
  'alpm',
  'apk',
  'bitbucket',
  'cargo',
  'chrome',
  'clawhub',
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
  'socket',
  'swift',
  'swid',
  'unknown',
  'vscode',
] as const satisfies readonly PURL_Type[]

type AllEcosystemsUnion = (typeof ALL_ECOSYSTEMS)[number]
type MissingInAllEcosystems = Exclude<PURL_Type, AllEcosystemsUnion>
type ExtraInAllEcosystems = Exclude<AllEcosystemsUnion, PURL_Type>

export type _Check_ALL_ECOSYSTEMS_has_all_purl_types =
  ExpectNever<MissingInAllEcosystems>
export type _Check_ALL_ECOSYSTEMS_has_no_extras =
  ExpectNever<ExtraInAllEcosystems>

export const ALL_SUPPORTED_ECOSYSTEMS = new Set<string>(ALL_ECOSYSTEMS)

// Purl types accepted by Coana's reachability `--purl-types` gate
// (@coana-tech/cli `getAdvisoryEcosystemFromPurlType`), narrower than
// ALL_ECOSYSTEMS. Values outside this set are rejected by the engine at scan
// time, so we validate up front. Keep in sync when bumping @coana-tech/cli.
export const REACHABILITY_SUPPORTED_ECOSYSTEMS = [
  'cargo',
  'composer',
  'gem',
  'golang',
  'maven',
  NPM,
  'nuget',
  'pypi',
] as const satisfies readonly PURL_Type[]

export function getEcosystemChoicesForMeow(): string[] {
  return [...ALL_ECOSYSTEMS]
}

export function getReachabilityEcosystemChoices(): string[] {
  return [...REACHABILITY_SUPPORTED_ECOSYSTEMS]
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

export function parseReachEcosystems(raw: readonly string[]): PURL_Type[] {
  const choices = getReachabilityEcosystemChoices()
  const result: PURL_Type[] = []
  for (const ecosystem of raw) {
    if (!choices.includes(ecosystem)) {
      throw new InputError(
        `Invalid ecosystem: "${ecosystem}". Valid values are: ${joinAnd(choices)}`,
      )
    }
    result.push(ecosystem as PURL_Type)
  }
  return result
}
