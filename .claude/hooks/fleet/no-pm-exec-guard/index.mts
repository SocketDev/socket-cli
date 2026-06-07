#!/usr/bin/env node
// Claude Code PreToolUse(Bash) hook — no-pm-exec-guard.
//
// Blocks two banned package-manager run forms at Bash time:
//
//   1. `pnpm exec` / `npm exec` / `yarn exec` — run an already-installed
//      `node_modules/.bin` binary but wrap it in the package manager's startup +
//      (in this fleet) the Socket Firewall interception layer on every call —
//      pure overhead. `bare node_modules/.bin/tsgo` ran in 422ms vs the
//      multi-second `pnpm exec tsgo` wrapper (2026-06-03 slowdown investigation).
//      Fix: run the bin directly (`node_modules/.bin/<tool>`) or `pnpm run <x>`.
//
//   2. `npx` / `pnpm dlx` / `yarn dlx` — FETCH + execute unpinned code, a
//      supply-chain risk. The `socket/no-npx-dlx` oxlint rule already bans these
//      in committed SOURCE, but a Claude Bash invocation runs before any lint —
//      so this hook is the run-time block (2026-06-06: round-2 code-is-law scan
//      found dlx/npx had no Bash-time gate, only the source lint rule).
//      Fix: add the dep + run it installed, or `pipx`/`node_modules/.bin`.
//
// AST-parses the command via shell-command.mts/findInvocation (per the
// no-command-regex-in-hooks rule) — never a raw regex on the command string.
//
// Bypass: `Allow pm-exec bypass` in a recent user turn.
//
// Exit codes: 0 — pass; 2 — block. Fails open on any throw.

import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withBashGuard } from '../_shared/payload.mts'
import { findInvocation } from '../_shared/shell-command.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow pm-exec bypass'

// (binary, label) pairs whose `exec` subcommand is banned (overhead/wrapper).
const PM_EXEC: ReadonlyArray<readonly [string, string]> = [
  ['pnpm', 'pnpm exec'],
  ['npm', 'npm exec'],
  ['yarn', 'yarn exec'],
]

// (binary, subcommand, label) for the fetch+execute forms — `pnpm dlx` /
// `yarn dlx` carry a `dlx` subcommand; `npx` / `pnx` are bare binaries (no
// subcommand). All fetch unpinned code and are banned at run time.
const FETCH_EXEC: ReadonlyArray<
  readonly [string, string | undefined, string]
> = [
  ['pnpm', 'dlx', 'pnpm dlx'],
  ['yarn', 'dlx', 'yarn dlx'],
  ['npx', undefined, 'npx'],
  ['pnx', undefined, 'pnx'],
]

export function bannedPmExec(command: string): string | undefined {
  for (let i = 0, { length } = PM_EXEC; i < length; i += 1) {
    const [binary, label] = PM_EXEC[i]!
    if (findInvocation(command, { binary, subcommand: 'exec' })) {
      return label
    }
  }
  return undefined
}

export function bannedFetchExec(command: string): string | undefined {
  for (let i = 0, { length } = FETCH_EXEC; i < length; i += 1) {
    const [binary, subcommand, label] = FETCH_EXEC[i]!
    const query = subcommand ? { binary, subcommand } : { binary }
    if (findInvocation(command, query)) {
      return label
    }
  }
  return undefined
}

void (async () => {
  await withBashGuard((command, payload) => {
    const execLabel = bannedPmExec(command)
    const fetchLabel = bannedFetchExec(command)
    if (!execLabel && !fetchLabel) {
      return
    }
    if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
      return
    }
    if (fetchLabel) {
      logger.error(
        [
          `[no-pm-exec-guard] Blocked: \`${fetchLabel}\`.`,
          '',
          `  \`${fetchLabel} <pkg>\` FETCHES + executes unpinned code — a`,
          '  supply-chain risk the fleet bans (CLAUDE.md Tooling).',
          '',
          '  Add the dep and run it installed, or use pipx / node_modules/.bin:',
          `    pnpm add -D <pkg> && node_modules/.bin/<tool>   not  ${fetchLabel} <pkg>`,
          '',
          `  Bypass: type \`${BYPASS_PHRASE}\` if this is genuinely intended.`,
          '',
        ].join('\n'),
      )
    } else {
      logger.error(
        [
          `[no-pm-exec-guard] Blocked: \`${execLabel}\`.`,
          '',
          `  \`${execLabel} <tool>\` wraps the installed bin in package-manager +`,
          '  Socket Firewall startup overhead on every call.',
          '',
          '  Run the bin directly, or via a script:',
          `    node_modules/.bin/<tool>      not  ${execLabel} <tool>`,
          '    pnpm run <script>',
          '',
          `  Bypass: type \`${BYPASS_PHRASE}\` if this is genuinely intended.`,
          '',
        ].join('\n'),
      )
    }
    process.exitCode = 2
  })
})()
