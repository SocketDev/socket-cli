/*
 * @file The dated BURN-DOWN allowlist for
 *   `scripts/fleet/check/prose-em-dashes-are-absent.mts`, loaded from the
 *   sibling `prose-em-dash-burn-down.json`.
 *
 *   The rule tightened on 2026-08-05 from "no em-dash chains" to "no em-dash
 *   at all": a single U+2014 in outbound prose reads as an agent tell, so the
 *   gate flags every one. The corpus was not clean when the gate landed, so
 *   every file carrying the backlog is listed by PATH with the date it entered
 *   the burn-down.
 *
 *   THIS LIST ONLY EVER SHRINKS, AND IT SHRINKS TO EMPTY. An entry is a debt,
 *   not an exemption: once a file's em-dashes are rewritten, that file's line
 *   comes out of the JSON in the same commit. Nothing is ever added. A listed
 *   file that scans clean is reported by the gate as a STALE entry so the line
 *   comes out. Once the last line is gone, this module, the JSON, and the
 *   import in the check all retire together.
 *
 *   Why a path allowlist rather than a rule-disable: a disable turns the gate
 *   off for everyone forever and leaves no record of what is owed. A dated
 *   path list keeps the gate ON for every file NOT listed, so nothing new can
 *   land, and it names the exact remaining work.
 *
 *   Keys are repo-relative, forward-slash paths, sorted. Values are the ISO
 *   date the path entered the burn-down. The list is fleet-wide, so it carries
 *   both the wheelhouse's `template/base/...` authoring paths and the live
 *   paths a cascaded member sees; a key that names nothing in the current repo
 *   is inert and is never reported as stale.
 */

import { readFileSync } from 'node:fs'
import path from 'node:path'

const BURN_DOWN_FILE = path.join(
  import.meta.dirname,
  'prose-em-dash-burn-down.json',
)

interface BurnDownFile {
  readonly files: Readonly<Record<string, string>>
}

function loadBurnDown(): Readonly<Record<string, string>> {
  try {
    const parsed = JSON.parse(
      readFileSync(BURN_DOWN_FILE, 'utf8'),
    ) as BurnDownFile
    return parsed.files ?? {}
  } catch {
    // A missing or malformed list must never turn the gate off silently. An
    // empty map means every file gates, which fails loud on the real backlog
    // instead of quietly passing it.
    return {}
  }
}

export const PROSE_EM_DASH_BURN_DOWN: Readonly<Record<string, string>> =
  loadBurnDown()

/**
 * True when `relPath` is still owed a rewrite, so its em-dash findings are
 * suppressed. `relPath` must already be a forward-slash, repo-relative path.
 */
export function isBurnedDown(relPath: string): boolean {
  return Object.hasOwn(PROSE_EM_DASH_BURN_DOWN, relPath)
}

/**
 * Every burn-down path, sorted. The gate prints the count so the remaining
 * debt is visible on a green run.
 */
export function burnDownPaths(): string[] {
  return Object.keys(PROSE_EM_DASH_BURN_DOWN).toSorted()
}
