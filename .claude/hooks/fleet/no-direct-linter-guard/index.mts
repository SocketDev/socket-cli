#!/usr/bin/env node
// Claude Code PreToolUse(Bash) hook — no-direct-linter-guard.
//
// Blocks invoking a linter or formatter binary directly. The fleet runs
// lint/format ONLY through the repo scripts (`pnpm run lint` / `fix` / `check`
// / `format`) and the `scripts/fleet/*` wrappers — those own the explicit
// `-c .config/fleet/<oxlintrc|oxfmtrc>` flag and the ignore set. A bare binary
// call is a double hazard:
//
//   1. Configless `oxfmt`/`oxlint` falls back to its own defaults (double-quote
//      + semicolon) and corrupts fleet files. The scripts always pass `-c`.
//   2. A bare formatter has no ignore scoping and will reformat vendored
//      `upstream/` trees the fleet must never touch.
//
// Foreign tools (`eslint`/`prettier`/`biome`/`dprint`) are not fleet tools at
// all (see no-other-linters-guard); `cargo fmt` / `rustfmt` / `gofmt` reflow
// hand-formatted code. All are blocked.
//
// The binary is matched on its BASENAME (so `node_modules/.bin/oxlint` and a
// bare `oxlint` both match) via shell-command.mts/parseCommands — AST parse,
// never a raw regex on the command string (no-command-regex-in-hooks rule).
// The scripts' OWN internal `node_modules/.bin/oxlint` spawns are child
// processes, not Claude Bash calls, so this hook never sees them.
//
// Bypass: `Allow direct-linter bypass` in a recent user turn.
//
// Exit codes: 0 — pass; 2 — block. Fails open on any throw.

import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withBashGuard } from '../_shared/payload.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow direct-linter bypass'

// Linter/formatter binaries banned as a bare/direct invocation. Matched on the
// command's basename, so the `node_modules/.bin/<tool>` path form is caught too.
const BANNED_BINARIES: ReadonlySet<string> = new Set([
  'oxlint',
  'oxfmt',
  'eslint',
  'prettier',
  'biome',
  'dprint',
  'rustfmt',
  'gofmt',
])

// `<binary> <subcommand>` forms — cargo's format/lint subcommands. `cargo
// build` / `cargo test` are fine, so match on the first non-flag arg.
const BANNED_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['cargo', new Set(['fmt', 'clippy'])],
])

export function bannedLinterInvocation(command: string): string | undefined {
  for (const cmd of parseCommands(command)) {
    const { binary } = cmd
    if (!binary) {
      continue
    }
    const base = path.basename(binary)
    if (BANNED_BINARIES.has(base)) {
      return base
    }
    const subs = BANNED_SUBCOMMANDS.get(base)
    if (subs) {
      const verb = cmd.args.find(a => !a.startsWith('-'))
      if (verb && subs.has(verb)) {
        return `${base} ${verb}`
      }
    }
  }
  return undefined
}

void (async () => {
  await withBashGuard((command, payload) => {
    const tool = bannedLinterInvocation(command)
    if (!tool) {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return
    }
    logger.error(
      [
        `[no-direct-linter-guard] Blocked: direct \`${tool}\` invocation.`,
        '',
        '  The fleet runs lint/format ONLY through the repo scripts, which own',
        '  the `-c .config/fleet/…` flag + ignore set. A bare formatter falls',
        '  back to its own defaults (corrupts fleet files) and has no ignore',
        '  scoping (reformats vendored upstream/ we must never touch).',
        '',
        '  Use a script wrapper instead:',
        '    pnpm run lint        pnpm run fix --all',
        '    pnpm run check       pnpm run format',
        `    not  ${tool} …`,
        '',
        `  Bypass: type \`${BYPASS_PHRASE}\` if this is genuinely intended.`,
        '',
      ].join('\n'),
    )
    process.exitCode = 2
  })
})()
