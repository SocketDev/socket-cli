import { Type } from '@sinclair/typebox'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { setupSdk } from '../../utils/socket/sdk.mts'
import { deduplicateArtifacts } from './lib/artifacts.mts'
import { buildPurl } from './lib/purl.mts'

import type { ArtifactData } from './lib/artifacts.mts'
import type { SocketSdk } from '@socketsecurity/sdk-stable'
import type { Static } from '@sinclair/typebox'

const logger = getDefaultLogger()

// JSON Schema for the depscore tool input. Authored in TypeBox so the
// schema is type-safe at the call site; emitted as plain JSON Schema for
// the MCP wire (no zod, no zod-to-json-schema round-trip).
export const DepscoreInputSchema = Type.Object({
  packages: Type.Array(
    Type.Object({
      depname: Type.String({
        description: 'The name of the dependency',
      }),
      ecosystem: Type.Optional(
        Type.String({
          default: 'npm',
          description:
            'The package ecosystem (e.g., npm, pypi, gem, golang, maven, nuget, cargo)',
        }),
      ),
      version: Type.Optional(
        Type.String({
          default: 'unknown',
          description:
            "The version of the dependency, use 'unknown' if not known",
        }),
      ),
    }),
    {
      description: 'Array of packages to check',
    },
  ),
  platform: Type.Optional(
    Type.String({
      description:
        "Optional OS-architecture hint (e.g., 'linux-x64', 'darwin-arm64', 'win32-x64'). Used to select the most relevant artifact when a package has platform-specific builds.",
    }),
  ),
})

export type DepscoreInput = Static<typeof DepscoreInputSchema>

export const DEPSCORE_TOOL_NAME = 'depscore'

export const DEPSCORE_TOOL_DESCRIPTION =
  "Get the dependency score of packages with the `depscore` tool from Socket. Use 'unknown' for version if not known. Use this tool to scan dependencies for their quality and security on existing code or when code is generated. Stop generating code and ask the user how to proceed when any of the scores are low. When checking dependencies, make sure to also check the imports in the code, not just the manifest files (pyproject.toml, package.json, etc)."

export interface DepscoreToolResult {
  content: Array<{ text: string; type: 'text' }>
  isError?: boolean | undefined
}

export interface DepscoreOptions {
  apiToken: string
}

export function formatScore(jsonData: ArtifactData): string {
  const ns = jsonData.namespace ? `${jsonData.namespace}/` : ''
  const purl = `pkg:${jsonData.type || 'unknown'}/${ns}${jsonData.name || 'unknown'}@${jsonData.version || 'unknown'}`
  if (
    jsonData.score &&
    (jsonData.score as Record<string, unknown>)['overall'] !== undefined
  ) {
    const scoreEntries = Object.entries(
      jsonData.score as Record<string, unknown>,
    )
      .filter(([key]) => key !== 'overall' && key !== 'uuid')
      .map(([key, value]) => {
        const numValue = Number(value)
        const displayValue =
          numValue <= 1 ? Math.round(numValue * 100) : numValue
        return `${key}: ${displayValue}`
      })
      .join(', ')
    return `${purl}: ${scoreEntries}`
  }
  return `${purl}: No score found`
}

// Memoize SDK clients per token. Stdio mode shares one client across all
// tool calls; HTTP+OAuth mode constructs one per distinct token.
const sdkCache = new Map<string, SocketSdk>()

export async function getSdk(apiToken: string): Promise<SocketSdk> {
  const cached = sdkCache.get(apiToken)
  if (cached) {
    return cached
  }
  const result = await setupSdk({ apiToken })
  if (!result.ok) {
    throw new Error(
      result.cause || result.message || 'Failed to set up Socket SDK',
    )
  }
  sdkCache.set(apiToken, result.data)
  return result.data
}

export async function runDepscore(
  input: DepscoreInput,
  opts: DepscoreOptions,
): Promise<DepscoreToolResult> {
  const { packages, platform } = input
  logger.info(`Received request for ${packages.length} packages`)

  const components = packages.map(pkg => {
    const cleanedVersion = (pkg.version ?? 'unknown').replace(/[\^~]/g, '')
    const ecosystem = pkg.ecosystem ?? 'npm'
    const purl = buildPurl(ecosystem, pkg.depname, cleanedVersion)
    if (
      cleanedVersion !== '1.0.0' &&
      cleanedVersion !== 'unknown' &&
      cleanedVersion
    ) {
      logger.info(`Using version ${cleanedVersion} for ${pkg.depname}`)
    }
    return { purl }
  })

  let sdk: SocketSdk
  try {
    sdk = await getSdk(opts.apiToken)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`SDK setup failed: ${message}`)
    return {
      content: [{ text: `SDK setup failed: ${message}`, type: 'text' }],
      isError: true,
    }
  }

  let response
  try {
    response = await sdk.batchPackageFetch(
      { components },
      {
        alerts: false,
        compact: false,
        fixable: false,
        licenseattrib: false,
        licensedetails: false,
      },
    )
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    logger.error(`Error processing packages: ${message}`)
    return {
      content: [{ text: 'Error connecting to Socket API', type: 'text' }],
      isError: true,
    }
  }

  if (!response.success) {
    const status = response.status
    const cause = response.cause || response.error
    if (status === 401) {
      const errorMsg = `Socket authentication failed [401]. Re-authenticate and retry. ${cause ?? ''}`
      logger.error(errorMsg)
      return {
        content: [{ text: errorMsg, type: 'text' }],
        isError: true,
      }
    }
    if (status === 403) {
      const errorMsg = `Socket denied access [403]. Re-authenticate with the correct organization or repository permissions and retry. ${cause ?? ''}`
      logger.error(errorMsg)
      return {
        content: [{ text: errorMsg, type: 'text' }],
        isError: true,
      }
    }
    const errorMsg = `Error processing packages: [${status}] ${cause ?? response.error}`
    logger.error(errorMsg)
    return {
      content: [{ text: errorMsg, type: 'text' }],
      isError: true,
    }
  }

  const artifacts = (response.data || []) as ArtifactData[]
  if (!artifacts.length) {
    const errorMsg = 'No packages were found.'
    logger.error(errorMsg)
    return {
      content: [{ text: errorMsg, type: 'text' }],
      isError: true,
    }
  }

  const filtered = artifacts.filter(a => !a['_type'])
  if (!filtered.length) {
    return {
      content: [
        {
          text: 'No valid artifact records returned by Socket API',
          type: 'text',
        },
      ],
      isError: true,
    }
  }

  const deduplicated = deduplicateArtifacts(filtered, platform)
  const results = deduplicated.map(formatScore)

  return {
    content: [
      {
        text: `Dependency scores:\n${results.join('\n')}`,
        type: 'text',
      },
    ],
  }
}
