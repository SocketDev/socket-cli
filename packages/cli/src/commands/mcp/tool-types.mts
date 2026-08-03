/**
 * Structural types shared by every `socket mcp` tool module. Each `tool-*.mts`
 * exports a `define*Tool(): ToolSpec`; `server.mts` collects the specs,
 * compiles their input schemas once, and dispatches `tools/list` + `tools/call`
 * by name.
 *
 * Nothing here imports the MCP SDK, so the seam survives an SDK major bump: the
 * only SDK-shaped code is the two `setRequestHandler` registrations in
 * `server.mts`.
 */

import type { TSchema } from '@sinclair/typebox'

/**
 * Tool annotations the SDK forwards to clients. Every Socket tool is a read,
 * so `readOnlyHint` is the one flag set today.
 */
export interface ToolAnnotations {
  destructiveHint?: boolean | undefined
  idempotentHint?: boolean | undefined
  openWorldHint?: boolean | undefined
  readOnlyHint?: boolean | undefined
}

/**
 * Per-request context the MCP SDK hands a `tools/call` handler.
 * `authInfo.token` carries the OAuth bearer in HTTP mode; stdio mode leaves it
 * undefined and the handler falls back through `ToolContext`.
 */
export interface ToolHandlerExtra {
  authInfo?: { token?: string | undefined } | undefined
}

/**
 * Server-lifetime context every handler receives. `sharedApiToken` marks the
 * configured token as belonging to a deploy operator rather than the caller;
 * org-scoped tools refuse to fall back to it so one caller never reads another
 * tenant's data through the operator's credentials.
 */
export interface ToolContext {
  getApiToken: () => string | undefined
  sharedApiToken: boolean
}

export interface ToolCallResult {
  content: Array<{ text: string; type: 'text' }>
  isError?: boolean | undefined
}

export type ToolHandler = (
  args: Record<string, unknown>,
  extra: ToolHandlerExtra,
  context: ToolContext,
) => Promise<ToolCallResult> | ToolCallResult

export interface ToolSpec {
  readonly annotations?: ToolAnnotations | undefined
  readonly description: string
  readonly handler: ToolHandler
  readonly inputSchema: TSchema
  readonly name: string
  readonly title: string
}
