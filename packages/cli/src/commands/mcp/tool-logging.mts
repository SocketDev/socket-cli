/**
 * Uniform logging + failure containment around every tool handler. Applied
 * centrally in `server.mts` so no handler repeats it.
 *
 * A thrown handler becomes an `isError` result rather than a protocol-level
 * exception: one tool bug must not tear down a client's MCP session.
 *
 * Arguments are logged at debug level only. Tokens ride on `extra.authInfo`,
 * which is never logged.
 */

import { debug } from '@socketsecurity/lib-stable/debug/output'
import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { errorToolResult } from './tool-auth.mts'

import type { ToolCallResult, ToolHandler } from './tool-types.mts'

const logger = getDefaultLogger()

export function withToolLogging(
  name: string,
  handler: ToolHandler,
): ToolHandler {
  return async (args, extra, context): Promise<ToolCallResult> => {
    debug(`mcp tool call: ${name} ${JSON.stringify(args)}`)
    try {
      const result = await handler(args, extra, context)
      if (result.isError) {
        logger.error(
          `MCP tool ${name} returned an error: ${result.content.map(c => c.text).join(' ')}`,
        )
      }
      return result
    } catch (e) {
      const message = errorMessage(e)
      logger.error(`MCP tool ${name} threw: ${message}`)
      return errorToolResult(
        `The ${name} tool failed unexpectedly. Where: ${name} handler. Saw: ${message}. Fix: retry, and re-run with SOCKET_CLI_DEBUG=1 for the full trace if it persists.`,
      )
    }
  }
}
