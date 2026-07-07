/**
 * @file Shared enforcer-inventory collectors for the code-is-law gate
 *   (claude-md-rules-are-enforced.mts). One place that knows how to enumerate
 *   the repo's executable enforcers — hooks, lint rules, and scripts — plus the
 *   fleet-canonical doc surface, so the gate's "does an enforcer for this rule
 *   exist?" question has a single source of truth. Kept here (not inlined in
 *   the check) so a sibling check or a future audit can reuse the same
 *   inventory rather than re-deriving the directory conventions.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

// A hook counts as an executable enforcer when its dir holds an index.mts (a
// PreToolUse/Stop guard or reminder) OR an install.mts (an installer hook that
// enforces off the host machine — git signing config, keychain setup). Both are
// code that makes a rule hold; a bare README-only dir does not.
const HOOK_ENTRYPOINTS = ['index.mts', 'install.mts']

function listDirs(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
  } catch {
    return []
  }
}

// Hook names (across fleet/ and repo/) whose dir has an enforcer entrypoint.
export function collectHookEnforcers(repoRoot: string): Set<string> {
  const out = new Set<string>()
  for (const seg of ['fleet', 'repo']) {
    const segDir = path.join(repoRoot, '.claude', 'hooks', seg)
    for (const name of listDirs(segDir)) {
      if (name === '_shared' || name.startsWith('.')) {
        continue
      }
      const dir = path.join(segDir, name)
      if (HOOK_ENTRYPOINTS.some(f => existsSync(path.join(dir, f)))) {
        out.add(name)
      }
    }
  }
  return out
}

export interface LintRuleInventory {
  // socket/<rule> names — the rule directories under .config/oxlint-plugin/fleet/.
  // Empty in a repo that doesn't ship the plugin (the gate's socket arm then
  // fails open).
  readonly socketRules: Set<string>
  // typescript/<rule> names that appear as keys in the oxlint config.
  readonly tsRules: Set<string>
}

export function collectLintRules(repoRoot: string): LintRuleInventory {
  const socketRules = new Set<string>()
  // The plugin's layout is one `fleet/<rule-id>/` directory per rule (per
  // CLAUDE.md "Lint rules"), so a rule name is the DIRECTORY name — not a `.mts`
  // file stem. (`socket/<id>` is the citation form; the `socket/` prefix is
  // implicit.)
  const rulesDir = path.join(repoRoot, '.config/oxlint-plugin/fleet')
  try {
    for (const entry of readdirSync(rulesDir, { withFileTypes: true })) {
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        socketRules.add(entry.name)
      }
    }
  } catch {
    // No plugin in this repo — leave socketRules empty.
  }

  const tsRules = new Set<string>()
  const configPath = path.join(repoRoot, '.config/fleet/oxlintrc.json')
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf8')) as {
      rules?: Record<string, unknown> | undefined
    }
    for (const key of Object.keys(config.rules ?? {})) {
      if (key.startsWith('typescript/')) {
        tsRules.add(key.slice('typescript/'.length))
      }
    }
  } catch {
    // No config or unparseable — leave tsRules empty.
  }
  return { socketRules, tsRules }
}

function walkMts(dir: string, base: string, out: Set<string>): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name === 'node_modules' || name.startsWith('.')) {
      continue
    }
    const abs = path.join(dir, name)
    let isDir = false
    try {
      isDir = statSync(abs).isDirectory()
    } catch {
      continue
    }
    if (isDir) {
      walkMts(abs, base, out)
    } else if (name.endsWith('.mts')) {
      // Key by the path RELATIVE to scripts/fleet/, forward-slashed, so a
      // citation `scripts/fleet/check/foo.mts` matches key `check/foo.mts`.
      out.add(path.relative(base, abs).split(path.sep).join('/'))
    }
  }
}

// Every scripts/{fleet,repo}/**/*.mts, keyed by its path under scripts/ (e.g.
// `fleet/check/foo.mts`, `repo/cascade-fleet.mts`). A citation is written as
// `scripts/<key>`; the check strips the leading `scripts/` before lookup. Both
// tiers count: scripts/fleet/ is cascaded executable law, scripts/repo/ is
// wheelhouse-owned automation (the cascade engine itself) — both are code that
// enforces a rule when run.
export function collectScriptPaths(repoRoot: string): Set<string> {
  const base = path.join(repoRoot, 'scripts')
  const out = new Set<string>()
  for (const tier of ['fleet', 'repo']) {
    walkMts(path.join(base, tier), base, out)
  }
  return out
}

// Absolute paths of docs/agents.md/fleet/*.md (one level — the fleet detail
// pages). These are gated alongside the CLAUDE.md fleet block.
export function collectFleetDocs(repoRoot: string): string[] {
  const dir = path.join(repoRoot, 'docs', 'agents.md', 'fleet')
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const name = entries[i]!
    if (name.endsWith('.md')) {
      out.push(path.join(dir, name))
    }
  }
  return out
}
