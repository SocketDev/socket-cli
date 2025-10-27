/**
 * actions Ecosystem Parser
 *
 * Parses GitHub Actions workflows (.github/workflows/*.yml) into CycloneDX SBOM format.
 *
 * Lock-Step Reference: cdxgen's lib/parsers/github.js
 * @see https://github.com/CycloneDX/cdxgen/blob/master/lib/parsers/github.js
 */

import { promises as fs } from 'node:fs'
import path from 'node:path'
import { parse as parseYaml } from 'yaml'
import type { Component, Dependency } from '../../types/sbom.mts'
import type {
  Ecosystem,
  ParseOptions,
  ParseResult,
  Parser,
  ProjectMetadata,
} from '../../types/parser.mts'

export class ActionsParser implements Parser {
  readonly ecosystem: Ecosystem = 'actions'

  async detect(projectPath: string): Promise<boolean> {
    try {
      const workflowsPath = path.join(projectPath, '.github', 'workflows')
      await fs.access(workflowsPath)
      return true
    } catch {
      return false
    }
  }

  async parse(projectPath: string, options: ParseOptions = {}): Promise<ParseResult> {
    const metadata: ProjectMetadata = {
      name: path.basename(projectPath),
      version: '0.0.0',
    }

    const actions = new Map<string, { name: string; version: string }>()

    const workflowsPath = path.join(projectPath, '.github', 'workflows')
    const files = await fs.readdir(workflowsPath)

    for (const file of files) {
      if (!file.endsWith('.yml') && !file.endsWith('.yaml')) continue

      const content = await fs.readFile(path.join(workflowsPath, file), 'utf8')
      const workflow = parseYaml(content)

      if (workflow.jobs) {
        for (const job of Object.values(workflow.jobs) as Array<{ steps?: Array<{ uses?: string }> }>) {
          if (job.steps) {
            for (const step of job.steps) {
              if (step.uses) {
                const match = step.uses.match(/^([^@]+)@(.+)$/)
                if (match) {
                  actions.set(match[1], { name: match[1], version: match[2] })
                }
              }
            }
          }
        }
      }
    }

    const components: Component[] = Array.from(actions.values()).map(action => ({
      type: 'library',
      'bom-ref': `pkg:github/${action.name}@${action.version}`,
      name: action.name,
      version: action.version,
      purl: `pkg:github/${action.name}@${action.version}`,
      scope: 'required',
    }))

    const graph: Dependency[] = [{
      ref: `pkg:github/${metadata.name}@${metadata.version}`,
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
