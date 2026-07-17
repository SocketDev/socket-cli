/**
 * @file Pure adapters from the fleet-canonical Claude `.mcp.json` shape to
 *   project-local Codex/OpenCode configs and Kimi's per-user MCP file.
 *   Credentials never belong in the canonical or generated project files; each
 *   client owns OAuth state in its user data directory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'

import { isMainModule } from './_shared/is-main-module.mts'
import { REPO_ROOT } from './paths.mts'

export type PortableMcpServer =
  | {
      args: string[]
      command: string
      kind: 'stdio'
    }
  | {
      kind: 'http'
      url: string
    }

export type PortableMcpServers = Readonly<Record<string, PortableMcpServer>>

// Boundary + known secret-bearing key name + boundary, including snake/kebab case.
const CREDENTIAL_KEY_PATTERN =
  /(?:^|[-_])(?:auth(?:orization)?|bearer|credential|password|secret|token)(?:$|[-_])/i
const CREDENTIAL_VALUE_PATTERN = /\bbearer\s+[a-z\d._~+/=-]+/i

function assertNoCredentials(value: unknown, location = '.mcp.json'): void {
  if (typeof value === 'string') {
    if (CREDENTIAL_VALUE_PATTERN.test(value)) {
      throw new Error(
        `Committed MCP config contains a credential at ${location}`,
      )
    }
    return
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      assertNoCredentials(value[index], `${location}[${index}]`)
    }
    return
  }
  if (!isRecord(value)) {
    return
  }
  const entries = Object.entries(value)
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const [key, child] = entries[i]!
    if (CREDENTIAL_KEY_PATTERN.test(key)) {
      throw new Error(
        `Committed MCP config contains a credential field at ${location}.${key}`,
      )
    }
    assertNoCredentials(child, `${location}.${key}`)
  }
}

function compactOpenCodeCommandArrays(
  text: string,
  servers: PortableMcpServers,
): string {
  let result = text
  const items = Object.values(servers)
  for (let i = 0, { length } = items; i < length; i += 1) {
    const server = items[i]!
    if (server.kind !== 'stdio') {
      continue
    }
    const command = [server.command, ...server.args]
    const compact = `      "command": [${command.map(value => JSON.stringify(value)).join(', ')}]`
    if (compact.length > 80) {
      continue
    }
    const expanded = [
      '      "command": [',
      ...command.map(
        (value, index) =>
          `        ${JSON.stringify(value)}${index + 1 < command.length ? ',' : ''}`,
      ),
      '      ]',
    ].join('\n')
    result = result.replace(expanded, compact)
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function main(): void {
  if (!process.argv.includes('--write')) {
    throw new Error(
      'Usage: node scripts/fleet/mcp-config.mts --write (regenerates project MCP client configs)',
    )
  }
  writeMcpClientConfigs(REPO_ROOT)
  process.stdout.write('Generated .codex/config.toml and opencode.json.\n')
}

function parseStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new Error(`MCP server ${field} must be an array of strings`)
  }
  return [...value]
}

function runMain(): void {
  try {
    main()
  } catch (error) {
    process.stderr.write(`${errorMessage(error)}\n`)
    process.exitCode = 1
  }
}

function sortRecord<T>(record: Readonly<Record<string, T>>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(record).toSorted(([left], [right]) =>
      left < right ? -1 : left > right ? 1 : 0,
    ),
  )
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlStringArray(values: readonly string[]): string[] {
  const compact = JSON.stringify(values)
  if (`args = ${compact}`.length <= 80) {
    return [`args = ${compact}`]
  }
  return ['args = [', ...values.map(value => `  ${tomlString(value)},`), ']']
}

/**
 * Merge the canonical server definitions into Kimi's user-owned config. Kimi
 * has no project discovery file, so local servers receive an absolute cwd while
 * unrelated user servers and credentials remain untouched.
 */
export function mergeKimiMcpConfig(
  currentText: string,
  servers: PortableMcpServers,
  repoRoot: string,
): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(currentText)
  } catch {
    throw new Error('Existing Kimi MCP config must contain valid JSON')
  }
  if (!isRecord(parsed)) {
    throw new Error('Existing Kimi MCP config must be a JSON object')
  }
  const existing = parsed['mcpServers']
  if (existing !== undefined && !isRecord(existing)) {
    throw new Error('Existing Kimi mcpServers value must be a JSON object')
  }

  const mcpServers: Record<string, unknown> = { ...(existing ?? {}) }
  for (const [name, server] of Object.entries(servers)) {
    mcpServers[name] =
      server.kind === 'http'
        ? { auth: 'oauth', type: 'http', url: server.url }
        : {
            args: server.args,
            command: server.command,
            cwd: repoRoot,
          }
  }
  return `${JSON.stringify(
    { ...parsed, mcpServers: sortRecord(mcpServers) },
    undefined,
    2,
  )}\n`
}

/**
 * Parse and validate the one committed MCP authority.
 */
export function parseCanonicalMcpConfig(text: string): PortableMcpServers {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('Canonical .mcp.json must contain valid JSON')
  }
  assertNoCredentials(parsed)
  if (!isRecord(parsed) || !isRecord(parsed['mcpServers'])) {
    throw new Error('Canonical .mcp.json must contain an mcpServers object')
  }

  const servers: Record<string, PortableMcpServer> = {}
  for (const [name, rawServer] of Object.entries(parsed['mcpServers'])) {
    if (!isRecord(rawServer)) {
      throw new Error(`MCP server ${name} must be an object`)
    }
    if (rawServer['type'] === 'http') {
      const url = rawServer['url']
      if (typeof url !== 'string' || url.length === 0) {
        throw new Error(`HTTP MCP server ${name} must have a URL`)
      }
      servers[name] = { kind: 'http', url }
      continue
    }
    const command = rawServer['command']
    if (typeof command !== 'string' || command.length === 0) {
      throw new Error(`stdio MCP server ${name} must have a command`)
    }
    servers[name] = {
      args: parseStringArray(rawServer['args'] ?? [], `${name}.args`),
      command,
      kind: 'stdio',
    }
  }
  return sortRecord(servers)
}

/**
 * Render the trusted-project `.codex/config.toml` MCP section.
 */
export function renderCodexMcpConfig(servers: PortableMcpServers): string {
  const lines = [
    '# Generated from ../.mcp.json by scripts/fleet/mcp-config.mts.',
    '# OAuth credentials stay in Codex user storage; do not add them here.',
  ]
  for (const [name, server] of Object.entries(sortRecord(servers))) {
    lines.push('', `[mcp_servers.${name}]`)
    if (server.kind === 'http') {
      lines.push(`url = ${tomlString(server.url)}`)
    } else {
      lines.push(`command = ${tomlString(server.command)}`)
      lines.push(...tomlStringArray(server.args))
    }
  }
  return `${lines.join('\n')}\n`
}

/**
 * Render OpenCode's project-root `opencode.json`.
 */
export function renderOpenCodeMcpConfig(servers: PortableMcpServers): string {
  const mcp: Record<string, unknown> = {}
  for (const [name, server] of Object.entries(sortRecord(servers))) {
    mcp[name] =
      server.kind === 'http'
        ? { enabled: true, type: 'remote', url: server.url }
        : {
            command: [server.command, ...server.args],
            enabled: true,
            type: 'local',
          }
  }
  const rendered = JSON.stringify(
    { $schema: 'https://opencode.ai/config.json', mcp },
    undefined,
    2,
  )
  return `${compactOpenCodeCommandArrays(rendered, servers)}\n`
}

/**
 * Regenerate the two committed project adapters from `.mcp.json`.
 */
export function writeMcpClientConfigs(repoRoot: string): void {
  const templateRoot = path.join(repoRoot, 'template', 'base')
  const configRoot = existsSync(path.join(templateRoot, '.mcp.json'))
    ? templateRoot
    : repoRoot
  const servers = parseCanonicalMcpConfig(
    readFileSync(path.join(configRoot, '.mcp.json'), 'utf8'),
  )
  mkdirSync(path.join(configRoot, '.codex'), { recursive: true })
  writeFileSync(
    path.join(configRoot, '.codex', 'config.toml'),
    renderCodexMcpConfig(servers),
  )
  writeFileSync(
    path.join(configRoot, 'opencode.json'),
    renderOpenCodeMcpConfig(servers),
  )
}

if (isMainModule(import.meta.url)) {
  runMain()
}
