/**
 * rubygems Ecosystem Parser
 *
 * Parses Ruby projects (Gemfile + Gemfile.lock) into CycloneDX SBOM format.
 * Supports: Gemfile.lock (lockfile)
 *
 * Lock-Step Reference: cdxgen's lib/parsers/ruby.js
 * - Baseline: cdxgen v11.11.0
 * - Lock-Step Score: Target 90-100
 * - Deviations: Pure text parsing (no bundler binary)
 *
 * @see https://github.com/CycloneDX/cdxgen/blob/master/lib/parsers/ruby.js
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import type { Component, Dependency } from '../../types/sbom.mts'
import type {
  Ecosystem,
  ParseOptions,
  ParseResult,
  Parser,
  ProjectMetadata,
} from '../../types/parser.mts'

/**
 * Ruby gem dependency information.
 */
interface GemDependencyInfo {
  name: string
  version: string
  dependencies: string[]
}

/**
 * rubygems parser implementation.
 *
 * cdxgen reference: parseRubyProject() in lib/parsers/ruby.js
 * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/ruby.js
 */
export class RubygemsParser implements Parser {
  readonly ecosystem: Ecosystem = 'rubygems'

  /**
   * Detect if this is a Ruby project.
   *
   * cdxgen reference: detectRubyProject() checks for Gemfile or Gemfile.lock.
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/ruby.js#L30-L50
   */
  async detect(projectPath: string): Promise<boolean> {
    try {
      const gemfilePath = path.join(projectPath, 'Gemfile')
      await fs.access(gemfilePath)
      return true
    } catch {
      try {
        const gemfileLockPath = path.join(projectPath, 'Gemfile.lock')
        await fs.access(gemfileLockPath)
        return true
      } catch {
        return false
      }
    }
  }

  /**
   * Parse Ruby project and generate SBOM components.
   *
   * cdxgen reference: parseRubyProject() reads Gemfile.lock.
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/ruby.js#L80-L130
   */
  async parse(
    projectPath: string,
    options: ParseOptions = {},
  ): Promise<ParseResult> {
    const metadata = await this.extractMetadata(projectPath)
    const dependencies = await this.parseGemfileLock(projectPath)

    const components = this.buildComponents(dependencies, options)
    const dependencyGraph = this.buildDependencyGraph(metadata, dependencies)

    return {
      ecosystem: this.ecosystem,
      metadata,
      components,
      dependencies: dependencyGraph,
    }
  }

  /**
   * Extract project metadata.
   *
   * Ruby projects don't have explicit metadata files like package.json.
   * Metadata would come from .gemspec files.
   */
  private async extractMetadata(projectPath: string): Promise<ProjectMetadata> {
    const projectName = path.basename(projectPath)
    return {
      name: projectName,
      version: '0.0.0',
    }
  }

  /**
   * Parse Gemfile.lock.
   *
   * cdxgen reference: parseGemfileLock() parses custom text format.
   * Gemfile.lock format:
   * GEM
   *   remote: https://rubygems.org/
   *   specs:
   *     gem-name (1.0.0)
   *       dependency1 (~> 2.0)
   *       dependency2
   *
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/ruby.js#L200-L250
   */
  private async parseGemfileLock(
    projectPath: string,
  ): Promise<Map<string, GemDependencyInfo>> {
    const dependencies = new Map<string, GemDependencyInfo>()

    try {
      const lockfilePath = path.join(projectPath, 'Gemfile.lock')
      const content = await fs.readFile(lockfilePath, 'utf8')
      const lines = content.split('\n')

      let inSpecsSection = false
      let currentGem: GemDependencyInfo | null = null

      for (const line of lines) {
        // Check for specs section.
        if (line.trim() === 'specs:') {
          inSpecsSection = true
          continue
        }

        if (!inSpecsSection) {
          continue
        }

        // End of specs section.
        if (line.match(/^[A-Z]/)) {
          inSpecsSection = false
          continue
        }

        // Parse gem definition: "    gem-name (1.0.0)"
        const gemMatch = line.match(/^\s{4}(\S+)\s+\(([^)]+)\)/)
        if (gemMatch) {
          if (currentGem) {
            dependencies.set(currentGem.name, currentGem)
          }
          currentGem = {
            name: gemMatch[1],
            version: gemMatch[2],
            dependencies: [],
          }
          continue
        }

        // Parse dependency: "      dependency-name (~> 2.0)"
        const depMatch = line.match(/^\s{6}(\S+)/)
        if (depMatch && currentGem) {
          currentGem.dependencies.push(depMatch[1])
        }
      }

      // Add last gem.
      if (currentGem) {
        dependencies.set(currentGem.name, currentGem)
      }
    } catch {
      // Gemfile.lock doesn't exist.
    }

    return dependencies
  }

  /**
   * Build CycloneDX components.
   *
   * cdxgen reference: createRubyComponents()
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/ruby.js#L280-L320
   */
  private buildComponents(
    dependencies: Map<string, GemDependencyInfo>,
    options: ParseOptions,
  ): Component[] {
    const components: Component[] = []

    for (const [name, dep] of dependencies.entries()) {
      components.push({
        type: 'library',
        'bom-ref': `pkg:gem/${dep.name}@${dep.version}`,
        name: dep.name,
        version: dep.version,
        purl: `pkg:gem/${dep.name}@${dep.version}`,
        scope: 'required',
      })
    }

    return components
  }

  /**
   * Build dependency graph.
   *
   * cdxgen reference: createRubyDependencyGraph()
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/ruby.js#L340-L380
   */
  private buildDependencyGraph(
    metadata: ProjectMetadata,
    dependencies: Map<string, GemDependencyInfo>,
  ): Dependency[] {
    const graph: Dependency[] = []

    const rootRef = `pkg:gem/${metadata.name}@${metadata.version}`
    const directDeps = Array.from(dependencies.values()).map(
      d => `pkg:gem/${d.name}@${d.version}`,
    )

    graph.push({
      ref: rootRef,
      dependsOn: directDeps,
    })

    for (const [name, dep] of dependencies.entries()) {
      const ref = `pkg:gem/${dep.name}@${dep.version}`
      const dependsOn = dep.dependencies
        .map(depName => {
          const transitive = dependencies.get(depName)
          return transitive
            ? `pkg:gem/${transitive.name}@${transitive.version}`
            : null
        })
        .filter((purl): purl is string => purl !== null)

      if (dependsOn.length > 0) {
        graph.push({ ref, dependsOn })
      }
    }

    return graph
  }
}
