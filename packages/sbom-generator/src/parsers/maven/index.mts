/**
 * maven Ecosystem Parser
 *
 * Parses Java/Maven projects (pom.xml) into CycloneDX SBOM format.
 *
 * Lock-Step Reference: cdxgen's lib/parsers/java.js
 * @see https://github.com/CycloneDX/cdxgen/blob/master/lib/parsers/java.js
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { XMLParser } from 'fast-xml-parser'
import type { Component, Dependency } from '../../types/sbom.mts'
import type {
  Ecosystem,
  ParseOptions,
  ParseResult,
  Parser,
  ProjectMetadata,
} from '../../types/parser.mts'

export class MavenParser implements Parser {
  readonly ecosystem: Ecosystem = 'maven'
  private xmlParser = new XMLParser({ ignoreAttributes: false })

  async detect(projectPath: string): Promise<boolean> {
    try {
      const pomPath = path.join(projectPath, 'pom.xml')
      await fs.access(pomPath)
      return true
    } catch {
      return false
    }
  }

  async parse(projectPath: string, options: ParseOptions = {}): Promise<ParseResult> {
    const pomPath = path.join(projectPath, 'pom.xml')
    const content = await fs.readFile(pomPath, 'utf8')
    const parsed = this.xmlParser.parse(content)

    const project = parsed.project
    const metadata: ProjectMetadata = {
      name: project.artifactId || 'unknown',
      version: project.version || '0.0.0',
      description: project.description,
    }

    const dependencies = new Map<string, { groupId: string; artifactId: string; version: string }>()

    if (project.dependencies?.dependency) {
      const deps = Array.isArray(project.dependencies.dependency)
        ? project.dependencies.dependency
        : [project.dependencies.dependency]

      for (const dep of deps) {
        const key = `${dep.groupId}:${dep.artifactId}`
        dependencies.set(key, {
          groupId: dep.groupId,
          artifactId: dep.artifactId,
          version: dep.version || 'latest',
        })
      }
    }

    const components: Component[] = Array.from(dependencies.values()).map(dep => ({
      type: 'library',
      'bom-ref': `pkg:maven/${dep.groupId}/${dep.artifactId}@${dep.version}`,
      name: `${dep.groupId}:${dep.artifactId}`,
      version: dep.version,
      purl: `pkg:maven/${dep.groupId}/${dep.artifactId}@${dep.version}`,
      scope: 'required',
    }))

    const graph: Dependency[] = [{
      ref: `pkg:maven/${project.groupId}/${metadata.name}@${metadata.version}`,
      dependsOn: components.map(c => c.purl || ''),
    }]

    return {
      ecosystem: this.ecosystem,
      metadata,
      components,
      dependencies: graph,
    }
  }
}
