#!/usr/bin/env node
// Claude Code PreToolUse hook — module-noun-name-guard.
//
// Blocks creating a new `src/` module file whose name is a verb-phrase
// (an ACTION), e.g. `trim-publish-manifest.ts`, `create-release.ts`,
// `generate-notes.ts`, `fetch-packument.ts`.
//
// Fleet/socket-lib convention: a module is a concise NOUN that names a
// DOMAIN and groups the related functions for it — `manifest.ts`,
// `exports.ts`, `tarball.ts`, `normalize.ts`. The trim/create/fetch
// helpers live INSIDE the relevant noun module (trimPublishManifest +
// createPackageJson both sit in `manifest.ts`), reachable through that
// module's single `exports` entry. We do NOT do one-method-per-file, and
// we do NOT name a file after the verb phrase of the one function it holds.
//
// Why: verb-phrase filenames fragment a domain across a dozen tiny files,
// multiply the hand-maintained `exports` map, and bury the noun a reader
// is actually looking for. Grouping by noun keeps the public surface small
// and the related code co-located.
//
// The check is filename-only and fires on CREATION (Write of a new path)
// so it never disturbs files that predate the rule. Single-word names are
// always allowed (a one-word verb like `normalize` reads as the domain);
// only a multi-segment kebab phrase LED BY an action verb is blocked.
//
// Exit code 2 makes Claude Code refuse the tool call.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Write",
//     "tool_input": { "file_path": "...", "content": "..." } }
//
// Fails open on hook bugs (exit 0 + stderr log).

import { existsSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow module-noun-name bypass'

// Leading action verbs that mark a filename as an ACTION rather than a
// domain noun. Deliberately excludes predicate prefixes (is/has/can/should)
// and stand-alone single-word names — those are handled by the
// single-segment carve-out, so `normalize.ts` / `validate.ts` stay legal.
const ACTION_VERBS: ReadonlySet<string> = new Set([
  'add',
  'apply',
  'build',
  'bump',
  'calculate',
  'check',
  'clean',
  'clear',
  'collect',
  'compile',
  'compute',
  'convert',
  'copy',
  'create',
  'delete',
  'detect',
  'download',
  'ensure',
  'extract',
  'fetch',
  'filter',
  'find',
  'fix',
  'format',
  'gather',
  'generate',
  'get',
  'handle',
  'init',
  'initialize',
  'install',
  'load',
  'make',
  'merge',
  'parse',
  'print',
  'process',
  'read',
  'remove',
  'render',
  'resolve',
  'run',
  'save',
  'scan',
  'send',
  'set',
  'sort',
  'split',
  'strip',
  'sync',
  'trim',
  'update',
  'upload',
  'validate',
  'verify',
  'write',
])

// Basenames (without extension) that are structural, not domain modules.
const EXEMPT_STEMS: ReadonlySet<string> = new Set([
  'constants',
  'index',
  'primordials',
  'types',
])

export type Verdict = {
  ok: boolean
  message?: string | undefined
  suggestion?: string | undefined
}

export function classifyModulePath(absPath: string): Verdict {
  const normalized = normalizePath(absPath)
  const filename = path.basename(normalized)

  // Source modules only: TypeScript under a `src/` segment.
  if (!/\.(?:mts|ts)$/.test(filename) || filename.endsWith('.d.ts')) {
    return { ok: true }
  }
  const segments = normalized.split('/')
  if (!segments.includes('src')) {
    return { ok: true }
  }
  // Tests own their own naming (`<module>.test.mts`); never govern them.
  if (segments.includes('test') || segments.includes('__tests__')) {
    return { ok: true }
  }

  const stem = filename.replace(/\.(?:mts|ts)$/, '')
  if (EXEMPT_STEMS.has(stem) || stem.endsWith('.test')) {
    return { ok: true }
  }

  // Single-word names are domain nouns by construction (`manifest`,
  // `normalize`, `tarball`) — always allowed.
  const parts = stem.split('-')
  if (parts.length < 2) {
    return { ok: true }
  }

  const lead = parts[0]!.toLowerCase()
  if (!ACTION_VERBS.has(lead)) {
    return { ok: true }
  }

  const domain = parts[parts.length - 1]!
  return {
    ok: false,
    message: `${filename} is a verb-phrase (an action), not a domain noun. Fleet modules are concise NOUN names that group the related functions for a domain.`,
    suggestion: `Add this function to an existing noun module (e.g. \`${domain}.ts\`), or name the file after its domain noun — not \`${lead}-…\`.`,
  }
}

export function emitBlock(filePath: string, verdict: Verdict): string {
  const lines: string[] = []
  lines.push('[module-noun-name-guard] Blocked: verb-phrase module name.')
  lines.push(`  File:       ${filePath}`)
  if (verdict.message) {
    lines.push(`  Issue:      ${verdict.message}`)
  }
  if (verdict.suggestion) {
    lines.push(`  Suggestion: ${verdict.suggestion}`)
  }
  lines.push('')
  lines.push('  Fleet module-naming convention:')
  lines.push('    - A module is a NOUN naming a domain (manifest, tarball).')
  lines.push('    - It GROUPS the related functions; not one method per file.')
  lines.push('    - trimPublishManifest + createPackageJson both live in')
  lines.push('      manifest.ts, reachable via one `exports` entry.')
  lines.push('')
  lines.push(`  Deliberate exception? Type "${BYPASS_PHRASE}".`)
  return lines.join('\n') + '\n'
}

export const check = editGuard((filePath, content, payload) => {
  void content
  const verdict = classifyModulePath(filePath)
  if (verdict.ok) {
    return undefined
  }
  // Fleet convention only — a sibling/external clone owns its own layout.
  if (!isFleetTarget(payload)) {
    return undefined
  }
  // Only block CREATION of a new verb-phrase module. Editing a file that
  // already exists predates this rule and must never be blocked.
  if (existsSync(filePath)) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  return block(emitBlock(filePath, verdict))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
