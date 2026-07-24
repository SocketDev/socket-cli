/**
 * @file Scans `.claude/hooks/fleet/<name>/index.mts` sources for the dispatch
 *   eligibility markers and the static event/tool/trigger declarations, and
 *   collects the bundle-safe hooks. Split from gen/hook-dispatch.mts (which
 *   renders the tables + manifest from these descriptors) to keep both under
 *   the file-size cap. A hook is BUNDLE-SAFE when it is entrypoint-guarded
 *   (importing it does not fire `main()`) AND exports a `defineHook`-built
 *   `hook` the dispatcher runs via its `check` seam without a dynamic import.
 */

import { readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ENTRYPOINT_GUARD_RE =
  /\bvoid\s+runHook\s*\(\s*hook\s*,\s*import\.meta\.url/
const EXPORT_HOOK_RE = /export\s+const\s+hook\s*=\s*defineHook\s*\(/
// Snapshot-hostility opt-out: a hook whose module-eval graph holds native
// state V8 refuses to serialize (an SDK client binding node:http's
// HTTPParser, module-eval semver construction, …) declares
// `@dispatch-snapshot-exclude` in its header. It stays in the FULL table
// (index.cjs path) but is split out of the snapshot bundle into
// `excluded-bundle.cjs`, which deserialize-main splices in at runtime.
const SNAPSHOT_EXCLUDE_RE = /@dispatch-snapshot-exclude\b/
const DISPATCH_EVENT_RE = /\bevent\s*:\s*['"]([^'"]+)['"]/
const DISPATCH_TOOLS_RE = /\bmatcher\s*:\s*\[([^\]]*)\]/
const EXPORT_TRIGGERS_RE = /\bexport\s+const\s+triggers\b/
const INLINE_TRIGGERS_RE = /\btriggers\s*:\s*\[/

export interface EligibleHook {
  readonly event: string
  readonly name: string
  readonly snapshotExcluded: boolean
  readonly tools: readonly string[]
  readonly triggers: readonly string[]
}

/**
 * Index just before the `triggers` array literal a hook declares, or -1 when it
 * declares none. Two forms: `export const triggers[: type] = [ … ]` (referenced
 * by shorthand in defineHook — return the index of its `=`, so the caller's
 * `indexOf('[')` skips the `[` in a `readonly string[]` annotation) or an
 * inline `triggers: [ … ]` property (return the index of its `[`).
 */
function findTriggersArrayStart(source: string): number {
  const exportMatch = EXPORT_TRIGGERS_RE.exec(source)
  if (exportMatch) {
    return source.indexOf('=', exportMatch.index + exportMatch[0].length)
  }
  const inlineMatch = INLINE_TRIGGERS_RE.exec(source)
  if (inlineMatch) {
    return inlineMatch.index + inlineMatch[0].length - 1
  }
  return -1
}

/**
 * Extract the quoted-string tokens of a hook's `triggers` array in declared
 * order (`[]` when none). Scans for the array's matching `]` while honoring
 * quoted strings, so a token that itself contains a `]` (the OSC-52 `]52;`
 * clipboard trigger) does not end the array early. Tokens may hold other
 * special chars (`(`, `=`) and either quote style.
 */
export function parseTriggers(source: string): string[] {
  const start = findTriggersArrayStart(source)
  if (start === -1) {
    return []
  }
  const open = source.indexOf('[', start)
  if (open === -1) {
    return []
  }
  const tokens: string[] = []
  let quote = ''
  let token = ''
  for (let i = open + 1, { length } = source; i < length; i += 1) {
    const ch = source[i]!
    if (quote) {
      if (ch === '\\') {
        token += source[i + 1] ?? ''
        i += 1
        continue
      }
      if (ch === quote) {
        tokens.push(token)
        token = ''
        quote = ''
        continue
      }
      token += ch
      continue
    }
    if (ch === "'" || ch === '"') {
      quote = ch
      token = ''
      continue
    }
    if (ch === ']') {
      break
    }
  }
  return tokens
}

/**
 * Parse a hook's source for the eligibility markers + optional event/tools/
 * triggers declarations. Returns the eligible-hook descriptor, or undefined
 * when the hook is not bundle-safe.
 */
export function parseHookSource(
  name: string,
  source: string,
): EligibleHook | undefined {
  if (!ENTRYPOINT_GUARD_RE.test(source) || !EXPORT_HOOK_RE.test(source)) {
    return undefined
  }
  const eventMatch = DISPATCH_EVENT_RE.exec(source)
  const event = eventMatch?.[1] ?? 'PreToolUse'
  const toolsMatch = DISPATCH_TOOLS_RE.exec(source)
  const tools = toolsMatch?.[1]
    ? toolsMatch[1]
        .split(',')
        // Strip a leading or trailing single/double quote from each token.
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean)
    : []
  return {
    __proto__: null,
    event,
    name,
    snapshotExcluded: SNAPSHOT_EXCLUDE_RE.test(source),
    tools,
    triggers: parseTriggers(source),
  } as EligibleHook
}

/**
 * Scan the fleet hooks dir, returning every bundle-safe hook sorted by name.
 */
export function collectEligibleHooks(hooksDir: string): EligibleHook[] {
  const entries = readdirSync(hooksDir, { withFileTypes: true })
  const eligible: EligibleHook[] = []
  for (const dirent of entries) {
    if (!dirent.isDirectory()) {
      continue
    }
    const name = dirent.name
    if (name.startsWith('_')) {
      continue
    }
    const indexPath = path.join(hooksDir, name, 'index.mts')
    let source: string
    try {
      source = readFileSync(indexPath, 'utf8')
    } catch {
      continue
    }
    const parsed = parseHookSource(name, source)
    if (parsed) {
      eligible.push(parsed)
    }
  }
  eligible.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return eligible
}
