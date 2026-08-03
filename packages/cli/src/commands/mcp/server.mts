import { TypeCompiler } from '@sinclair/typebox/compiler'

import { Server } from '@modelcontextprotocol/server'

import { defineAlertsTool } from './tool-alerts.mts'
import { defineDepscoreTool } from './tool-depscore.mts'
import { withToolLogging } from './tool-logging.mts'
import { defineOrganizationsTool } from './tool-organizations.mts'
import { definePackageFileContentsTool } from './tool-package-file-contents.mts'
import { definePackageFileGrepTool } from './tool-package-file-grep.mts'
import { definePackageFilesTool } from './tool-package-files.mts'
import { defineThreatFeedTool } from './tool-threat-feed.mts'

import type { ServerContext, Tool } from '@modelcontextprotocol/server'
import type {
  ToolContext,
  ToolHandler,
  ToolHandlerExtra,
  ToolSpec,
} from './tool-types.mts'

export interface ServerConfig {
  getApiToken: () => string | undefined
  serverName: string
  // True when the configured token belongs to a deploy operator rather than the
  // caller — HTTP mode with OAuth, where each request carries its own bearer.
  // Org-scoped tools refuse to fall back to a shared token.
  sharedApiToken?: boolean | undefined
  version: string
}

/**
 * The canonical tool set, in the order clients see it in `tools/list`.
 *
 * All seven ship by default. Every tool is a read against the Socket API using
 * the caller's own credentials, and each one is reachable through a CLI command
 * the same token already authorizes, so none of them widens what the operator
 * can see. Gating the org-scoped three behind a flag would only hide them: an
 * MCP client discovers tools from `tools/list`, so a tool a user must first
 * know about in order to enable is a tool nobody finds.
 */
export function buildSocketToolSpecs(): ToolSpec[] {
  return [
    defineDepscoreTool(),
    defineOrganizationsTool(),
    defineAlertsTool(),
    defineThreatFeedTool(),
    definePackageFilesTool(),
    definePackageFileContentsTool(),
    definePackageFileGrepTool(),
  ]
}

export interface ToolEntry {
  check: ReturnType<typeof TypeCompiler.Compile>
  handler: ToolHandler
}

const toolSpecs = buildSocketToolSpecs()

// Compiled once at module load rather than per server instance: HTTP mode
// builds a fresh Server per session, and the schemas never vary.
const toolEntries = new Map<string, ToolEntry>(
  toolSpecs.map(spec => [
    spec.name,
    {
      check: TypeCompiler.Compile(spec.inputSchema),
      handler: withToolLogging(spec.name, spec.handler),
    },
  ]),
)

const toolListing = toolSpecs.map(spec => ({
  ...(spec.annotations ? { annotations: spec.annotations } : {}),
  description: spec.description,
  inputSchema: schemaToJsonSchema(spec.inputSchema),
  name: spec.name,
  title: spec.title,
}))

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

  const context: ToolContext = {
    getApiToken: config.getApiToken,
    sharedApiToken: config.sharedApiToken ?? false,
  }

  server.setRequestHandler('tools/list', () => ({
    tools: toolListing,
  }))

  server.setRequestHandler('tools/call', async (request, ctx) => {
    const { arguments: args, name } = request.params

    const entry = toolEntries.get(name)
    if (!entry) {
      return {
        content: [{ text: `Unknown tool: ${name}`, type: 'text' as const }],
        isError: true,
      }
    }

    const toolArgs: Record<string, unknown> = { ...args }
    // Typed as boolean so the compiler's type predicate does not narrow
    // `toolArgs` away from the record shape the handlers read.
    const isValid: boolean = entry.check.Check(toolArgs)
    if (!isValid) {
      const errors = [...entry.check.Errors(toolArgs)]
        .map(e => `${e.path}: ${e.message}`)
        .join('; ')
      return {
        content: [
          {
            text: `Invalid arguments for ${name}: ${errors}`,
            type: 'text' as const,
          },
        ],
        isError: true,
      }
    }

    const result = await entry.handler(
      toolArgs,
      toToolHandlerExtra(ctx),
      context,
    )
    return {
      content: result.content.map(c => ({
        text: c.text,
        type: 'text' as const,
      })),
      ...(result.isError === undefined ? {} : { isError: result.isError }),
    }
  })

  return server
}

// Convert a TypeBox schema to a JSON Schema literal for MCP wire output.
// TypeBox values are JSON Schema natively, but every node carries symbol-keyed
// metadata (`Symbol(TypeBox.Kind)`, `Symbol(TypeBox.Optional)`) that JSON
// Schema has no place for. The JSON round trip is the copy: a transport that
// hands objects over by reference would otherwise pass the symbols straight to
// a consumer whose result validator rejects them.
export function schemaToJsonSchema(schema: object): Tool['inputSchema'] {
  return JSON.parse(JSON.stringify(schema))
}

/**
 * The slice of the SDK's per-request context this server reads. Narrowed from
 * `ServerContext` so the adapter below stays honest about its input while
 * remaining trivially constructible in a test.
 */
export type ToolHandlerContext = Pick<ServerContext, 'http'>

/**
 * Adapt the SDK's per-request handler context to the SDK-free
 * `ToolHandlerExtra` the tool modules read. This is the only place a tool's
 * auth input is shaped by the SDK, so an SDK major that moves `authInfo`
 * changes this function and nothing else. `ctx.http` is populated only on an
 * HTTP transport, so a stdio caller gets an empty extra and falls back to the
 * configured token inside the tool body.
 */
export function toToolHandlerExtra(ctx: ToolHandlerContext): ToolHandlerExtra {
  const authInfo = ctx.http?.authInfo
  return authInfo ? { authInfo: { token: authInfo.token } } : {}
}
