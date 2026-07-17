#!/usr/bin/env node
// Claude Code PreToolUse(Bash) hook — no-direct-linter-guard.
//
// Blocks invoking a linter, formatter, or TypeScript compiler binary directly.
// The fleet runs lint/format/type-check ONLY through the repo scripts
// (`pnpm run lint` / `fix` / `check` / `format`) and the `scripts/fleet/*`
// wrappers — those own the explicit `-c .config/fleet/<oxlintrc|oxfmtrc>` /
// `-p .config/fleet/tsconfig.check.json` flag and the ignore set. A bare binary
// call is a double hazard (for `tsc`/`tsgo`: the default tsconfig misses
// `allowImportingTsExtensions` → bogus TS5097 on every `.mts` import):
//
//   1. Configless `oxfmt`/`oxlint` falls back to its own defaults (double-quote
//      + semicolon) and corrupts fleet files. The scripts always pass `-c`.
//   2. A bare formatter has no ignore scoping and will reformat vendored
//      `upstream/` trees the fleet must never touch.
//
// Foreign tools (`eslint`/`prettier`/`biome`/`dprint`) are not fleet tools at
// all (see no-other-linters-guard); `cargo fmt` / `rustfmt` / `gofmt` reflow
// hand-formatted code. Runner-wrapped forms (`yarn prettier`, `npx prettier`,
// `pnpm exec prettier`, `bunx prettier`) are caught too; only
// `<runner> run <script>` (a package.json script) passes.
//
// This is a CONVENTION guard, not a universal-safety one: "run the repo's
// wrapper, not a bare binary" is a FLEET doctrine that only holds where the
// fleet toolchain lives (the `-c .config/fleet/…` script wrappers, the repo's
// own scripts). Outside a fleet repo — a sibling clone, an external checkout,
// a Rust project that formats with native `cargo fmt` — the native binary IS
// the sanctioned path, and the operator can't even self-authorize a bypass
// because the fleet tooling isn't installed there. So the whole guard gates on
// `isFleetTarget` and no-ops outside a fleet repo (see fleet-context.mts). A
// fleet-rooted session acting on a non-fleet repo via a leading
// `cd <non-fleet-repo> && <formatter>` is judged against that repo.
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
  // TypeScript compiler. A bare `tsc` / `tsgo` (incl. `pnpm exec tsc`) resolves
  // the DEFAULT tsconfig, which lacks the fleet check config's flags (e.g.
  // `allowImportingTsExtensions`) → bogus TS5097 "import path can only end with
  // '.mts'" on every fleet `.mts` import. The fleet type-checks ONLY through
  // `pnpm run check` (the tsc step passes `-p .config/fleet/tsconfig.check.json`).
  'tsc',
  'tsgo',
])

// `<binary> <subcommand>` forms — cargo's format/lint subcommands. `cargo
// build` / `cargo test` are fine, so match on the first non-flag arg.
const BANNED_SUBCOMMANDS: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['cargo', new Set(['clippy', 'fmt'])],
])

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
  // Convention guard: the "use the repo's wrapper, not a bare binary" rule is a
  // FLEET doctrine that only holds where the fleet toolchain exists. In a
  // non-fleet repo the native binary (`cargo fmt`, the project's own script) IS
  // the sanctioned path, so no-op there.
  if (!isFleetTarget(payload)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(
    [
      `[no-direct-linter-guard] Blocked: direct \`${tool}\` invocation.`,
      '',
      '  The fleet runs lint/format/type-check ONLY through the repo scripts,',
      '  which own the `-c .config/fleet/…` / `-p …/tsconfig.check.json` flag +',
      '  ignore set (a bare `tsc` uses the wrong tsconfig). Use a wrapper:',
      '    pnpm run lint        pnpm run fix --all',
      '    pnpm run check       pnpm run format',
      `    not  ${tool} …`,
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
