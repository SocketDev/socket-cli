import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger'

import { createConfiguredServer } from './server.mts'

import type { ServerConfig } from './server.mts'

const logger = getDefaultLogger()

export async function runStdioTransport(config: ServerConfig): Promise<void> {
  logger.info('Starting Socket MCP server in stdio mode')
  const server = createConfiguredServer(config)
  const transport = new StdioServerTransport()
  await server.connect(transport)
  logger.info(
    `Socket MCP server version ${config.version} started successfully (stdio)`,
  )
}
