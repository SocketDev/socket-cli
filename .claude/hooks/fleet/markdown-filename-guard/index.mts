#!/usr/bin/env node
// Claude Code PreToolUse hook — markdown-filename-guard.
//
// Blocks Edit/Write tool calls that would create a markdown file
// with a non-canonical filename. Per the fleet's docs convention:
//
//   - Allowed everywhere: README.md, LICENSE.
//   - Allowed at root, docs/, .claude/ (top level only), or any
//     package root (a directory holding package.json — npm renders
//     these files from there): the conventional SCREAMING_CASE set
//     (AUTHORS, CHANGELOG, CLAUDE, CODE_OF_CONDUCT, CONTRIBUTING,
//     GOVERNANCE, MAINTAINERS, NOTICE, SECURITY, SUPPORT, etc.).
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
// The fleet's `scripts/fleet/check/markdown-filenames-are-canonical.mts`
// does the same check at commit time; this hook catches it earlier, at
// edit time, so the model gets immediate feedback when it picks a wrong
// name.
//
// Exit code 2 makes Claude Code refuse the tool call.
//
// Reads a Claude Code PreToolUse JSON payload from stdin:
//   { "tool_name": "Edit"|"Write",
//     "tool_input": { "file_path": "...", "content"|"new_string": "..." } }
//
// Fails open on hook bugs (exit 0 + stderr log).

import { existsSync } from 'node:fs'
import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { isEphemeralPath } from '../_shared/ephemeral-path.mts'
import { isFleetTarget } from '../_shared/fleet-context.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow markdown-filename bypass'

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

type Verdict = {
  ok: boolean
  message?: string | undefined
  suggestion?: string | undefined
}

export function classifyMarkdownPath(absPath: string): Verdict {
  const filename = path.basename(absPath)
  if (!/\.(MD|markdown|md)$/.test(filename)) {
    return { ok: true }
  }

  // Scratchpad / temp-dir drafts are not repo docs — exempt them before any
  // naming or location rule applies.
  if (isEphemeralPath(absPath)) {
    return { ok: true }
  }

  // A markdown file inside a vendored-source payload tree mirrors an
  // EXTERNAL project's layout (node-smol's additions/source-patched/doc/api,
  // vendor/, third_party/, upstream/, …): its name and location are
  // upstream-dictated source-tree content, not fleet docs.
  const payloadNorm = normalizePath(absPath)
  if (
    /\/(?:additions\/source-patched|external|third_party|upstream|vendor)\//.test(
      payloadNorm,
    )
  ) {
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

  // A `.md` under `.github/workflows/` is a GitHub Agentic Workflows (gh-aw)
  // source, not a doc — `gh aw compile` turns it into a sibling `.lock.yml`.
  // It owns its own naming (lowercase-hyphenated, matching the workflow), so
  // the human-docs filename convention doesn't apply.
  if (absPath.includes('.github')) {
    const normalized = normalizePath(absPath)
    if (normalized.includes('/.github/workflows/')) {
      return { ok: true }
    }
    // GitHub Copilot reads `.github/copilot-instructions.md` as its repo
    // instruction file (a host-dictated name, not a human doc).
    if (normalized.endsWith('/.github/copilot-instructions.md')) {
      return { ok: true }
    }
  }

  // Cross-harness agent rule adapters: each AI host reads its rules from a
  // host-named path (Cursor, Windsurf, Cline, Kiro). These are tool config the
  // host dictates, not human docs, so the doc-filename convention does not
  // apply.
  const harnessNorm = normalizePath(absPath)
  if (
    harnessNorm.includes('/.cursor/rules/') ||
    harnessNorm.includes('/.windsurf/rules/') ||
    harnessNorm.includes('/.clinerules/') ||
    harnessNorm.includes('/.kiro/steering/')
  ) {
    return { ok: true }
  }

  const relPath = normalizePath(toRepoRelative(absPath))
  // For docs that describe a specific code file (e.g. `smol-ffi.js.md`),
  // strip the source-file hint before validating the stem.
  const stemRaw = filename.replace(/\.(MD|markdown|md)$/, '')
  const nameWithoutExt = stripCodeFileHintExt(stemRaw)
  // A stripped hint means the stem IS a source filename, quoted verbatim
  // (mirror docs: `version_subset.js.md` documents `version_subset.js`).
  // Source filenames follow the source tree's convention, so lowercase
  // underscores are fine there — renaming the doc would break the mirror.
  const mirrorsSourceFile = nameWithoutExt !== stemRaw

  // README / LICENSE — anywhere.
  if (nameWithoutExt === 'LICENSE' || nameWithoutExt === 'README') {
    return { ok: true }
  }

  // SCREAMING_CASE allowlist.
  if (ALLOWED_SCREAMING_CASE.has(nameWithoutExt)) {
    if (isAtAllowedScreamingLocation(relPath)) {
      return { ok: true }
    }
    // A package root gets the repo-root allowance: npm force-includes
    // CHANGELOG/LICENSE/AUTHORS-style files from the directory holding
    // package.json, so these names are ecosystem-dictated there (e.g. a
    // workspace sub-package's CHANGELOG.md rendered on its npm page).
    if (existsSync(path.join(path.dirname(absPath), 'package.json'))) {
      return { ok: true }
    }
    const lowered = filename.toLowerCase().replace(/_/g, '-')
    return {
      ok: false,
      message: `${filename} (SCREAMING_CASE) is allowed only at the repo root, docs/, .claude/, or a package root (a directory with package.json). This path puts it deeper.`,
      suggestion: `Either move to root / docs/ / .claude/ / the package root, or rename to ${lowered}.`,
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

  // Must be lowercase-with-hyphens (a source-mirroring stem may also carry
  // the source file's underscores).
  if (
    !isLowercaseHyphenated(nameWithoutExt) &&
    !(mirrorsSourceFile && isLowercaseSourceName(nameWithoutExt))
  ) {
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
      /* c8 ignore next - path.posix.dirname never returns '' so the || '.' fallback is unreachable */
      message: `${filename}: per-repo docs live under docs/ or .claude/, not at ${path.posix.dirname(relPath) || '.'}.`,
      suggestion: `Move to docs/${filename} or .claude/${filename}.`,
    }
  }

  return { ok: true }
}

export function emitBlock(filePath: string, verdict: Verdict): string {
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
  lines.push('')
  lines.push(`  Deliberate exception? Type "${BYPASS_PHRASE}".`)
  return lines.join('\n') + '\n'
}

export function isAtAllowedRegularLocation(relPath: string): boolean {
  const dir = path.posix.dirname(relPath)
  if (dir === '.claude' || dir.startsWith('.claude/')) {
    return true
  }
  // Accept any path segment named `docs` so per-package doc trees like
  // `packages/<pkg>/docs/<name>.md` and
  // `packages/<pkg>/lang/<lang>/docs/<name>.md` resolve to the same "in
  // a docs/ directory" rule as repo-root docs/. Segment-equality (not
  // substring) so `foo-docs/`, `docs-old/`, `.docs/` don't match.
  const segments = normalizePath(dir).split('/')
  return segments.includes('docs')
}

export function isAtAllowedScreamingLocation(relPath: string): boolean {
  const dir = path.posix.dirname(relPath)
  // Repo-root-equivalent locations for SCREAMING_CASE allowlist files.
  // `template/` is the wheelhouse's scaffolding seed: its CLAUDE.md /
  // README.md / docs/ / .claude/ are the canonical sources each fleet repo's
  // OWN root copies derive from, so they get the same allowance as the
  // repo-root forms (template/CLAUDE.md → <repo>/CLAUDE.md after cascade).
  return (
    dir === '.' ||
    dir === '.claude' ||
    dir === 'docs' ||
    dir === 'template' ||
    dir === 'template/.claude' ||
    dir === 'template/base' ||
    dir === 'template/base/.claude' ||
    dir === 'template/base/docs' ||
    dir === 'template/docs'
  )
}

export function isLowercaseHyphenated(nameWithoutExt: string): boolean {
  return /^[a-z0-9]+(-[a-z0-9]+)*$/.test(nameWithoutExt)
}

/**
 * Loose stem rule for docs that mirror a source file verbatim: lowercase
 * segments joined by hyphens or underscores (Node internals use
 * `version_subset.js`-style names). Only consulted when the stem carried a
 * code-file hint extension. Underscores fold to hyphens so the base
 * predicate stays the single shape authority.
 */
export function isLowercaseSourceName(nameWithoutExt: string): boolean {
  return isLowercaseHyphenated(nameWithoutExt.replace(/_/g, '-'))
}

export function isScreamingCase(nameWithoutExt: string): boolean {
  return /^[A-Z0-9_]+$/.test(nameWithoutExt) && /[A-Z]/.test(nameWithoutExt)
}

/**
 * Strip a single trailing "source-file extension" hint from a doc-filename
 * stem. Canonical fleet pattern for docs describing a specific code file is
 * `<source>.md` (e.g. `smol-ffi.js.md` describes `smol-ffi.js`). Without this
 * strip, `smol-ffi.js.md` is parsed as stem `smol-ffi.js` which fails
 * `isLowercaseHyphenated` on the embedded `.`. The accepted hint extensions
 * match the language set the fleet documents code in.
 */
export function stripCodeFileHintExt(stem: string): string {
  return stem.replace(
    /\.(?:[cm]?[jt]sx?|json|ya?ml|toml|sh|py|rs|go|cc|cpp|h|hpp)$/,
    '',
  )
}

/**
 * Strip a leading repo-absolute prefix (anything up through and including a
 * `<repo-name>/` segment) so we get the in-repo relative path. Falls back to
 * the input if no recognizable prefix.
 *
 * Special case: socket-wheelhouse keeps the fleet-canonical doc tree under
 * `template/`, which acts as the "repo root" from the fleet perspective. Strip
 * that extra prefix so doc-location rules apply the same way as in a downstream
 * repo (where the docs live at actual root). Without this carve-out, every
 * SCREAMING_CASE doc in `template/` (CLAUDE.md, README.md at template root)
 * would trip the SCREAMING_CASE-only-at-repo-root rule.
 */
export function toRepoRelative(filePath: string): string {
  const normalized = normalizePath(filePath)
  // socket-wheelhouse treats template/ as the effective repo root. Anchor on
  // the LAST `template/` segment so the carve-out holds for any checkout
  // location — `~/projects/<repo>`, a `/private/tmp` worktree, or CI's
  // `/home/runner/work/<repo>/<repo>/` — not only paths under `/projects/`.
  // The fleet-canonical content now lives under the `base/` archetype layer
  // (`template/base/...`), so peel that segment too: `template/base/CLAUDE.md`
  // resolves to `CLAUDE.md`, exactly as the flat `template/CLAUDE.md` does.
  const templateIdx = normalized.lastIndexOf('/template/')
  if (templateIdx !== -1) {
    const afterTemplate = normalized.slice(templateIdx + '/template/'.length)
    return afterTemplate.startsWith('base/')
      ? afterTemplate.slice('base/'.length)
      : afterTemplate
  }
  // Otherwise strip up through the recognizable repo-checkout prefix.
  // `~/projects/<repo>/` and CI's `.../work/<repo>/<repo>/` both collapse to
  // the in-repo relative path; fall back to the input when neither matches.
  const projectsMatch = normalized.match(/\/projects\/[^/]+\/(.+)$/)
  if (projectsMatch) {
    return projectsMatch[1]!
  }
  const ciMatch = normalized.match(/\/work\/[^/]+\/[^/]+\/(.+)$/)
  if (ciMatch) {
    return ciMatch[1]!
  }
  return filePath
}

export const check = editGuard((filePath, content, payload) => {
  void content
  const verdict = classifyMarkdownPath(filePath)
  if (verdict.ok) {
    return undefined
  }
  // The fleet doc-filename convention only governs fleet repos — an external /
  // sibling clone (e.g. a GitHub wiki where `Home.md` is the page slug) owns
  // its own naming.
  if (!isFleetTarget(payload)) {
    return undefined
  }
  // Only block CREATION of a new non-canonical name. Editing a file that
  // already exists on disk — whose name predates this rule and which we are
  // not renaming — must never be blocked.
  if (existsSync(filePath)) {
    return undefined
  }
  // Recoverable override for a deliberate exception.
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
