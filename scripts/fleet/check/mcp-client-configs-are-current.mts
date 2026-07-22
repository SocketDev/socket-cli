#!/usr/bin/env node
/**
 * @file Fail-closed parity gate for MCP client adapters. `.mcp.json` is the
 *   single committed authority; `.codex/config.toml` and `opencode.json` are
 *   generated projections and may never carry credentials.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import {
  CODEX_ADAPTERS,
  parseCanonicalMcpConfig,
  renderKimiProjectMcpConfig,
  renderOpenCodeMcpConfig,
} from '../mcp-config.mts'
import type { PortableMcpServers } from '../mcp-config.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

function main(): void {
  const issues = findMcpClientConfigIssues(REPO_ROOT)
  if (issues.length === 0) {
    logger.success(
      '[mcp-client-configs-are-current] Codex/OpenCode/Kimi configs match .mcp.json.',
    )
    return
  }
  logger.fail(
    [
      '[mcp-client-configs-are-current] generated MCP client config drift:',
      ...issues.map(issue => `  - ${issue}`),
      'Fix: edit only .mcp.json, run `node scripts/fleet/mcp-config.mts --write`, then cascade.',
    ].join('\n'),
  )
  process.exitCode = 1
}

/**
 * Return every missing, invalid, or stale committed MCP surface.
 */
export function findMcpClientConfigIssues(repoRoot: string): string[] {
  const templateRoot = path.join(repoRoot, 'template', 'base')
  const configRoot = existsSync(path.join(templateRoot, '.mcp.json'))
    ? templateRoot
    : repoRoot
  const canonicalPath = path.join(configRoot, '.mcp.json')
  if (!existsSync(canonicalPath)) {
    return ['.mcp.json is missing.']
  }

  let servers: PortableMcpServers
  try {
    servers = parseCanonicalMcpConfig(readFileSync(canonicalPath, 'utf8'))
  } catch (error) {
    return [`.mcp.json is invalid: ${errorMessage(error)}`]
  }

  const issues: string[] = []
  // `.codex/*` is generated-untracked (repo-root LIVE tree, gitignored,
  // regenerated at setup — never committed). An ABSENT root copy is fine (setup
  // recreates it); a PRESENT-but-stale copy is flagged so a hand-edit is caught.
  // Iterates the CODEX_ADAPTERS authority so the render logic lives in one place.
  for (let i = 0, { length } = CODEX_ADAPTERS; i < length; i += 1) {
    const adapter = CODEX_ADAPTERS[i]!
    const filePath = path.join(repoRoot, adapter.path)
    if (
      existsSync(filePath) &&
      readFileSync(filePath, 'utf8') !== adapter.render(servers)
    ) {
      issues.push(`${adapter.path} is drifted from .mcp.json.`)
    }
  }
  // `opencode.json` + `.kimi-code/mcp.json` are tracked cascade sources — they
  // MUST be present at configRoot and match `.mcp.json`.
  const cascadeAdapters = [
    {
      content: renderOpenCodeMcpConfig(servers),
      relativePath: 'opencode.json',
    },
    {
      content: renderKimiProjectMcpConfig(servers),
      relativePath: '.kimi-code/mcp.json',
    },
  ]
  for (let i = 0, { length } = cascadeAdapters; i < length; i += 1) {
    const entry = cascadeAdapters[i]!
    const filePath = path.join(configRoot, entry.relativePath)
    if (!existsSync(filePath)) {
      issues.push(`${entry.relativePath} is missing.`)
    } else if (readFileSync(filePath, 'utf8') !== entry.content) {
      issues.push(`${entry.relativePath} is drifted from .mcp.json.`)
    }
  }
  return issues
}

if (isMainModule(import.meta.url)) {
  main()
}
