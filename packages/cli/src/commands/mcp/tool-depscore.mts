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
      // The compiled schema check in server.mts ran before this handler, so the
      // record satisfies DepscoreInputSchema.
      const input = args as unknown as DepscoreInput
      const result = await runDepscore(input, { apiToken })
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
