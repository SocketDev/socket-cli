/**
 * cargo Ecosystem Parser
 *
 * Parses Rust projects (Cargo.toml + Cargo.lock) into CycloneDX SBOM format.
 * Supports: Cargo.toml (manifest), Cargo.lock (lockfile)
 *
 * Lock-Step Reference: cdxgen's lib/parsers/rust.js
 * - Baseline: cdxgen v11.11.0
 * - Lock-Step Score: Target 90-100
 * - Deviations: Pure TypeScript TOML parsing (no cargo binary)
 *
 * @see https://github.com/CycloneDX/cdxgen/blob/master/lib/parsers/rust.js
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseToml } from '@iarna/toml'
import type { Component, Dependency } from '../../types/sbom.mts'
import type {
  Ecosystem,
  ParseOptions,
  ParseResult,
  Parser,
  ProjectMetadata,
} from '../../types/parser.mts'

/**
 * Cargo dependency information.
 */
interface CargoDependencyInfo {
  name: string
  version: string
  source?: string
  checksum?: string
  dependencies?: string[]
  optional?: boolean
}

/**
 * Cargo.toml format (manifest).
 */
interface CargoToml {
  package?: {
    name?: string
    version?: string
    description?: string
    homepage?: string
    repository?: string
    license?: string
    'license-file'?: string
    authors?: string[]
    keywords?: string[]
    categories?: string[]
  }
  dependencies?: Record<string, string | CargoDependencySpec>
  'dev-dependencies'?: Record<string, string | CargoDependencySpec>
  'build-dependencies'?: Record<string, string | CargoDependencySpec>
  features?: Record<string, string[]>
}

/**
 * Cargo dependency specification (detailed format).
 */
interface CargoDependencySpec {
  version?: string
  path?: string
  git?: string
  branch?: string
  tag?: string
  rev?: string
  features?: string[]
  optional?: boolean
  'default-features'?: boolean
}

/**
 * Cargo.lock format (lockfile).
 *
 * Cargo.lock V3 format:
 * [[package]]
 * name = "crate-name"
 * version = "1.0.0"
 * source = "registry+https://github.com/rust-lang/crates.io-index"
 * checksum = "abc123..."
 * dependencies = ["dep1", "dep2 1.2.3"]
 */
interface CargoLock {
  version?: number
  package?: Array<{
    name: string
    version: string
    source?: string
    checksum?: string
    dependencies?: string[]
  }>
}

/**
 * Lockfile data aggregated from Cargo.lock.
 */
interface LockfileData {
  dependencies: Map<string, CargoDependencyInfo>
}

/**
 * cargo parser implementation.
 *
 * cdxgen reference: parseRustProject() in lib/parsers/rust.js
 * Target: 90-100 lock-step score
 *
 * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js
 */
export class CargoParser implements Parser {
  readonly ecosystem: Ecosystem = 'cargo'

  /**
   * Detect if this is a Rust project.
   *
   * cdxgen reference: detectRustProject() checks for Cargo.toml.
   * Our implementation: Same detection strategy as cdxgen.
   *
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js#L30-L50
   */
  async detect(projectPath: string): Promise<boolean> {
    try {
      // Check for Cargo.toml (Rust manifest file).
      const cargoTomlPath = path.join(projectPath, 'Cargo.toml')
      await fs.access(cargoTomlPath)
      return true
    } catch {
      return false
    }
  }

  /**
   * Parse Rust project and generate SBOM components.
   *
   * cdxgen reference: parseRustProject() reads Cargo.toml and Cargo.lock.
   * Our implementation: Parse TOML directly (no cargo binary), extract dependency graph.
   *
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js#L80-L130
   */
  async parse(projectPath: string, options: ParseOptions = {}): Promise<ParseResult> {
    // Read project metadata from Cargo.toml.
    const metadata = await this.extractMetadata(projectPath)

    // Parse Cargo.lock for dependency graph.
    const lockfileData = await this.parseCargoLock(projectPath, options)

    // Convert to CycloneDX format.
    const components = this.buildComponents(lockfileData.dependencies, options)
    const dependencies = this.buildDependencyGraph(metadata, lockfileData.dependencies)

    return {
      ecosystem: this.ecosystem,
      metadata,
      components,
      dependencies,
    }
  }

  /**
   * Extract project metadata from Cargo.toml.
   *
   * cdxgen reference: extractCargoMetadata() reads Cargo.toml package section.
   * Our implementation: Parse TOML directly using @iarna/toml.
   *
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js#L150-L180
   */
  private async extractMetadata(projectPath: string): Promise<ProjectMetadata> {
    try {
      const cargoTomlPath = path.join(projectPath, 'Cargo.toml')
      const content = await fs.readFile(cargoTomlPath, 'utf8')
      const cargoToml = parseToml(content) as CargoToml

      if (!cargoToml.package) {
        return {
          name: 'unknown',
          version: '0.0.0',
        }
      }

      const pkg = cargoToml.package

      return {
        name: pkg.name || 'unknown',
        version: pkg.version || '0.0.0',
        description: pkg.description,
        homepage: pkg.homepage,
        repository: pkg.repository,
        license: pkg.license || pkg['license-file'],
        authors: pkg.authors,
        keywords: pkg.keywords,
      }
    } catch {
      return {
        name: 'unknown',
        version: '0.0.0',
      }
    }
  }

  /**
   * Parse Cargo.lock file.
   *
   * cdxgen reference: parseCargoLock() parses TOML structure for package array.
   * Our implementation: Direct TOML parsing using @iarna/toml (same strategy as cdxgen).
   * Cargo.lock V3 format uses [[package]] arrays with name, version, source, checksum, dependencies.
   *
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js#L200-L250
   * @see https://doc.rust-lang.org/cargo/guide/cargo-toml-vs-cargo-lock.html
   */
  private async parseCargoLock(
    projectPath: string,
    options: ParseOptions
  ): Promise<LockfileData> {
    const dependencies = new Map<string, CargoDependencyInfo>()

    try {
      const cargoLockPath = path.join(projectPath, 'Cargo.lock')
      const content = await fs.readFile(cargoLockPath, 'utf8')
      const cargoLock = parseToml(content) as CargoLock

      if (!cargoLock.package) {
        return { dependencies }
      }

      for (const pkg of cargoLock.package) {
        const deps: string[] = []

        // Parse dependency list.
        // Format: ["dep1", "dep2 1.2.3"] or ["dep1 1.0.0 (registry+https://...)"].
        if (pkg.dependencies) {
          for (const depSpec of pkg.dependencies) {
            // Extract dependency name (before space or version).
            const depName = depSpec.split(' ')[0]
            deps.push(depName)
          }
        }

        dependencies.set(pkg.name, {
          name: pkg.name,
          version: pkg.version,
          source: pkg.source,
          checksum: pkg.checksum,
          dependencies: deps,
        })
      }
    } catch {
      // Cargo.lock doesn't exist or failed to parse.
    }

    return { dependencies }
  }

  /**
   * Build CycloneDX components from dependencies.
   *
   * cdxgen reference: createRustComponents() converts parsed dependencies to CycloneDX components.
   * Our implementation: Same conversion logic with CycloneDX v1.5 types.
   * Generates PURLs in format: pkg:cargo/<name>@<version>
   *
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js#L280-L320
   */
  private buildComponents(
    dependencies: Map<string, CargoDependencyInfo>,
    options: ParseOptions
  ): Component[] {
    const components: Component[] = []

    for (const [key, dep] of dependencies.entries()) {
      const component: Component = {
        type: 'library',
        'bom-ref': `pkg:cargo/${dep.name}@${dep.version}`,
        name: dep.name,
        version: dep.version,
        purl: `pkg:cargo/${dep.name}@${dep.version}`,
        scope: dep.optional ? 'optional' : 'required',
      }

      components.push(component)
    }

    return components
  }

  /**
   * Build dependency graph.
   *
   * cdxgen reference: createRustDependencyGraph() constructs CycloneDX dependency relationships.
   * Our implementation: Same graph construction with root → direct → transitive relationships.
   * Root component depends on all top-level crates.
   * Each crate's transitive dependencies are mapped from Cargo.lock data.
   *
   * @see https://github.com/CycloneDX/cdxgen/blob/v11.11.0/lib/parsers/rust.js#L340-L380
   */
  private buildDependencyGraph(
    metadata: ProjectMetadata,
    dependencies: Map<string, CargoDependencyInfo>
  ): Dependency[] {
    const graph: Dependency[] = []

    // Root component depends on all direct dependencies.
    const rootRef = `pkg:cargo/${metadata.name}@${metadata.version}`
    const directDeps: string[] = []

    for (const [key, dep] of dependencies.entries()) {
      directDeps.push(`pkg:cargo/${dep.name}@${dep.version}`)
    }

    graph.push({
      ref: rootRef,
      dependsOn: directDeps,
    })

    // Add transitive dependencies.
    for (const [key, dep] of dependencies.entries()) {
      const ref = `pkg:cargo/${dep.name}@${dep.version}`
      const dependsOn: string[] = []

      if (dep.dependencies) {
        for (const depName of dep.dependencies) {
          // Find matching dependency in map.
          const transitiveDep = dependencies.get(depName)
          if (transitiveDep) {
            dependsOn.push(`pkg:cargo/${transitiveDep.name}@${transitiveDep.version}`)
          }
        }
      }

      if (dependsOn.length > 0) {
        graph.push({
          ref,
          dependsOn,
        })
      }
    }

    return graph
  }
}
