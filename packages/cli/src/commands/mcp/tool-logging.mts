/**
 * Uniform logging + failure containment + structured audit around every tool
 * handler. Applied centrally in `server.mts` so no handler repeats it.
 *
 * A thrown handler becomes an `isError` result rather than a protocol-level
 * exception: one tool bug must not tear down a client's MCP session.
 *
 * Every call emits a structured JSON audit entry (SUS-18 / TPSF-2598) to the
 * append-only store in `tool-audit.mts`. The entry carries the timestamp,
 * authenticated identity, request ID, tool name, execution status, target
 * resources, and masked input arguments. Tokens ride on `extra.authInfo` and
 * are never logged raw — the audit entry carries a truncated SHA-256 hash.
 */

import { debug } from '@socketsecurity/lib-stable/debug/output'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  emitAuditEvent,
  extractResources,
  maskArgs,
  newRequestId,
  tokenIdentity,
} from './tool-audit.mts'
import { AUTH_REQUIRED_MSG, errorToolResult } from './tool-auth.mts'

import type { ToolCallResult, ToolHandler } from './tool-types.mts'

const logger = getDefaultLogger()

export function withToolLogging(
  name: string,
  handler: ToolHandler,
): ToolHandler {
  return async (args, extra, context): Promise<ToolCallResult> => {
    const requestId = newRequestId()
    const identity = tokenIdentity(extra?.authInfo?.token)
    const masked = maskArgs(args)
    const resources = extractResources(args)
    debug(`mcp tool call: ${name} ${JSON.stringify(masked)}`)
    try {
      const result = await handler(args, extra, context)
      // An auth-required result is a denial, not a generic failure.
      const isDenied =
        result.isError &&
        result.content.some(c => c.text === AUTH_REQUIRED_MSG)
      const status: 'success' | 'failure' | 'denied' = isDenied
        ? 'denied'
        : result.isError
          ? 'failure'
          : 'success'
      emitAuditEvent({
        args: masked,
        identity,
        requestId,
        resources,
        status,
        timestamp: new Date().toISOString(),
        tool: name,
      })
      if (result.isError) {
        logger.error(
          `MCP tool ${name} returned an error: ${result.content.map(c => c.text).join(' ')}`,
        )
      }
      return result
    } catch (e) {
      const message = errorMessage(e)
      logger.error(`MCP tool ${name} threw: ${message}`)
      emitAuditEvent({
        args: masked,
        identity,
        requestId,
        resources,
        status: 'failure',
        timestamp: new Date().toISOString(),
        tool: name,
      })
      return errorToolResult(
        `The ${name} tool failed unexpectedly. Where: ${name} handler. Saw: ${message}. Fix: retry, and re-run with SOCKET_CLI_DEBUG=1 for the full trace if it persists.`,
      )
    }
  }
}
