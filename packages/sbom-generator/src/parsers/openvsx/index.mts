/**
 * openvsx Ecosystem Parser
 *
 * Parses VS Code extensions from Open VSX Registry into CycloneDX SBOM format.
 * Socket-specific parser (no cdxgen equivalent).
 *
 * Note: This is a placeholder implementation. Full implementation requires
 * Open VSX API integration to fetch extension metadata.
 */

import type { Component, Dependency } from '../../types/sbom.mts'
import type {
  Ecosystem,
  ParseOptions,
  ParseResult,
  Parser,
  ProjectMetadata,
} from '../../types/parser.mts'

export class OpenvsxParser implements Parser {
  readonly ecosystem: Ecosystem = 'openvsx'

  async detect(projectPath: string): Promise<boolean> {
    // Detection would check for .vscode/extensions.json or package.json with vscode extension metadata.
    return false
  }

  async parse(projectPath: string, options: ParseOptions = {}): Promise<ParseResult> {
    // Placeholder implementation.
    // Full implementation would:
    // 1. Parse .vscode/extensions.json for extension IDs
    // 2. Query Open VSX API for metadata
    // 3. Generate components with pkg:vscode/publisher.extension@version PURLs

    const metadata: ProjectMetadata = {
      name: 'vscode-extensions',
      version: '0.0.0',
    }

    return {
      ecosystem: this.ecosystem,
      metadata,
      components: [],
      dependencies: [],
    }
  }
}
