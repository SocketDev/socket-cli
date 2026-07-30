#!/usr/bin/env node
// Claude Code PreToolUse hook — playwright-launch-guard.
//
// Blocks a hand-rolled Playwright browser launch at the moment it enters a
// file. Incident (2026-07-29): an agent hand-rolled an npm browser bootstrap
// — a bare chromium.launch call, sandbox-disabling args, retry loops through
// the Cloudflare challenge — and burned the operator through repeated
// post-OTP sign-in loops while the proven session module sat in
// socket-registry. The contract lives in ONE sanctioned module:
// scripts/fleet/publish-infra/npm/browser-session.mts — persistent context
// only, no sandbox flags, no scripted login, pause-not-retry on Cloudflare.
//
// DENIES an Edit/Write/MultiEdit landing content in a .mts/.ts/.mjs file
// under scripts/** or .claude/skills/** when the written text carries:
//
//   1. A quoted '--no-sandbox' launch arg, or the chromiumSandbox option —
//      sandbox-disabling is never sanctioned.
//   2. A bare chromium.launch call — launchPersistentContext through the
//      sanctioned module is the only sanctioned form.
//   3. A launchPersistentContext call in any file that is NOT the sanctioned
//      module itself. Allowlisted verbatim: a path ending
//      publish-infra/npm/browser-session.mts; the rendering-chromium-to-png
//      screenshot skill files; and a path ending
//      ghcr-package-visibility/browser.mts (2026-07-29: pre-existing driver,
//      migrates to the session module later).
//
// Fix: import openNpmBrowserSession from
// scripts/fleet/publish-infra/npm/browser-session.mts and drive the returned
// session instead of launching a browser by hand.
//
// Clean writes pass silently. Detection is over the about-to-land text
// (Write content / Edit new_string / each MultiEdit new_string), so the
// violation is caught before it ever reaches disk.
//
// Bypass: `Allow playwright-launch bypass` (auto-wired via defineHook
// metadata, so the phrase shown is provably the phrase detected).

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// Fast pre-dispatch substrings — the dispatcher skips this hook unless one
// appears in the raw payload.
export const triggers: readonly string[] = [
  '--no-sandbox',
  'chromium',
  'launchPersistentContext',
]

// File shapes in scope: TypeScript/ESM sources under scripts/** or
// .claude/skills/** (the fleet's automation surfaces — where a hand-rolled
// launch would land).
// require-regex-comment: `\.(?:mjs|mts|ts)$` — the guarded source extensions.
const GUARDED_EXT_RE = /\.(?:mjs|mts|ts)$/

// Violation detectors, all over the WRITTEN TEXT (never a shell command, so
// these are safe from no-hook-cmd-regex):
// require-regex-comment: a quote (' " `) immediately around --no-sandbox —
// the string-literal-in-args-context shape; a bare prose mention in a
// comment stays out of scope.
const NO_SANDBOX_LITERAL_RE = /['"`]--no-sandbox['"`]/
// require-regex-comment: the chromiumSandbox launch option as a whole word.
const CHROMIUM_SANDBOX_RE = /\bchromiumSandbox\b/
// require-regex-comment: `chromium.launch` followed by an open paren —
// `chromium.launchPersistentContext(` does NOT match (the next char is `P`).
const BARE_LAUNCH_RE = /\bchromium\.launch\s*\(/
// require-regex-comment: any launchPersistentContext call — sanctioned only
// inside the allowlisted session-owning files.
const PERSISTENT_CONTEXT_RE = /\blaunchPersistentContext\s*\(/

const FIX_LINES = [
  'Fix: import openNpmBrowserSession from',
  '     scripts/fleet/publish-infra/npm/browser-session.mts and drive the',
  '     returned session — persistent context only, no sandbox flags, no',
  '     scripted login, pause-not-retry on a Cloudflare challenge.',
]

/**
 * One detected launch violation: what was matched, and why it is banned.
 */
export interface LaunchViolation {
  readonly detail: string
  readonly violation: string
}

/**
 * True when `filePath` is a guarded source file: .mts/.ts/.mjs under a
 * scripts/ tree or under .claude/skills/. Pure over the normalized path.
 */
export function isGuardedPath(filePath: string): boolean {
  const p = normalizePath(filePath)
  if (!GUARDED_EXT_RE.test(p)) {
    return false
  }
  return (
    p.includes('/scripts/') ||
    p.startsWith('scripts/') ||
    p.includes('/.claude/skills/') ||
    p.startsWith('.claude/skills/')
  )
}

/**
 * True when `filePath` is sanctioned to call launchPersistentContext itself:
 * the browser-session module, the rendering-chromium-to-png screenshot skill
 * files, or the grandfathered ghcr-package-visibility driver (2026-07-29:
 * pre-existing, migrates to the session module later). Pure.
 */
export function isSanctionedSessionOwner(filePath: string): boolean {
  const p = normalizePath(filePath)
  return (
    p.endsWith('publish-infra/npm/browser-session.mts') ||
    p.includes('/rendering-chromium-to-png/') ||
    p.endsWith('ghcr-package-visibility/browser.mts')
  )
}

/**
 * The launch violations in `content` were it written to `filePath`. Pure —
 * the injected content is the about-to-land text, never a disk read. An
 * out-of-scope path yields no violations regardless of content.
 */
export function detectLaunchViolations(
  filePath: string,
  content: string,
): LaunchViolation[] {
  if (!isGuardedPath(filePath)) {
    return []
  }
  const violations: LaunchViolation[] = []
  if (NO_SANDBOX_LITERAL_RE.test(content)) {
    violations.push({
      __proto__: null,
      detail:
        'sandbox-disabling launch args are never sanctioned; the session ' +
        'module launches with the sandbox intact.',
      violation: "a quoted '--no-sandbox' launch arg",
    } as LaunchViolation)
  }
  if (CHROMIUM_SANDBOX_RE.test(content)) {
    violations.push({
      __proto__: null,
      detail:
        'the chromiumSandbox option is the same sandbox-disabling knob by ' +
        'another name.',
      violation: 'the chromiumSandbox launch option',
    } as LaunchViolation)
  }
  if (BARE_LAUNCH_RE.test(content)) {
    violations.push({
      __proto__: null,
      detail:
        'a bare chromium.launch throws away the persistent profile that ' +
        'keeps the operator signed in; launchPersistentContext via the ' +
        'session module is the only sanctioned form.',
      violation: 'a bare chromium.launch( call',
    } as LaunchViolation)
  }
  if (
    PERSISTENT_CONTEXT_RE.test(content) &&
    !isSanctionedSessionOwner(filePath)
  ) {
    violations.push({
      __proto__: null,
      detail:
        'only the sanctioned session module (and the grandfathered ' +
        'rendering-chromium-to-png skill + ghcr-package-visibility driver) ' +
        'may own a launchPersistentContext call.',
      violation: 'a launchPersistentContext( call outside the session module',
    } as LaunchViolation)
  }
  return violations
}

/**
 * The about-to-land text fragments of an Edit/Write/MultiEdit payload. Write
 * → content; Edit → new_string; MultiEdit → every edits[].new_string. Only
 * the WRITTEN fragments are scanned — a violation already on disk is not
 * re-litigated by an unrelated edit to the same file.
 */
function writtenFragments(payload: {
  tool_input?: Record<string, unknown> | undefined
}): string[] {
  const input = payload.tool_input
  if (!input || typeof input !== 'object') {
    return []
  }
  const out: string[] = []
  if (typeof input['content'] === 'string') {
    out.push(input['content'])
  }
  if (typeof input['new_string'] === 'string') {
    out.push(input['new_string'])
  }
  const edits = input['edits']
  if (Array.isArray(edits)) {
    for (let i = 0, { length } = edits; i < length; i += 1) {
      const edit = edits[i] as { new_string?: unknown | undefined } | undefined
      if (edit && typeof edit.new_string === 'string') {
        out.push(edit.new_string)
      }
    }
  }
  return out
}

export const check = editGuard((filePath, _content, payload) => {
  const fragments = writtenFragments(payload)
  if (fragments.length === 0) {
    return undefined
  }
  const violations = detectLaunchViolations(filePath, fragments.join('\n'))
  if (violations.length === 0) {
    return undefined
  }
  return block(
    [
      `[playwright-launch-guard] ${payload.tool_name} blocked — hand-rolled`,
      `Playwright browser launch in ${filePath}:`,
      '',
      ...violations.flatMap(v => [`  • ${v.violation}`, `    ${v.detail}`]),
      '',
      ...FIX_LINES,
      '',
      'Incident, 2026-07-29: a hand-rolled npm browser bootstrap looped the',
      'operator through repeated post-OTP sign-ins. The session module is',
      'the proven path.',
    ].join('\n'),
  )
})

export const hook = defineHook({
  bypass: ['playwright-launch'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
