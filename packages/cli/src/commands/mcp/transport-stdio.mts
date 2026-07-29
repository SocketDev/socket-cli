import { serveStdio } from '@modelcontextprotocol/server/stdio'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { createConfiguredServer } from './server.mts'

import type { StdioServerHandle } from '@modelcontextprotocol/server/stdio'
import type { ServerConfig } from './server.mts'

const logger = getDefaultLogger()

/**
 * Serve MCP over stdio. `serveStdio` owns the transport and calls the factory
 * once per connection — including the discarded `server/discover` probe — so it
 * takes the factory rather than one instance. Returns the connection handle;
 * the caller keeps the process alive by leaving stdin open.
 */
export function runStdioTransport(config: ServerConfig): StdioServerHandle {
  logger.info('Starting Socket MCP server in stdio mode')
  const handle = serveStdio(() => createConfiguredServer(config), {
    onerror: error => {
      logger.error(`Socket MCP stdio error: ${errorMessage(error)}`)
    },
  })
  logger.info(
    `Socket MCP server version ${config.version} started successfully (stdio)`,
  )
  return handle
}
