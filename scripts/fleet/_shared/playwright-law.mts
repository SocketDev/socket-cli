/*
 * @file The Playwright browser law, as code. Every browser the fleet opens
 *   follows ONE launch shape and ONE sign-in contract; this module is the
 *   single importable statement of both, so drivers, guards, checks, and
 *   agent prompts cite the same law instead of re-deriving it from prose.
 *   The reference implementation is the sanctioned session module
 *   (`scripts/fleet/publish-infra/npm/browser-session.mts`); the
 *   `playwright-launch-guard` hook and the playwright-launches-are-sanctioned
 *   check enforce the same rules at write time and in CI.
 *   The law, and why each clause exists:
 *
 *   - `chromiumSandbox: true` is MANDATORY. Playwright defaults the Chromium
 *     sandbox OFF and injects a no-sandbox flag that current Chrome brands
 *     unsupported — observed 2026-07-30 destabilizing runs and dropping the
 *     signed-in session. The banner is not cosmetic.
 *   - ONE durable profile, shared by every npm browser tool, so an operator
 *     signed in for one gate is signed in everywhere. A second per-tool profile
 *     means a second sign-in.
 *   - Exactly TWO ignored Playwright defaults: `--enable-automation` (sets the
 *     navigator.webdriver bot signal; with it, a fresh npmjs.com login plus OTP
 *     bounced straight back to signed-out) and `--use-mock-keychain` (writes a
 *     cookie store a bare Chrome launch of the same profile cannot share). No
 *     `args` array, no other options.
 *   - Login is NEVER scripted. The operator signs in once in the headed window;
 *     no password, OTP, or cookie passes through the process.
 *   - npm auth is decided by the `/-/whoami` BODY on the website origin, never
 *     the HTTP status.
 *   - A human-verification challenge PAUSES the run for the operator and is never
 *     retried blindly: a retry ladder against a bot challenge earns a rate
 *     limit that then masquerades as a broken session.
 */

import os from 'node:os'
import path from 'node:path'

/**
 * The ONE durable Chrome profile every npm browser tool shares. Mirrors the
 * sanctioned session module so profiles already signed in keep working.
 */
export const LAWFUL_PROFILE_DIR = path.join(
  os.homedir(),
  '.config',
  'socket-wheelhouse',
  'staged-browser-profile',
)

/**
 * The only sanctioned `ignoreDefaultArgs` value — see the file header for
 * what each entry protects.
 */
export const LAWFUL_IGNORED_DEFAULT_ARGS = Object.freeze([
  '--enable-automation',
  '--use-mock-keychain',
] as const)

/**
 * Browser channel resolution: system Chrome, overridable for a machine
 * without Chrome installed (playwright-core cannot conjure a channel it has
 * no binary for).
 */
export function lawfulBrowserChannel(): string {
  return process.env['SOCKET_BROWSER_CHANNEL'] || 'chrome'
}

/**
 * The complete lawful launch-option shape. `chromiumSandbox` is the literal
 * type `true`: a launch that disables the sandbox is not a variant of the
 * law, it is outside it.
 */
// Named a Shape, not Options: this is what `lawfulLaunchOptions()` RETURNS
// and is never a caller-facing parameter bag. Every member is required
// because the law IS the complete shape — an optional member would describe
// a launch that omits part of it.
export interface LawfulLaunchShape {
  channel: string
  chromiumSandbox: true
  headless: boolean
  ignoreDefaultArgs: readonly string[]
}

/**
 * Build the one lawful launch-options object. Drivers pass this straight to
 * a persistent-context launch on {@link LAWFUL_PROFILE_DIR}; anything a
 * driver wants to add beyond headedness is, by definition, unlawful.
 */
export function lawfulLaunchOptions(
  options?: { headless?: boolean | undefined } | undefined,
): LawfulLaunchShape {
  const { headless = false } = { __proto__: null, ...options } as NonNullable<
    typeof options
  >
  return {
    channel: lawfulBrowserChannel(),
    chromiumSandbox: true,
    headless,
    ignoreDefaultArgs: LAWFUL_IGNORED_DEFAULT_ARGS,
  }
}

const LAWFUL_KEYS = new Set([
  'channel',
  'chromiumSandbox',
  'headless',
  'ignoreDefaultArgs',
])

/**
 * Every way the given options diverge from the law, in plain sentences.
 * Empty means lawful. Pure — exported for tests and for guards that want to
 * report all divergences at once instead of failing on the first.
 */
export function lawViolations(launchOptions: unknown): string[] {
  if (typeof launchOptions !== 'object' || launchOptions === null) {
    return ['launch options must be an object matching LawfulLaunchShape']
  }
  const opts = launchOptions as Record<string, unknown>
  const violations: string[] = []
  if (opts['chromiumSandbox'] !== true) {
    violations.push(
      'chromiumSandbox must be exactly true — Playwright defaults the sandbox off by injecting a no-sandbox flag Chrome refuses',
    )
  }
  if (typeof opts['channel'] !== 'string' || opts['channel'] === '') {
    violations.push(
      'channel must be a non-empty string (lawfulBrowserChannel())',
    )
  }
  if (typeof opts['headless'] !== 'boolean') {
    violations.push('headless must be an explicit boolean')
  }
  const ignored = opts['ignoreDefaultArgs']
  const lawful =
    Array.isArray(ignored) &&
    ignored.length === LAWFUL_IGNORED_DEFAULT_ARGS.length &&
    LAWFUL_IGNORED_DEFAULT_ARGS.every(flag => ignored.includes(flag))
  if (!lawful) {
    violations.push(
      `ignoreDefaultArgs must be exactly [${LAWFUL_IGNORED_DEFAULT_ARGS.join(', ')}]`,
    )
  }
  if ('args' in opts) {
    violations.push(
      'an args array is never lawful — the shape has no free-form flags',
    )
  }
  const keys = Object.keys(opts)
  for (let i = 0, { length } = keys; i < length; i += 1) {
    const key = keys[i]!
    if (!LAWFUL_KEYS.has(key) && key !== 'args') {
      violations.push(
        `unexpected launch option \`${key}\` — the law has exactly ${[...LAWFUL_KEYS].join(', ')}`,
      )
    }
  }
  return violations
}

/**
 * Throw unless the options are exactly the lawful shape, listing every
 * divergence so a driver author fixes them all in one pass.
 */
export function assertLawfulLaunchOptions(launchOptions: unknown): void {
  const violations = lawViolations(launchOptions)
  if (violations.length > 0) {
    throw new Error(
      [
        'Unlawful Playwright launch options:',
        ...violations.map(v => `  - ${v}`),
      ].join('\n'),
    )
  }
}

/**
 * The sign-in contract as data, one rule per entry — quote these instead of
 * paraphrasing them.
 */
export const SIGN_IN_CONTRACT = Object.freeze([
  'Login is NEVER scripted: the operator signs in once in the headed window; no password, OTP, or cookie passes through the process.',
  'All npm browser tools share the ONE durable profile so a single sign-in covers every tool.',
  'npm auth is decided by the /-/whoami BODY on the website origin, never the HTTP status.',
  'A human-verification challenge PAUSES the run for the operator with a visible countdown and is never retried blindly.',
] as const)

/**
 * The law as a verbatim prompt block. Any agent prompt that may open a
 * browser must carry this text unedited — paraphrase is how the law drifted
 * into "the sandbox banner is cosmetic" once already.
 */
export const PLAYWRIGHT_LAW_PROMPT = [
  'Playwright browser law (verbatim, non-negotiable):',
  `- Launch ONLY via openNpmBrowserSession (scripts/fleet/publish-infra/npm/browser-session.mts) on the durable profile ${LAWFUL_PROFILE_DIR}.`,
  '- The launch shape is channel + chromiumSandbox: true + headless + the two sanctioned ignoreDefaultArgs entries, and nothing else — never an args array, never a sandbox-disabling flag.',
  ...SIGN_IN_CONTRACT.map(rule => `- ${rule}`),
].join('\n')
