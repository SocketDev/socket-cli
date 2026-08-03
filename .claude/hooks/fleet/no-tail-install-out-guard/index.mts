#!/usr/bin/env node
// Claude Code PreToolUse hook — no-tail-install-out-guard.
//
// Blocks Bash commands that narrow a gate's output down to a window the
// gate's refusal cannot appear in. Two shapes:
//
//   1. install/check/fix/test output piped into `tail` or `head`
//   2. `git push` or a cascade script piped into a `grep` whose pattern
//      matches only the success vocabulary
//
// The first shape's failure mode:
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
// The second shape has its own incident: 2026-07-28, a cascade was run as
// `node scripts/repo/sync.mts … | grep -oE "[0-9]+ fixed"`. It reported
// `0 fixed`, which read as "already in sync". The discarded output said
// `refusing a stale template apply: incoming template 413f3cd5a is a strict
// ancestor of the already-applied template 705da6ebb`. The cascade had not
// run at all. Re-run unfiltered from a current checkout: 38/86 fixed. That
// was the sixth time in one session a conclusion came from a filtered view,
// which is what promoted this from a habit to a guard.
//
// No bypass. The rewrite is always available: replace `tail -N` with
// `grep -iE "warning|error|ignored|fail"` to scan the full output, keep the
// refusal vocabulary in a gate command's grep, or redirect the run to a file
// and read the verdict. The hook's stderr names them.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Bash",
//     "tool_input": { "command": "..." },
//     ... }
//
// Exit codes:
//   0 — pass, not Bash, or the command shape isn't the bad one.
//   2 — block (install/gate output piped to tail/head, or a gate command
//       piped to a grep that cannot match a refusal).
//
// Fails open on malformed payloads (exit 0 + stderr log).

import { parseShell } from '@socketsecurity/lib-stable/shell/parse'

import type { ParseEntry } from '@socketsecurity/lib-stable/shell/parse'

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'

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

// Return a human-readable label for an install-shaped command, or
// undefined when the tokens are something else (`git log`, `ls`, etc.).
// Skips leading `NAME=value` assignment tokens so `CI=true pnpm i`
// still matches.
export function describeInstallShape(tokens: string[]): string | undefined {
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

// Scripts whose REFUSALS read nothing like their successes. The cascade
// reports work as `<n> fixed`, but declines with `skipping fleet dir — template
// source has uncommitted changes` and `refusing a stale template apply:
// incoming template <sha> is a strict ancestor of the already-applied template
// <sha>`. An operator grepping for the success shape sees an empty match and
// reads it as "nothing to do" rather than "it refused to run".
const GATE_SCRIPTS: readonly string[] = ['cli.mts', 'doctor.mts', 'sync.mts']

// The vocabulary a refusal actually uses. A filter that keeps none of these
// terms cannot surface one, so the operator is left reading a success-only view
// of a command that may not have succeeded.
export const REFUSAL_TERMS: readonly string[] = [
  'abort',
  'block',
  'denied',
  'error',
  'fail',
  'refus',
  'skip',
  'stale',
  'unfixed',
  'warn',
]

// Label a gate-shaped command — one whose verdict line is the point of running
// it — or undefined for anything else. `git push` runs the whole pre-push
// validation stack and prints its verdict last; the cascade scripts print the
// refusals above.
export function describeGateShape(tokens: string[]): string | undefined {
  let i = 0
  while (i < tokens.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!)) {
    i += 1
  }
  const bin = tokens[i]
  if (bin === 'git') {
    let j = i + 1
    while (j < tokens.length && tokens[j]!.startsWith('-')) {
      j += 1
    }
    return tokens[j] === 'push' ? 'git push' : undefined
  }
  if (bin === 'node') {
    const script = tokens
      .slice(i + 1)
      .find(t => GATE_SCRIPTS.some(s => t === s || t.endsWith(`/${s}`)))
    if (script) {
      return `node ${script}`
    }
  }
  return undefined
}

// Whether a `grep` segment still lets refusal lines through. `grep` is this
// guard's own sanctioned rewrite for `tail`, but only when the pattern keeps
// the refusals: `grep -iE "warning|error|fail"` surfaces one, `grep -oE
// "[0-9]+ fixed"` cannot. An inverting grep (`-v`) drops matching lines and
// keeps the rest, so it is an exclusion rather than a narrowing and is left
// alone.
export function grepKeepsRefusals(tokens: readonly string[]): boolean {
  const args = tokens.slice(1)
  if (args.some(a => /^-[A-Za-z]*v/.test(a))) {
    return true
  }
  const patterns: string[] = []
  let positional: string | undefined
  for (let i = 0, { length } = args; i < length; i += 1) {
    const arg = args[i]!
    if (arg === '--regexp' || arg === '-e') {
      const next = args[i + 1]
      if (next !== undefined) {
        patterns.push(next)
      }
      i += 1
      continue
    }
    if (!arg.startsWith('-') && positional === undefined) {
      positional = arg
    }
  }
  if (!patterns.length && positional !== undefined) {
    patterns.push(positional)
  }
  const haystack = patterns.join('\n').toLowerCase()
  return REFUSAL_TERMS.some(term => haystack.includes(term))
}

// Pure text filters a pipeline may chain ahead of the truncator. They rewrite
// the stream without producing it, so the command that actually ran sits
// further left: `git push | grep -v "^remote:" | tail -4` hides the push
// verdict exactly as `git push | tail -4` does, and both must be caught.
const PASSTHROUGH_FILTERS = new Set([
  'awk',
  'cat',
  'cut',
  'grep',
  'sed',
  'sort',
  'tr',
  'uniq',
])

// Walk left from the truncator at `index`, stepping over chained text filters,
// to the segment that produced the output. Returns undefined when the chain
// runs off the start or is broken by a non-pipe separator (`;`, `&&`), since
// neither case has a producer feeding this pipeline.
export function findPipeSource(
  segments: ReadonlyArray<{ precededBy: string; tokens: string[] }>,
  index: number,
): { tokens: string[] } | undefined {
  for (let i = index - 1; i >= 0; i -= 1) {
    const seg = segments[i]!
    const first = seg.tokens.find(t => t !== '')
    if (first === undefined || !PASSTHROUGH_FILTERS.has(first)) {
      return seg
    }
    if (seg.precededBy !== '|') {
      return undefined
    }
  }
  return undefined
}

// Walk shell-quote tokens to find a pipe `|` whose LEFT side is an
// install-shaped or gate-shaped command and whose RIGHT side narrows the
// output away. Pipes are the only operator that matters — `&&`, `||`, `;`,
// `&` separate independent commands, so `pnpm i && echo done | tail -5`
// is NOT the bad pattern (the tail consumes `echo`, not `pnpm`).
export function findOffendingPipe(command: string):
  | {
      install: string
      truncator: string
    }
  | undefined {
  let entries: ParseEntry[]
  try {
    entries = parseShell(command)
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
    if (typeof e !== 'string') {
      // Glob tokens are structural metadata, not command arguments.
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

  // Now scan: a segment whose `precededBy === '|'` AND whose first token
  // narrows the output is the truncator. Its predecessor (the segment
  // immediately before, regardless of separator) must be install- or
  // gate-shaped for this to fire.
  //
  // `head`/`tail` always truncate. `grep` only counts against a GATE command,
  // where the refusal vocabulary diverges from the success vocabulary — an
  // install's warnings already say "warning"/"error", so the sanctioned
  // `grep -iE "warning|error|…"` rewrite must keep working there.
  for (let i = 1; i < segments.length; i += 1) {
    const here = segments[i]!
    if (here.precededBy !== '|') {
      continue
    }
    const tokens = here.tokens.filter(t => t !== '')
    const firstTok = tokens[0]
    if (firstTok !== 'grep' && firstTok !== 'head' && firstTok !== 'tail') {
      continue
    }
    const prev = findPipeSource(segments, i)
    if (!prev) {
      continue
    }
    const gateShape = describeGateShape(prev.tokens)
    if (firstTok === 'grep') {
      if (!gateShape || grepKeepsRefusals(tokens)) {
        continue
      }
      return { install: gateShape, truncator: firstTok }
    }
    const source = describeInstallShape(prev.tokens) ?? gateShape
    if (source) {
      return { install: source, truncator: firstTok }
    }
  }
  return undefined
}

export function isOp(e: ParseEntry): e is { op: string } {
  return typeof e === 'object' && 'op' in e
}

// bashGuard handles the tool_name gate, command narrow, and fail-open on any
// throw.
export const check = bashGuard(command => {
  const hit = findOffendingPipe(command)
  if (!hit) {
    return undefined
  }
  if (hit.truncator === 'grep') {
    return block(
      [
        `[no-tail-install-out-guard] Blocked: \`${hit.install}\` output ` +
          'filtered by a pattern that cannot match a refusal.',
        '',
        `  Offending shape: \`${hit.install} ... | grep <success-pattern>\``,
        '',
        '  Why this is blocked:',
        '    A gate command declines in words that look nothing like the words',
        '    it succeeds in. The cascade reports `<n> fixed` on success but',
        '    `skipping fleet dir …` / `refusing a stale template apply …` when',
        '    it declines; `git push` prints its validation verdict, not a',
        '    summary. Grepping for the success shape returns an empty match on',
        '    a refusal, which reads as "nothing to do" — so a command that',
        '    never ran gets recorded as one that found nothing.',
        '',
        '  Fix: keep the refusal vocabulary in the pattern.',
        '',
        `    ${hit.install} 2>&1 | grep -iE "${REFUSAL_TERMS.join('|')}"`,
        '',
        '  Or capture the whole run and read the verdict:',
        '',
        `    ${hit.install} >/tmp/out.txt 2>&1; echo "exit=$?"; tail -40 /tmp/out.txt`,
        '',
      ].join('\n'),
    )
  }
  return block(
    [
      '[no-tail-install-out-guard] Blocked: install/gate output piped to ' +
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
      '    `git push` and the cascade scripts print their refusal the same way:',
      '    above whatever line the window happens to catch.',
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
