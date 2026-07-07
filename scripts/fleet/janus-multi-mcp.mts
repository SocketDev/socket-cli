#!/usr/bin/env node
/**
 * @file Multi-Janus MCP shim — a stdio MCP server that fronts MANY repo Janus
 *   queues behind one connection. The native `janus mcp` is rooted at a single
 *   `.janus/` (its launch cwd), so an agent in repo A can't file/read tickets
 *   in repo B's queue without switching checkouts. This shim adds a `workspace`
 *   parameter to every tool and routes the call to that repo's `.janus/` by
 *   shelling `janus` with `JANUS_ROOT` (the env knob already ships — zero Janus
 *   changes). So a socket-lib agent that needs a socket-wheelhouse change files
 *   it into the wheelhouse queue and keeps draining its own — no cross-checkout
 *   commit, which is what wedged the shared `.git/index` before.
 *   STOPGAP: when upstream `janus mcp --workspace name=path` (the PR stack)
 *   lands, the tool shape here matches it, so callers swap shim→native with no
 *   change and this file is deleted. See
 *   docs/agents.md/fleet/multi-agent-operating-procedure.md.
 *   Protocol: JSON-RPC 2.0 over newline-delimited stdio (`initialize` →
 *   `notifications/initialized` → `tools/list` / `tools/call`). Implemented
 *   directly (no SDK dep — a throwaway shim shouldn't pull a soak-gated
 *   dependency).
 *   Usage: `node scripts/fleet/janus-multi-mcp.mts` (wired via `.mcp.json`).
 */

import process from 'node:process'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import {
  createTicketArgs,
  listTicketsArgs,
  nextTicketArgs,
  runJanus,
  showTicketArgs,
  updateStatusArgs,
} from './janus-multi-runner.mts'
import {
  discoverWorkspaces,
  resolveWorkspace,
} from './janus-multi-workspace.mts'

const logger = getDefaultLogger()

const PROTOCOL_VERSION = '2024-11-05'
const SERVER_NAME = 'janus-multi'
const SERVER_VERSION = '0.1.0'

// JSON Schema fragment reused by every workspace-scoped tool: the `workspace`
// param names which repo's queue to target.
const WORKSPACE_PROP = {
  description:
    'The fleet repo name whose Janus queue to target (e.g. socket-wheelhouse). Call list_workspaces for the set.',
  type: 'string',
} as const

// The tool catalog. Each `inputSchema` is plain JSON Schema (the MCP wire
// shape). Annotations mirror janus's own (reads are read-only, status writes
// are idempotent) so a client's Agents-Rule-of-Two scoping still applies.
export interface ToolDef {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  annotations: Record<string, boolean>
}

export const TOOLS: ToolDef[] = [
  {
    annotations: { readOnlyHint: true },
    description:
      'List the available Janus workspaces (fleet repos with a .janus/ queue). Returns each name + repo path.',
    inputSchema: { properties: {}, type: 'object' },
    name: 'list_workspaces',
  },
  {
    annotations: { destructiveHint: false, readOnlyHint: false },
    description:
      "Create a ticket in a workspace's Janus queue. Use this to file work into ANOTHER repo's queue (e.g. a fleet-canonical change that belongs in socket-wheelhouse) instead of editing that repo's checkout.",
    inputSchema: {
      properties: {
        description: { description: 'Ticket description', type: 'string' },
        externalRef: {
          description:
            'External reference (e.g. gh-123) for cross-repo linking',
          type: 'string',
        },
        priority: { description: 'Priority 0-4 (default 2)', type: 'number' },
        ticketType: {
          description: 'bug | feature | task | epic | chore',
          type: 'string',
        },
        title: { description: 'Ticket title', type: 'string' },
        workspace: WORKSPACE_PROP,
      },
      required: ['workspace', 'title'],
      type: 'object',
    },
    name: 'create_ticket',
  },
  {
    annotations: { readOnlyHint: true },
    description:
      "Get the next available ticket(s) to work on in a workspace (dependency-aware). The runner loop's 'what's next'.",
    inputSchema: {
      properties: {
        limit: {
          description: 'Max tickets to return (default 5)',
          type: 'number',
        },
        workspace: WORKSPACE_PROP,
      },
      required: ['workspace'],
      type: 'object',
    },
    name: 'get_next_available_ticket',
  },
  {
    annotations: { readOnlyHint: true },
    description: "List tickets in a workspace's queue (JSON).",
    inputSchema: {
      properties: { workspace: WORKSPACE_PROP },
      required: ['workspace'],
      type: 'object',
    },
    name: 'list_tickets',
  },
  {
    annotations: { readOnlyHint: true },
    description: 'Show one ticket in a workspace (full content, JSON).',
    inputSchema: {
      properties: {
        id: { description: 'Ticket ID (partial accepted)', type: 'string' },
        workspace: WORKSPACE_PROP,
      },
      required: ['workspace', 'id'],
      type: 'object',
    },
    name: 'show_ticket',
  },
  {
    annotations: {
      destructiveHint: false,
      idempotentHint: true,
      readOnlyHint: false,
    },
    description:
      'Change a ticket status in a workspace. Statuses: new, next, in_progress, complete, cancelled, archived.',
    inputSchema: {
      properties: {
        id: { description: 'Ticket ID', type: 'string' },
        status: {
          description:
            'new | next | in_progress | complete | cancelled | archived',
          type: 'string',
        },
        workspace: WORKSPACE_PROP,
      },
      required: ['workspace', 'id', 'status'],
      type: 'object',
    },
    name: 'update_status',
  },
]

// A JSON-RPC error string for an unknown / janus-less workspace, naming the
// allowed set (error-message-quality: what + saw vs wanted + fix).
function unknownWorkspaceError(name: string): string {
  const names = discoverWorkspaces().map(w => w.name)
  return (
    `unknown workspace "${name}". ` +
    `Known workspaces (fleet repos with a .janus/): ${names.length ? names.join(', ') : '(none found)'}. ` +
    `Fix: pass one of those as "workspace", or run list_workspaces.`
  )
}

// Dispatch a tools/call to the janus runner. Returns the MCP `content` text (a
// string) or throws a string the caller wraps as an MCP tool error.
export function callTool(name: string, args: Record<string, unknown>): string {
  if (name === 'list_workspaces') {
    const ws = discoverWorkspaces().map(w => ({
      name: w.name,
      repoPath: w.repoPath,
    }))
    return JSON.stringify(ws, undefined, 2)
  }
  const workspaceName =
    typeof args['workspace'] === 'string' ? args['workspace'] : ''
  const workspace = resolveWorkspace(workspaceName)
  if (!workspace) {
    throw unknownWorkspaceError(workspaceName)
  }
  let janusArgs: string[]
  switch (name) {
    case 'create_ticket':
      janusArgs = createTicketArgs({
        description: args['description'] as string | undefined,
        externalRef: args['externalRef'] as string | undefined,
        priority: args['priority'] as number | undefined,
        ticketType: args['ticketType'] as string | undefined,
        title: String(args['title'] ?? ''),
      })
      break
    case 'get_next_available_ticket':
      janusArgs = nextTicketArgs(args['limit'] as number | undefined)
      break
    case 'list_tickets':
      janusArgs = listTicketsArgs()
      break
    case 'show_ticket':
      janusArgs = showTicketArgs(String(args['id'] ?? ''))
      break
    case 'update_status':
      janusArgs = updateStatusArgs(
        String(args['id'] ?? ''),
        String(args['status'] ?? ''),
      )
      break
    default:
      throw `unknown tool "${name}".`
  }
  const r = runJanus(workspace, janusArgs)
  if (!r.ok) {
    throw `janus ${janusArgs[0]} failed in workspace "${workspace.name}": ${r.stderr || r.stdout || 'no output'}`
  }
  return r.stdout || '(ok)'
}

// --- JSON-RPC plumbing ----------------------------------------------------

export interface JsonRpcRequest {
  jsonrpc: string
  id?: number | string | undefined
  method: string
  params?: Record<string, unknown> | undefined
}

// Build the JSON-RPC response object for one request. Notifications (no `id`)
// return undefined → nothing is written. Pure, so it unit-tests without stdio.
export function handleRequest(
  req: JsonRpcRequest,
): Record<string, unknown> | undefined {
  const { id, method } = req
  if (method === 'initialize') {
    return {
      id,
      jsonrpc: '2.0',
      result: {
        capabilities: { tools: {} },
        protocolVersion: PROTOCOL_VERSION,
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
      },
    }
  }
  if (method === 'notifications/initialized' || id === undefined) {
    // Notification — no response.
    return undefined
  }
  if (method === 'tools/list') {
    return { id, jsonrpc: '2.0', result: { tools: TOOLS } }
  }
  if (method === 'tools/call') {
    const params = req.params ?? {}
    const toolName = String(params['name'] ?? '')
    const toolArgs = (params['arguments'] as Record<string, unknown>) ?? {}
    try {
      const text = callTool(toolName, toolArgs)
      return {
        id,
        jsonrpc: '2.0',
        result: { content: [{ text, type: 'text' }] },
      }
    } catch (e) {
      // Tool-level error → MCP returns it as isError content, not a JSON-RPC
      // error (so the agent sees the message and can correct).
      return {
        id,
        jsonrpc: '2.0',
        result: { content: [{ text: String(e), type: 'text' }], isError: true },
      }
    }
  }
  return {
    error: { code: -32_601, message: `method not found: ${method}` },
    id,
    jsonrpc: '2.0',
  }
}

async function main(): Promise<void> {
  const rl = createInterface({ input: process.stdin })
  rl.on('line', line => {
    const trimmed = line.trim()
    if (!trimmed) {
      return
    }
    let req: JsonRpcRequest
    try {
      req = JSON.parse(trimmed) as JsonRpcRequest
    } catch {
      return
    }
    const res = handleRequest(req)
    if (res !== undefined) {
      process.stdout.write(`${JSON.stringify(res)}\n`)
    }
  })
  rl.on('close', () => {
    process.exit(0)
  })
  logger.info('[janus-multi-mcp] ready (stdio)')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  void main()
}
