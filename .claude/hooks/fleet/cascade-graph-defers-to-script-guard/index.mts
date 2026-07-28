#!/usr/bin/env node
// Claude Code PreToolUse hook — cascade-graph-defers-to-script-guard.
//
// Makes the agent STOP eyeballing the raw release-cascade graph and run the
// SMART scripts that reason about downstream obligations for it. The graph in
// scripts/fleet/lib/release-cascade.mts is DATA, not the whole story: some fleet
// repos, socket-packageurl-js, socket-sdk-js, ship zero runtime dependencies
// and BUNDLE their upstreams into dist/**, so an upstream bump owes a downstream
// RELEASE, not just a catalog pin. Reading the graph text by hand and reasoning
// ad-hoc misses that — the exact mistake that concluded "a socket-lib bump owes
// only catalog-pins, no downstream release" when packageurl-js and sdk actually
// owed follow-up releases. The bundling logic lives in code (bundlesDependency +
// findUndeclaredBundledEdges + computeOwedFollowUps), so the answer must come
// from RUNNING it, never from squinting at the map.
//
// BLOCKED: a Bash command that MANUALLY INSPECTS the cascade graph —
//   - `cat` / `head` / `tail` / `less` / `more` / `bat` / `view` of a
//     `release-cascade.mts` file.
//   - `grep` / `rg` targeting `release-cascade.mts` OR the `RELEASE_CASCADE_GRAPH`
//     symbol anywhere.
//   - `git show <ref>:.../release-cascade.mts`, `git log -- .../release-cascade.mts`,
//     `git grep RELEASE_CASCADE_GRAPH`, `git cat-file` of the graph file.
//
// ALLOWED, never blocked:
//   - `node scripts/fleet/socket-lib-cascade.mts --status` — the smart status
//     script, which accounts for bundling.
//   - `node scripts/fleet/check/cascade-followups-are-settled.mts` — the
//     settle-check that stands on computeOwedFollowUps.
//   - running the graph's code any other way, editing it through the Edit/Write
//     tools, and every non-inspection command — they match no rule.
//
// The decision is a PURE function, decideCascadeGraphGuard, over the parsed
// command, so it is exhaustively unit-tested without touching the filesystem.
// Each cat / grep / rg / git segment is AST-parsed via commandsFor — robust to
// leading env assignments, `git -C <path>`, quoting, and `&&` / `;` / `|` chains
// — so a quoted "release-cascade.mts" inside a message never false-fires.
//
// Does NOT fire when:
//   - the context is CI — CI / GITHUB_ACTIONS / CONTINUOUS_INTEGRATION set. CI
//     runs the checks through its own workflow, not an interactive agent.
//   - the acted-on repo is not fleet-managed — scope 'convention' stands the
//     hook down in a foreign repo.
//
// Bypass: `Allow cascade-graph-inspect bypass` typed verbatim in a recent user
// turn — for the genuine case of reading the graph file to edit it by hand.
//
// Fails open on parse / payload errors — a guard bug must not wedge every Bash
// call.

import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { extractGitCwd } from '../_shared/git-cwd.mts'
import { bashGuard, block, defineHook, runHook } from '../_shared/guard.mts'
import { commandsFor } from '../_shared/shell-command.mts'

// The graph module's basename and the exported symbol that names it — the two
// surfaces a hand inspection reaches for. Also the pre-flight triggers.
const GRAPH_FILE_BASENAME = 'release-cascade.mts'
const GRAPH_SYMBOL = 'RELEASE_CASCADE_GRAPH'

// Pre-flight skip hint: detection only fires when one of these appears in the
// raw command, so the dispatcher skips importing the hook otherwise.
export const triggers: readonly string[] = [GRAPH_FILE_BASENAME, GRAPH_SYMBOL]

// Stable identifier for CI scripts / ndjson reporters to branch on instead of
// substring-matching the human message.
export const ERR_CASCADE_GRAPH_DEFERS_TO_SCRIPT =
  'ERR_FLEET_CASCADE_GRAPH_DEFERS_TO_SCRIPT'

// Read-only inspection binaries whose target is the graph file (or a grep/rg
// pattern of the graph symbol).
const INSPECT_BINARIES: readonly string[] = [
  'bat',
  'cat',
  'grep',
  'head',
  'less',
  'more',
  'rg',
  'tail',
  'view',
]

// The `git` subcommands that read a file's content or history — the inspection
// vectors a graph read reaches through `git`.
const GIT_INSPECT_SUBCOMMANDS: ReadonlySet<string> = new Set([
  'cat-file',
  'grep',
  'log',
  'show',
])

/**
 * A cascade-graph-guard verdict. `blocked: false` allows; a block carries a
 * human `reason` label for the inspection it fired on — `cat
 * release-cascade.mts`, `grep RELEASE_CASCADE_GRAPH`.
 */
export interface CascadeGraphGuardDecision {
  readonly blocked: boolean
  readonly reason?: string | undefined
}

const ALLOW: CascadeGraphGuardDecision = { blocked: false }

// True when `arg` names the graph FILE. A git `ref:path` refspec is split so
// `HEAD:scripts/fleet/lib/release-cascade.mts` still resolves to the path.
function isGraphFileArg(arg: string): boolean {
  const colon = arg.lastIndexOf(':')
  const pathPart = colon >= 0 ? arg.slice(colon + 1) : arg
  const normalized = normalizePath(pathPart)
  return (
    normalized === GRAPH_FILE_BASENAME ||
    normalized.endsWith(`/${GRAPH_FILE_BASENAME}`)
  )
}

// True when `arg` references the cascade graph at all — the graph file, or the
// exported symbol as a grep/rg pattern.
function argReferencesGraph(arg: string): boolean {
  return arg.includes(GRAPH_SYMBOL) || isGraphFileArg(arg)
}

// The concrete surface an arg hit, for the reason label.
function describeHit(arg: string): string {
  return arg.includes(GRAPH_SYMBOL) ? GRAPH_SYMBOL : GRAPH_FILE_BASENAME
}

// A read-only-binary inspection of the graph, or undefined.
function inspectBinaryReason(command: string): string | undefined {
  for (let i = 0, { length } = INSPECT_BINARIES; i < length; i += 1) {
    const binary = INSPECT_BINARIES[i]!
    for (const cmd of commandsFor(command, binary)) {
      const hit = cmd.args.find(argReferencesGraph)
      if (hit) {
        return `${binary} ${describeHit(hit)}`
      }
    }
  }
  return undefined
}

// A `git` content/history inspection of the graph, or undefined. A `git`
// segment counts only when it carries a reading subcommand AND an arg that
// references the graph, so a plain `git status` never trips it.
function gitInspectReason(command: string): string | undefined {
  for (const cmd of commandsFor(command, 'git')) {
    if (!cmd.args.some(arg => GIT_INSPECT_SUBCOMMANDS.has(arg))) {
      continue
    }
    const hit = cmd.args.find(argReferencesGraph)
    if (hit) {
      return `git ${describeHit(hit)}`
    }
  }
  return undefined
}

/**
 * Decide whether a Bash `command` must be blocked as a hand inspection of the
 * release-cascade graph. Pure — no filesystem, no environment. Evaluates every
 * cat / grep / rg / head / tail / less / more / bat / view / git segment of a
 * chained command.
 *
 * BLOCKS a read of `release-cascade.mts` or a grep of `RELEASE_CASCADE_GRAPH`.
 * ALLOWS the sanctioned smart scripts, edit-tool writes, and everything else —
 * those match no rule.
 */
export function decideCascadeGraphGuard(
  command: string,
): CascadeGraphGuardDecision {
  const reason = inspectBinaryReason(command) ?? gitInspectReason(command)
  return reason ? { blocked: true, reason } : ALLOW
}

/**
 * True when the environment looks like CI, where the checks run through their
 * own workflow rather than an interactive agent.
 */
export function isCiEnv(env: NodeJS.ProcessEnv): boolean {
  return Boolean(
    env['CI'] || env['GITHUB_ACTIONS'] || env['CONTINUOUS_INTEGRATION'],
  )
}

export function formatBlock(
  decision: CascadeGraphGuardDecision,
  repoDir: string,
): string {
  const reason = decision.reason ?? 'a hand inspection of the cascade graph'
  return (
    [
      `[cascade-graph-defers-to-script-guard] Blocked: ${reason} — the cascade obligations are code-is-law. [${ERR_CASCADE_GRAPH_DEFERS_TO_SCRIPT}]`,
      '',
      `  What:  ${reason}. Eyeballing scripts/fleet/lib/release-cascade.mts and`,
      '         reasoning ad-hoc about what a release owes downstream MISSES',
      '         bundling: socket-packageurl-js and socket-sdk-js ship zero runtime',
      '         deps and bundle their upstreams into dist/**, so an upstream bump',
      '         owes a downstream RELEASE, not just a catalog pin. The bundling',
      '         logic lives in code, not in the map you are reading.',
      `  Where: ${repoDir} — the fleet release surface.`,
      `  Saw:   ${reason}.`,
      '  Fix:   run the SMART scripts that account for bundling, never the raw graph:',
      '           node scripts/fleet/socket-lib-cascade.mts --status',
      '           node scripts/fleet/check/cascade-followups-are-settled.mts',
      '         Both stand on computeOwedFollowUps + findUndeclaredBundledEdges in',
      '         scripts/fleet/lib/release-cascade.mts — the obligation answer comes',
      '         from RUNNING that code, not from reading the graph literal.',
    ].join('\n') + '\n'
  )
}

export const check = bashGuard(command => {
  // CI runs the checks through its own workflow — no interactive agent to gate.
  if (isCiEnv(process.env)) {
    return undefined
  }
  const decision = decideCascadeGraphGuard(command)
  if (!decision.blocked) {
    return undefined
  }
  return block(formatBlock(decision, extractGitCwd(command)))
})

export const hook = defineHook({
  bypass: ['cascade-graph-inspect'],
  check,
  event: 'PreToolUse',
  matcher: ['Bash'],
  scope: 'convention',
  triggers,
  type: 'guard',
})
void runHook(hook, import.meta.url)
