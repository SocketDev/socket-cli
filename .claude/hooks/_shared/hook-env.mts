/**
 * @fileoverview Hook-runtime helpers: disable-env check + prefixed
 * stderr writer.
 *
 * Two responsibilities every hook needs:
 *
 *   1. `isHookDisabled(slug)` — check the canonical
 *      `SOCKET_<UPPER_SLUG>_DISABLED` env var so every hook gets a
 *      uniform kill switch. The hook's name is the only input; the
 *      env-var name is derived (kebab → upper-snake + `_DISABLED`
 *      suffix). Today 15 of 47 hooks have a manually-named disable
 *      env; this helper makes it free for every hook.
 *
 *   2. `hookLog(slug, ...lines)` — write `[<slug>] <line>` to stderr.
 *      Hooks have long duplicated this prefix shape with
 *      `process.stderr.write(\`[hook-name] ...\`)`; centralizing it
 *      keeps the format consistent and lets us evolve it later
 *      (color, level prefixes, etc.) in one file.
 *
 * No dependency on `@socketsecurity/lib-stable` — hooks load fast at PreTool-
 * Use time and the lib's logger ships a chunk of code (spinners, color
 * detection, header/footer) that's wasted on a single stderr.write.
 * Plain process.stderr is the right tool here.
 */

import process from 'node:process'

/**
 * Convert a hook slug (kebab-case) to its canonical disable env-var
 * name. Pure string transform — exposed for tests + for hooks that
 * want to mention the env-var name in their disable hint.
 *
 *   hookDisableEnvVar('no-revert-guard')        → 'SOCKET_NO_REVERT_GUARD_DISABLED'
 *   hookDisableEnvVar('comment-tone-reminder')  → 'SOCKET_COMMENT_TONE_REMINDER_DISABLED'
 *   hookDisableEnvVar('auth-rotation-reminder') → 'SOCKET_AUTH_ROTATION_REMINDER_DISABLED'
 */
export function hookDisableEnvVar(slug: string): string {
  const upper = slug.toUpperCase().replace(/-/g, '_')
  return `SOCKET_${upper}_DISABLED`
}

/**
 * True when the canonical disable env is set to a truthy value. The
 * fleet treats any non-empty value as "disabled" — `=1`, `=true`,
 * `=yes`, all the same. An explicit `=0` or `=false` is also still
 * non-empty, so technically "disabled"; if a user wants to enable
 * after a session-wide disable, they should `unset` the var.
 */
export function isHookDisabled(slug: string): boolean {
  return Boolean(process.env[hookDisableEnvVar(slug)])
}

/**
 * Write one or more lines to stderr, each prefixed with `[<slug>] `.
 * Trailing newlines are added automatically. Empty-string args are
 * written as bare newlines (useful for visual separation).
 *
 *   hookLog('foo', 'first line', '', 'after blank')
 *   →   [foo] first line\n
 *       \n
 *       [foo] after blank\n
 */
export function hookLog(slug: string, ...lines: readonly string[]): void {
  const prefix = `[${slug}] `
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const ln = lines[i]!
    if (ln === '') {
      process.stderr.write('\n')
    } else {
      process.stderr.write(`${prefix}${ln}\n`)
    }
  }
}
