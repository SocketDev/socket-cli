#!/usr/bin/env node
// Claude Code PreToolUse hook — no-tail-install-out-guard.
//
// Blocks Bash commands that pipe install/check/fix/test output into
// `tail` or `head`. The pattern's failure mode:
//
//   pnpm i 2>&1 | tail -5
//
// looks like a way to save context, but pnpm always prints its Socket
// Firewall footer last. Critical warnings — [ERR_PNPM_IGNORED_BUILDS],
// peer-dep mismatches, soak-bypass tripwires — print ABOVE the footer.
// A 5-line tail captures the footer and an exit-code line, hiding
// every warning. Local pnpm with a pre-built node_modules/ skips
// approval gates that fresh CI runners trip on. The result is a
// known-broken local-passes-CI-fails pattern.
//
// Past incident: 2026-05-28, v6.0.4 shipped with `[ERR_PNPM_IGNORED_BUILDS]
// esbuild@0.27.7` on the fresh CI runner. The warning was in the local
// pnpm i output but above the `tail -5` window. Red CI on a published
// tag. (See memory feedback_dont_tail_install_output.)
//
// No bypass. The rewrite is always available: replace `tail -N` with
// `grep -iE "warning|error|ignored|fail"` to scan the full output,
// or just drop the truncation. The hook's stderr names both.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     ... }
//
// Exit codes:
//   0 — pass (not Bash, or the command shape isn't the bad one).
//   2 — block (install/check command piped to tail/head).
//
// Fails open on malformed payloads (exit 0 + stderr log).

// oxlint-disable-next-line no-explicit-any -- shell-quote ships no types; runtime contract is stable.
import { parse as shellQuoteParse } from 'shell-quote'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

type ParseEntry = string | { op: string } | { comment: string }

const parse = shellQuoteParse as unknown as (cmd: string) => ParseEntry[]

function isOp(e: ParseEntry): e is { op: string } {
  return typeof e === 'object' && 'op' in e
}

// Verbs whose output we never want truncated. `i` and `install` are the
// classic case; `run check`/`run fix`/`run update`/`run test`/`run cover`/
// `run build` print the same warning-then-footer ordering through the
// same SFW shim. `exec` is included because `pnpm exec vitest ...` and
// similar route through the same wrapper.
const PNPM_VERBS_FIRST = new Set([
  'add',
  'exec',
  'i',
  'install',
  'up',
  'update',
])
const PNPM_RUN_SCRIPTS = new Set([
  'build',
  'check',
  'cover',
  'fix',
  'install',
  'release',
  'test',
  'update',
])

// Walk shell-quote tokens to find a pipe `|` whose LEFT side is an
// install-shaped command and whose RIGHT side starts with `tail` or
// `head`. Pipes are the only operator that matters — `&&`, `||`, `;`,
// `&` separate independent commands, so `pnpm i && echo done | tail -5`
// is NOT the bad pattern (the tail consumes `echo`, not `pnpm`).
function findOffendingPipe(command: string):
  | {
      install: string
      truncator: string
    }
  | undefined {
  let entries: ParseEntry[]
  try {
    entries = parse(command)
  } catch {
    /* c8 ignore start - shell-quote does not throw on string inputs; bashGuard guarantees a string */
    return undefined
    /* c8 ignore stop */
  }

  // Collect command segments split by COMMAND_SEPARATORS, also tracking
  // which separator op preceded each segment (or 'start'). The relevant
  // shape is segment[i] (pnpm i ...) followed by op '|' followed by
  // segment[i+1] (tail ... / head ...).
  const segments: Array<{ tokens: string[]; precededBy: string }> = []
  let cur: string[] = []
  let lastOp = 'start'

  const flush = (op: string) => {
    segments.push({ tokens: cur, precededBy: lastOp })
    cur = []
    lastOp = op
  }

  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    if (typeof e === 'object' && 'comment' in e) {
      continue
    }
    if (isOp(e)) {
      if (
        e.op === '\n' ||
        e.op === ';' ||
        e.op === '&' ||
        e.op === '&&' ||
        e.op === '|' ||
        e.op === '||'
      ) {
        flush(e.op)
        continue
      }
      // Redirect ops (`>`, `>>`, `<`, `2>&1` shows up as `>` + `&1`).
      // Keep collecting; they don't separate commands.
      continue
    }
    if (e === '') {
      // `$VAR` placeholder. Push a sentinel so the segment isn't lost
      // (the binary may still be `pnpm` later in the tokens).
      cur.push('')
      continue
    }
    cur.push(e)
  }
  // Final segment.
  segments.push({ tokens: cur, precededBy: lastOp })

  // Now scan: a segment whose `precededBy === '|'` AND whose first
  // token is `tail` / `head` is the truncator. Its predecessor (the
  // segment immediately before, regardless of separator) must be an
  // install-shaped command for this to fire.
  for (let i = 1; i < segments.length; i += 1) {
    const here = segments[i]!
    if (here.precededBy !== '|') {
      continue
    }
    const firstTok = here.tokens.find(t => t !== '')
    if (firstTok !== 'head' && firstTok !== 'tail') {
      continue
    }
    const prev = segments[i - 1]!
    const installShape = describeInstallShape(prev.tokens)
    if (installShape) {
      return { install: installShape, truncator: firstTok }
    }
  }
  return undefined
}

// Return a human-readable label for an install-shaped command, or
// undefined when the tokens are something else (`git log`, `ls`, etc.).
// Skips leading `NAME=value` assignment tokens so `CI=true pnpm i`
// still matches.
function describeInstallShape(tokens: string[]): string | undefined {
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
    i += 1
  }
  const bin = tokens[i]
  if (bin !== 'npm' && bin !== 'pnpm' && bin !== 'yarn') {
    return undefined
  }
  // Find first non-flag token after the binary.
  let j = i + 1
  while (j < tokens.length && tokens[j]!.startsWith('-')) {
    j += 1
  }
  const verb = tokens[j]
  if (!verb) {
    return undefined
  }
  // `pnpm i`, `pnpm install`, etc.
  if (PNPM_VERBS_FIRST.has(verb)) {
    return `${bin} ${verb}`
  }
  // `pnpm run <script>`.
  if (verb === 'run') {
    let k = j + 1
    while (k < tokens.length && tokens[k]!.startsWith('-')) {
      k += 1
    }
    const script = tokens[k]
    if (script && PNPM_RUN_SCRIPTS.has(script)) {
      return `${bin} run ${script}`
    }
  }
  return undefined
}

// bashGuard handles the tool_name gate, command narrow, and fail-open on any
// throw.
export const check = bashGuard(command => {
  const hit = findOffendingPipe(command)
  if (!hit) {
    return undefined
  }
  return block(
    [
      '[no-tail-install-out-guard] Blocked: install/check output piped to ' +
        `\`${hit.truncator}\`.`,
      '',
      `  Offending shape: \`${hit.install} ... | ${hit.truncator} -N\``,
      '',
      '  Why this is blocked:',
      '    pnpm prints its Socket Firewall footer last. Critical warnings',
      '    ([ERR_PNPM_IGNORED_BUILDS], peer-dep mismatches, soak-bypass',
      '    tripwires) print ABOVE the footer. A small `tail`/`head` window',
      '    captures the footer and hides every warning — a known local-passes-',
      '    CI-fails failure mode (v6.0.4 shipped with red CI this way).',
      '',
      '  Fix: scan the full output for warning markers instead.',
      '',
      `    ${hit.install} 2>&1 | grep -iE "warning|error|ignored|fail"`,
      '',
      '  Or drop the truncation entirely and read all the output.',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
