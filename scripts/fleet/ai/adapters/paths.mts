import path from 'node:path'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { ADAPTERS } from '../../gen/harness-adapters/catalog.mts'
import {
  CODEX_MCP_CONFIG_REL,
  CODEX_MCP_HOOKS_REL,
  OPENCODE_MCP_ADAPTER_REL,
} from '../../mcp/paths.mts'

export const GENERATED_AI_ADAPTER_PATHS: readonly string[] = [
  ...ADAPTERS.map(adapter => adapter.dest).filter(dest => dest !== 'AGENTS.md'),
  CODEX_MCP_CONFIG_REL,
  CODEX_MCP_HOOKS_REL,
  OPENCODE_MCP_ADAPTER_REL,
]

const RESERVED_ROOTS = new Set([
  path.posix.dirname(CODEX_MCP_CONFIG_REL),
  ...ADAPTERS.map(adapter => normalizePath(adapter.dest).split('/')[0]!).filter(
    root => root.startsWith('.') && root !== '.github',
  ),
])

export function isGeneratedAiAdapterPath(relativePath: string): boolean {
  let candidate = path.posix.normalize(normalizePath(relativePath))
  if (candidate.startsWith('../') || path.posix.isAbsolute(candidate)) {
    return false
  }
  const parts = candidate.split('/')
  if (parts[0] === 'template') {
    if (['base', 'preset', 'generated'].includes(parts[1] ?? '')) {
      candidate = parts
        .slice(parts[1] === 'base' && parts[2] === 'conditional' ? 4 : 3)
        .join('/')
    } else if (parts[1] === 'overrides') {
      candidate = parts.slice(3).join('/')
    }
  }
  return (
    GENERATED_AI_ADAPTER_PATHS.includes(candidate) ||
    [...RESERVED_ROOTS].some(
      root => candidate === root || candidate.startsWith(`${root}/`),
    )
  )
}
