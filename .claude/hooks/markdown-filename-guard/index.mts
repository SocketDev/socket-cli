#!/usr/bin/env node
// Claude Code PreToolUse hook — markdown-filename-guard.
//
// Blocks Edit/Write tool calls that would create a markdown file
// with a non-canonical filename. Per the fleet's docs convention:
//
//   - Allowed everywhere: README.md, LICENSE.
//   - Allowed at root, docs/, or .claude/ (top level only): the
//     conventional SCREAMING_CASE set (AUTHORS, CHANGELOG, CLAUDE,
//     CODE_OF_CONDUCT, CONTRIBUTING, GOVERNANCE, MAINTAINERS,
//     NOTICE, SECURITY, SUPPORT, etc.).
//   - Everything else must be lowercase-with-hyphens AND placed
//     under `docs/` or `.claude/` (at any depth).
//
// Why: SCREAMING_CASE doc filenames optimize for "noticeable in a
// repo root" but read as shouty + opaque inside body text and TOC
// links. Hyphenated lowercase reads naturally and matches every
// other slug-style identifier the fleet uses (URLs, CSS classes,
// CLI flags, package names). The narrow SCREAMING_CASE allowlist is
// the set GitHub renders specially — adding more would dilute the
// signal.
//
// The fleet's `scripts/validate/markdown-filenames.mts` does the
// same check at commit time; this hook catches it earlier, at edit
// time, so the model gets immediate feedback when it picks a wrong
// name.
//
// Exit code 2 makes Claude Code refuse the tool call.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Fails open on hook bugs (exit 0 + stderr log).

import path from 'node:path'
import process from 'node:process'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { readStdin } from '../_shared/transcript.mts'

type ToolInput = {
  tool_input?:
    | {
        content?: string | undefined
        file_path?: string | undefined
        new_string?: string | undefined
      }
    | undefined
  tool_name?: string | undefined
}

// SCREAMING_CASE files allowed at root / docs/ / .claude/ (top level).
const ALLOWED_SCREAMING_CASE: ReadonlySet<string> = new Set([
  'AUTHORS',
  'CHANGELOG',
  'CITATION',
  'CLAUDE',
  'CODE_OF_CONDUCT',
  'CONTRIBUTING',
  'CONTRIBUTORS',
  'COPYING',
  'CREDITS',
  'GOVERNANCE',
  'LICENSE',
  'MAINTAINERS',
  'NOTICE',
  'README',
  'SECURITY',
  'SUPPORT',
  'TRADEMARK',
])

/**
 * Strip a leading repo-absolute prefix (anything up through and
 * including a `<repo-name>/` segment) so we get the in-repo relative
 * path. Falls back to the input if no recognizable prefix.
 *
 * Special case: socket-wheelhouse keeps the fleet-canonical doc tree
 * under `template/`, which acts as the "repo root" from the fleet
 * perspective. Strip that extra prefix so doc-location rules apply
 * the same way as in a downstream repo (where the docs live at
 * actual root). Without this carve-out, every SCREAMING_CASE doc
 * in `template/` (CLAUDE.md, README.md at template root) would trip
 * the SCREAMING_CASE-only-at-repo-root rule.
 */
function toRepoRelative(filePath: string): string {
  // PreToolUse passes absolute paths. Strip up through `/projects/<repo>/`.
  const m = filePath.match(/\/projects\/[^/]+\/(.+)$/)
  if (!m) {
    return filePath
  }
  let rel = m[1]!
  // socket-wheelhouse: treat template/ as the effective repo root.
  if (rel.startsWith('template/')) {
    rel = rel.slice('template/'.length)
  }
  return rel
}

function isScreamingCase(nameWithoutExt: string): boolean {
  return /^[A-Z0-9_]+$/.test(nameWithoutExt) && /[A-Z]/.test(nameWithoutExt)
}

function isLowercaseHyphenated(nameWithoutExt: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameWithoutExt)
}

function isAtAllowedScreamingLocation(relPath: string): boolean {
  const dir = path.posix.dirname(relPath)
  return dir === '.' || dir === 'docs' || dir === '.claude'
}

function isAtAllowedRegularLocation(relPath: string): boolean {
  const dir = path.posix.dirname(relPath)
  return (
    dir === 'docs' ||
    dir.startsWith('docs/') ||
    dir === '.claude' ||
    dir.startsWith('.claude/')
  )
}

/**
 * Strip a single trailing "source-file extension" hint from a
 * doc-filename stem. Canonical fleet pattern for docs describing a
 * specific code file is `<source>.md` (e.g. `smol-ffi.js.md` describes
 * `smol-ffi.js`). Without this strip, `smol-ffi.js.md` is parsed as
 * stem `smol-ffi.js` which fails `isLowercaseHyphenated` on the
 * embedded `.`. The accepted hint extensions match the language set
 * the fleet documents code in.
 */
function stripCodeFileHintExt(stem: string): string {
  return stem.replace(
    /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|sh|py|rs|go|cc|cpp|h|hpp)$/,
    '',
  )
}

type Verdict = {
  ok: boolean
  message?: string
  suggestion?: string
}

export function classifyMarkdownPath(absPath: string): Verdict {
  const filename = path.basename(absPath)
  if (!/\.(md|MD|markdown)$/.test(filename)) {
    return { ok: true }
  }

  // Anything under a `.claude/` segment is off-limits to doc-filename
  // rules: that tree is owned by Claude Code (auto-memory, skills,
  // hooks, settings) and each tool inside picks its own filename
  // convention. The hook's job is to keep human-facing docs canonical,
  // not police runtime/tooling artifacts.
  //
  // Cheap-substring pre-check: if the path doesn't even contain the
  // literal `.claude` token, skip the normalize call. Saves the
  // normalization on the overwhelmingly-common non-`.claude` path.
  if (absPath.includes('.claude')) {
    const normalized = normalizePath(absPath)
    if (normalized.includes('/.claude/') || normalized.endsWith('/.claude')) {
      return { ok: true }
    }
  }

  const relPath = normalizePath(toRepoRelative(absPath))
  // For docs that describe a specific code file (e.g. `smol-ffi.js.md`),
  // strip the source-file hint before validating the stem.
  const nameWithoutExt = stripCodeFileHintExt(
    filename.replace(/\.(md|MD|markdown)$/, ''),
  )

  // README / LICENSE — anywhere.
  if (nameWithoutExt === 'README' || nameWithoutExt === 'LICENSE') {
    return { ok: true }
  }

  // SCREAMING_CASE allowlist.
  if (ALLOWED_SCREAMING_CASE.has(nameWithoutExt)) {
    if (isAtAllowedScreamingLocation(relPath)) {
      return { ok: true }
    }
    const lowered = filename.toLowerCase().replace(/_/g, '-')
    return {
      ok: false,
      message: `${filename} (SCREAMING_CASE) is allowed only at the repo root, docs/, or .claude/. This path puts it deeper.`,
      suggestion: `Either move to root / docs/ / .claude/, or rename to ${lowered}.`,
    }
  }

  // Wrong-case extension `.MD`.
  if (filename.endsWith('.MD')) {
    return {
      ok: false,
      message: `Extension is .MD; the fleet uses .md.`,
      suggestion: filename.replace(/\.MD$/, '.md'),
    }
  }

  // SCREAMING_CASE not in the allowlist — never allowed.
  if (isScreamingCase(nameWithoutExt)) {
    return {
      ok: false,
      message: `${filename}: SCREAMING_CASE markdown filenames are limited to the canonical allowlist (AUTHORS, CHANGELOG, CLAUDE, README, SECURITY, etc.). Custom doc names should be lowercase-with-hyphens.`,
      suggestion: filename.toLowerCase().replace(/_/g, '-'),
    }
  }

  // Must be lowercase-with-hyphens.
  if (!isLowercaseHyphenated(nameWithoutExt)) {
    const suggested = nameWithoutExt
      .toLowerCase()
      .replace(/[_\s]+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
    return {
      ok: false,
      message: `${filename}: doc filenames must be lowercase-with-hyphens (no underscores, no camelCase, no spaces).`,
      suggestion: `${suggested}.md`,
    }
  }

  // Lowercase-hyphenated docs must live under docs/ or .claude/.
  if (!isAtAllowedRegularLocation(relPath)) {
    return {
      ok: false,
      message: `${filename}: per-repo docs live under docs/ or .claude/, not at ${path.posix.dirname(relPath) || '.'}.`,
      suggestion: `Move to docs/${filename} or .claude/${filename}.`,
    }
  }

  return { ok: true }
}

function emitBlock(filePath: string, verdict: Verdict): void {
  const lines: string[] = []
  lines.push('[markdown-filename-guard] Blocked: non-canonical doc filename.')
  lines.push(`  File:       ${filePath}`)
  if (verdict.message) {
    lines.push(`  Issue:      ${verdict.message}`)
  }
  if (verdict.suggestion) {
    lines.push(`  Suggestion: ${verdict.suggestion}`)
  }
  lines.push('')
  lines.push('  Fleet doc-filename rules:')
  lines.push('    - README.md / LICENSE — allowed anywhere.')
  lines.push(
    '    - SCREAMING_CASE allowlist (AUTHORS, CHANGELOG, CLAUDE, CONTRIBUTING,',
  )
  lines.push(
    '      GOVERNANCE, MAINTAINERS, NOTICE, README, SECURITY, SUPPORT, …) —',
  )
  lines.push('      allowed at root / docs/ / .claude/ (top level only).')
  lines.push(
    '    - Everything else: lowercase-with-hyphens, in docs/ or .claude/.',
  )
  process.stderr.write(lines.join('\n') + '\n')
}

async function main(): Promise<void> {
  const raw = await readStdin()
  if (!raw) {
    return
  }
  let payload: ToolInput
  try {
    payload = JSON.parse(raw) as ToolInput
  } catch {
    return
  }
  if (payload.tool_name !== 'Edit' && payload.tool_name !== 'Write') {
    return
  }
  const filePath = payload.tool_input?.file_path ?? ''
  if (!filePath) {
    return
  }
  const verdict = classifyMarkdownPath(filePath)
  if (verdict.ok) {
    return
  }
  emitBlock(filePath, verdict)
  process.exitCode = 2
}

main().catch(e => {
  process.stderr.write(
    `[markdown-filename-guard] hook error (continuing): ${(e as Error).message}\n`,
  )
})
