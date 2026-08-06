#!/usr/bin/env node
/*
 * @file `check --all` gate: on a THIN member, every workflow step that runs a
 *   fleet install/checkout composite also passes the payload-token inputs, so
 *   the bundle download during `pnpm install` has a credential.
 *
 *   A thin member's fleet payload is untracked and fetched from a release in
 *   the wheelhouse, which is PRIVATE. A workflow's own `GITHUB_TOKEN` is
 *   scoped to its repo, so it cannot read that release; the GHCR mirror is not
 *   published either, so the anonymous pull has nothing to fall back to. The
 *   composite mints a read-only token from a GitHub App instead — but only
 *   when the caller passes `payload-token-client-id`. Omit it and the mint is
 *   skipped, the download 404s, and install dies before a single test runs.
 *
 *   This is not hypothetical. ultrathink went thin on 2026-08-03; only
 *   `npm-publish.yml` passed the inputs, so its CI went red on the next push
 *   and stayed red for every run after — nine workflows' worth of failures
 *   whose logs all read `fleet payload hydration failed`, one missing input
 *   apiece. The failure mode is nasty because it is invisible in a fat member
 *   and in the wheelhouse: both have the payload committed, so the fetch is a
 *   no-op and the missing input costs nothing until the day the member goes
 *   thin.
 *
 *   Scope: thin members only, keyed on a committed `bundle.ref`. The wheelhouse
 *   (the producer) and every fat member pass vacuously, which is correct — the
 *   input is inert for them. Wiring it anyway is still the recommended shape,
 *   since it makes going thin a config change rather than a workflow edit.
 *
 *   Exit: 0 — clean, or not a thin member; 1 — a thin member has a fleet
 *   install/checkout step with no payload-token input.
 *
 *   Usage: node scripts/fleet/check/thin-workflow-payloads-are-fetchable.mts [--quiet]
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

// The composites whose install path can reach the bundle fetch. `checkout`
// hydrates immediately after checking out, ahead of every other reader;
// `setup-and-install` forwards to it and then installs.
export const PAYLOAD_FETCHING_COMPOSITES: readonly string[] = [
  './.github/actions/fleet/checkout',
  './.github/actions/fleet/setup-and-install',
]

// Passing the client id alone proves the wiring: the composite only consumes
// the private key when the id is set, so an id with no key is already a
// same-file mistake the reader can see.
export const PAYLOAD_TOKEN_INPUT = 'payload-token-client-id'

/**
 * One workflow step that reaches the payload fetch without a token input.
 */
export interface UnwiredStep {
  readonly composite: string
  readonly line: number
  readonly workflow: string
}

// CRLF-safe: a workflow authored on Windows would otherwise carry a trailing
// \r into every indent and token comparison below.
function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

function indentWidth(line: string): number {
  let i = 0
  while (i < line.length && line[i] === ' ') {
    i += 1
  }
  return i
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim()
  return trimmed === '' || trimmed.startsWith('#')
}

/**
 * The steps in one workflow that invoke a payload-fetching composite without
 * passing {@link PAYLOAD_TOKEN_INPUT}. Pure — text in, findings out.
 *
 * A step's extent is found by scanning forward from its `uses:` line to the
 * next line that starts a sibling list item or dedents out of the step. That
 * span is what gets searched, so a token input belonging to a LATER step never
 * counts as this one's.
 */
export function findUnwiredSteps(
  text: string,
  workflow: string,
): UnwiredStep[] {
  const lines = splitLines(text)
  const out: UnwiredStep[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    // Two shapes reach the same step. `- uses: X` puts the composite on the
    // list item itself; `- name: …` + `uses: X` puts it on a child key. They
    // need DIFFERENT end conditions, and conflating them is a false positive
    // waiting to happen: a child `uses:` has siblings (`with:`) at its own
    // indent, so ending the step at the first equal-indent line stops before
    // the `with:` block that holds the answer.
    // group 1 = leading spaces (the indent), group 2 = the composite path.
    // `-\s+` is what distinguishes the list-item form from the child-key one.
    const dashed = /^(\s*)-\s+uses:\s*(\S+)/u.exec(line)
    // Same two groups, no dash: `uses:` as a child key of a `- name:` step.
    const plain = /^(\s*)uses:\s*(\S+)/u.exec(line)
    const match = dashed ?? plain
    if (!match) {
      continue
    }
    const composite = match[2]!.replace(/['"]/gu, '')
    if (!PAYLOAD_FETCHING_COMPOSITES.includes(composite)) {
      continue
    }
    // The indent a line must go BELOW to leave this step: the list-item indent
    // for a dashed step, the key indent for a child one.
    const exitIndent = dashed ? match[1]!.length + 1 : match[1]!.length
    let wired = false
    for (let j = i + 1; j < length; j += 1) {
      const next = lines[j]!
      if (isBlankOrComment(next)) {
        continue
      }
      if (indentWidth(next) < exitIndent) {
        break
      }
      // A sibling list item at the step's own level starts the NEXT step.
      if (dashed && /^\s*-\s/u.test(next) && indentWidth(next) <= exitIndent) {
        break
      }
      if (next.includes(PAYLOAD_TOKEN_INPUT)) {
        wired = true
        break
      }
    }
    if (!wired) {
      out.push({ composite, line: i + 1, workflow })
    }
  }
  return out
}

/**
 * True when this repo consumes a fleet release bundle, i.e. its committed
 * config pins `bundle.ref`. A repo with no pin produces the payload or carries
 * it committed, so no workflow of its needs a fetch credential.
 */
export function isThinMember(repoRoot: string): boolean {
  const configPath = path.join(
    repoRoot,
    '.config',
    'repo',
    'socket-wheelhouse.json',
  )
  if (!existsSync(configPath)) {
    return false
  }
  try {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8'))
    const ref = parsed?.bundle?.ref
    return typeof ref === 'string' && ref.length > 0
  } catch {
    // A config we cannot read is not evidence of thinness; the config's own
    // schema check owns that failure.
    return false
  }
}

function listWorkflows(repoRoot: string): string[] {
  const dir = path.join(repoRoot, '.github', 'workflows')
  try {
    return readdirSync(dir)
      .filter(name => name.endsWith('.yml') || name.endsWith('.yaml'))
      .map(name => path.join(dir, name))
      .toSorted()
  } catch {
    return []
  }
}

export function main(): number {
  const quiet = process.argv.includes('--quiet')
  if (!isThinMember(REPO_ROOT)) {
    if (!quiet) {
      logger.success(
        '[thin-workflow-payloads-are-fetchable] not a thin member (no bundle.ref) — the payload fetch is a no-op here.',
      )
    }
    return 0
  }
  const workflows = listWorkflows(REPO_ROOT)
  const unwired: UnwiredStep[] = []
  for (let i = 0, { length } = workflows; i < length; i += 1) {
    const file = workflows[i]!
    let text
    try {
      text = readFileSync(file, 'utf8')
    } catch {
      continue
    }
    unwired.push(...findUnwiredSteps(text, path.basename(file)))
  }
  if (unwired.length) {
    logger.fail(
      '[thin-workflow-payloads-are-fetchable] a thin member has workflow step(s) that cannot authenticate the bundle fetch:',
    )
    logger.error(
      `  What:   ${unwired.length} fleet install/checkout step(s) omit \`${PAYLOAD_TOKEN_INPUT}\`, so the App mint is skipped and the private release download 404s during install.`,
    )
    logger.error('  Where:  the workflow + line below.')
    logger.error('  Saw:    wanted every step wired, saw unwired:')
    for (let i = 0, { length } = unwired; i < length; i += 1) {
      const step = unwired[i]!
      logger.error(`    x ${step.workflow}:${step.line}  ${step.composite}`)
    }
    logger.error(
      "  Fix:    add both inputs to each step's `with:` block — they are inert until the member provisions the App:",
    )
    logger.error(
      '            payload-token-client-id: ${{ vars.SOCKET_PAYLOAD_CLIENT_ID }}',
    )
    logger.error(
      '            payload-token-private-key: ${{ secrets.SOCKET_PAYLOAD_APP_PRIVATE_KEY }}',
    )
    return 1
  }
  if (!quiet) {
    logger.success(
      `[thin-workflow-payloads-are-fetchable] all fleet install/checkout steps across ${workflows.length} workflow(s) can mint a payload token.`,
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'thin member: every fleet install/checkout workflow step can mint a payload token',
  help: `Usage: node scripts/fleet/check/thin-workflow-payloads-are-fetchable.mts`,
}

/* c8 ignore start - entry-point wiring, exercised by running the script. */
if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
/* c8 ignore stop */
