/**
 * Parser Interface Types
 *
 * Base types for ecosystem-specific parsers.
 */

import type { Component, Dependency } from './sbom.mts'

/**
 * Supported ecosystems.
 */
export type Ecosystem =
  | 'npm'
  | 'pypi'
  | 'maven'
  | 'gradle'
  | 'go'
  | 'cargo'
  | 'rubygems'
  | 'packagist'
  | 'nuget'

/**
 * Base parser interface - all ecosystem parsers implement this.
 */
export interface Parser {
  /**
   * Ecosystem identifier.
   */
  readonly ecosystem: Ecosystem

  /**
   * Detect if this parser can handle the given directory.
   */
  detect(projectPath: string): Promise<boolean>

  /**
   * Parse project and generate SBOM components.
   */
  parse(projectPath: string, options?: ParseOptions): Promise<ParseResult>
}

/**
 * Options for parsing.
 */
export interface ParseOptions {
  /**
   * Include development dependencies.
   */
  includeDevDependencies?: boolean

  /**
   * Include transitive dependencies (deep parsing).
   */
  deep?: boolean

  /**
   * Only parse lockfile, ignore manifest.
   */
  lockfileOnly?: boolean
}

/**
 * Result from parsing.
 */
export interface ParseResult {
  /**
   * Ecosystem that was parsed.
   */
  ecosystem: Ecosystem

  /**
   * Project metadata from manifest.
   */
  metadata: ProjectMetadata

  /**
   * SBOM components (packages).
   */
  components: Component[]

  /**
   * Dependency relationships.
   */
  dependencies: Dependency[]
}

/**
 * Project metadata extracted from manifest.
 */
export interface ProjectMetadata {
  /**
   * Project name.
   */
  name: string

  /**
   * Project version.
   */
  version: string

  /**
   * Project description.
   */
  description?: string

  /**
   * Project homepage URL.
   */
  homepage?: string

  /**
   * Repository URL.
   */
  repository?: string

  /**
   * License identifier (SPDX).
   */
  license?: string

  /**
   * Authors/maintainers.
   */
  authors?: string[]

  /**
   * Keywords/tags.
   */
  keywords?: string[]
}
