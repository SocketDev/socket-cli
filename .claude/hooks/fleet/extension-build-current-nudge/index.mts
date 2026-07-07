#!/usr/bin/env node
// Claude Code PostToolUse hook — extension-build-current-nudge.
//
// renamed-from: extension-build-current-guard
//
// Fires after Edit/Write operations. When the edited path is under
// `tools/trusted-publisher-extension/src/`, the hook runs
// `pnpm --filter @socketsecurity/trusted-publisher-extension build`
// in the background to keep dist/ in sync with src/.
//
// The hook is FIRE-AND-FORGET — it never blocks (PostToolUse can't
// reject the prior tool call anyway). Its purpose is to ensure
// local Chrome loads of the unpacked extension always see the
// latest src/ behavior without the operator having to remember to
// run the build manually.
//
// Build failures are surfaced to stderr so the operator sees them,
// but the hook still exits 0.

import { existsSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { actedOnPath } from '../_shared/fleet-context.mts'
import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

const EXTENSION_SRC_PREFIX = 'tools/trusted-publisher-extension/src/'
const EXTENSION_FILTER = '@socketsecurity/trusted-publisher-extension'

/**
 * Returns true when filePath is under the extension's src/ tree.
 */
export function isExtensionSrcPath(filePath: string): boolean {
  return filePath.includes(EXTENSION_SRC_PREFIX)
}

/**
 * Walks up from `start` looking for a directory that contains both
 * `package.json` AND `tools/trusted-publisher-extension/`. Returns the path or
 * undefined.
 */
export function findRepoRoot(start: string): string | undefined {
  let cur = start
  for (let i = 0; i < 10; i++) {
    if (
      existsSync(path.join(cur, 'package.json')) &&
      existsSync(path.join(cur, 'tools', 'trusted-publisher-extension'))
    ) {
      return cur
    }
    const parent = path.dirname(cur)
    if (parent === cur) {
      return undefined
    }
    cur = parent
  }
  /* c8 ignore next */
  return undefined
}

export const check = editGuard((filePath, _content, payload) => {
  if (!isExtensionSrcPath(filePath)) {
    return undefined
  }
  // Build the repo the EDITED FILE lives in — an extension-src edit in a
  // non-session checkout must rebuild that checkout, not the session repo
  // (actedOnPath resolves the file's directory first).
  const repoRoot = findRepoRoot(actedOnPath(payload))
  if (!repoRoot) {
    return undefined
  }
  // Run build synchronously so the operator sees the result before
  // they reach for Chrome's reload button. Rolldown finishes in
  // ~15ms for this extension; no real cost.
  const r = spawnSync('pnpm', ['--filter', EXTENSION_FILTER, 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    /* c8 ignore start - encoding:'utf8' guarantees strings; non-string arms are unreachable in practice */
    const output = `${typeof r.stdout === 'string' ? r.stdout : ''}${typeof r.stderr === 'string' ? r.stderr : ''}`
    /* c8 ignore stop */
    const lines = [
      '[extension-build-current-nudge] Build failed after src/ edit.',
      '',
      '  Output tail:',
      ...output
        .split('\n')
        .slice(-10)
        .map(l => `    ${l}`),
      '',
      '  Fix the error then re-run:',
      `    pnpm --filter ${EXTENSION_FILTER} build`,
    ]
    // Still notify (never block) — PostToolUse hooks can't reject the prior
    // call, and we don't want to confuse the operator with a non-zero exit
    // that has no actionable effect.
    return notify(lines.join('\n'))
  }
  return undefined
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Edit', 'Write'],
  scope: 'convention',
  type: 'nudge',
})
void runHook(hook, import.meta.url)
