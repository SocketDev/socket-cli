#!/usr/bin/env node
// Claude Code PreToolUse hook — pull-request-target-guard.
//
// Blocks Edit/Write to `.github/workflows/*.yml` that combines the
// dangerous patterns the GitHub Actions threat model is allergic to:
//
//   `pull_request_target` trigger
//     + `actions/checkout` of the fork's HEAD (the PR head SHA,
//       `pull_request.head.sha`, or `pull_request.head.ref`)
//     + a subsequent `run:` step that EXECUTES the checked-out
//       fork code (`pnpm i`, `npm i`, `yarn`, `bun i`, `pip install`,
//       `cargo build`, `go build`, `make`, build scripts, etc.)
//
// `pull_request_target` runs in the BASE repo's context, with access
// to secrets. By default `actions/checkout` checks out the base —
// safe. When the workflow explicitly checks out the FORK's HEAD AND
// then runs install / build / arbitrary commands on it, the fork's
// authors can exfiltrate the base repo's secrets (e.g. via a `prepare`
// install script).
//
// Reference threat write-up:
//   https://bsky.app/profile/43081j.com/post/3mlnme43qnc2e
//
// What zizmor already covers (we don't duplicate):
//   - `dangerous-triggers`: flags ANY `pull_request_target` use.
//   - `bot-conditions`, `github-env`, `template-injection`,
//     `overprovisioned-secrets`, `artipacked`: collateral patterns.
//
// What zizmor doesn't directly catch and this hook adds:
//   - The exact "fork-checkout + execute-fork-code" combo. Zizmor
//     flags the trigger as dangerous; this hook flags the specific
//     exploitation path so the operator can't miss it at edit time.
//
// Bypass: `Allow pr-target-execution bypass` in a recent user turn.
// Use case: a workflow that genuinely needs to execute fork code in
// the privileged context (rare, reviewer-acknowledged trade-off).
//
// Exit codes:
//   0 — pass (not a workflow file, not the dangerous combo, or all
//       execute steps use --ignore-scripts and similar guards).
//   2 — block.
//
// Fails open on parse errors (exit 0 + stderr log).

import path from 'node:path'
import process from 'node:process'

import { bypassPhrasePresent, readStdin } from '../_shared/transcript.mts'

interface ToolInput {
  readonly tool_input?:
    | {
        readonly content?: string | undefined
        readonly file_path?: string | undefined
        readonly new_string?: string | undefined
      }
    | undefined
  readonly tool_name?: string | undefined
  readonly transcript_path?: string | undefined
}

const BYPASS_PHRASE = 'Allow pr-target-execution bypass'

// Workflow-file shape.
function isWorkflowPath(filePath: string): boolean {
  return /\/\.github\/workflows\/[^/]+\.ya?ml$/.test(filePath)
}

// 1. `on:` block declares `pull_request_target`. Match in three
// shapes:
//   on: pull_request_target
//   on: [pull_request_target, ...]
//   on:
//     pull_request_target:
//       types: [...]
const TRIGGER_RE =
  /^\s*on\s*:[\s\S]*?\bpull_request_target\b/m

// 2. `actions/checkout` with a ref pointing at the fork's HEAD.
// Common shapes in YAML:
//   ref: ${{ github.event.pull_request.head.sha }}
//   ref: ${{ github.event.pull_request.head.ref }}
//   ref: ${{ github.event.pull_request.head.repo.full_name }}
//
// The `head.*` selector is the smoking-gun pattern — base.*
// checkouts are safe, head.* on pull_request_target is the exact
// privileged-fork-checkout shape.
const FORK_CHECKOUT_RE =
  /uses\s*:\s*[^\n]*actions\/checkout[^\n]*[\s\S]{0,500}?\bref\s*:\s*[^\n]*\bgithub\.event\.pull_request\.head\b/

// 3. Subsequent `run:` that executes fork code. The list is the
// common set; not exhaustive (a workflow can `bash <(curl ...)`).
// Intentional false-positive risk on benign uses (e.g. running a
// linter that doesn't execute project scripts) — operators can
// bypass when needed.
//
// Each pattern matches the COMMAND TOKEN as it appears at run-time;
// we deliberately don't try to parse YAML steps. A coarse scan that
// flags too much is preferable to a fine scan that misses a leak.
const EXECUTE_PATTERNS: ReadonlyArray<{
  re: RegExp
  cmd: string
  safeIf?: RegExp
}> = [
  // Node package managers — `prepare`/`postinstall` scripts run by
  // default. --ignore-scripts neutralizes the install-script vector
  // but a build step on the next line can still execute fork code.
  {
    re: /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add)\b/,
    cmd: 'package-manager install',
    safeIf: /--ignore-scripts\b/,
  },
  // Node build steps (no install-script bypass; the build itself
  // runs fork-controlled code).
  {
    re: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?build\b/,
    cmd: 'node build',
  },
  // Generic `npm test` / `pnpm test` etc.
  {
    re: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?test\b/,
    cmd: 'node test',
  },
  // Python.
  {
    re: /\bpip\s+install\b/,
    cmd: 'pip install',
  },
  {
    re: /\b(?:python|python3)\s+setup\.py\b/,
    cmd: 'python setup.py',
  },
  {
    re: /\bpoetry\s+(?:install|build)\b/,
    cmd: 'poetry install/build',
  },
  // Ruby.
  {
    re: /\bbundle\s+install\b/,
    cmd: 'bundle install',
  },
  // Rust.
  {
    re: /\bcargo\s+(?:build|test|run|install)\b/,
    cmd: 'cargo build/test/run/install',
  },
  // Go.
  {
    re: /\bgo\s+(?:build|test|run|install|generate)\b/,
    cmd: 'go build/test/run/install',
  },
  // Make / generic build runners.
  {
    re: /\b(?:make|gmake|ninja|just|task)\s+\w*/,
    cmd: 'make / build runner',
  },
  // `bash <(curl ...)` and `sh -c "$(curl ...)"` install patterns.
  {
    re: /\b(?:bash|sh|zsh)\b[^\n]*\$\(\s*curl\b/,
    cmd: 'shell pipe from curl',
  },
  {
    re: /\b(?:bash|sh|zsh)\b[^\n]*<\(\s*curl\b/,
    cmd: 'shell process-sub from curl',
  },
]

interface Finding {
  readonly line: number
  readonly cmd: string
  readonly snippet: string
}

/**
 * Scan a workflow body and return findings. Returns empty when the
 * dangerous combo isn't present.
 *
 * Three preconditions must hold for ANY finding to fire:
 *   1. on: pull_request_target
 *   2. actions/checkout with a fork-HEAD ref
 *   3. one or more execute-fork-code steps
 *
 * If only (1) and (2) hold, zizmor's `dangerous-triggers` already
 * surfaces it. The execute-fork-code step is what this hook adds.
 */
export function findUnsafeForkExecution(content: string): Finding[] {
  if (!TRIGGER_RE.test(content)) {
    return []
  }
  if (!FORK_CHECKOUT_RE.test(content)) {
    return []
  }
  const findings: Finding[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    // Only inspect `run:` lines (and block-scalar continuations).
    // A coarse signal — when a `run:` step contains the pattern,
    // count it as an execute. Multi-line `run: |` blocks with the
    // pattern on a later line also hit because we're scanning every
    // line.
    const runHit = /^\s*-?\s*run\s*:\s*(.*)/.exec(line)
    const bodyLine = runHit ? runHit[1]! : line
    for (const ep of EXECUTE_PATTERNS) {
      if (!ep.re.test(bodyLine)) {
        continue
      }
      // Safe-if clause (e.g. --ignore-scripts on install).
      if (ep.safeIf?.test(bodyLine)) {
        continue
      }
      findings.push({
        cmd: ep.cmd,
        line: i + 1,
        snippet:
          bodyLine.trim().length > 90
            ? bodyLine.trim().slice(0, 87) + '…'
            : bodyLine.trim(),
      })
      break
    }
  }
  return findings
}

let payloadRaw = ''
process.stdin.setEncoding('utf8')
process.stdin.on('data', chunk => {
  payloadRaw += chunk
})
process.stdin.on('end', () => {
  try {
    let payload: ToolInput
    try {
      payload = JSON.parse(payloadRaw) as ToolInput
    } catch {
      process.exit(0)
    }
    if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
      process.exit(0)
    }
    const filePath = payload.tool_input?.file_path ?? ''
    if (!filePath || !isWorkflowPath(filePath)) {
      process.exit(0)
    }
    const content =
      payload.tool_input?.new_string ?? payload.tool_input?.content ?? ''
    if (!content) {
      process.exit(0)
    }
    const findings = findUnsafeForkExecution(content)
    if (findings.length === 0) {
      process.exit(0)
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      process.exit(0)
    }
    const lines: string[] = []
    lines.push(
      '[pull-request-target-guard] Blocked: fork-execution in pull_request_target workflow.',
    )
    lines.push(`  File: ${path.basename(filePath)}`)
    lines.push('')
    lines.push('  Workflow combines all three high-risk patterns:')
    lines.push('    1. on: pull_request_target  (runs in BASE repo context with secrets)')
    lines.push(
      '    2. actions/checkout with ref: ${{ github.event.pull_request.head.* }}',
    )
    lines.push(
      '       (checks out the FORK code — attacker-controlled)',
    )
    lines.push('    3. Subsequent execute-fork-code step(s):')
    for (const f of findings) {
      lines.push(`         Line ${f.line} (${f.cmd}): ${f.snippet}`)
    }
    lines.push('')
    lines.push('  Why this is dangerous:')
    lines.push(
      '    The fork can declare a `prepare` / `postinstall` script (or a build',
    )
    lines.push(
      '    step) that exfiltrates the base repo\'s secrets. Even `--ignore-scripts`',
    )
    lines.push('    only stops install-time execution — a build still runs fork code.')
    lines.push('')
    lines.push('  Safer patterns:')
    lines.push(
      '    a. Split: run build in `on: pull_request` (no secrets), publish an',
    )
    lines.push(
      '       artifact, then a separate `workflow_run` consumes it and posts the',
    )
    lines.push('       comment with the privileged token.')
    lines.push(
      '    b. Gate the pull_request_target trigger on `labeled` so only maintainers',
    )
    lines.push('       can run it: `on: pull_request_target: types: [labeled]`.')
    lines.push('    c. Never check out the fork in pull_request_target context.')
    lines.push('')
    lines.push(
      '  Reference: https://bsky.app/profile/43081j.com/post/3mlnme43qnc2e',
    )
    lines.push('')
    lines.push(
      `  Bypass (rare; requires a deliberate review trade-off): type "${BYPASS_PHRASE}".`,
    )
    process.stderr.write(lines.join('\n') + '\n')
    process.exit(2)
  } catch (e) {
    process.stderr.write(
      `[pull-request-target-guard] hook error (allowing): ${e}\n`,
    )
    process.exit(0)
  }
})
