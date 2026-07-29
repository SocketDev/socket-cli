import { Type } from '@sinclair/typebox'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { fetchSocketFileList } from './lib/files.mts'
import { buildPurl } from './lib/purl.mts'
import { readToolString } from './tool-args.mts'
import {
  authRequiredToolResult,
  errorToolResult,
  resolveScopedToolAuthToken,
  textToolResult,
} from './tool-auth.mts'
import { isBoundedToolString, MAX_PURL_FIELD_LENGTH } from './tool-input.mts'

import type { ToolSpec } from './tool-types.mts'

export const PACKAGE_FILES_TOOL_NAME = 'package_files'

export const PACKAGE_FILES_TOOL_DESCRIPTION =
  "List the files published in a package using the `package_files` tool from Socket. Returns a tree of paths and sizes for any package on a supported ecosystem (npm, pypi, gem, cargo, maven, golang, nuget, chrome, openvsx). Useful for inspecting what a dependency ships before installing it. After calling this, use `package_file_contents` with one of the paths to read the file's contents."

// Declared in socket-mcp's order so the emitted `required` array matches the
// published server's `tools/list` payload element for element.
export const PackageFilesInputSchema = Type.Object({
  ecosystem: Type.String({
    default: 'npm',
    description:
      'Package ecosystem (e.g., npm, pypi, gem, cargo, maven, golang, nuget, chrome, openvsx)',
  }),
  depname: Type.String({
    description:
      'Package name (e.g., "lodash", "@babel/core", "org.springframework:spring-core", "meta/pyrefly" for openvsx)',
  }),
  version: Type.String({ description: 'Package version' }),
  artifactId: Type.Optional(
    Type.String({
      description:
        'Per-version artifact disambiguator (e.g. PyPI filename, Maven artifact id, NuGet asset). Required when an ecosystem ships multiple artifacts per version.',
    }),
  ),
  platform: Type.Optional(
    Type.String({
      description:
        "Platform qualifier for ecosystems with per-OS/arch artifacts (e.g. openvsx: 'linux-x64', 'darwin-arm64', 'win32-x64').",
    }),
  ),
})

/**
 * Compose the PURL the file-list endpoint is queried with. The PURL is derived
 * from the individual coordinates rather than accepted whole from the caller,
 * so `packageurl-js` owns the encoding of every component and no caller picks
 * the request's path segment directly.
 */
export function buildPackageFilesPurl(
  ecosystem: string,
  depname: string,
  version: string,
  artifactId?: string | undefined,
  platform?: string | undefined,
): string {
  const qualifiers: Record<string, string> = {}
  if (artifactId) {
    qualifiers['artifact_id'] = artifactId
  }
  if (platform) {
    qualifiers['platform'] = platform
  }
  return buildPurl(
    ecosystem,
    depname,
    version,
    Object.keys(qualifiers).length ? qualifiers : undefined,
  )
}

export function definePackageFilesTool(): ToolSpec {
  return {
    annotations: { readOnlyHint: true },
    description: PACKAGE_FILES_TOOL_DESCRIPTION,
    handler: async (args, extra, context) => {
      const depname = readToolString(args, 'depname')
      const version = readToolString(args, 'version')
      const ecosystem = readToolString(args, 'ecosystem') ?? 'npm'
      const artifactId = readToolString(args, 'artifactId')
      const platform = readToolString(args, 'platform')
      for (const [label, value] of [
        ['depname', depname],
        ['version', version],
        ['ecosystem', ecosystem],
        ['artifactId', artifactId],
        ['platform', platform],
      ] as const) {
        if (
          value !== undefined &&
          !isBoundedToolString(value, MAX_PURL_FIELD_LENGTH)
        ) {
          return errorToolResult(
            `Listing package files failed. Where: the \`${label}\` argument. Saw: ${value.length} characters, wanted at most ${MAX_PURL_FIELD_LENGTH}. Fix: pass the package coordinate itself, not a document.`,
          )
        }
      }
      if (!depname || !version) {
        return errorToolResult(
          'Listing package files failed. Where: the tool arguments. Saw: a missing `depname` or `version`, wanted both. Fix: pass the package name and the exact version to inspect.',
        )
      }
      const purl = buildPackageFilesPurl(
        ecosystem,
        depname,
        version,
        artifactId,
        platform,
      )
      const apiToken = resolveScopedToolAuthToken(
        extra.authInfo?.token,
        context,
      )
      if (!apiToken) {
        return authRequiredToolResult()
      }
      try {
        const result = await fetchSocketFileList(apiToken, purl)
        if (result.fileCount === 0) {
          return textToolResult(`No files found for ${result.purl}`)
        }
        const sizeKb = (result.totalBytes / 1024).toFixed(1)
        return textToolResult(
          `${result.purl} — ${result.fileCount} files, ${sizeKb} KB\n${result.tree}`,
        )
      } catch (e) {
        return errorToolResult(errorMessage(e))
      }
    },
    inputSchema: PackageFilesInputSchema,
    name: PACKAGE_FILES_TOOL_NAME,
    title: 'Package File List Tool',
  }
}
