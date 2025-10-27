/**
 * nuget Ecosystem Parser
 *
 * Parses .NET projects (packages.config, .csproj) into CycloneDX SBOM format.
 *
 * Lock-Step Reference: cdxgen's lib/parsers/dotnet.js
 * @see https://github.com/CycloneDX/cdxgen/blob/master/lib/parsers/dotnet.js
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

export class NugetParser implements Parser {
  readonly ecosystem: Ecosystem = 'nuget'
  private xmlParser = new XMLParser({ ignoreAttributes: false })

  async detect(projectPath: string): Promise<boolean> {
    try {
      const csprojFiles = await fs.readdir(projectPath)
      return csprojFiles.some(f => f.endsWith('.csproj'))
    } catch {
      return false
    }
  }

  async parse(
    projectPath: string,
    options: ParseOptions = {},
  ): Promise<ParseResult> {
    const metadata: ProjectMetadata = {
      name: path.basename(projectPath),
      version: '0.0.0',
    }

    const dependencies = new Map<string, { name: string; version: string }>()

    // Parse .csproj files for PackageReference.
    const files = await fs.readdir(projectPath)
    for (const file of files) {
      if (!file.endsWith('.csproj')) continue

      const content = await fs.readFile(path.join(projectPath, file), 'utf8')
      const parsed = this.xmlParser.parse(content)

      // Extract PackageReference elements.
      const project = parsed.Project
      if (project?.ItemGroup) {
        const itemGroups = Array.isArray(project.ItemGroup)
          ? project.ItemGroup
          : [project.ItemGroup]
        for (const group of itemGroups) {
          const refs = group.PackageReference
          if (refs) {
            const refArray = Array.isArray(refs) ? refs : [refs]
            for (const ref of refArray) {
              const name = ref['@_Include']
              const version = ref['@_Version']
              if (name && version) {
                dependencies.set(name, { name, version })
              }
            }
          }
        }
      }
    }

    const components: Component[] = Array.from(dependencies.values()).map(
      dep => ({
        type: 'library',
        'bom-ref': `pkg:nuget/${dep.name}@${dep.version}`,
        name: dep.name,
        version: dep.version,
        purl: `pkg:nuget/${dep.name}@${dep.version}`,
        scope: 'required',
      }),
    )

    const graph: Dependency[] = [
      {
        ref: `pkg:nuget/${metadata.name}@${metadata.version}`,
        dependsOn: components.map(c => c.purl || ''),
      },
    ]

    return {
      ecosystem: this.ecosystem,
      metadata,
      components,
      dependencies: graph,
    }
  }
}
