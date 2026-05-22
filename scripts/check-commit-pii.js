'use strict'

// Pre-commit guard: asks Claude (sonnet) to flag any specific customer names
// or customer-identifying personal information in the commit message and the
// staged diff. Blocks the commit when Claude reports a match.
//
// Usage (from .husky/commit-msg):
//   node ./scripts/check-commit-pii.js "$1"
//
// Skip with: DISABLE_PRECOMMIT_PII_CHECK=1 git commit ...

const { execSync, spawnSync } = require('node:child_process')
const fs = require('node:fs')

const MAX_DIFF_CHARS = 200_000
const MAX_BUDGET_USD = '0.10'

function detectClaude() {
  const result = spawnSync('claude', ['--version'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return result.status === 0
}

function readCommitMessage(msgFilePath) {
  if (!msgFilePath || !fs.existsSync(msgFilePath)) {
    return ''
  }
  // Strip git's comment lines (lines starting with #) and trailing whitespace.
  return fs
    .readFileSync(msgFilePath, 'utf8')
    .split(/\r?\n/)
    .filter(line => !line.startsWith('#'))
    .join('\n')
    .trim()
}

function readStagedDiff() {
  try {
    let diff = execSync('git diff --cached --no-color', {
      encoding: 'utf8',
      maxBuffer: 50 * 1024 * 1024,
    })
    if (diff.length > MAX_DIFF_CHARS) {
      diff =
        diff.slice(0, MAX_DIFF_CHARS) +
        '\n\n[...diff truncated for length...]\n'
    }
    return diff
  } catch (e) {
    console.error(`[pii-check] Could not read staged diff: ${e.message}`)
    return ''
  }
}

function buildPrompt(commitMsg, stagedDiff) {
  return `You are a strict reviewer guarding a public-ish git repository against accidentally leaking information about Socket's customers.

Inspect the COMMIT MESSAGE and STAGED DIFF below and decide whether they mention any of:
- A specific customer / client / end-user organization by name (a named business that uses Socket).
- Personal information that identifies a specific customer end-user (real person names, customer emails, customer account IDs, internal customer references).
- Any phrasing that would let an outside reader figure out which customer reported an issue or requested a feature.

DO NOT flag:
- Generic third-party tool, vendor, or platform names (e.g. npm, pnpm, GitHub, Linear, Slack, Sentry, Coana, Grafana, Anthropic, Vercel, AWS).
- Socket's own product names, internal team names, employee names, or the Socket organization itself.
- Names of open-source libraries, dependencies, or maintainers found in package metadata.
- Test fixture data that is obviously synthetic ("foo", "bar", "test-user", "example.com").

Reply with EXACTLY ONE LINE, one of:
- OK
- BLOCK: <one short sentence describing what was found and where>

=== COMMIT MESSAGE ===
${commitMsg || '(empty)'}

=== STAGED DIFF ===
${stagedDiff || '(empty)'}
`
}

function askClaude(prompt) {
  const result = spawnSync(
    'claude',
    [
      '--print',
      '--model',
      'sonnet',
      // Disable every tool so the model can only emit text. No tools => no
      // permission prompts => safe to run unattended from a git hook.
      '--tools',
      '',
      '--disable-slash-commands',
      '--max-budget-usd',
      MAX_BUDGET_USD,
      '--no-session-persistence',
    ],
    {
      input: prompt,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
      maxBuffer: 10 * 1024 * 1024,
    },
  )
  if (result.error) {
    return { ok: false, error: result.error.message }
  }
  if (result.status !== 0) {
    // claude sometimes writes its error to stdout in --print mode, so include
    // both streams in the message for diagnosability.
    const tail = `${result.stderr || ''}${result.stdout || ''}`.trim()
    return {
      ok: false,
      error: `claude exited with status ${result.status}${tail ? `: ${tail}` : ''}`,
    }
  }
  return { ok: true, output: (result.stdout || '').trim() }
}

function main() {
  if (process.env['DISABLE_PRECOMMIT_PII_CHECK']) {
    console.log('[pii-check] Skipping (DISABLE_PRECOMMIT_PII_CHECK is set).')
    return 0
  }
  if (!detectClaude()) {
    console.warn(
      '[pii-check] WARNING: `claude` CLI not found on PATH. Skipping PII check.',
    )
    console.warn(
      '[pii-check] Install Claude Code (https://claude.com/claude-code) to enable this guard.',
    )
    return 0
  }
  const commitMsg = readCommitMessage(process.argv[2])
  const stagedDiff = readStagedDiff()
  if (!commitMsg && !stagedDiff) {
    return 0
  }
  const prompt = buildPrompt(commitMsg, stagedDiff)
  const result = askClaude(prompt)
  if (!result.ok) {
    console.warn(
      `[pii-check] WARNING: Claude check failed to run: ${result.error}`,
    )
    console.warn('[pii-check] Allowing commit; please review manually.')
    return 0
  }
  // Match the first non-empty line so wrapping or stray whitespace does not
  // hide a verdict.
  const firstLine = result.output
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(line => line.length > 0)
  if (firstLine && /^BLOCK\b/i.test(firstLine)) {
    console.error('')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('[pii-check] Commit blocked: customer reference detected.')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error(result.output)
    console.error('')
    console.error(
      'Revise the commit message and/or staged changes to remove the reference.',
    )
    console.error(
      'If this is a false positive, bypass once with: DISABLE_PRECOMMIT_PII_CHECK=1 git commit ...',
    )
    console.error('')
    return 1
  }
  // Treat anything that is not an explicit OK as a malformed response and
  // fail closed. Otherwise a Claude refusal, hallucination, or stray
  // explanatory text would silently let a problematic commit through.
  if (!firstLine || !/^OK\b/i.test(firstLine)) {
    console.error('')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error('[pii-check] Commit blocked: unrecognized Claude response.')
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━')
    console.error(result.output || '(empty response)')
    console.error('')
    console.error(
      'Expected the first non-empty line to start with "OK" or "BLOCK:".',
    )
    console.error(
      'If this is a transient model error, retry; otherwise bypass with: DISABLE_PRECOMMIT_PII_CHECK=1 git commit ...',
    )
    console.error('')
    return 1
  }
  console.log('[pii-check] No customer references detected.')
  return 0
}

process.exitCode = main()
