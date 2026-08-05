#!/usr/bin/env node
/*
 * @file `check --all` gate: every human-gate lane A hands the operator
 *   something they can paste and run as-is.
 *
 *   Two defects this catches, both observed in real gates:
 *
 *   1. A lane that tells the operator to run a command in their own terminal.
 *      The `!` prefix runs it in THIS session instead, so the output lands in
 *      the conversation and the agent can read the result rather than asking
 *      what happened. A gate whose command runs out of band strands the agent.
 *
 *   2. A lane that assumes a working directory. `run \`cd <path> && <cmd>\``
 *      breaks the moment the operator pastes it somewhere else, and it is the
 *      shape an operator has to edit before running. Prefer the flag that
 *      removes the assumption, such as `gh --repo <owner>/<name>`; when a
 *      script needs its root, name the absolute path beside the command rather
 *      than prefixing a `cd`.
 *
 *   Scope: the `humanLane` string literals in
 *   `scripts/fleet/_shared/human-gate.mts`, the fleet composer every scripted
 *   gate builds from. A phrase-only lane (`type exactly: …`) is exempt: an
 *   authorization phrase is typed, never run.
 *
 *   Usage: node scripts/fleet/check/human-gate-lanes-are-runnable.mts [--quiet]
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const COMPOSER_REL = 'scripts/fleet/_shared/human-gate.mts'

/**
 * A lane that types a phrase rather than running a command. An authorization
 * phrase is typed verbatim by the human, so the `!` rule does not apply. Pure.
 */
export function isPhraseLane(lane: string): boolean {
  return /\btype exactly\b/.test(lane)
}

/**
 * Every defect in one `humanLane` value. Empty when the lane is well formed.
 * Pure over its input.
 */
export function laneDefects(lane: string): string[] {
  if (isPhraseLane(lane)) {
    return []
  }
  const out: string[] = []
  // A bare `cd` inside the pasted command is the directory assumption.
  if (/`\s*cd\s/.test(lane)) {
    out.push(
      'embeds a `cd` in the pasted command — use a flag that removes the directory assumption, or name the absolute path beside it',
    )
  }
  // A command-shaped lane must route through the session.
  const hasCommand = lane.includes('`')
  if (hasCommand && !lane.includes('! ')) {
    out.push(
      'runs a command without the `!` prefix — `! <cmd>` runs it in this session so its output is readable',
    )
  }
  if (/\bin your (?:own )?terminal\b/.test(lane)) {
    out.push(
      'sends the operator to their own terminal — the output never reaches the session',
    )
  }
  return out
}

/**
 * Each `humanLane:` literal in `source`, with its 1-based line. Pure.
 */
export function collectLanes(
  source: string,
): Array<{ lane: string; line: number }> {
  const out: Array<{ lane: string; line: number }> = []
  const lines = source.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    if (!raw.includes('humanLane:')) {
      continue
    }
    // A lane may wrap, so join forward until the template literal closes.
    let lane = raw
    let j = i
    while (j + 1 < length && (lane.match(/`/g) ?? []).length % 2 === 1) {
      j += 1
      lane += `\n${lines[j]!}`
    }
    out.push({ lane, line: i + 1 })
  }
  return out
}

/**
 * Every lane defect across the composer, as `path:line — defect` strings.
 */
export function findLaneDefects(repoRoot: string): string[] {
  let source: string
  try {
    source = readFileSync(path.join(repoRoot, COMPOSER_REL), 'utf8')
  } catch {
    // A member without the composer has no lanes to gate.
    return []
  }
  const out: string[] = []
  const lanes = collectLanes(source)
  for (let i = 0, { length } = lanes; i < length; i += 1) {
    const entry = lanes[i]!
    const defects = laneDefects(entry.lane)
    for (let j = 0, { length: dlen } = defects; j < dlen; j += 1) {
      out.push(`${COMPOSER_REL}:${entry.line} — ${defects[j]!}`)
    }
  }
  return out.toSorted()
}

function main(): number {
  const offenders = findLaneDefects(REPO_ROOT)
  if (offenders.length) {
    logger.fail(
      '[human-gate-lanes-are-runnable] a human-gate lane A is not paste-and-run:',
    )
    for (let i = 0, { length } = offenders; i < length; i += 1) {
      logger.error(`  ✗ ${offenders[i]!}`)
    }
    logger.error(
      '  Where: the humanLane literals in scripts/fleet/_shared/human-gate.mts.',
    )
    logger.error(
      '  Saw: a lane the operator must edit or run out of band; wanted a single',
    )
    logger.error('  pasteable `! <command>` that needs no working directory.')
    logger.error(
      '  Fix: docs/agents.md/fleet/human-gates.md, "Lane A runs from',
    )
    logger.error('  anywhere".')
    process.exitCode = 1
    return 1
  }
  if (!process.argv.includes('--quiet')) {
    logger.success(
      '[human-gate-lanes-are-runnable] every gate lane is paste-and-run.',
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies every human-gate lane hands the operator a paste-and-run command',
  help: `Usage: node scripts/fleet/check/human-gate-lanes-are-runnable.mts [flags]

  --quiet  suppress the success message`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
