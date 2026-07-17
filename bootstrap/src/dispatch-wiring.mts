/*
 * @file Single source of the fleet hook-dispatch WIRING vocabulary — the two
 *   command forms `.claude/settings.json` points each dispatch event at, and
 *   the pure rewrite/canonicalize between them. Kept in ONE place so every site
 *   that touches the wiring agrees on the exact byte-for-byte forms (the loop
 *   guard):
 *
 *   - scripts/fleet/setup/hook-snapshot.mts builds the launcher + wires it
 *   - bootstrap/src/settings.mts PRESERVES a host's launcher form through a
 *     cascade merge, and CANONICALIZES it away for the fleet-drift comparison
 *     The two forms per event: baseline node
 *     "$CLAUDE_PROJECT_DIR"/…/_dispatch/index.cjs <Event> the V8 COMPILE-CACHE
 *     path — correct on every OS/arch with zero per-machine state. The
 *     fleet-cascaded canonical, and the launcher's own fail-open target.
 *     launcher "$CLAUDE_PROJECT_DIR"/…/_dispatch/dispatch-launcher <Event> the
 *     per-host native launcher that re-execs `node --snapshot-blob …` (the V8
 *     startup-snapshot fast path). Built by setup; gitignored; fails open to
 *     the baseline. It is the SAME fleet dispatch slot, just realized for this
 *     host — so the merge treats the two forms as interchangeable:
 *     canonicalize(launcher) === baseline, and a cascade preserves whichever
 *     form the host chose instead of reverting the fast path. PURE: no imports,
 *     no I/O, no side effects — safe to bundle into the dep-0 fetcher and to
 *     import from a plain setup script.
 */

// The four hook events the fleet dispatcher fans out — the entries the cascaded
// settings.json points at the compile-cache index.cjs. The ONLY commands the
// wiring rewrites; standalone single-hook entries (skill-usage-logger, …) are
// left untouched.
export const DISPATCH_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'SessionStart',
  'Stop',
] as const

export const INDEX_REL = '.claude/hooks/fleet/_dispatch/index.cjs'
export const LAUNCHER_REL = '.claude/hooks/fleet/_dispatch/dispatch-launcher'

/**
 * The compile-cache baseline command for an event (the cascaded canonical).
 */
export function baselineCommand(event: string): string {
  return `node "$CLAUDE_PROJECT_DIR"/${INDEX_REL} ${event}`
}

/**
 * The launcher fast-path command for an event (POSIX execv, host-built).
 */
export function launcherCommand(event: string): string {
  return `"$CLAUDE_PROJECT_DIR"/${LAUNCHER_REL} ${event}`
}

/**
 * A dispatch command for `event` in either form (baseline or launcher). Used to
 * recognize an existing dispatch entry regardless of which path it's wired to,
 * so a rewrite is idempotent and replaces (never duplicates) the entry.
 */
export function isDispatchCommand(command: string, event: string): boolean {
  return (
    command === baselineCommand(event) ||
    command === launcherCommand(event) ||
    // Pre-cutover form: the live per-event dispatcher the launcher supersedes.
    command ===
      `node "$CLAUDE_PROJECT_DIR"/.claude/hooks/fleet/_shared/dispatch.mts ${event}`
  )
}

/**
 * Is `command` the launcher (fast-path) form for `event`? The signal a host has
 * opted this dispatch slot into the per-machine snapshot launcher.
 */
export function isLauncherCommand(command: string, event: string): boolean {
  return command === launcherCommand(event)
}

export interface HookEntry {
  type?: string | undefined
  command?: string | undefined
  [key: string]: unknown
}
export interface MatcherEntry {
  matcher?: string | undefined
  hooks?: HookEntry[] | undefined
  [key: string]: unknown
}
export interface DispatchSettings {
  hooks?: Record<string, MatcherEntry[] | undefined> | undefined
  [key: string]: unknown
}

/**
 * Rewrite every recognized dispatch command in `settings` to the form
 * `make(event)` produces. Returns the number of commands changed. Mutates in
 * place; the caller decides whether to persist. Passing `baselineCommand` as
 * `make` CANONICALIZES (both forms collapse to the baseline) — the shape the
 * fleet-drift comparison needs so a launcher-wired host doesn't read as drift.
 */
export function rewriteDispatchCommands(
  settings: DispatchSettings,
  make: (event: string) => string,
): number {
  let changed = 0
  const hooks = settings.hooks ?? {}
  for (let i = 0, { length } = DISPATCH_EVENTS; i < length; i += 1) {
    const event = DISPATCH_EVENTS[i]!
    const matchers = hooks[event] ?? []
    for (let m = 0, ml = matchers.length; m < ml; m += 1) {
      const entries = matchers[m]!.hooks ?? []
      for (let j = 0, hl = entries.length; j < hl; j += 1) {
        const entry = entries[j]!
        if (
          entry.type === 'command' &&
          entry.command &&
          isDispatchCommand(entry.command, event)
        ) {
          const next = make(event)
          if (entry.command !== next) {
            entry.command = next
            changed += 1
          }
        }
      }
    }
  }
  return changed
}

/**
 * The set of dispatch events `settings` has wired to the LAUNCHER (fast-path)
 * form. Used to carry a host's launcher choice across a cascade merge that
 * would otherwise reset the fleet section to the baseline.
 */
export function launcherWiredEvents(settings: DispatchSettings): Set<string> {
  const wired = new Set<string>()
  const hooks = settings.hooks ?? {}
  for (let i = 0, { length } = DISPATCH_EVENTS; i < length; i += 1) {
    const event = DISPATCH_EVENTS[i]!
    const matchers = hooks[event] ?? []
    for (let m = 0, ml = matchers.length; m < ml; m += 1) {
      const entries = matchers[m]!.hooks ?? []
      for (let j = 0, hl = entries.length; j < hl; j += 1) {
        const entry = entries[j]!
        if (entry.command && isLauncherCommand(entry.command, event)) {
          wired.add(event)
        }
      }
    }
  }
  return wired
}
