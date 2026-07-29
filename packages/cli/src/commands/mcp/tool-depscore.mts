import {
  DEPSCORE_TOOL_DESCRIPTION,
  DEPSCORE_TOOL_NAME,
  DepscoreInputSchema,
  runDepscore,
} from './depscore.mts'
import { authRequiredToolResult, resolveToolAuthToken } from './tool-auth.mts'

import type { DepscoreInput } from './depscore.mts'
import type { ToolSpec } from './tool-types.mts'

/**
 * Wrap the depscore worker as a tool spec.
 *
 * Package scores are public, non-tenant data — the answer is identical for
 * every caller — so this tool uses the unscoped token resolver and may fall
 * back to the server's configured token. The org-scoped tools do not.
 */
export function defineDepscoreTool(): ToolSpec {
  return {
    annotations: { readOnlyHint: true },
    description: DEPSCORE_TOOL_DESCRIPTION,
    handler: async (args, extra, context) => {
      const apiToken = resolveToolAuthToken(extra.authInfo?.token, context)
      if (!apiToken) {
        return authRequiredToolResult()
      }
      const result = await runDepscore(readDepscoreInput(args), { apiToken })
      return {
        content: result.content.map(c => ({
          text: c.text,
          type: 'text' as const,
        })),
        isError: result.isError,
      }
    },
    inputSchema: DepscoreInputSchema,
    name: DEPSCORE_TOOL_NAME,
    title: 'Dependency Score Tool',
  }
}

/**
 * Re-derive the depscore input from the raw argument record.
 *
 * The compiled schema check in `server.mts` already proved the shape.
 * Rebuilding the value field by field rather than casting keeps the handler
 * honest if the schema and the `DepscoreInput` type ever drift apart, and drops
 * anything the schema does not describe instead of forwarding it to the API.
 */
export function readDepscoreInput(
  args: Record<string, unknown>,
): DepscoreInput {
  const rawPackages = Array.isArray(args['packages']) ? args['packages'] : []
  const packages: DepscoreInput['packages'] = []
  for (const item of rawPackages) {
    if (typeof item !== 'object' || item === null || !('depname' in item)) {
      continue
    }
    const { depname } = item
    if (typeof depname !== 'string') {
      continue
    }
    const entry: DepscoreInput['packages'][number] = { depname }
    const ecosystem = 'ecosystem' in item ? item.ecosystem : undefined
    if (typeof ecosystem === 'string') {
      entry.ecosystem = ecosystem
    }
    const version = 'version' in item ? item.version : undefined
    if (typeof version === 'string') {
      entry.version = version
    }
    packages.push(entry)
  }
  const platform = args['platform']
  return {
    packages,
    ...(typeof platform === 'string' ? { platform } : {}),
  }
}
