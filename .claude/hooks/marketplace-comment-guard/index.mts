#!/usr/bin/env node
// Claude Code PreToolUse hook — marketplace-comment-guard.
//
// Enforces consistency between `.claude-plugin/marketplace.json` and its
// sibling `.claude-plugin/README.md`. Every plugin pinned in
// marketplace.json must have a row in the README's pin table with a
// matching `version` (= `source.ref`) AND `sha`, plus an ISO-8601 `date`.
//
// JSON can't carry comments and Claude Code's marketplace.json parser
// would reject them anyway, so the human-readable pin metadata (pin
// date, pinner, notes) lives in the README. The guard keeps the two
// files honest — same shape as the GHA `uses:` SHA-pin comment rule,
// which uses an inline `# v6.4.0 (YYYY-MM-DD)` to carry the staleness
// signal.
//
// Scope:
//   - Fires on Edit and Write tool calls.
//   - Only inspects paths ending in `.claude-plugin/marketplace.json`
//     or `.claude-plugin/README.md`.
//   - When marketplace.json is being edited, the post-edit JSON is
//     reconstructed from disk + the proposed change and checked against
//     the on-disk README.
//   - When README is being edited, the post-edit README is reconstructed
//     and checked against the on-disk marketplace.json.
//
// The hook fails OPEN on its own bugs (exit 0 + stderr log) so a bad
// hook deploy can't brick the session.

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

interface Hook {
  tool_name?: string | undefined
  tool_input?:
    | {
        file_path?: string | undefined
        new_string?: string | undefined
        old_string?: string | undefined
        content?: string | undefined
      }
    | undefined
}

interface PluginPin {
  name: string
  ref: string
  sha: string
}

interface BadPin {
  name: string
  expected: PluginPin
  reason: string
}

const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function extractPluginPins(
  marketplaceJson: string,
): PluginPin[] | undefined {
  let parsed: unknown
  try {
    parsed = JSON.parse(marketplaceJson)
  } catch {
    return undefined
  }
  if (!parsed || typeof parsed !== 'object') {
    return undefined
  }
  const plugins = (parsed as { plugins?: unknown | undefined }).plugins
  if (!Array.isArray(plugins)) {
    return []
  }
  const pins: PluginPin[] = []
  for (let i = 0, { length } = plugins; i < length; i += 1) {
    const entry = plugins[i]!
    if (!entry || typeof entry !== 'object') {
      continue
    }
    const e = entry as Record<string, unknown>
    const name = typeof e['name'] === 'string' ? e['name'] : undefined
    const src = e['source']
    if (!src || typeof src !== 'object') {
      continue
    }
    const s = src as Record<string, unknown>
    const ref = typeof s['ref'] === 'string' ? s['ref'] : undefined
    const sha = typeof s['sha'] === 'string' ? s['sha'] : undefined
    if (name && ref && sha) {
      pins.push({ name, ref, sha })
    }
  }
  return pins
}

interface ReadmeRow {
  plugin: string
  version: string
  sha: string
  date: string
}

// Parse the README's markdown pin table. We look for any line matching
// the pipe-separated table shape with at least 4 columns; the first
// four are plugin / version / sha / date. Trailing columns (by, notes)
// are ignored by the guard.
export function extractReadmeRows(readme: string): ReadmeRow[] {
  const rows: ReadmeRow[] = []
  for (const rawLine of readme.split('\n')) {
    const line = rawLine.trim()
    if (!line.startsWith('|') || !line.endsWith('|')) {
      continue
    }
    // Strip leading + trailing | and split.
    const cells = line
      .slice(1, -1)
      .split('|')
      .map(c => c.trim())
    if (cells.length < 4) {
      continue
    }
    const [plugin, version, sha, date] = cells
    if (!plugin || !version || !sha || !date) {
      continue
    }
    // Skip header row and divider row.
    if (plugin === 'plugin' || /^-+$/.test(plugin.replace(/[\s:-]/g, '-'))) {
      continue
    }
    rows.push({ plugin, version, sha, date })
  }
  return rows
}

export function isGuardedPath(
  p: string,
): { kind: 'json' | 'readme' } | undefined {
  if (p.endsWith('/.claude-plugin/marketplace.json')) {
    return { kind: 'json' }
  }
  if (p.endsWith('/.claude-plugin/README.md')) {
    return { kind: 'readme' }
  }
  return undefined
}

export function reconstructAfterEdit(
  filePath: string,
  tool: 'Edit' | 'Write',
  input: Hook['tool_input'],
): string | undefined {
  if (tool === 'Write') {
    return input?.content ?? ''
  }
  // Edit: apply old_string → new_string to the current on-disk content.
  const oldStr = input?.old_string ?? ''
  const newStr = input?.new_string ?? ''
  let current: string
  try {
    current = readFileSync(filePath, 'utf8')
  } catch {
    return undefined
  }
  const idx = current.indexOf(oldStr)
  if (idx === -1) {
    return undefined
  }
  return current.slice(0, idx) + newStr + current.slice(idx + oldStr.length)
}

export function siblingPath(filePath: string, kind: 'json' | 'readme'): string {
  const dir = path.dirname(filePath)
  return kind === 'json'
    ? path.join(dir, 'README.md')
    : path.join(dir, 'marketplace.json')
}

export function validate(pins: PluginPin[], rows: ReadmeRow[]): BadPin[] {
  const bad: BadPin[] = []
  const byPlugin = new Map<string, ReadmeRow>()
  for (let i = 0, { length } = rows; i < length; i += 1) {
    const row = rows[i]!
    byPlugin.set(row.plugin, row)
  }
  for (let i = 0, { length } = pins; i < length; i += 1) {
    const pin = pins[i]!
    const row = byPlugin.get(pin.name)
    if (!row) {
      bad.push({
        name: pin.name,
        expected: pin,
        reason: `no row in README pin table for plugin "${pin.name}"`,
      })
      continue
    }
    if (row.version !== pin.ref) {
      bad.push({
        name: pin.name,
        expected: pin,
        reason: `README version "${row.version}" does not match marketplace.json source.ref "${pin.ref}"`,
      })
    }
    if (row.sha !== pin.sha) {
      bad.push({
        name: pin.name,
        expected: pin,
        reason: `README sha "${row.sha}" does not match marketplace.json source.sha "${pin.sha}"`,
      })
    }
    if (!ISO_DATE_RE.test(row.date)) {
      bad.push({
        name: pin.name,
        expected: pin,
        reason: `README date "${row.date}" is not ISO-8601 YYYY-MM-DD`,
      })
    }
  }
  return bad
}

function main() {
  let stdin = ''
  process.stdin.on('data', chunk => {
    stdin += chunk
  })
  process.stdin.on('end', () => {
    try {
      let payload: Hook
      try {
        payload = JSON.parse(stdin) as Hook
      } catch {
        process.exit(0)
      }
      const tool = payload.tool_name
      if (tool !== 'Edit' && tool !== 'Write') {
        process.exit(0)
      }
      const filePath = payload.tool_input?.file_path
      if (!filePath) {
        process.exit(0)
      }
      const kind = isGuardedPath(filePath)
      if (!kind) {
        process.exit(0)
      }

      const reconstructed = reconstructAfterEdit(
        filePath,
        tool,
        payload.tool_input,
      )
      if (reconstructed === undefined) {
        process.exit(0)
      }

      const sibling = siblingPath(filePath, kind.kind)
      let siblingContent: string
      try {
        siblingContent = readFileSync(sibling, 'utf8')
      } catch {
        // Sibling missing — block, the pair must exist together.
        process.stderr.write(
          `[marketplace-comment-guard] refusing edit: sibling file missing.\n` +
            `  Edited:  ${filePath}\n` +
            `  Missing: ${sibling}\n\n` +
            `marketplace.json and its sibling README.md must exist together.\n` +
            `Create the missing file before editing the other.\n`,
        )
        process.exit(2)
      }

      const marketplaceJson =
        kind.kind === 'json' ? reconstructed : siblingContent
      const readme = kind.kind === 'readme' ? reconstructed : siblingContent

      const pins = extractPluginPins(marketplaceJson)
      if (pins === undefined) {
        process.stderr.write(
          `[marketplace-comment-guard] refusing edit: marketplace.json is not parseable JSON.\n` +
            `  File: ${kind.kind === 'json' ? filePath : sibling}\n\n` +
            `Fix the JSON syntax before editing either side of the pair.\n`,
        )
        process.exit(2)
      }

      const rows = extractReadmeRows(readme)
      const bad = validate(pins, rows)
      if (bad.length === 0) {
        process.exit(0)
      }

      process.stderr.write(
        `[marketplace-comment-guard] refusing edit: ` +
          `${bad.length} plugin pin(s) drift between marketplace.json and README.md.\n` +
          bad
            .map(
              b =>
                `    ${b.name}: ${b.reason}\n` +
                `      expected row: | ${b.expected.name} | ${b.expected.ref} | ${b.expected.sha} | YYYY-MM-DD | ... |`,
            )
            .join('\n') +
          '\n\nFix: update the README pin table so every plugin in marketplace.json\n' +
          'has a row with matching version + sha + an ISO-8601 date.\n' +
          'Bump the SHA → bump the row. Same discipline as the GHA `uses:`\n' +
          'SHA-pin comments — the date column is the staleness signal.\n',
      )
      process.exit(2)
    } catch (e) {
      process.stderr.write(
        `[marketplace-comment-guard] hook error (allowing): ${e}\n`,
      )
      process.exit(0)
    }
  })
  if (process.stdin.readable === false) {
    process.exit(0)
  }
}

main()
