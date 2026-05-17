/**
 * TypeBox schema for external-tools.json files.
 *
 * Validates tool configuration used by the tool-installer to auto-download
 * and verify external build dependencies.
 *
 * Normalized schema across all Socket repos:
 *   socket-btm: build tools (system tools, pip packages)
 *   socket-cli: bundle tools (npm packages, GitHub release binaries)
 *   socket-registry: CI tools (GitHub release binaries)
 *   ultrathink: build tools (compilers, language toolchains)
 */

import { Type } from '@sinclair/typebox'

import { validateSchema } from '@socketsecurity/lib/schema/validate'

const toolSchema = Type.Object(
  {
    // Common fields (all repos).
    description: Type.Optional(
      Type.String({ description: 'What the tool is used for' }),
    ),
    version: Type.Optional(
      Type.String({
        description: 'Version requirement (exact "0.15.2" or range "3.28+")',
      }),
    ),
    packageManager: Type.Optional(
      Type.Union(
        [Type.Literal('npm'), Type.Literal('pip'), Type.Literal('pnpm')],
        {
          description: 'Package manager for installation. Absent = system tool',
        },
      ),
    ),
    notes: Type.Optional(
      Type.Union([Type.String(), Type.Array(Type.String())], {
        description: 'Additional notes about the tool',
      }),
    ),

    // GitHub release fields (socket-cli bundle-tools, socket-registry).
    repository: Type.Optional(
      Type.String({ description: 'Repository in "github:owner/repo" format' }),
    ),
    release: Type.Optional(
      Type.Union([Type.Literal('asset'), Type.Literal('archive')], {
        description:
          'Release type: "asset" for individual binaries, "archive" for source tarballs',
      }),
    ),
    tag: Type.Optional(
      Type.String({ description: 'Release tag (when different from version)' }),
    ),
    checksums: Type.Optional(
      Type.Record(
        Type.String(),
        Type.Union([
          // Platform-keyed: { "darwin-arm64": { "asset": "...", "sha256": "..." } }
          Type.Object({
            asset: Type.String(),
            sha256: Type.String(),
          }),
          // Flat: { "file.tar.gz": "abc..." } (legacy/simple).
          Type.String(),
        ]),
        { description: 'Checksums keyed by platform or asset filename' },
      ),
    ),

    // npm package fields (socket-cli bundle-tools).
    integrity: Type.Optional(
      Type.String({ description: 'npm package integrity hash (sha512)' }),
    ),
    npm: Type.Optional(
      Type.Object(
        {
          package: Type.Optional(Type.String()),
          version: Type.Optional(Type.String()),
        },
        {
          description:
            'Nested npm package reference (when tool has both binary and npm forms)',
        },
      ),
    ),
  },
  // TypeBox equivalent of Zod's .passthrough() — allow extra properties.
  { additionalProperties: true },
)

export const externalToolsSchema = Type.Object(
  {
    $schema: Type.Optional(Type.String()),
    description: Type.Optional(
      Type.String({
        description: 'Human-readable description of this config file',
      }),
    ),
    extends: Type.Optional(
      Type.String({
        description: 'Path to a base external-tools.json to inherit tools from',
      }),
    ),
    tools: Type.Optional(
      Type.Record(Type.String(), toolSchema, {
        description: 'Map of tool name to tool configuration',
      }),
    ),
  },
  { additionalProperties: true },
)

/**
 * Validate an external-tools.json object against the schema.
 *
 * @param {unknown} data - Parsed JSON data.
 * @returns `{ ok: true, value }` on success, `{ ok: false, errors }` with
 *   normalized `{ path, message }` issues on failure.
 */
export function validateExternalTools(data) {
  return validateSchema(externalToolsSchema, data)
}
