/**
 * npm package specification utilities for Socket CLI.
 * Parses and handles various npm package specification formats.
 *
 * Supported Formats:
 * - Regular packages: lodash, lodash@4.17.21
 * - Scoped packages: @types/node, @types/node@20.0.0
 * - Version ranges: lodash@^4.0.0, lodash@~4.17.0
 * - Git URLs: git+https://github.com/user/repo.git
 * - File paths: file:../local-package
 * - Aliases: my-alias@npm:real-package@1.0.0
 *
 * Key Functions:
 * - safeNpa: Safe wrapper for npm-package-arg
 * - safeNpmSpecToPurl: Convert npm spec to PURL
 * - safeParseNpmSpec: Parse npm spec to name/version
 *
 * Error Handling:
 * - Returns undefined for invalid specs
 * - Fallback parsing for edge cases
 * - Safe against malformed input
 */

import npmPackageArg from 'npm-package-arg'

import { NPM } from '../../constants.mts'
import { createPurlObject } from '../purl/parse.mts'

export type {
  AliasResult,
  FileResult,
  HostedGit,
  HostedGitResult,
  RegistryResult,
  Result,
  URLResult,
} from 'npm-package-arg'

export type ParsedPackageSpec = {
  name: string
  version: string | undefined
}

/**
 * Safe wrapper for npm-package-arg that doesn't throw.
 * Returns undefined if parsing fails.
 */
export function safeNpa(
  ...args: Parameters<typeof npmPackageArg>
): ReturnType<typeof npmPackageArg> | undefined {
  try {
    return Reflect.apply(npmPackageArg, undefined, args)
  } catch {}
  return undefined
}

/**
 * Parse npm package specification into name and version.
 * Uses npm-package-arg for proper handling of various spec formats:
 * - Regular packages: lodash, lodash@4.17.21
 * - Scoped packages: @types/node, @types/node@20.0.0
 * - Version ranges: lodash@^4.0.0
 * - Git URLs, file paths, etc.
 *
 * Returns undefined if parsing fails.
 */
export function safeParseNpmSpec(
  pkgSpec: string,
): ParsedPackageSpec | undefined {
  // Use npm-package-arg for proper spec parsing.
  const parsed = safeNpa(pkgSpec)

  if (!parsed) {
    // Fallback to simple parsing if npm-package-arg fails.
    // Return undefined for empty spec.
    if (!pkgSpec) {
      return undefined
    }

    // Handle scoped packages first to avoid confusion with version delimiter.
    if (pkgSpec.startsWith('@')) {
      const scopedMatch = pkgSpec.match(/^(@[^/@]+\/[^/@]+)(?:@(.+))?$/)
      if (scopedMatch) {
        return {
          name: scopedMatch[1]!,
          version: scopedMatch[2],
        }
      }
    }

    // Handle regular packages.
    const atIndex = pkgSpec.indexOf('@')
    if (atIndex === -1) {
      return { name: pkgSpec, version: undefined }
    }

    return {
      name: pkgSpec.slice(0, atIndex),
      version: pkgSpec.slice(atIndex + 1),
    }
  }

  // Extract name and version from parsed spec.
  const name = parsed.name || pkgSpec

  // If name is empty, parsing failed.
  if (!name) {
    return undefined
  }

  let version: string | undefined

  // Handle different spec types from npm-package-arg.
  if (
    parsed.type === 'tag' ||
    parsed.type === 'version' ||
    parsed.type === 'range'
  ) {
    // For npm registry packages:
    // - type 'tag': latest, beta, etc.
    // - type 'version': exact version like 1.0.0
    // - type 'range': version range like ^1.0.0, ~1.0.0, or * for bare names
    // Don't include '*' as a version - it means "any version".
    if (parsed.fetchSpec && parsed.fetchSpec !== '*') {
      version = parsed.fetchSpec
    } else if (
      parsed.rawSpec &&
      parsed.rawSpec !== '*' &&
      parsed.rawSpec !== parsed.name
    ) {
      version = parsed.rawSpec
    }
  } else if (
    parsed.type === 'git' ||
    parsed.type === 'remote' ||
    parsed.type === 'file'
  ) {
    // For non-registry specs, use rawSpec if different from name.
    if (parsed.rawSpec && parsed.rawSpec !== parsed.name) {
      version = parsed.rawSpec
    }
  }

  return { name, version }
}

/**
 * Convert npm package spec to PURL string.
 * Handles various npm spec formats and converts them to standardized PURLs.
 * Returns undefined if conversion fails.
 */
export function safeNpmSpecToPurl(pkgSpec: string): string | undefined {
  const parsed = safeParseNpmSpec(pkgSpec)
  if (!parsed) {
    return undefined
  }

  const { name, version } = parsed

  // Create PURL object to ensure proper formatting.
  const purlObj = createPurlObject({
    type: NPM,
    name,
    version,
    throws: false,
  })

  return (
    purlObj?.toString() ?? `pkg:${NPM}/${name}${version ? `@${version}` : ''}`
  )
}

/**
 * Convert npm package spec to PURL string.
 * Handles various npm spec formats and converts them to standardized PURLs.
 * Throws if conversion fails.
 */
export function npmSpecToPurl(pkgSpec: string): string {
  const purl = safeNpmSpecToPurl(pkgSpec)
  if (!purl) {
    throw new Error(`Failed to convert ${NPM} spec to PURL: ${pkgSpec}`)
  }
  return purl
}
