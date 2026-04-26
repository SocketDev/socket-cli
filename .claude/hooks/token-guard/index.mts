#!/usr/bin/env node
// Claude Code PreToolUse hook — token-guard firewall.
//
// Blocks Bash commands that would echo token-bearing env vars into
// tool output. This fires BEFORE the command runs; exit code 2 makes
// Claude Code refuse the tool call. The model sees the rejection
// reason on stderr and retries with a redacted formulation.
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
// Control flow uses a `BlockError` thrown from check helpers so every
// short-circuit path goes through a single `process.exitCode = 2`
// drop at the top-level catch — no scattered `process.exit(2)` that
// can race with buffered stderr.

import process from 'node:process'

// Name fragments matched case-insensitively against the command.
const SENSITIVE_ENV_NAMES = [
  'TOKEN',
  'SECRET',
  'PASSWORD',
  'PASS',
  'API_KEY',
  'APIKEY',
  'SIGNING_KEY',
  'PRIVATE_KEY',
  'AUTH',
  'CREDENTIAL',
]

// Pipelines that "launder" earlier-stage secrets into safe output.
const REDACTION_MARKERS = [
  /\bsed\b[^|]*s[/|#][^/|#]*=[^/|#]*<?redact/i,
  /\bsed\b[^|]*s[/|#][^/|#]*[A-Z_]+=[^/|#]*\*+/i,
  /\|\s*cut\b[^|]*-d['"]?=['"]?\s*-f\s*1/i,
  /\|\s*awk\b[^|]*-F\s*['"]?=['"]?/i,
  />\s*\/dev\/null/,
  />>\s*[^|]/,
  />\s*[^|]/,
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
const ENV_FILE_READ = /\b(?:cat|head|tail|less|more|bat)\b[^|]*\.env[^/\s|]*/

// curl calls that include an Authorization header.
const CURL_WITH_AUTH =
  /\bcurl\b(?:[^|]|\|(?!\s*(?:sed|grep|head|tail|jq)))*(?:-H|--header)\s*['"]?Authorization:/i

// Literal token-shape patterns — if any match in the command string,
// a real token has been pasted somewhere it shouldn't have been.
const LITERAL_TOKEN_PATTERNS: Array<[RegExp, string]> = [
  [/\bvtwn_[A-Za-z0-9_-]{8,}/, 'Val Town token (vtwn_)'],
  [/\blin_api_[A-Za-z0-9_-]{8,}/, 'Linear API token (lin_api_)'],
  [/\bsk-[A-Za-z0-9_-]{20,}/, 'OpenAI/Anthropic-style secret key (sk-)'],
  [/\bsk_live_[A-Za-z0-9_-]{16,}/, 'Stripe live secret (sk_live_)'],
  [/\bsk_test_[A-Za-z0-9_-]{16,}/, 'Stripe test secret (sk_test_)'],
  [/\bpk_live_[A-Za-z0-9_-]{16,}/, 'Stripe live publishable (pk_live_)'],
  [/\brk_live_[A-Za-z0-9_-]{16,}/, 'Stripe live restricted (rk_live_)'],
  [/\bghp_[A-Za-z0-9]{30,}/, 'GitHub personal access token (ghp_)'],
  [/\bgho_[A-Za-z0-9]{30,}/, 'GitHub OAuth token (gho_)'],
  [/\bghs_[A-Za-z0-9]{30,}/, 'GitHub app server token (ghs_)'],
  [/\bghu_[A-Za-z0-9]{30,}/, 'GitHub user access token (ghu_)'],
  [/\bghr_[A-Za-z0-9]{30,}/, 'GitHub refresh token (ghr_)'],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/\bglpat-[A-Za-z0-9_-]{16,}/, 'GitLab PAT (glpat-)'],
  [/\bAKIA[0-9A-Z]{16}/, 'AWS access key ID (AKIA)'],
  [/\bxox[baprs]-[A-Za-z0-9-]{10,}/, 'Slack token (xox_-)'],
  [/\bAIza[0-9A-Za-z_-]{35}/, 'Google API key (AIza)'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/, 'JWT'],
]

class BlockError extends Error {
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

const stdin = (): Promise<string> =>
  new Promise(resolve => {
    let buf = ''
    process.stdin.setEncoding('utf8')
    process.stdin.on('data', chunk => (buf += chunk))
    process.stdin.on('end', () => resolve(buf))
  })

type ToolInput = {
  tool_name?: string
  tool_input?: { command?: string }
}

const hasRedaction = (command: string): boolean =>
  REDACTION_MARKERS.some(re => re.test(command))

// Word-boundary match so `PASS` doesn't fire on `PATHS-ALLOWLIST` and
// `AUTH` doesn't fire on `AUTHOR`. Env-var-style boundaries treat `_`
// as a separator (so `ACCESS_TOKEN` matches `TOKEN`) but require a
// non-alphanumeric character on each end (so `PATHS` doesn't match
// `PASS`). The pre-fix substring match created false positives
// whenever a path name happened to contain a sensitive keyword as a
// literal substring.
const sensitiveEnvBoundaryRes = SENSITIVE_ENV_NAMES.map(
  frag => new RegExp(String.raw`(?:^|[^A-Z0-9])${frag}(?:[^A-Z0-9]|$)`),
)
const referencesSensitiveEnv = (command: string): boolean => {
  const upper = command.toUpperCase()
  return sensitiveEnvBoundaryRes.some(re => re.test(upper))
}

const matchesAlwaysDangerous = (command: string): RegExp | null => {
  for (const re of ALWAYS_DANGEROUS) {
    if (re.test(command)) {
      return re
    }
  }
  return null
}

const check = (command: string): void => {
  // 0. Literal token-shape in the command string — hardest block.
  // A real token value already landed in the command, which itself is
  // logged. We refuse to echo it further and urge rotation.
  for (const [pattern, label] of LITERAL_TOKEN_PATTERNS) {
    if (pattern.test(command)) {
      throw new BlockError(
        `literal ${label} found in command string`,
        'Rotate the exposed token immediately. Never paste tokens into commands; read them from .env.local or a keychain at subprocess spawn time.',
        false,
      )
    }
  }

  // 1. Always-dangerous patterns.
  const dangerous = matchesAlwaysDangerous(command)
  if (dangerous) {
    throw new BlockError(
      `\`${dangerous.source}\` dumps env to stdout`,
      'Pipe through redaction, e.g. `env | sed "s/=.*/=<redacted>/"` or filter specific keys.',
    )
  }

  // 2. .env file reads without redaction.
  if (ENV_FILE_READ.test(command) && !hasRedaction(command)) {
    throw new BlockError(
      '.env file read without a redaction pipeline',
      'Use `sed "s/=.*/=<redacted>/" .env.local` or `grep -v "^#" .env.local | cut -d= -f1` for key names only.',
    )
  }

  // 3. curl with Authorization header and unsanitized stdout.
  const curlHasAuth = CURL_WITH_AUTH.test(command)
  const curlOutputSafe =
    />\s*\/dev\/null|>\s*[^|&]/.test(command) ||
    /\|\s*(?:jq|grep|head|tail|wc|cut|awk|python3?\s+-m\s+json\.tool)\b/.test(
      command,
    )
  if (curlHasAuth && !curlOutputSafe) {
    throw new BlockError(
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
    const isPureWrite = /^\s*(?:git|pnpm|npm|node|tsc|oxfmt|oxlint)\b/.test(
      command,
    )
    if (!isPureWrite) {
      throw new BlockError(
        'command references sensitive env var name and writes to stdout without redaction',
        'Redirect to a file, pipe through `sed "s/=.*/=<redacted>/"`, or ensure only key names (not values) are printed.',
      )
    }
  }
}

const emitBlock = (command: string, err: BlockError): void => {
  const safeCommand = err.showCommand
    ? command.slice(0, 200) + (command.length > 200 ? '…' : '')
    : '<command suppressed to avoid re-logging the literal token>'
  process.stderr.write(
    `\n[token-guard] Blocked: ${err.rule}\n` +
      `  Command: ${safeCommand}\n` +
      `  Fix: ${err.suggestion}\n\n`,
  )
}

const main = async (): Promise<void> => {
  const raw = await stdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Bash') {
    return
  }
  const command = payload.tool_input?.command ?? ''
  if (!command) {
    return
  }

  try {
    check(command)
  } catch (e) {
    if (e instanceof BlockError) {
      emitBlock(command, e)
      process.exitCode = 2
      return
    }
    throw e
  }
}

main().catch(e => {
  // Never block a tool call due to a bug in the hook itself. Log it
  // so we notice, but fail open.
  process.stderr.write(`[token-guard] hook error (allowing): ${e}\n`)
  process.exitCode = 0
})
