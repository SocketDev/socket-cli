/**
 * SBOM Generator Entry Point
 *
 * Type-safe CycloneDX SBOM generator for multi-ecosystem projects.
 */

import { randomUUID } from 'node:crypto'

import type {
  Component,
  Dependency,
  ExternalReference,
  Sbom,
} from './types/sbom.mts'
import type { Ecosystem, ParseOptions, Parser } from './types/parser.mts'

import { NpmParser } from './parsers/index.mts'

/**
 * Generate options.
 */
export interface GenerateOptions extends ParseOptions {
  /**
   * Limit to specific ecosystems (auto-detects all if not specified).
   */
  ecosystems?: Ecosystem[]
}

/**
 * Available parsers.
 */
const PARSERS: Parser[] = [new NpmParser()]

/**
 * Generate CycloneDX SBOM for a project.
 *
 * @param projectPath - Path to project directory
 * @param options - Generation options
 * @returns CycloneDX SBOM object
 */
export async function generateSbom(
  projectPath: string,
  options: GenerateOptions = {},
): Promise<Sbom> {
  // Auto-detect applicable parsers.
  const parsers = await detectParsers(projectPath, options.ecosystems)

  if (!parsers.length) {
    throw new Error('No supported ecosystems detected in project')
  }

  // Parse each ecosystem.
  const results = await Promise.all(
    parsers.map(p => p.parse(projectPath, options)),
  )

  // Combine into single SBOM.
  return combineSbom(results)
}

/**
 * Detect which parsers can handle this project.
 */
async function detectParsers(
  projectPath: string,
  ecosystems?: Ecosystem[],
): Promise<Parser[]> {
  const applicable: Parser[] = []

  for (const parser of PARSERS) {
    // Skip if not in allowed ecosystems.
    if (ecosystems && !ecosystems.includes(parser.ecosystem)) {
      continue
    }

    // Check if parser can handle this project.
    const canHandle = await parser.detect(projectPath)
    if (canHandle) {
      applicable.push(parser)
    }
  }

  return applicable
}

/**
 * Combine multiple parse results into single SBOM.
 */
function combineSbom(
  results: Array<{
    ecosystem: Ecosystem
    metadata: {
      name: string
      version: string
      description?: string
      homepage?: string
      repository?: string
      license?: string
      authors?: string[]
      keywords?: string[]
    }
    components: Component[]
    dependencies: Dependency[]
  }>,
): Sbom {
  // Use first result as primary metadata (typically root project).
  const primary = results[0]
  if (!primary) {
    throw new Error('No results provided to buildSbom')
  }

  // Collect all components and dependencies.
  const allComponents: Component[] = []
  const allDependencies: Dependency[] = []

  for (const result of results) {
    allComponents.push(...result.components)
    allDependencies.push(...result.dependencies)
  }

  // Deduplicate components by bom-ref.
  const uniqueComponents = deduplicateComponents(allComponents)

  // Build SBOM.
  const sbom: Sbom = {
    bomFormat: 'CycloneDX',
    specVersion: '1.5',
    serialNumber: `urn:uuid:${randomUUID()}`,
    version: 1,
    metadata: {
      timestamp: new Date().toISOString(),
      tools: [
        {
          vendor: 'Socket.dev',
          name: '@socketsecurity/sbom-generator',
          version: '1.0.0',
        },
      ],
      component: (() => {
        const extRefs = buildExternalReferences(primary.metadata)
        return {
          type: 'application',
          'bom-ref': `pkg:${primary.ecosystem}/${primary.metadata.name}@${primary.metadata.version}`,
          name: primary.metadata.name,
          version: primary.metadata.version,
          ...(primary.metadata.description && {
            description: primary.metadata.description,
          }),
          ...(primary.metadata.license && {
            licenses: [{ license: { id: primary.metadata.license } }],
          }),
          ...(extRefs && extRefs.length > 0 && {
            externalReferences: extRefs,
          }),
        }
      })(),
    },
    components: uniqueComponents,
    dependencies: allDependencies,
  }

  return sbom
}

/**
 * Deduplicate components by bom-ref.
 */
function deduplicateComponents(components: Component[]): Component[] {
  const seen = new Set<string>()
  const unique: Component[] = []

  for (const component of components) {
    const ref = component['bom-ref']
    if (ref && seen.has(ref)) {
      continue
    }

    if (ref) {
      seen.add(ref)
    }
    unique.push(component)
  }

  return unique
}

/**
 * Build external references from metadata.
 */
function buildExternalReferences(metadata: {
  homepage?: string
  repository?: string
}): ExternalReference[] | undefined {
  const refs: ExternalReference[] = []

  if (metadata.homepage) {
    refs.push({
      url: metadata.homepage,
      type: 'website' as const,
    })
  }

  if (metadata.repository) {
    refs.push({
      url: metadata.repository,
      type: 'vcs' as const,
    })
  }

  return refs.length > 0 ? refs : undefined
}

// Re-export types.
export type { Component, Dependency, Sbom } from './types/sbom.mts'
export type {
  Ecosystem,
  ParseOptions,
  ParseResult,
  Parser,
  ProjectMetadata,
} from './types/parser.mts'
