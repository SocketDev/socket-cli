#!/usr/bin/env node
/*
 * @file `check --all` gate: the repo's `.config/repo/external-tools.json`
 *   shared-tool entries match the wheelhouse copy.
 *
 *   external-tools.json is per-repo owned, but fleet tooling reads it —
 *   `scripts/fleet/install-sfw.mts` resolves the sfw pin from it and the
 *   `path-tools-are-at-pinned-version` gate reads its version floors — so the
 *   CODE and its DATA drift independently. 2026-07-08: five repos failed CI on
 *   stale copies (sfw entries missing `binaryName`, sha256-era integrity where
 *   the installer expects sha512 SRI, years-old pnpm pins), and three more
 *   were missing the file entirely. The composite actions read the ONE fleet
 *   registry at `scripts/fleet/setup/external-tools.json`, not this per-repo
 *   file, but the local install/check surface still reads this one, so the
 *   fleet setup action's presence remains the "this is a fleet member" signal
 *   that makes a missing file fail loud.
 *
 *   The gate compares each SHARED tool entry (a tool name that also exists in
 *   the wheelhouse copy) deep-equal against the wheelhouse value. Repo-specific
 *   tools, keys absent from the wheelhouse copy, are untouched — sdxgen's
 *   language toolchains stay repo-owned. A copy still at the LEGACY repo-root
 *   location fails with a move instruction (the sync-scaffolding cascade and
 *   the bundle installer both perform that move automatically).
 *
 *   Resolution order for the reference copy: a sibling `socket-wheelhouse`
 *   checkout, else the wheelhouse's own copy when running IN the wheelhouse
 *   the gate self-passes there. No network: when no reference copy is
 *   findable (CI of a member repo), the gate SKIPS explicitly — cross-repo
 *   state is a local-dev/cascade concern, and CI must not depend on a sibling
 *   checkout.
 *
 *   Fix: copy the wheelhouse file verbatim when the repo has no repo-specific
 *   tools; otherwise update just the drifted shared entries.
 *
 *   Usage: node scripts/fleet/check/external-tools-match-wheelhouse.mts [--quiet]
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const TOOLS_FILE = '.config/repo/external-tools.json'
// The pre-move location. A copy still here is a stale layout, not a valid
// alternate home — fail with a move instruction until the fleet sweep lands.
const LEGACY_TOOLS_FILE = 'external-tools.json'
const SETUP_ACTION = '.github/actions/fleet/setup-and-install/action.yml'

export interface ExternalToolsDoc {
  readonly tools?: Record<string, unknown> | undefined
}

/**
 * Parse an external-tools.json content string to its tools map. Returns
 * undefined for unreadable/format-alien content (pre-container-format copies
 * count as fully drifted, which the caller reports).
 */
export function parseTools(
  content: string,
): Record<string, unknown> | undefined {
  try {
    const doc = JSON.parse(content) as ExternalToolsDoc
    return doc.tools && typeof doc.tools === 'object' ? doc.tools : undefined
  } catch {
    return undefined
  }
}

/**
 * Diff a member's tools map against the wheelhouse reference. Only SHARED
 * keys, present in both, are compared; repo-specific tools pass untouched.
 * Returns the drifted shared tool names.
 */
export function driftedSharedTools(
  memberTools: Record<string, unknown>,
  wheelhouseTools: Record<string, unknown>,
): string[] {
  const drifted: string[] = []
  const names = Object.keys(wheelhouseTools).toSorted()
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (!(name in memberTools)) {
      continue
    }
    const a = JSON.stringify(memberTools[name])
    const b = JSON.stringify(wheelhouseTools[name])
    if (a !== b) {
      drifted.push(name)
    }
  }
  return drifted
}

/**
 * Locate the wheelhouse reference copy: the current repo when it IS the
 * wheelhouse, else a `socket-wheelhouse` sibling checkout. Returns undefined
 * when neither exists (CI of a member repo — the gate skips).
 */
export function findReferenceCopy(repoRoot: string): string | undefined {
  const own = path.join(repoRoot, 'template', 'base')
  if (
    existsSync(path.join(own, TOOLS_FILE)) ||
    existsSync(path.join(repoRoot, 'template'))
  ) {
    const self = path.join(repoRoot, TOOLS_FILE)
    return existsSync(self) ? self : undefined
  }
  const sibling = path.join(
    path.dirname(repoRoot),
    'socket-wheelhouse',
    TOOLS_FILE,
  )
  return existsSync(sibling) ? sibling : undefined
}

/**
 * A copy still at the legacy repo-root location, when the canonical
 * `.config/repo/` path is empty. Returns the legacy absolute path, or
 * undefined when the repo is already on the canonical layout (or has no copy
 * at all).
 */
export function findLegacyCopy(repoRoot: string): string | undefined {
  if (existsSync(path.join(repoRoot, TOOLS_FILE))) {
    return undefined
  }
  const legacy = path.join(repoRoot, LEGACY_TOOLS_FILE)
  return existsSync(legacy) ? legacy : undefined
}

function main(): number {
  const quiet = process.argv.includes('--quiet')
  const memberPath = path.join(REPO_ROOT, TOOLS_FILE)
  const setupActionPresent = existsSync(path.join(REPO_ROOT, SETUP_ACTION))

  const refPath = findReferenceCopy(REPO_ROOT)
  if (!refPath) {
    if (!quiet) {
      logger.log(
        '[external-tools-match-wheelhouse] skipped — no wheelhouse reference copy findable (CI / no sibling checkout).',
      )
    }
    return 0
  }

  const legacyPath = findLegacyCopy(REPO_ROOT)
  if (legacyPath) {
    logger.fail(
      `[external-tools-match-wheelhouse] ${LEGACY_TOOLS_FILE} sits at the LEGACY repo-root location — the canonical home is ${TOOLS_FILE}.\n` +
        `  Fix: git mv ${LEGACY_TOOLS_FILE} ${TOOLS_FILE}\n` +
        `  The sync-scaffolding cascade and the fleet bundle installer both perform this move automatically on their next pass.`,
    )
    process.exitCode = 1
    return 1
  }

  if (!existsSync(memberPath)) {
    if (!setupActionPresent) {
      if (!quiet) {
        logger.log(
          '[external-tools-match-wheelhouse] no external-tools.json and no fleet setup action — nothing to check.',
        )
      }
      return 0
    }
    logger.fail(
      `[external-tools-match-wheelhouse] ${TOOLS_FILE} is MISSING but this repo carries the fleet setup action — the local install/check surface (install-sfw, path-tools-are-at-pinned-version) reads it.\n` +
        `  Fix: copy it from the wheelhouse (verbatim when this repo has no repo-specific tools):\n` +
        `    cp ${refPath} ${memberPath}`,
    )
    process.exitCode = 1
    return 1
  }

  if (path.resolve(refPath) === path.resolve(memberPath)) {
    if (!quiet) {
      logger.success(
        '[external-tools-match-wheelhouse] this repo is the reference copy.',
      )
    }
    return 0
  }

  const memberTools = parseTools(readFileSync(memberPath, 'utf8'))
  const refTools = parseTools(readFileSync(refPath, 'utf8'))
  if (!refTools) {
    logger.warn(
      '[external-tools-match-wheelhouse] wheelhouse reference copy unreadable — skipping.',
    )
    return 0
  }
  if (!memberTools) {
    logger.fail(
      `[external-tools-match-wheelhouse] ${TOOLS_FILE} has no \`tools\` container — a pre-container-format copy the fleet setup actions cannot read.\n` +
        `  Fix: copy the wheelhouse file (verbatim when this repo has no repo-specific tools):\n` +
        `    cp ${refPath} ${memberPath}`,
    )
    process.exitCode = 1
    return 1
  }

  const drifted = driftedSharedTools(memberTools, refTools)
  if (drifted.length) {
    logger.fail(
      `[external-tools-match-wheelhouse] ${drifted.length} shared tool entr(ies) drift from the wheelhouse copy: ${drifted.join(', ')}.\n` +
        `  The cascade-owned setup actions read this data; a stale entry breaks CI setup (missing binaryName, old integrity format).\n` +
        `  Fix: update the drifted entries from ${refPath} (verbatim copy when this repo has no repo-specific tools).`,
    )
    process.exitCode = 1
    return 1
  }

  if (!quiet) {
    logger.success(
      '[external-tools-match-wheelhouse] every shared tool entry matches the wheelhouse copy.',
    )
  }
  return 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'verifies the repo external-tools.json shared tool entries match the wheelhouse copy',
  help: `Usage: node scripts/fleet/check/external-tools-match-wheelhouse.mts [flags]

  --quiet  suppress the success and skip messages`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
