/**
 * Token resolution and canned result shapes shared by every `socket mcp` tool.
 *
 * Two resolvers, deliberately different:
 *
 * - `resolveToolAuthToken` serves tools that read public, non-tenant data
 *   (package scores). The configured token is an acceptable fallback because
 *   the answer is the same for every caller.
 * - `resolveScopedToolAuthToken` serves org-scoped tools (organizations,
 *   alerts, threat feed, package file lists). It refuses a shared operator
 *   token, so an authenticated caller can never read the operator's private org
 *   data. It fails closed: no per-request token and a shared configured token
 *   yields `undefined`, and the tool answers AUTH_REQUIRED.
 */

import type { ToolCallResult, ToolContext } from './tool-types.mts'

export const AUTH_REQUIRED_MSG =
  'Authentication is required. Run `socket login`, or set SOCKET_API_TOKEN, for stdio mode. In HTTP mode, connect through OAuth so the request carries your own Socket token.'

export function authRequiredToolResult(): ToolCallResult {
  return errorToolResult(AUTH_REQUIRED_MSG)
}

export function errorToolResult(text: string): ToolCallResult {
  return {
    content: [{ text, type: 'text' }],
    isError: true,
  }
}

/**
 * Resolve the token a public-data tool should use: the per-request OAuth token
 * first, then the server's configured token.
 */
export function resolveToolAuthToken(
  requestToken: string | undefined,
  context: ToolContext,
): string | undefined {
  return requestToken || context.getApiToken() || undefined
}

/**
 * Resolve the token an org-scoped tool should use. The per-request OAuth token
 * always wins. The configured token is only acceptable when it is the local
 * user's own; a shared operator token is refused.
 */
export function resolveScopedToolAuthToken(
  requestToken: string | undefined,
  context: ToolContext,
): string | undefined {
  if (requestToken) {
    return requestToken
  }
  if (context.sharedApiToken) {
    return undefined
  }
  return context.getApiToken() || undefined
}

export function textToolResult(text: string): ToolCallResult {
  return {
    content: [{ text, type: 'text' }],
  }
}
