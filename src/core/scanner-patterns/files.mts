import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'

import fg from 'fast-glob'

import type { ScannerName } from '@socketsecurity/scan-patterns'

const IGNORED_GLOBS = [
  '**/.git/**',
  '**/node_modules/**',
  '**/vendor/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
]

const SCANNER_GLOBS: Readonly<Record<ScannerName, readonly string[]>> = {
  agentConfigs: [
    '**/AGENTS.md',
    '**/CLAUDE.md',
    '**/.agents/**/*',
    '**/.claude/**/*',
    '**/.cursor/**/*',
  ],
  manifests: ['**/*'],
  secrets: ['**/*'],
  skills: ['**/SKILL.md', '**/.agents/skills/**/*', '**/.claude/skills/**/*'],
  workflows: ['**/.github/workflows/*.{yaml,yml}'],
}

export async function discoverScannerPatternFiles(
  scanner: ScannerName,
  targets: readonly string[],
  cwd: string,
): Promise<string[]> {
  const files = new Set<string>()
  for (const target of targets.length ? targets : ['.']) {
    const resolved = path.resolve(cwd, target)
    const targetStat = await stat(resolved)
    if (targetStat.isFile()) {
      files.add(resolved)
      continue
    }
    if (!targetStat.isDirectory()) {
      continue
    }
    const matches = await fg([...SCANNER_GLOBS[scanner]], {
      absolute: true,
      cwd: resolved,
      dot: true,
      followSymbolicLinks: false,
      ignore: IGNORED_GLOBS,
      onlyFiles: true,
      unique: true,
    })
    for (const match of matches) {
      files.add(path.resolve(match))
    }
  }
  return [...files].toSorted()
}

export async function readScannerPatternText(
  filename: string,
): Promise<string | undefined> {
  const fileStat = await stat(filename)
  if (fileStat.size > 1024 * 1024) {
    return undefined
  }
  const content = await readFile(filename)
  if (content.includes(0)) {
    return undefined
  }
  return content.toString('utf8')
}
