#!/usr/bin/env node
/**
 * @file `check --all` gate: every playwright launch in the tree goes through the
 *   sanctioned session module, with no automation flags and no bare
 *   `chromium.launch`. Local and offline — a text scan, lint-style.
 *   Why this is a gate and not a convention: on 2026-07-29 an npm sign-in
 *   looped forever inside a driver that had invented its own Chrome profile,
 *   and the debugging thrash then added a `chromiumSandbox` toggle and a
 *   Cloudflare retry ladder — each change moving further from
 *   `scripts/fleet/publish-infra/npm/browser-session.mts`, the shape that
 *   demonstrably works (ported from socket-registry's proven configurator).
 *   The rules:
 *
 *   - **No sandbox or automation flags.** An `args:` array carrying
 *     `--no-sandbox` (or `--disable-*` automation flags) and any
 *     `chromiumSandbox:` setting are both refused. Playwright's own default
 *     already passes `--no-sandbox`; restating or inverting it only diverges
 *     from the proven shape, and the flag banner it produces is cosmetic.
 *   - **Persistent context only.** A bare `chromium.launch(` gets a fresh
 *     throwaway profile, so an operator's npm session cannot persist. Use
 *     `launchPersistentContext` on the durable profile.
 *   - **One bootstrap.** `launchPersistentContext` is reached ONLY through
 *     `browser-session.mts`, so the sign-in contract, the single-instance
 *     guard, and the challenge PAUSE cannot be re-derived per tool. Strict from
 *     day one: the tree conforms as of the refactor that added this. The pure
 *     scanner (`scanPlaywrightUsage`) takes file text and returns violations,
 *     so it is unit-tested from fixtures with no filesystem. Usage: node
 *     scripts/fleet/check/playwright-launches-are-sanctioned.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { globSync } from '@socketsecurity/lib-stable/globs/match'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isMainModule } from '../_shared/is-main-module.mts'
import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

/**
 * The ONE module allowed to call `launchPersistentContext` for the fleet's npm
 * tooling. Every other tool imports its session from here.
 */
export const SANCTIONED_SESSION_MODULE =
  'scripts/fleet/publish-infra/npm/browser-session.mts'

/**
 * Files allowed to call a playwright launch directly, each with the reason it
 * is out of the npm session module's scope. Dated so a stale entry is
 * visible; entries are repo-relative paths, matched after normalization.
 *
 * - The screenshot skill is a HEADLESS renderer with no session, no sign-in, and
 *   no durable profile: a different contract entirely.
 * - The GHCR visibility driver drives github.com, not npmjs.com, and has its own
 *   sign-in poll. Allowlisted 2026-07-29 pending its own migration onto a
 *   shared session module.
 */
export const LAUNCH_ALLOWLIST: readonly string[] = [
  SANCTIONED_SESSION_MODULE,
  '.claude/skills/fleet/rendering-chromium-to-png/screenshot.mts',
  'scripts/repo/ghcr-package-visibility/browser.mts',
]

/**
 * The globs scanned. Both mirror trees are covered, so a template payload
 * cannot ship an unsanctioned launch into every fleet repo.
 */
export const SCAN_GLOBS: readonly string[] = [
  'scripts/**/*.mts',
  'template/base/scripts/**/*.mts',
  '.claude/skills/**/*.mts',
  'template/base/.claude/skills/**/*.mts',
]

/**
 * One rule violation: the file, the rule, and the offending text.
 */
export interface PlaywrightViolation {
  detail: string
  relPath: string
  rule: 'bare-launch' | 'sandbox-flag' | 'unsanctioned-persistent-context'
}

/**
 * The allowlist entry covering `relPath`, or undefined when none does. The
 * template mirror of an allowlisted path is covered by the same entry — the
 * two copies are byte-identical by construction, so listing both would be a
 * second place to forget. Pure — exported for tests.
 */
export function allowlistEntryFor(
  relPath: string,
  allowlist: readonly string[] = LAUNCH_ALLOWLIST,
): string | undefined {
  const normalized = normalizePath(relPath)
  const withoutMirror = normalized.startsWith('template/base/')
    ? normalized.slice('template/base/'.length)
    : normalized
  for (let i = 0, { length } = allowlist; i < length; i += 1) {
    const entry = normalizePath(allowlist[i]!)
    if (normalized === entry || withoutMirror === entry) {
      return entry
    }
  }
  return undefined
}

/**
 * `text` with its line and block comments blanked out. The rules below match
 * CALLS, and a docblock that quotes the sanctioned launch shape — as
 * `browser-session.mts` and this file both do — is documentation, not a
 * launch. Scanning raw text flagged exactly that, so comments are stripped
 * first. String contents are preserved, so an explicitly passed `--no-sandbox`
 * literal is still caught. Pure — exported for tests.
 */
export function stripComments(text: string): string {
  let out = ''
  let i = 0
  const { length } = text
  while (i < length) {
    const two = text.slice(i, i + 2)
    if (two === '//') {
      const nl = text.indexOf('\n', i)
      i = nl === -1 ? length : nl
      continue
    }
    if (two === '/*') {
      const close = text.indexOf('*/', i + 2)
      i = close === -1 ? length : close + 2
      continue
    }
    const ch = text[i]!
    if (ch === "'" || ch === '"' || ch === '`') {
      // Copy the whole string literal verbatim, honoring escapes, so a flag
      // passed as a literal is still visible to the rules.
      out += ch
      i += 1
      while (i < length) {
        const c = text[i]!
        out += c
        i += 1
        if (c === '\\') {
          if (i < length) {
            out += text[i]!
            i += 1
          }
          continue
        }
        if (c === ch) {
          break
        }
      }
      continue
    }
    out += ch
    i += 1
  }
  return out
}

/**
 * Whether `text` imports playwright at all. Files that never touch playwright
 * are out of scope, which keeps the scan cheap and the failures relevant.
 * Pure — exported for tests.
 */
export function importsPlaywright(text: string): boolean {
  return /from\s+['"]playwright(?:-core)?['"]/.test(text)
}

/**
 * Every sanctioned-launch violation in one file's text. The rules are
 * text-level on purpose: a launch option is a literal in practice, and a
 * text scan needs no typechecker and cannot be defeated by an import alias
 * the way a symbol lookup can. Pure — exported for tests.
 */
export function scanPlaywrightUsage(config: {
  allowlist?: readonly string[] | undefined
  relPath: string
  text: string
}): PlaywrightViolation[] {
  const cfg = { __proto__: null, ...config } as typeof config
  const { relPath } = cfg
  if (!importsPlaywright(cfg.text)) {
    return []
  }
  // Rules match CALLS, so prose that quotes a launch shape never counts.
  const text = stripComments(cfg.text)
  const allowed = allowlistEntryFor(relPath, cfg.allowlist ?? LAUNCH_ALLOWLIST)
  const violations: PlaywrightViolation[] = []
  // Sandbox and automation flags are refused EVERYWHERE, allowlist included:
  // the allowlist covers where a launch may live, never what flags it may
  // pass.
  if (/\bchromiumSandbox\s*:/.test(text)) {
    violations.push({
      detail:
        'sets `chromiumSandbox` — playwright already defaults the sandbox off, ' +
        'and forcing it diverges from the proven launch shape',
      relPath,
      rule: 'sandbox-flag',
    })
  }
  // A quoted launch flag: an opening quote, `--`, then one of the sandbox /
  // automation flag names, then the closing quote.
  const sandboxArg =
    /['"]--(?:disable-(?:blink-features|dev-shm-usage|setuid-sandbox)|no-sandbox)['"]/.exec(
      text,
    )
  if (sandboxArg) {
    violations.push({
      detail: `passes the launch flag ${sandboxArg[0]} explicitly`,
      relPath,
      rule: 'sandbox-flag',
    })
  }
  if (/\bchromium\s*\.\s*launch\s*\(/.test(text) && !allowed) {
    violations.push({
      detail:
        'calls bare `chromium.launch(` — a throwaway profile, so no operator ' +
        'session can persist. Use launchPersistentContext on the durable profile',
      relPath,
      rule: 'bare-launch',
    })
  }
  if (/\blaunchPersistentContext\s*\(/.test(text) && !allowed) {
    violations.push({
      detail: `calls launchPersistentContext outside ${SANCTIONED_SESSION_MODULE}`,
      relPath,
      rule: 'unsanctioned-persistent-context',
    })
  }
  return violations
}

const RULE_FIX: Record<PlaywrightViolation['rule'], string> = {
  'bare-launch':
    'Replace with the shared session: `import { openNpmBrowserSession } from ' +
    "'…/publish-infra/npm/browser-session.mts'`.",
  'sandbox-flag':
    'Delete the flag / option. The sanctioned shape is ' +
    '`launchPersistentContext(profileDir, { channel, headless: false })` and ' +
    'nothing else.',
  'unsanctioned-persistent-context':
    `Import the session from ${SANCTIONED_SESSION_MODULE} instead of ` +
    'launching here, or add a dated allowlist entry with the reason this ' +
    'tool needs its own launch.',
}

/**
 * Render violations as What / Where / Saw vs wanted / Fix blocks. Pure —
 * exported for tests.
 */
export function formatViolations(
  violations: readonly PlaywrightViolation[],
): string {
  const blocks: string[] = []
  for (let i = 0, { length } = violations; i < length; i += 1) {
    const v = violations[i]!
    blocks.push(
      [
        `What: an unsanctioned playwright launch (${v.rule}).`,
        `Where: ${v.relPath}`,
        `Saw: ${v.detail}.`,
        `Wanted: every launch to go through ${SANCTIONED_SESSION_MODULE}.`,
        `Fix: ${RULE_FIX[v.rule]}`,
      ].join('\n'),
    )
  }
  return blocks.join('\n\n')
}

/**
 * Scan the repo and return every violation found.
 */
export function collectViolations(root: string = REPO_ROOT): {
  scanned: number
  violations: PlaywrightViolation[]
} {
  const files = globSync(SCAN_GLOBS, {
    absolute: true,
    cwd: root,
    ignore: ['**/node_modules/**'],
  })
  const violations: PlaywrightViolation[] = []
  let scanned = 0
  for (let i = 0, { length } = files; i < length; i += 1) {
    const absPath = files[i]!
    let text: string
    try {
      text = readFileSync(absPath, 'utf8')
    } catch {
      continue
    }
    if (!importsPlaywright(text)) {
      continue
    }
    scanned += 1
    const relPath = normalizePath(path.relative(root, absPath))
    violations.push(...scanPlaywrightUsage({ relPath, text }))
  }
  return { scanned, violations }
}

export function main(): void {
  const quiet = process.argv.slice(2).includes('--quiet')
  const { scanned, violations } = collectViolations()
  if (violations.length) {
    logger.fail(formatViolations(violations))
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `Playwright launches are sanctioned — ${scanned} playwright-importing file(s) checked.`,
    )
  }
}

// Entrypoint-guarded so importing this module for a unit test of its pure
// scanner does not run the scan.
if (isMainModule(import.meta.url)) {
  main()
}
