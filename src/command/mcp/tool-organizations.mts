import { Type } from '@sinclair/typebox'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { fetchSocketOrganizations } from './lib/socket-api.mts'
import {
  authRequiredToolResult,
  errorToolResult,
  resolveScopedToolAuthToken,
  textToolResult,
} from './tool-auth.mts'

import type { ToolSpec } from './tool-types.mts'

export const ORGANIZATIONS_TOOL_NAME = 'organizations'

export const ORGANIZATIONS_TOOL_DESCRIPTION =
  'List the Socket organizations the authenticated user belongs to with the `organizations` tool. Use this to discover the `org_slug` values needed by other org-scoped tools (e.g. `alerts`, `threat_feed`), or when the user asks which organizations they have access to.'

export const OrganizationsInputSchema = Type.Object({})

export function defineOrganizationsTool(): ToolSpec {
  return {
    annotations: { readOnlyHint: true },
    description: ORGANIZATIONS_TOOL_DESCRIPTION,
    handler: async (_args, extra, context) => {
      const apiToken = resolveScopedToolAuthToken(
        extra.authInfo?.token,
        context,
      )
      if (!apiToken) {
        return authRequiredToolResult()
      }
      try {
        const data = await fetchSocketOrganizations(apiToken)
        return textToolResult(JSON.stringify(data, undefined, 2))
      } catch (e) {
        return errorToolResult(errorMessage(e))
      }
    },
    inputSchema: OrganizationsInputSchema,
    name: ORGANIZATIONS_TOOL_NAME,
    title: 'List Organizations Tool',
  }
}
