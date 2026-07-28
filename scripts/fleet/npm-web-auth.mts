#!/usr/bin/env node
/*
 * @file PTY wrapper for npm's browser-based 2FA web-auth flow, for `npm
 *   publish|login|deprecate|owner|access|...` run from a NON-interactive agent
 *   shell. WHY THIS EXISTS. npm's write operations require 2FA. On a real
 *   terminal npm runs a web-auth flow: it prints "Authenticate your account
 *   at:" plus a `https://www.npmjs.com/auth/cli/<id>` URL, opens the browser,
 *   and polls the registry until the human approves. Two things break that flow
 *   under an agent:
 *
 *   1. NO TTY. The agent's Bash channel is not a terminal, so npm decides it
 *      cannot do an interactive/web flow and errors `EOTP` instead of opening
 *      the browser and staying alive to poll.
 *   2. MASKED OUTPUT. The agent harness redacts the auth URL in displayed tool
 *      output as `auth/cli/***`, so the URL can never be relayed by reading
 *      what the terminal shows. THE FIX. Run npm under a pseudo-terminal so it
 *      believes it has a TTY and performs its native open-and-poll web flow,
 *      staying alive until the human authenticates. `script -q /dev/null npm
 *      ...` is the zero-dependency PTY on macOS and BSD; util-linux `script -q
 *      -c '<cmd>' /dev/null` is the Linux form. We stream npm's output straight
 *      through to the caller AND watch the RAW process stream for the auth URL.
 *      Reading the URL off the raw stream sidesteps the harness masking
 *      entirely: the URL flows only into the platform opener as an argument and
 *      is never printed by us. On first match we spawn `open` / `xdg-open` /
 *      `start` on it, then keep the process alive until npm exits and propagate
 *      npm's exit code. NO-OP PASSTHROUGH. When a real TTY is present npm
 *      handles its own flow, and when `--otp=<code>` is already supplied no
 *      browser is needed, so in both cases this wrapper execs npm directly with
 *      inherited stdio and does nothing else. Usage: node
 *      scripts/fleet/npm-web-auth.mts
 *      <publish|login|deprecate|owner|access|...> [args]
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- PTY streaming + detached opener + exact exit-code propagation need raw child_process control; see the per-call rationale on runUnderPty/runInherit/openInBrowser.
import { spawn as nodeSpawn } from 'node:child_process'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from './_shared/is-main-module.mts'
import { runMain } from './_shared/run-main.mts'

const logger = getDefaultLogger()

// The npm subcommands whose write path triggers the 2FA web-auth flow. Used by
// --help text and the sibling npm-2fa-needs-pty-guard; kept here so the one list
// of auth-gated operations lives beside the runner that services them.
export const AUTH_OPERATIONS: readonly string[] = [
  'access',
  'deprecate',
  'login',
  'owner',
  'publish',
  'unpublish',
]

// The two prompt phrases npm prints immediately before the web-auth URL: the
// happy path and the error/authorize path. Detection is anchored on one of
// these so arbitrary npmjs.com URLs elsewhere in the output can never be
// mistaken for the auth URL.
const AUTH_PROMPT_RE =
  /Authenticate your account at:|Open this URL in your browser to authenticate:/i

// A concrete npm web-auth URL: an npmjs.com host with an `/auth/cli/<id>` or a
// `/login` path. The character classes EXCLUDE `*` on purpose — the agent
// harness renders the redacted URL as `auth/cli/***`, so a masked display can
// never satisfy this pattern. We only ever extract from the raw process stream,
// and this makes that guarantee structural rather than incidental.
const NPM_AUTH_URL_RE =
  /https?:\/\/[a-z0-9.-]*npmjs\.com\/(?:auth\/cli\/[a-z0-9._-]+|login[a-z0-9._~:/?#[\]@!$&'()+,;=%-]*)/i

/**
 * Extract the npm web-auth URL from a chunk of npm output. Returns the FIRST
 * `https://www.npmjs.com/auth/cli/<id>` or login URL that appears after one of
 * npm's auth prompts, or `undefined` when no prompt-anchored, unmasked URL is
 * present. ANSI/spinner noise around the phrase and URL is tolerated because
 * the scan is a forward regex from the prompt, not a line-exact parse.
 */
export function extractNpmAuthUrl(text: string): string | undefined {
  const prompt = AUTH_PROMPT_RE.exec(text)
  if (!prompt) {
    return undefined
  }
  const after = text.slice(prompt.index)
  return NPM_AUTH_URL_RE.exec(after)?.[0]
}

/**
 * The platform command that opens a URL in the default browser: `open` on
 * macOS, `start` on Windows, `xdg-open` elsewhere.
 */
export function pickOpenCommand(platform: NodeJS.Platform): string {
  if (platform === 'darwin') {
    return 'open'
  }
  if (platform === 'win32') {
    return 'start'
  }
  return 'xdg-open'
}

/**
 * True when the npm args already carry an `--otp` flag (`--otp <code>` or
 * `--otp=<code>`). With an OTP supplied npm needs no browser, so the wrapper
 * passes straight through to npm.
 */
export function hasOtpFlag(args: readonly string[]): boolean {
  return args.some(a => a === '--otp' || a.startsWith('--otp='))
}

export interface PtyInvocation {
  readonly command: string
  readonly args: readonly string[]
}

/**
 * Build the `script`-based PTY invocation that runs `npm <npmArgs>` under a
 * pseudo-terminal. macOS/BSD `script` takes the command as trailing args after
 * the typescript file; util-linux `script` takes it via `-c`. Returns
 * `undefined` on platforms without `script` (Windows), where the caller falls
 * back to running npm directly.
 */
export function buildPtyInvocation(
  platform: NodeJS.Platform,
  npmArgs: readonly string[],
): PtyInvocation | undefined {
  if (platform === 'win32') {
    return undefined
  }
  if (platform === 'linux') {
    const inner = ['npm', ...npmArgs].map(quoteForShell).join(' ')
    return { command: 'script', args: ['-q', '-c', inner, '/dev/null'] }
  }
  // macOS + the BSDs: `script -q /dev/null npm <args...>`.
  return { command: 'script', args: ['-q', '/dev/null', 'npm', ...npmArgs] }
}

// Minimal single-quote shell escaping for the Linux `script -c` command string.
// Array-based spawn args stay unquoted; only the Linux `-c` path joins into one
// string, so this is the one place a token needs escaping.
function quoteForShell(token: string): string {
  return `'${token.replaceAll("'", `'\\''`)}'`
}

export interface RunConfig {
  readonly argv: readonly string[]
  readonly platform: NodeJS.Platform
  readonly isTty: boolean
  readonly env: NodeJS.ProcessEnv
  // Working directory for the npm child. Programmatic callers (the
  // placeholder reservation script publishes from an assembled temp dir) set
  // it; the CLI leaves it undefined = the caller's cwd.
  readonly cwd?: string | undefined
}

/**
 * True when the wrapper should stay out of the way and exec npm directly: a
 * real TTY is present (npm drives its own flow) or an `--otp` is already
 * supplied (no browser needed).
 */
export function isPassthrough(config: {
  readonly isTty: boolean
  readonly args: readonly string[]
}): boolean {
  return config.isTty || hasOtpFlag(config.args)
}

// Spawn the platform opener on the URL, detached, with all stdio discarded. The
// URL is passed ONLY as an argument (data-flow), never written to our stdout, so
// the harness masking of displayed output is irrelevant.
function openInBrowser(url: string, platform: NodeJS.Platform): void {
  try {
    const opener = pickOpenCommand(platform)
    const child = nodeSpawn(opener, [url], {
      detached: true,
      stdio: 'ignore',
      // `start` is a cmd.exe builtin, not an executable.
      shell: platform === 'win32',
    })
    child.on('error', () => {})
    child.unref()
  } catch {
    // Opening the browser is best-effort — the URL still streams through to the
    // caller, who can open it by hand.
  }
}

// Run `cmd args` inheriting all stdio and resolve with its exit code. The direct
// (non-PTY) path for the TTY / --otp passthrough and for platforms without
// `script`.
// oxlint-disable-next-line socket/prefer-async-spawn -- streaming passthrough: stdio is inherited and the exact child exit code is propagated.
function runInherit(
  cmd: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
  cwd?: string | undefined,
): Promise<number> {
  return new Promise(resolve => {
    const child = nodeSpawn(cmd, [...args], { stdio: 'inherit', env, cwd })
    child.on('error', () => resolve(1))
    child.on('exit', code => resolve(code ?? 1))
  })
}

// Run npm under the PTY: stream npm's output through to the caller while
// watching the raw stream for the auth URL, opening it on first match. Resolves
// with npm's exit code.
// oxlint-disable-next-line socket/prefer-async-spawn -- PTY web-auth requires streaming stdio and a live URL watcher on the raw child stream.
function runUnderPty(pty: PtyInvocation, config: RunConfig): Promise<number> {
  return new Promise(resolve => {
    const child = nodeSpawn(pty.command, [...pty.args], {
      stdio: ['inherit', 'pipe', 'pipe'],
      env: config.env,
      cwd: config.cwd,
    })
    let buffer = ''
    let opened = false
    const watch = (chunk: Buffer) => {
      process.stdout.write(chunk)
      if (opened) {
        return
      }
      buffer += chunk.toString('utf8')
      const url = extractNpmAuthUrl(buffer)
      if (url) {
        opened = true
        openInBrowser(url, config.platform)
      }
    }
    child.stdout?.on('data', watch)
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(chunk))
    child.on('error', () => resolve(1))
    child.on('exit', code => resolve(code ?? 1))
  })
}

/**
 * Run an npm auth operation, choosing the passthrough or PTY path. Pure w.r.t.
 * its `config` argument so a test can drive it with an injected platform / TTY
 * state / env. Resolves with the exit code to propagate.
 */
export async function runNpmWebAuth(config: RunConfig): Promise<number> {
  const args = [...config.argv]
  if (isPassthrough({ isTty: config.isTty, args })) {
    return runInherit('npm', args, config.env, config.cwd)
  }
  const pty = buildPtyInvocation(config.platform, args)
  if (!pty) {
    return runInherit('npm', args, config.env, config.cwd)
  }
  return runUnderPty(pty, config)
}

function usage(): string {
  return [
    'Usage: npm-web-auth <operation> [args...]',
    '',
    'Runs `npm <operation> [args...]` under a PTY so npm performs its native',
    'browser 2FA web-auth flow from a non-interactive agent shell, and',
    'auto-opens the auth URL read from the raw process stream.',
    '',
    `Auth-gated operations: ${AUTH_OPERATIONS.join(', ')}.`,
    '',
    'Passes straight through to npm when a real TTY is present or when',
    '--otp=<code> is already supplied.',
  ].join('\n')
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2)
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    logger.log(usage())
    return argv.length === 0 ? 2 : 0
  }
  return runNpmWebAuth({
    argv,
    platform: process.platform,
    isTty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    env: process.env,
  })
}

if (isMainModule(import.meta.url)) {
  runMain(main)
}
