import { TypeCompiler } from '@sinclair/typebox/compiler'

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

import {
  DEPSCORE_TOOL_DESCRIPTION,
  DEPSCORE_TOOL_NAME,
  DepscoreInputSchema,
  runDepscore,
} from './depscore.mts'

import type { DepscoreInput } from './depscore.mts'

export interface ServerConfig {
  getApiToken: () => string | undefined
  serverName: string
  version: string
}

const depscoreInputCheck = TypeCompiler.Compile(DepscoreInputSchema)

export function createConfiguredServer(config: ServerConfig): Server {
  const server = new Server(
    {
      name: config.serverName,
      version: config.version,
    },
    {
      capabilities: {
        tools: {},
      },
    },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      {
        annotations: {
          readOnlyHint: true,
        },
        description: DEPSCORE_TOOL_DESCRIPTION,
        inputSchema: schemaToJsonSchema(DepscoreInputSchema),
        name: DEPSCORE_TOOL_NAME,
        title: 'Dependency Score Tool',
      },
    ],
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const { arguments: args, name } = request.params

    if (name !== DEPSCORE_TOOL_NAME) {
      return {
        content: [{ text: `Unknown tool: ${name}`, type: 'text' as const }],
        isError: true,
      }
    }

    if (!depscoreInputCheck.Check(args)) {
      const errors = [...depscoreInputCheck.Errors(args)]
        .map(e => `${e.path}: ${e.message}`)
        .join('; ')
      return {
        content: [
          {
            text: `Invalid arguments for ${DEPSCORE_TOOL_NAME}: ${errors}`,
            type: 'text' as const,
          },
        ],
        isError: true,
      }
    }

    const authToken =
      (extra.authInfo?.token as string | undefined) || config.getApiToken()

    if (!authToken) {
      return {
        content: [
          {
            text: 'Authentication is required. Configure SOCKET_API_TOKEN for stdio mode or connect through OAuth-enabled HTTP mode.',
            type: 'text' as const,
          },
        ],
        isError: true,
      }
    }

    const result = await runDepscore(args as DepscoreInput, {
      apiToken: authToken,
    })
    return {
      content: result.content.map(c => ({
        text: c.text,
        type: 'text' as const,
      })),
      isError: result.isError,
    }
  })

  return server
}

// Convert TypeBox schema to a JSON Schema literal for MCP wire output.
// TypeBox values are JSON Schema natively; cloning produces a plain
// object the SDK serializes without zod-specific machinery.
export function schemaToJsonSchema(schema: object): Record<string, unknown> {
  return JSON.parse(JSON.stringify(schema))
}
