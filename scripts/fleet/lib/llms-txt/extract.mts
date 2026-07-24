/**
 * @file Deterministic repo fact extractor for the llms.txt generator.
 *   Reads package.json, .config/socket-wheelhouse.json, and README.md.
 *   No AI calls; no network; no process.cwd(). Pure FS reads only.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import type { RepoFacts } from './types.mts'

/**
 * Read and parse a JSON file at `filePath`. Returns undefined on parse
 * error or missing file.
 */
function readJson(filePath: string): Record<string, unknown> | undefined {
  if (!existsSync(filePath)) {
    return undefined
  }
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as Record<string, unknown>
  } catch {
    return undefined
  }
}

/**
 * Extract the first substantive paragraph from a README. Skips the H1
 * badge lines and empty lines, returning the first paragraph of body text
 * up to 400 characters.
 */
export function extractReadmeLead(readmePath: string): string | undefined {
  if (!existsSync(readmePath)) {
    return undefined
  }
  const text = readFileSync(readmePath, 'utf8')
  const lines = text.split('\n')
  let inParagraph = false
  const paragraphLines: string[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    const trimmed = line.trim()
    // Skip H1, badge lines, and empty leading lines.
    if (!inParagraph) {
      if (
        trimmed.startsWith('#') ||
        trimmed.startsWith('[![') ||
        trimmed.startsWith('![') ||
        trimmed === ''
      ) {
        continue
      }
      inParagraph = true
    }
    if (trimmed === '') {
      break
    }
    paragraphLines.push(trimmed)
  }
  if (paragraphLines.length === 0) {
    return undefined
  }
  const joined = paragraphLines.join(' ')
  return joined.length > 400 ? joined.slice(0, 400) : joined
}

/**
 * Resolve the repo name from config then package.json basename fallback.
 */
function resolveRepoName(
  config: Record<string, unknown> | undefined,
  pkg: Record<string, unknown> | undefined,
  repoRoot: string,
): string {
  if (
    typeof config?.['repoName'] === 'string' &&
    config['repoName'].length > 0
  ) {
    return config['repoName']
  }
  if (typeof pkg?.['name'] === 'string' && pkg['name'].length > 0) {
    const name = pkg['name'] as string
    // Strip scope prefix if present.
    const slash = name.lastIndexOf('/')
    return slash !== -1 ? name.slice(slash + 1) : name
  }
  return path.basename(repoRoot)
}

/**
 * Resolve layout from config, package.json workspaces, or pnpm-workspace.yaml.
 */
function resolveLayout(
  config: Record<string, unknown> | undefined,
  pkg: Record<string, unknown> | undefined,
  repoRoot: string,
): 'monorepo' | 'single-package' {
  if (
    config?.['layout'] === 'monorepo' ||
    config?.['layout'] === 'single-package'
  ) {
    return config['layout'] as 'monorepo' | 'single-package'
  }
  // npm/yarn workspaces field.
  if (pkg?.['workspaces'] !== undefined) {
    return 'monorepo'
  }
  // pnpm workspaces file (no workspaces field in package.json).
  let stat
  try {
    stat = statSync(path.join(repoRoot, 'pnpm-workspace.yaml'))
  } catch {
    stat = undefined
  }
  if (stat?.isFile()) {
    return 'monorepo'
  }
  return 'single-package'
}

/**
 * Extract deterministic repo facts from the repo root. Never throws — returns
 * best-effort data and leaves optional fields undefined when absent.
 */
export function extractRepoFacts(repoRoot: string): RepoFacts {
  const pkgPath = path.join(repoRoot, 'package.json')
  const configPathA = path.join(repoRoot, '.config', 'socket-wheelhouse.json')
  const configPathB = path.join(repoRoot, '.socket-wheelhouse.json')
  const readmePath = path.join(repoRoot, 'README.md')

  const pkg = readJson(pkgPath)
  const config = existsSync(configPathA)
    ? readJson(configPathA)
    : readJson(configPathB)

  const engines = pkg?.['engines'] as Record<string, string> | undefined
  const nodeFloor =
    typeof engines?.['node'] === 'string' ? engines['node'] : undefined

  return {
    layout: resolveLayout(config, pkg, repoRoot),
    license: typeof pkg?.['license'] === 'string' ? pkg['license'] : undefined,
    nodeFloor,
    readmeLead: extractReadmeLead(readmePath),
    repoName: resolveRepoName(config, pkg, repoRoot),
    version: typeof pkg?.['version'] === 'string' ? pkg['version'] : undefined,
  }
}
