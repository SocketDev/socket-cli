// Let a hook persist its correction into the agent's per-project memory
// (`~/.claude/projects/<derived>/memory/`) the first time it fires.
// Idempotent: an existing entry is never touched; MEMORY.md gets its index
// line exactly once. The project dir name is Claude Code's encoding of the
// session cwd (`/` flattened to `-`).

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveProjectDir } from './project-dir.mts'

export interface AgentMemoryEntry {
  /**
   * Kebab-case slug; becomes `<name>.md` and the `[[link]]` target.
   */
  name: string
  /**
   * One line used by recall to judge relevance.
   */
  description: string
  /**
   * Memory taxonomy: user | feedback | project | reference.
   */
  type: 'feedback' | 'project' | 'reference' | 'user'
  /**
   * Markdown body (below the frontmatter).
   */
  body: string
  /**
   * Hook text for the MEMORY.md index line.
   */
  indexHook: string
  /**
   * Override the projects root (tests). Default: ~/.claude/projects.
   */
  baseDir?: string | undefined
  /**
   * Override the project dir (tests). Default: resolveProjectDir().
   */
  cwd?: string | undefined
}

export function projectMemoryDir(
  cwd: string = resolveProjectDir(),
  baseDir: string = path.join(os.homedir(), '.claude', 'projects'),
): string {
  const encoded = path.resolve(cwd).replaceAll(path.sep, '-')
  return path.join(baseDir, encoded, 'memory')
}

/**
 * Write `<name>.md` + its MEMORY.md index line if absent. Returns true only
 * when the entry file was created by this call; an existing file is left
 * byte-untouched and returns false.
 */
export function ensureAgentMemoryEntry(entry: AgentMemoryEntry): boolean {
  const memoryDir = projectMemoryDir(entry.cwd, entry.baseDir)
  const filePath = path.join(memoryDir, `${entry.name}.md`)
  if (existsSync(filePath)) {
    return false
  }
  mkdirSync(memoryDir, { recursive: true })
  const frontmatter = [
    '---',
    `name: ${entry.name}`,
    `description: "${entry.description.replaceAll('"', "'")}"`,
    'metadata:',
    `  type: ${entry.type}`,
    '---',
    '',
  ].join('\n')
  writeFileSync(filePath, `${frontmatter}${entry.body.trimEnd()}\n`)

  const indexPath = path.join(memoryDir, 'MEMORY.md')
  const indexLine = `- [${entry.name}](${entry.name}.md) — ${entry.indexHook}`
  const index = existsSync(indexPath) ? readFileSync(indexPath, 'utf8') : ''
  if (!index.includes(`(${entry.name}.md)`)) {
    const joined = index.length > 0 && !index.endsWith('\n') ? '\n' : ''
    writeFileSync(indexPath, `${index}${joined}${indexLine}\n`)
  }
  return true
}
