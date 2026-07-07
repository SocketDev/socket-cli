#!/usr/bin/env node
// Claude Code PostToolUse hook — extension-build-current-reminder.
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

import { readStdin } from '../_shared/transcript.mts'

interface PostToolUsePayload {
  readonly tool_name?: string | undefined
  readonly tool_input?: { readonly file_path?: unknown | undefined } | undefined
  readonly cwd?: string | undefined
}

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
  return undefined
}

async function main(): Promise<void> {
  let payload: PostToolUsePayload
  try {
    const raw = await readStdin()
    payload = JSON.parse(raw) as PostToolUsePayload
  } catch {
    process.exit(0)
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    process.exit(0)
  }
  const filePath =
    typeof payload.tool_input?.file_path === 'string'
      ? payload.tool_input.file_path
      : ''
  if (!filePath || !isExtensionSrcPath(filePath)) {
    process.exit(0)
  }
  const cwd = typeof payload.cwd === 'string' ? payload.cwd : process.cwd()
  const repoRoot = findRepoRoot(cwd)
  if (!repoRoot) {
    process.exit(0)
  }
  // Run build synchronously so the operator sees the result before
  // they reach for Chrome's reload button. Rolldown finishes in
  // ~15ms for this extension; no real cost.
  const r = spawnSync('pnpm', ['--filter', EXTENSION_FILTER, 'build'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })
  if (r.status !== 0) {
    const output = `${typeof r.stdout === 'string' ? r.stdout : ''}${typeof r.stderr === 'string' ? r.stderr : ''}`
    const lines = [
      '[extension-build-current-reminder] Build failed after src/ edit.',
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
    process.stderr.write(lines.join('\n') + '\n')
    // Still exit 0 — PostToolUse hooks can't reject the prior call,
    // and we don't want to confuse the operator with a non-zero
    // exit that has no actionable effect.
    process.exit(0)
  }
  process.exit(0)
}

main().catch(() => {
  process.exit(0)
})
