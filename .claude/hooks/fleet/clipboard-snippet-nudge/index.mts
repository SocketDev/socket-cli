#!/usr/bin/env node
// Claude Code PostToolUse(Write) hook — clipboard-snippet-nudge.
//
// When a run/paste snippet (a script the USER is meant to run: .sh/.bash/.zsh/
// .js/.mjs/.cjs/.mts/.ts/.py) is written into the session scratchpad on macOS,
// nudge to `pbcopy < <file>` so the snippet lands on the clipboard instead of
// making the user copy it out of the scrolling terminal.
//
// Clipboard WRITES are the sanctioned pattern here; clipboard/keychain READS
// stay banned (token-hygiene). PostToolUse, notify only — never blocks, always
// exits 0. macOS-only (pbcopy is a macOS binary). No bypass phrase.

import path from 'node:path'
import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { defineHook, editGuard, notify, runHook } from '../_shared/guard.mts'

// Extensions that read as a user-run/paste snippet (a shell or script file),
// as opposed to data/config the user would never paste into a terminal.
const SNIPPET_EXTS: ReadonlySet<string> = new Set([
  '.bash',
  '.cjs',
  '.js',
  '.mjs',
  '.mts',
  '.py',
  '.sh',
  '.ts',
  '.zsh',
])

/**
 * True when `filePath` is a snippet written into the session scratchpad — a
 * path under a `/scratchpad/` dir or the per-session claude temp dir
 * (`/tmp/claude-<uid>/…`). Pure + exported so the detection is unit-testable
 * without a hook payload or a real macOS host.
 */
export function isScratchpadSnippet(filePath: string): boolean {
  const p = normalizePath(filePath)
  const inScratch = p.includes('/scratchpad/') || /\/claude-[^/]+\//.test(p)
  return inScratch && SNIPPET_EXTS.has(path.extname(p))
}

export const check = editGuard(filePath => {
  // pbcopy is macOS-only; the nudge is meaningless elsewhere.
  if (process.platform !== 'darwin' || !isScratchpadSnippet(filePath)) {
    return undefined
  }
  return notify(
    `[clipboard-snippet-nudge] ${path.basename(filePath)} looks like a run/paste snippet — ` +
      `\`pbcopy < ${filePath}\` puts it on the user's clipboard so they don't copy it out of the scrolling terminal.`,
  )
})

export const hook = defineHook({
  check,
  event: 'PostToolUse',
  matcher: ['Write'],
  type: 'nudge',
})

void runHook(hook, import.meta.url)
