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
// hand-formatted code. All are blocked — and the foreign formatters block in
// ANY repo (fleet OR external): hand-running a formatter binary, instead of the
// repo's own script / pre-commit / codegen, is the anti-pattern everywhere
// (a `yarn prettier -w` to paper over a failing codegen format step is the
// incident this guard's universal scope closes). Runner-wrapped forms
// (`yarn prettier`, `npx prettier`, `pnpm exec prettier`, `bunx prettier`) are
// caught too; only `<runner> run <script>` (a package.json script) passes.
// oxfmt/oxlint stay gated to fleet repos, where their `-c` wrappers live.
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

import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { isFleetTarget } from '../_shared/fleet-context.mts'
import { parseCommands } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow direct-linter bypass'

// Linter/formatter binaries banned as a bare/direct invocation. Matched on the
// command's basename, so the `node_modules/.bin/<tool>` path form is caught too.
const BANNED_BINARIES: ReadonlySet<string> = new Set([
  // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- detection data: banned-binary list, not a config reference.
  'biome',
  'dprint',
  // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- detection data: banned-binary list, not a config reference.
  'eslint',
  'gofmt',
  'oxfmt',
  'oxlint',
  'prettier',
  'rustfmt',
])

// `<binary> <subcommand>` forms — cargo's format/lint subcommands. `cargo
// build` / `cargo test` are fine, so match on the first non-flag arg.
const BANNED_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['cargo', new Set(['clippy', 'fmt'])],
])

// Fleet-OWNED tools. Direct invocation is blocked only INSIDE a fleet repo
// (where the `-c .config/fleet/…` script wrappers + ignore sets exist); outside,
// oxfmt / oxlint aren't the repo's tools anyway. Every OTHER banned binary is a
// foreign formatter, blocked in ANY repo — hand-running a formatter binary is
// the anti-pattern everywhere, fleet or not (let the repo's own script,
// pre-commit, or codegen own it).
const FLEET_LINTERS: ReadonlySet<string> = new Set(['oxfmt', 'oxlint'])

// Package runners that execute a BIN by name. The forms `npx <bin>`, `bunx
// <bin>`, classic `yarn <bin>`, and the exec / dlx / x subcommands of pnpm,
// npm, bun, and yarn all run the bin directly — the same hazard as a bare call
// (`yarn prettier -w` was the gap that let a hand-formatter through). A runner
// `run <script>` invokes a package.json SCRIPT (the sanctioned path), NOT a
// bin, so it is never flagged.
const PACKAGE_RUNNERS: ReadonlySet<string> = new Set([
  'bun',
  'bunx',
  'npm',
  'npx',
  'pnpm',
  'yarn',
])
const RUNNER_EXEC_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'dlx',
  'exec',
  'x',
])

// The banned formatter/linter a package runner is about to execute, or
// undefined when the runner is invoking a script or a non-banned bin.
function runnerWrappedTool(
  runner: string,
  args: readonly string[],
): string | undefined {
  if (!PACKAGE_RUNNERS.has(runner)) {
    return undefined
  }
  const positional = args.filter(a => !a.startsWith('-'))
  const first = positional[0]
  if (!first) {
    return undefined
  }
  // A runner `run <script>` is a package.json script, never a bin.
  if (first === 'run') {
    return undefined
  }
  // `pnpm exec <bin>` / `bun x <bin>` put the bin after the subcommand; npx,
  // bunx, and classic `yarn <bin>` put the bin first.
  const candidate = RUNNER_EXEC_SUBCOMMANDS.has(first) ? positional[1] : first
  if (!candidate) {
    return undefined
  }
  const candidateBase = path.basename(candidate)
  return BANNED_BINARIES.has(candidateBase) ? candidateBase : undefined
}

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
    const wrapped = runnerWrappedTool(base, cmd.args)
    if (wrapped) {
      return wrapped
    }
  }
  return undefined
}

export const check = bashGuard((command, payload) => {
  const tool = bannedLinterInvocation(command)
  if (!tool) {
    return undefined
  }
  const fleetRepo = isFleetTarget(payload)
  // oxfmt / oxlint are FLEET tools: only meaningful — and only blocked — inside
  // a fleet repo, where the `-c .config/fleet/…` script wrappers exist. Every
  // foreign formatter (prettier / eslint / biome / cargo fmt / …) is blocked in
  // ANY repo: hand-running a formatter binary is the anti-pattern everywhere,
  // fleet or not. (A `yarn prettier -w` in an external repo, run to paper over a
  // generator's failing self-format step, is the incident this closes.)
  if (FLEET_LINTERS.has(tool) && !fleetRepo) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  const fix = fleetRepo
    ? [
        '  The fleet runs lint/format ONLY through the repo scripts, which own',
        '  the `-c .config/fleet/…` flag + ignore set. Use a wrapper instead:',
        '    pnpm run lint        pnpm run fix --all',
        '    pnpm run check       pnpm run format',
        `    not  ${tool} …`,
      ]
    : [
        "  Don't hand-run a formatter/linter binary — let the repo's own tooling",
        '  own it: run its package.json script (e.g. `npm run format` / `lint`),',
        "  or let its pre-commit / codegen format. If a generator's own format",
        '  step is failing, surface or fix THAT — never hand-format around it.',
        `    not  ${tool} …`,
      ]
  return block(
    [
      `[no-direct-linter-guard] Blocked: direct \`${tool}\` invocation.`,
      '',
      ...fix,
      '',
      `  Bypass: type \`${BYPASS_PHRASE}\` if this is genuinely intended.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
