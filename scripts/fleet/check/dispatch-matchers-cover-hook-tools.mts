// Fleet check — the `.claude/settings.json` dispatcher matcher for each event
// COVERS every tool the bundled hooks for that event actually handle.
//
// The dispatcher (`_dispatch/index.cjs <Event>`) is wired into settings.json
// behind a coarse regex matcher: Claude Code only invokes the dispatcher when
// the current tool matches it. Inside the dispatcher, `hookHandlesTool` then
// does an EXACT-name match against each bundled hook's `tools`. So a tool that
// a hook declares in `tools` but that is ABSENT from the settings matcher never
// reaches the dispatcher — the hook silently never fires for that tool. This is
// exactly how dep-derived-source-nudge (`tools: ['Edit','MultiEdit','Write']`)
// stopped firing on MultiEdit when the coarse matcher listed only `Bash|Edit|Write`.
//
// The matcher is hand-maintained (settings.json is the fleet-canonical wiring),
// while the hooks' `tools` are read by make-hook-dispatch.mts. Nothing tied the
// two together, so they drifted. This check ties them: it reads the eligible
// hooks (via the maker's own collector — single source) and asserts, per event:
//   - no match-all hook (tools omitted): every explicit `tools` token is present
//     in the coarse matcher; a missing token means that hook is silently dead
//     for that tool.
//   - a match-all hook (Stop / SessionStart style): the dispatcher entry must
//     have NO matcher (or `.*`) so it fires on every tool.
// Extra matcher tokens (a regex like `mcp__.*`, a stale tool) are tolerated —
// this is a COVERAGE (subset) check, not equality, so it never false-positives
// on a deliberately-broad matcher.
//
// Usage: node scripts/fleet/check/dispatch-matchers-cover-hook-tools.mts [--quiet]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import type { EligibleHook } from '../make-hook-dispatch.mts'
import {
  collectEligibleHooks,
  FLEET_HOOKS_DIR,
} from '../make-hook-dispatch.mts'
import { CLAUDE_SETTINGS_JSON, REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const DISPATCHER_CMD_RE = /_dispatch\/index\.cjs\s+(\w+)/

export interface DispatcherEntry {
  readonly matcher: string | undefined
  readonly present: boolean
}

export interface CoverageFinding {
  readonly event: string
  readonly kind: 'match-all-needs-catch-all' | 'missing-tools' | 'not-wired'
  readonly matcher: string | undefined
  readonly missing: readonly string[]
}

interface SettingsShape {
  hooks?:
    | Record<
        string,
        Array<{
          hooks?: Array<{ command?: string | undefined }> | undefined
          matcher?: string | undefined
        }>
      >
    | undefined
}

/**
 * A matcher that fires on every tool: absent, empty, or the catch-all regex.
 * Such a matcher is a superset of any explicit tool list, so it always covers.
 */
export function matcherCoversAll(matcher: string | undefined): boolean {
  const trimmed = matcher?.trim()
  return trimmed === undefined || trimmed === '' || trimmed === '.*'
}

/**
 * Pull the dispatcher matcher entry for each event out of a parsed settings
 * shape. The dispatcher entry is the one whose command runs
 * `_dispatch/index.cjs <Event>`; other entries (standalone per-hook wiring) are
 * ignored. Pure + exported for unit tests.
 */
export function extractDispatcherEntries(
  settings: SettingsShape,
): Record<string, DispatcherEntry> {
  const out: Record<string, DispatcherEntry> = {
    __proto__: null,
  } as unknown as Record<string, DispatcherEntry>
  const hooks = settings.hooks
  if (!hooks) {
    return out
  }
  const events = Object.keys(hooks)
  for (let i = 0, { length } = events; i < length; i += 1) {
    const event = events[i]!
    const arr = hooks[event] ?? []
    for (let j = 0, al = arr.length; j < al; j += 1) {
      const entry = arr[j]!
      const cmds = entry.hooks ?? []
      let isDispatcher = false
      for (let k = 0, cl = cmds.length; k < cl; k += 1) {
        const cmd = cmds[k]?.command ?? ''
        const m = DISPATCHER_CMD_RE.exec(cmd)
        if (m && m[1] === event) {
          isDispatcher = true
          break
        }
      }
      if (isDispatcher) {
        out[event] = {
          __proto__: null,
          matcher: entry.matcher,
          present: true,
        } as DispatcherEntry
        break
      }
    }
  }
  return out
}

/**
 * Diagnose per-event coverage: does each event's dispatcher matcher route every
 * tool its bundled hooks handle? Pure — takes the eligible hooks + the
 * extracted dispatcher entries, returns findings (empty = fully covered).
 */
export function diagnoseDispatcherCoverage(
  hooks: readonly EligibleHook[],
  dispatchers: Readonly<Record<string, DispatcherEntry>>,
): CoverageFinding[] {
  const byEvent = new Map<
    string,
    { hasMatchAll: boolean; tools: Set<string> }
  >()
  for (let i = 0, { length } = hooks; i < length; i += 1) {
    const h = hooks[i]!
    const bucket = byEvent.get(h.event) ?? {
      hasMatchAll: false,
      tools: new Set<string>(),
    }
    if (!h.tools || h.tools.length === 0) {
      bucket.hasMatchAll = true
    } else {
      for (let j = 0, tl = h.tools.length; j < tl; j += 1) {
        bucket.tools.add(h.tools[j]!)
      }
    }
    byEvent.set(h.event, bucket)
  }
  const findings: CoverageFinding[] = []
  const events = [...byEvent.keys()].toSorted()
  for (let i = 0, { length } = events; i < length; i += 1) {
    const event = events[i]!
    const { hasMatchAll, tools } = byEvent.get(event)!
    const dispatcher = dispatchers[event]
    if (!dispatcher?.present) {
      findings.push({
        __proto__: null,
        event,
        kind: 'not-wired',
        matcher: undefined,
        missing: hasMatchAll ? ['<all tools>'] : [...tools].toSorted(),
      } as CoverageFinding)
      continue
    }
    if (hasMatchAll) {
      if (!matcherCoversAll(dispatcher.matcher)) {
        findings.push({
          __proto__: null,
          event,
          kind: 'match-all-needs-catch-all',
          matcher: dispatcher.matcher,
          missing: [],
        } as CoverageFinding)
      }
      continue
    }
    if (matcherCoversAll(dispatcher.matcher)) {
      continue
    }
    const tokens = new Set(
      (dispatcher.matcher ?? '')
        .split('|')
        .map(s => s.trim())
        .filter(Boolean),
    )
    const missing = [...tools].filter(t => !tokens.has(t)).toSorted()
    if (missing.length) {
      findings.push({
        __proto__: null,
        event,
        kind: 'missing-tools',
        matcher: dispatcher.matcher,
        missing,
      } as CoverageFinding)
    }
  }
  return findings
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  let settings: SettingsShape
  try {
    settings = JSON.parse(
      readFileSync(CLAUDE_SETTINGS_JSON, 'utf8'),
    ) as SettingsShape
  } catch {
    logger.fail(
      '[check-dispatch-matchers-cover-hook-tools] could not read/parse .claude/settings.json.',
    )
    logger.error(`  Where: ${path.relative(REPO_ROOT, CLAUDE_SETTINGS_JSON)}`)
    process.exitCode = 1
    return
  }
  const hooks = collectEligibleHooks(FLEET_HOOKS_DIR)
  const dispatchers = extractDispatcherEntries(settings)
  const findings = diagnoseDispatcherCoverage(hooks, dispatchers)
  if (findings.length) {
    logger.fail(
      '[check-dispatch-matchers-cover-hook-tools] a settings.json dispatcher matcher does not cover its bundled hooks.',
    )
    for (let i = 0, { length } = findings; i < length; i += 1) {
      const f = findings[i]!
      logger.error(`  Where: settings.json hooks.${f.event} dispatcher entry`)
      if (f.kind === 'not-wired') {
        logger.error(
          `  Saw:   bundled ${f.event} hooks exist but no _dispatch/index.cjs ${f.event} entry is wired`,
        )
        logger.error(
          `  Wanted: a dispatcher entry routing ${f.missing.join(', ')} to the dispatcher`,
        )
      } else if (f.kind === 'match-all-needs-catch-all') {
        logger.error(
          `  Saw:   a match-all ${f.event} hook, but the matcher is \`${f.matcher}\` (restrictive)`,
        )
        logger.error(
          '  Wanted: no matcher (or `.*`) so the dispatcher fires on every tool',
        )
      } else {
        logger.error(
          `  Saw:   matcher \`${f.matcher}\` omits: ${f.missing.join(', ')}`,
        )
        logger.error(
          `  Wanted: the matcher to include every tool a bundled ${f.event} hook declares`,
        )
      }
    }
    logger.error(
      '  Fix:   add the missing tool(s) to the matcher in .claude/settings.json (template/base first, then cascade).',
    )
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      '[check-dispatch-matchers-cover-hook-tools] every dispatcher matcher covers its bundled hooks.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
