#!/usr/bin/env node
// Claude Code PreToolUse hook — token-guard firewall.
//
// Blocks Bash commands that would echo token-bearing env vars into
// tool output. This fires BEFORE the command runs; the block verdict
// makes Claude Code refuse the tool call (the runner prints the
// message + sets exitCode 2). The model sees the rejection reason on
// stderr and retries with a redacted formulation.
//
// Blocked patterns:
//   - Literal token shapes in the command string (vtwn_, lin_api_,
//     sk-, ghp_, AKIA, xox, AIza, JWT, etc.) — hardest block, logs
//     a redacted message and urges rotation
//   - `env`, `printenv`, `export -p`, `set` with no filter pipeline
//   - `cat` / `head` / `tail` / `less` / `more` of .env* files
//     without a redaction step
//   - `curl -H "Authorization: ..."` with output going to unfiltered
//     stdout (not /dev/null, not a file, not piped to jq/grep/etc.)
//   - Commands referencing a sensitive env var name (*TOKEN*,
//     *SECRET*, *PASSWORD*, *API_KEY*, *SIGNING_KEY*, *PRIVATE_KEY*,
//     *AUTH*, *CREDENTIAL*) that write to stdout without redaction
//
// `findViolation` returns a `BlockError` describing the first match so
// the single verdict path formats it into a `block()` — one runner-owned
// exit-code drop instead of scattered short-circuit exits that can race
// with buffered stderr.

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import type { GuardResult } from '../_shared/guard.mts'
import {
  SECRET_VALUE_PATTERNS,
  SENSITIVE_NAME_FRAGMENTS,
} from '../_shared/token-patterns.mts'

// Name fragments matched case-insensitively against the command.
// Sourced from the shared catalog in `_shared/token-patterns.mts` so
// every hook that scans for secret-bearing names uses one list.
const SENSITIVE_ENV_NAMES = SENSITIVE_NAME_FRAGMENTS

// Pipelines that "launder" earlier-stage secrets into safe output.
// The first two patterns match `sed 's/.../redact.../'` and
// `sed 's/.../FOO=*****/'` regardless of which delimiter sed uses
// (`/`, `#`, `|`). `[\s\S]*?` reaches across the delimiter between
// the search and replacement parts (the previous `[^/|#]*` couldn't
// cross `/` and so missed the canonical `sed 's/=.*/=<redacted>/'`
// — the very command the token-guard error message suggests).
const REDACTION_MARKERS = [
  /\bsed\b[^|]*s[/|#][\s\S]*?<?redact/i,
  /\bsed\b[^|]*s[/|#][\s\S]*?[A-Z_]+=[\s\S]*?\*{3,}/i,
  /\|\s*cut\b[^|]*-d['"]?=['"]?\s*-f\s*1/i,
  /\|\s*awk\b[^|]*-F\s*['"]?=['"]?/i,
  // Output redirections that send STDOUT away from the tool output (to
  // /dev/null, an appended file, or a plain file). The `(?<!\d)` lookbehind
  // rejects a file-descriptor-prefixed redirect — `2>/dev/null`, `2>&1` —
  // which redirects STDERR and leaves the secret-bearing STDOUT exposed.
  // Without it, `cat .env.local 2>/dev/null`, `echo $TOKEN 2>/dev/null`, and
  // `curl -H Authorization: … 2>/dev/null` were all treated as redacted and
  // slipped past the guard (a digit before `>` means it names a descriptor).
  /(?<!\d)>\s*\/dev\/null/,
  /(?<!\d)>>\s*[^|]/,
  /(?<!\d)>\s*[^|]/,
]

// Commands that dump all env vars to stdout with no filter.
const ALWAYS_DANGEROUS = [
  /^\s*env\s*(?:\||&&|;|$)/,
  /^\s*env\s*$/,
  /^\s*printenv\s*(?:\||&&|;|$)/,
  /^\s*printenv\s*$/,
  /^\s*export\s+-p\s*(?:\||&&|;|$)/,
  /^\s*set\s*(?:\||&&|;|$)/,
]

// Plain reads of .env files that would dump values to stdout.
const ENV_FILE_READ = /\b(?:bat|cat|head|less|more|tail)\b[^|]*\.env[^/\s|]*/

// curl calls that include an Authorization header.
const CURL_WITH_AUTH =
  /\bcurl\b(?:[^|]|\|(?!\s*(?:grep|head|jq|sed|tail)))*(?:--header|-H)\s*['"]?Authorization:/i

// Literal token-shape patterns live in the shared SECRET_VALUE_PATTERNS
// catalog (_shared/token-patterns.mts) — the SAME list the edit-time
// secret-content-guard and the commit-time scanners read, so a new vendor
// shape is added once and every gate picks it up (code is law, DRY).

export class BlockError extends Error {
  public readonly rule: string
  public readonly suggestion: string
  public readonly showCommand: boolean
  constructor(rule: string, suggestion: string, showCommand = true) {
    super(rule)
    this.name = 'BlockError'
    this.rule = rule
    this.suggestion = suggestion
    this.showCommand = showCommand
  }
}

export function hasRedaction(command: string) {
  return REDACTION_MARKERS.some(re => re.test(command))
}

// Env-var-context match: only fire when a sensitive keyword appears
// in a position that ACTUALLY references an env var. Possible contexts:
//   - `$TOKEN` / `${TOKEN}` / `${TOKEN:-default}`
//   - `TOKEN=value` / `export TOKEN=value`
//   - `env TOKEN` / `printenv TOKEN` / `unset TOKEN`
//   - `ENV['TOKEN']` / `ENV["TOKEN"]` / `ENV.fetch('TOKEN')` (Ruby)
//
// The previous version matched the fragment as a SUBSTRING of the
// env-var name (`[A-Z0-9_]*FRAG[A-Z0-9_]*`). That tripped `$AUTHOR_NAME`
// on `AUTH` (because AUTH is a prefix of AUTHOR) and `$PASSAGE_TIME`
// on `PASS`.
//
// Env-var names are conventionally underscore-segmented tokens
// (`ACCESS_TOKEN`, `API_KEY`). For a fragment to be sensitive it
// must occupy one or more WHOLE underscore-delimited tokens — not a
// substring of a single token. Boundary chars inside the name are
// therefore `^`, `$`, or `_`; letters/digits adjacent to the fragment
// mean it's part of a larger word (`AUTH` inside `AUTHOR`) so it
// doesn't count.
//
// Plain-prose occurrences ("tests pass") still don't trigger because
// the env-var sigils (`$`, `${`, `=`, `env`/`printenv`/etc., `ENV[`)
// gate every match.
const NAME_BODY = String.raw`(?:[A-Z0-9_]*_)?` // optional leading tokens
const NAME_TAIL = String.raw`(?:_[A-Z0-9_]*)?` // optional trailing tokens
const sensitiveEnvBoundaryRes = SENSITIVE_ENV_NAMES.map(frag => {
  const NAME = `${NAME_BODY}${frag}${NAME_TAIL}`
  return new RegExp(
    String.raw`(?:` +
      // $NAME  or  ${NAME}  or  ${NAME:-...}  or  ${NAME:=...} etc.
      String.raw`\$\{?${NAME}(?:[:}\W]|$)` +
      // NAME=  (assignment; whitespace allowed before =).
      String.raw`|(?:^|\s|;|&|\|)${NAME}\s*=` +
      // env NAME  /  printenv NAME  /  unset NAME  /  export NAME
      String.raw`|\b(?:env|printenv|unset|export)\s+${NAME}\b` +
      // Ruby ENV[...]  /  ENV.fetch(...)  with the name in single or
      // double quotes: ENV['ACCESS_TOKEN'], ENV["TOKEN"], etc.
      String.raw`|\bENV(?:\.FETCH)?\s*[\[(]\s*['"]${NAME}['"]` +
      String.raw`)`,
  )
})
export function referencesSensitiveEnv(command: string) {
  const upper = command.toUpperCase()
  return sensitiveEnvBoundaryRes.some(re => re.test(upper))
}

export function matchesAlwaysDangerous(command: string) {
  for (let i = 0, { length } = ALWAYS_DANGEROUS; i < length; i += 1) {
    const re = ALWAYS_DANGEROUS[i]!
    if (re.test(command)) {
      return re
    }
  }
  return undefined
}

/**
 * Scan a Bash command for the first token-leak violation. Returns a
 * `BlockError` describing the matched rule + suggested fix, or `undefined`
 * when the command is clean.
 */
export function findViolation(command: string): BlockError | undefined {
  // 0. Literal token-shape in the command string — hardest block.
  // A real token value already landed in the command, which itself is
  // logged. We refuse to echo it further and urge rotation.
  for (const { label, re } of SECRET_VALUE_PATTERNS) {
    if (re.test(command)) {
      return new BlockError(
        `literal ${label} found in command string`,
        'Rotate the exposed token immediately. Never paste tokens into commands; read them from .env.local or a keychain at subprocess spawn time.',
        false,
      )
    }
  }

  // 1. Always-dangerous patterns. Skip when the command already has a
  // redaction pipeline — the suggested fix here is `env | sed ...`,
  // which would itself match ALWAYS_DANGEROUS without this guard.
  const dangerous = matchesAlwaysDangerous(command)
  if (dangerous && !hasRedaction(command)) {
    return new BlockError(
      `\`${dangerous.source}\` dumps env to stdout`,
      'Pipe through redaction, e.g. `env | sed "s/=.*/=<redacted>/"` or filter specific keys.',
    )
  }

  // 2. .env file reads without redaction.
  if (ENV_FILE_READ.test(command) && !hasRedaction(command)) {
    return new BlockError(
      '.env file read without a redaction pipeline',
      'Use `sed "s/=.*/=<redacted>/" .env.local` or `grep -v "^#" .env.local | cut -d= -f1` for key names only.',
    )
  }

  // 3. curl with Authorization header and unsanitized stdout.
  const curlHasAuth = CURL_WITH_AUTH.test(command)
  const curlOutputSafe =
    // `(?<!\d)` so a stderr-only redirect (`2>/dev/null`) is NOT treated as a
    // safe sink — the response body still streams to STDOUT. See REDACTION_MARKERS.
    /(?<!\d)>\s*\/dev\/null|(?<!\d)>\s*[^|&]/.test(command) ||
    /\|\s*(?:jq|grep|head|tail|wc|cut|awk|python3?\s+-m\s+json\.tool)\b/.test(
      command,
    )
  if (curlHasAuth && !curlOutputSafe) {
    return new BlockError(
      'curl with Authorization header and unsanitized stdout',
      'Redirect response to /dev/null, pipe to jq/grep/head, or save to a file.',
    )
  }

  // 4. References a sensitive env var name and writes to stdout
  // without a redaction step. Skip when curl-with-auth passed — that
  // rule already evaluated the same pipeline.
  if (
    !curlHasAuth &&
    referencesSensitiveEnv(command) &&
    !hasRedaction(command)
  ) {
    const isPureWrite = /^\s*(?:git|node|npm|oxfmt|oxlint|pnpm|tsc)\b/.test(
      command,
    )
    if (!isPureWrite) {
      return new BlockError(
        'command references sensitive env var name and writes to stdout without redaction',
        'Redirect to a file, pipe through `sed "s/=.*/=<redacted>/"`, or ensure only key names (not values) are printed.',
      )
    }
  }
  return undefined
}

/**
 * Format the block message for a violation. When the matched rule found a
 * literal token, the command is suppressed so the secret value isn't
 * re-logged.
 */
export function blockMessage(command: string, err: BlockError): string {
  const safeCommand = err.showCommand
    ? command.slice(0, 200) + (command.length > 200 ? '…' : '')
    : '<command suppressed to avoid re-logging the literal token>'
  return (
    `\n[token-guard] Blocked: ${err.rule}\n` +
    `  Command: ${safeCommand}\n` +
    `  Fix: ${err.suggestion}\n`
  )
}

export const check = bashGuard((command: string): GuardResult => {
  const err = findViolation(command)
  if (err) {
    return block(blockMessage(command, err))
  }
  return undefined
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})
void runHook(hook, import.meta.url)
