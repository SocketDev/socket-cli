#!/usr/bin/env node
/**
 * @file Regenerate the `lockstep-mirrors` block in
 *   `.config/fleet/.prettierignore` from the lockstep manifest. A verbatim
 *   upstream mirror (`file-fork` row with `mirror: true`) is kept
 *   byte-identical with its upstream source, so oxfmt must skip it — but a
 *   blanket ignore of the whole `conformance/shims` dir would also skip the
 *   non-verbatim adapter shims that SHOULD be formatted. This deriver emits the
 *   EXACT declared mirror paths, each `**`-anchored, into a fenced,
 *   machine-owned block; `check/lockstep-mirror-markers-are-declared.mts`
 *   asserts the block matches, so the format-skip set stays manifest-tied. Run
 *   via `pnpm run lockstep:emit-mirror-globs`. Idempotent. Usage: node
 *   scripts/fleet/lockstep/emit-mirror-globs.mts.
 */

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { resolveManifestRoot } from './manifest.mts'
import {
  collectDeclaredMirrors,
  derivedMirrorGlobs,
  spliceMirrorBlock,
} from './mirror-globs.mts'
import { CONFIG_FLEET_DIR, REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

const logger = getDefaultLogger()

const PRETTIERIGNORE_PATH = path.join(CONFIG_FLEET_DIR, '.prettierignore')

export function main(): void {
  if (!existsSync(PRETTIERIGNORE_PATH)) {
    // No fleet .prettierignore (a non-fleet repo) — nothing to emit.
    return
  }
  const mirrors = collectDeclaredMirrors(resolveManifestRoot(REPO_ROOT))
  const globs = derivedMirrorGlobs(mirrors)
  const before = readFileSync(PRETTIERIGNORE_PATH, 'utf8')
  const after = spliceMirrorBlock(before, globs)
  if (after !== before) {
    writeFileSync(PRETTIERIGNORE_PATH, after, 'utf8')
    logger.success(
      `wrote ${globs.length} lockstep-mirror glob${globs.length === 1 ? '' : 's'} to ${path.relative(REPO_ROOT, PRETTIERIGNORE_PATH)}`,
    )
    return
  }
  logger.log(
    `${path.relative(REPO_ROOT, PRETTIERIGNORE_PATH)} lockstep-mirrors block already current (${globs.length} entr${globs.length === 1 ? 'y' : 'ies'}).`,
  )
}

if (isMainModule(import.meta.url)) {
  main()
}
