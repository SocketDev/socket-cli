// Package-manager + dependency-documentation convention scanners: the
// package.json `pnpm.overrides` split-source check, the npx/dlx runtime-call
// scanner, and the pnpm-first install-docs scanner. Gate-free string logic
// built on scan-core.

import { scanLines, splitLines } from './scan-core.mts'

import type { LineHit } from './scan-core.mts'

// ── package.json pnpm.overrides scanner ────────────────────────────
//
// Dependency overrides belong in pnpm-workspace.yaml `overrides:`, the
// fleet's single override surface. A non-empty `pnpm.overrides` block in
// a package.json splits the source of truth and sits outside the
// workspace file's `trustPolicy: no-downgrade`. Structural, not
// line-pattern: parse the JSON, flag a non-empty `pnpm.overrides`. Points
// the hit at the `"overrides"` line so the message is actionable. Returns
// no hits on parse failure (fail open; oxfmt / other gates catch broken
// JSON).
export const scanPackageJsonPnpmOverrides = (text: string): LineHit[] => {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return []
  }
  const pnpm = (parsed as { pnpm?: unknown | undefined } | null)?.pnpm
  const overrides =
    pnpm && typeof pnpm === 'object'
      ? (pnpm as { overrides?: unknown | undefined }).overrides
      : undefined
  if (
    !overrides ||
    typeof overrides !== 'object' ||
    Object.keys(overrides as Record<string, unknown>).length === 0
  ) {
    return []
  }
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (/"overrides"\s*:/.test(lines[i]!)) {
      return [{ lineNumber: i + 1, line: lines[i]!.trim() }]
    }
  }
  return [{ lineNumber: 1, line: '"pnpm": { "overrides": { … } }' }]
}

// ── npx/dlx scanner ────────────────────────────────────────────────
//
// Match `npx` / `yarn dlx` only when the token sits at a command
// position — preceded by start-of-line / whitespace / shell separator
// (`&&`, `||`, `;`, `|`, `(`, backtick), or directly after a PowerShell
// `& ` invoke. Exclude JSON-key, env-value, and identifier suffix
// contexts where `npx` shows up as an embedded substring:
//   - `"socket-npx": …`, bin-name suffix
//   - `"dev:npx": "…SOCKET_CLI_MODE=npx node …"` (script key + env value)
//   - `cmd-npx-helper`, identifier interior
// The negative lookbehind catches hyphen / colon / equals / underscore /
// dot prefixes; the negative lookahead catches the same followed forms
// (`npx-helper`, `npx:foo`).
//
// **Allowed:** `pnpm dlx` / `pnpm exec` / `pn dlx` / `pn exec` / `pnx`
// (the pnpm v11 shorthands for `pnpm dlx`). `pnpm dlx` is the
// fleet-canonical fetch-and-run form for documentation lines that
// describe ad-hoc CLI usage (where the consumer doesn't have the
// package pinned in their workspace). `pnx` is the v11 shorthand and
// is equally allowed.

const NPX_DLX_RE = /(?<![\w\-:=.])\b(npx|yarn dlx)\b(?![\w\-:=.])/

// Suggest the canonical replacement for a runtime npx/dlx call.
// Documentation contexts, comments, JSDoc, are exempt via
// looksLikeDocumentation(); we only ever land here for code lines. The
// right swap is the bin-direct form `node_modules/.bin/<tool>` — NOT
// `pnpm exec <tool>`: the Claude Bash-time `no-pm-exec-guard` BLOCKS
// `pnpm exec` / `npm exec` / `yarn exec` as package-manager + Socket
// Firewall startup overhead, so suggesting `pnpm exec` here would hand
// the developer a command that the guard then rejects. `node_modules/`
// `.bin/<tool>` is the form that guard endorses (it prints the same
// fix). Script entries should instead become `pnpm run <script>`; this
// scanner can't infer a script name, so it emits the bin-direct form
// and leaves the trailing `<tool> <args>` intact. The alternation is
// ordered longest-prefix-first so `pnpm dlx` / `yarn dlx` match before
// the bare `npx` / `pnx` binaries.
export function suggestNpxReplacement(line: string): string {
  return line
    .replace(/\bpnpm dlx\b/g, 'node_modules/.bin/')
    .replace(/\byarn dlx\b/g, 'node_modules/.bin/')
    .replace(/\bpnx\b/g, 'node_modules/.bin/')
    .replace(/\bnpx\b/g, 'node_modules/.bin/')
    .replace(/node_modules\/\.bin\/ +/g, 'node_modules/.bin/')
}

// A bare npx / yarn-dlx token wrapped in quotes with NOTHING else inside is a
// string-literal MENTION — detector code comparing `basename === "npx"`, a
// rule's own pattern table — not an invocation. Real usage always carries an
// argument (`npx <pkg>`) or sits inside a longer command string, which the
// scan still flags. This cleared false blocks on the fleet's own
// npx-detecting guard sources (foreign-linters.mts).
const NPX_DLX_EXACT_QUOTED_RE = /(['"`])(?:npx|yarn dlx)\1/g

export const scanNpxDlx = (text: string): LineHit[] =>
  scanLines(text, NPX_DLX_RE, {
    // Skip when the line stops matching once exact-quoted bare tokens are
    // stripped — anything that still matches is genuine usage.
    filter: line => !NPX_DLX_RE.test(line.replace(NPX_DLX_EXACT_QUOTED_RE, '')),
    skipDocs: { rule: 'npx' },
    suggest: suggestNpxReplacement,
  })

// ── pnpm-first docs scanner ────────────────────────────────────────
//
// Fleet rule: user-facing documentation that shows install commands
// should LEAD with the pnpm form (`pnpm install <pkg>`, `pnpm add
// <pkg>`). npm / yarn fallbacks are fine, but they should appear
// after the pnpm form — or in a sibling code block introduced as a
// fallback for users who don't have pnpm.
//
// This scanner walks fenced markdown code blocks (``` or ~~~) and
// emits a warning for any fence whose first install-shape line is
// npm/yarn rather than pnpm. Warning-only — never fails a commit.
// Inline backtick spans (a single `npm install foo` in prose) are
// NOT scanned; only block-level fences.
//
// Suppression: a line containing `socket-lint: allow pnpm-first`
// anywhere in the fence, or just above it, skips that block.

// Match shell install commands at line start (allowing leading
// whitespace + `$` prompt). Captures the package manager so the
// caller can tell which form was seen first.
const PNPM_INSTALL_LINE_RE = /^\s*\$?\s*pnpm\s+(?:add|i|install)\b/
// Same shape as above but for npm and yarn: matches `npm add|i|install` or
// `yarn install|add` or a bare `yarn` invocation, capturing the package
// manager name in group 1 so the caller can suggest the pnpm equivalent.
const NPM_YARN_INSTALL_LINE_RE =
  /^\s*\$?\s*(?:(npm)\s+(?:add|i|install)|(?:yarn)\s+(?:add|install)|(?:yarn))\s/

// Markdown fence opener: ``` or ~~~ at line start, optionally followed
// by an info string, language hint. We don't require closing match —
// just count fences as we go and treat alternating opens/closes.
const FENCE_OPEN_RE = /^\s*(?:```|~~~)/

const PNPM_FIRST_SUPPRESS_RE = /socket-lint:\s*allow\s+pnpm-first\b/

export const scanDocsPnpmFirst = (text: string): LineHit[] => {
  const hits: LineHit[] = []
  const lines = splitLines(text)
  let inFence = false
  let fenceStartLine = -1
  let fenceHasPnpm = false
  let fenceHasSuppress = false
  let fenceFirstNpmYarnHit: LineHit | undefined
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!
    if (FENCE_OPEN_RE.test(line)) {
      // Closing fence: flush any pending hit if no pnpm form was seen
      // and the block wasn't suppressed.
      if (inFence) {
        if (fenceFirstNpmYarnHit && !fenceHasPnpm && !fenceHasSuppress) {
          hits.push(fenceFirstNpmYarnHit)
        }
        inFence = false
        fenceStartLine = -1
        fenceHasPnpm = false
        fenceHasSuppress = false
        fenceFirstNpmYarnHit = undefined
      } else {
        inFence = true
        fenceStartLine = i + 1
      }
      continue
    }
    if (!inFence) {
      // Suppression marker on a comment line just above the fence is
      // also honored (some docs prefer keeping markers outside the
      // rendered code block).
      if (PNPM_FIRST_SUPPRESS_RE.test(line)) {
        // Look ahead one line for a fence open; if it's there, mark
        // the upcoming block as suppressed.
        const next = lines[i + 1]
        if (next !== undefined && FENCE_OPEN_RE.test(next)) {
          fenceHasSuppress = true
        }
      }
      continue
    }
    if (PNPM_FIRST_SUPPRESS_RE.test(line)) {
      fenceHasSuppress = true
      continue
    }
    if (PNPM_INSTALL_LINE_RE.test(line)) {
      fenceHasPnpm = true
      continue
    }
    if (
      NPM_YARN_INSTALL_LINE_RE.test(line) &&
      fenceFirstNpmYarnHit === undefined
    ) {
      fenceFirstNpmYarnHit = {
        lineNumber: i + 1,
        line,
        // Replace the npm/yarn subcommand with pnpm, preserving the add|i|install verb.
        suggested: line.replace(/\b(npm|yarn)\s+(add|i|install)\b/, 'pnpm $2'),
      }
    }
  }
  // Unclosed fence at EOF — flush whatever's pending.
  if (inFence && fenceFirstNpmYarnHit && !fenceHasPnpm && !fenceHasSuppress) {
    hits.push(fenceFirstNpmYarnHit)
  }
  // Reference fenceStartLine to suppress unused-variable lints; the
  // value is useful for future enhancements (e.g. block-level
  // diagnostics) but the current per-line LineHit shape carries the
  // offending line number directly.
  void fenceStartLine
  return hits
}
