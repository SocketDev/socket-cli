#!/usr/bin/env node
// Fleet check — pack-bytes-have-no-private-refs.
//
// The release gate for what the tarball CONTAINS, not what it lists. Packs
// the package (`pnpm pack`), then scans the decompressed BYTES of every
// text-like entry for three classes of reference that must never ship:
// private/internal path shapes (an operator's home directory, another fleet
// repo's private tree), fleet-DENIED domains, and credential value shapes.
//
// The source tree is already scanned for all three
// (private-paths-are-absent.mts, denied-domains-are-absent.mts, the
// token-guard family). This check exists because a BUILD STEP can bake a
// reference into published output that no source-level scanner ever sees: a
// bundler inlining an absolute loader path, a codegen step embedding the
// machine it ran on, a sourcemap carrying the build box's checkout layout, a
// fixture inlined into a bundle. The tarball is the only place those are
// visible, and once it publishes it is immutable.
//
// The pattern set is IMPORTED from the fleet's canonical matchers, never
// re-spelled here — `_shared/private-paths.mts`, `_shared/denied-domains.mts`,
// and `_shared/token-patterns.mts`. Every entry is a NAMED pattern with its
// own fix line and its own unit test; there is no single mega-regex.
//
// Private packages (`"private": true`) never publish, so the check passes
// without packing.
//
// Usage: node scripts/fleet/check/pack-bytes-have-no-private-refs.mts [--quiet]

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import {
  DENIED_DOMAINS,
  deniedHostRe,
  describeDeniedEntry,
} from '../../../.claude/hooks/fleet/_shared/denied-domains.mts'
import { PRIVATE_PATH_PATTERNS } from '../../../.claude/hooks/fleet/_shared/private-paths.mts'
import { SECRET_VALUE_PATTERNS } from '../../../.claude/hooks/fleet/_shared/token-patterns.mts'
import { isPurePlaceholder } from '../../../.git-hooks/_shared/personal-path.mts'
import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'
import { packAndInspect, readPackEntryText } from '../_shared/pack-inspect.mts'
import { resolveReleaseSubject } from '../_shared/release-subject.mts'
import { withPrunedPackManifest } from '../publish-infra/npm/pack-manifest.mts'
import { runMain } from '../_shared/run-main.mts'

import type { PrivatePathFinding } from '../../../.claude/hooks/fleet/_shared/private-paths.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Longest snippet echoed for a hit. A minified bundle is one enormous line;
 * without a cap the report would paste the whole thing (and, for a secret,
 * paste the secret at full length into CI logs).
 */
export const PACK_LEAK_SNIPPET_MAX = 120

/**
 * How many occurrences of one pattern are examined per entry before giving
 * up. Only the first NON-exempt occurrence is reported; the budget bounds a
 * pathological file where every occurrence is a documented placeholder.
 */
export const PACK_LEAK_MATCH_BUDGET = 64

/**
 * One named leak pattern. Named + individually fixable is the point: the
 * reference implementation this ports from used a single 700-character regex
 * with no test, so a broken alternative would have silently stopped matching.
 */
export interface PackLeakPattern {
  /**
   * The imperative fix line shown under the hit.
   */
  readonly fix: string
  /**
   * Stable identifier, `<family>/<detail>`, used in the report and in tests.
   */
  readonly name: string
  /**
   * The matcher. Non-global — the scanner compiles its own global copy so the
   * exported pattern carries no `lastIndex` state.
   */
  readonly re: RegExp
}

// Per-kind fix lines for the private-path family. The kind's description
// comes from the canonical matcher; the remedy is this check's to state.
const PRIVATE_PATH_FIXES: Readonly<Record<PrivatePathFinding['kind'], string>> =
  {
    'claude-plans-reports':
      'Stop referencing an operator-local plans/reports path from anything that ships; describe the constraint instead of where the note lives.',
    'cross-repo-claude':
      "Remove the other repo's private tree reference — published output must not disclose fleet layout.",
    'home-abs-path':
      'Make the build emit a relative or repo-rooted path (a placeholder in docs); an absolute home path leaks the build machine and its user.',
    'sibling-repo-rel':
      'Resolve the sibling-repo path at build time or drop it — it presumes a dev-box directory layout that no consumer has.',
  }

/**
 * Every pattern the packed bytes are scanned for, built from the fleet's
 * three canonical matcher modules so a new denied domain or secret shape is
 * picked up here with no edit. Order is family-by-family; the scanner reports
 * the first non-exempt occurrence of each.
 */
export const PACK_LEAK_PATTERNS: readonly PackLeakPattern[] = [
  ...PRIVATE_PATH_PATTERNS.map(p => ({
    fix: PRIVATE_PATH_FIXES[p.kind],
    name: `private-path/${p.kind}`,
    re: p.re,
  })),
  ...DENIED_DOMAINS.map(d => ({
    fix: `Remove the reference. ${describeDeniedEntry(d)}`,
    name: `denied-domain/${d.host}`,
    re: deniedHostRe(d.host),
  })),
  ...SECRET_VALUE_PATTERNS.map(s => ({
    fix: `Treat this as compromised: rotate the credential, then remove it from the build input. A published tarball is immutable — ${s.label} in it is public.`,
    name: `secret-value/${s.label}`,
    re: s.re,
  })),
]

// Entry extensions worth a text scan. Everything else (wasm, images, native
// binaries, archives) is skipped: a byte scan of compiled output produces
// noise, not findings.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const TEXT_ENTRY_RE =
  /\.(?:cjs|css|cts|html|js|json|map|md|mjs|mts|ts|txt|ya?ml)$/i

/**
 * True when a tarball entry is worth scanning as text: a known text
 * extension, or an extensionless file under `bin/` (a CLI launcher shebang
 * script, which is exactly where an absolute interpreter path lands).
 */
export function isTextLikePackEntry(entryPath: string): boolean {
  const normalized = normalizePath(entryPath)
  if (TEXT_ENTRY_RE.test(normalized)) {
    return true
  }
  const base = normalized.split('/').pop() ?? ''
  return normalized.startsWith('bin/') && base.length > 0 && !base.includes('.')
}

/**
 * One leak found in the packed bytes.
 */
export interface PackLeakHit {
  /**
   * Tarball-relative entry path.
   */
  readonly entry: string
  /**
   * The remedy from the matching pattern.
   */
  readonly fix: string
  /**
   * 1-based line within the entry.
   */
  readonly line: number
  /**
   * The pattern's stable name.
   */
  readonly name: string
  /**
   * The matched text, truncated to PACK_LEAK_SNIPPET_MAX.
   */
  readonly snippet: string
}

// The private-path matchers allow a leading delimiter (whitespace, quote,
// bracket) so a path glued to an identifier does not match; strip it back off
// the reported snippet. No other family's match can begin with one of these.
// oxlint-disable-next-line socket/require-regex-comment -- documented above
const LEADING_DELIMITER_RE = /^[\s"'`([{<]/

/**
 * The reported snippet for a raw match: leading delimiter dropped, truncated
 * to PACK_LEAK_SNIPPET_MAX with an ellipsis. Pure.
 */
export function trimPackLeakSnippet(match: string): string {
  const trimmed = match.replace(LEADING_DELIMITER_RE, '')
  return trimmed.length > PACK_LEAK_SNIPPET_MAX
    ? `${trimmed.slice(0, PACK_LEAK_SNIPPET_MAX)}…`
    : trimmed
}

/**
 * 1-based line number of a character index within `text`. Pure.
 */
export function lineNumberOfPackIndex(text: string, index: number): number {
  let line = 1
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) {
      line += 1
    }
  }
  return line
}

/**
 * The full source line containing a character index. Pure.
 */
export function lineTextAtPackIndex(text: string, index: number): string {
  const start = text.lastIndexOf('\n', index - 1) + 1
  const end = text.indexOf('\n', index)
  return text.slice(start, end === -1 ? text.length : end)
}

// Global-flagged clones of the exported patterns, compiled once. The exported
// array stays stateless so a test can call `.re.test()` repeatedly.
const globalPatternCache = new Map<string, RegExp>()

function globalPatternFor(pattern: PackLeakPattern): RegExp {
  const cached = globalPatternCache.get(pattern.name)
  if (cached) {
    cached.lastIndex = 0
    return cached
  }
  const flags = pattern.re.flags.includes('g')
    ? pattern.re.flags
    : `${pattern.re.flags}g`
  const re = new RegExp(pattern.re.source, flags)
  globalPatternCache.set(pattern.name, re)
  return re
}

/**
 * True when a match is documentation rather than a leak. Narrow by design:
 * only the home-absolute-path family, and only when the containing line is a
 * PURE placeholder by the fleet's canonical test (a bracketed user token, a
 * `$VAR`, or a CI service-account home). Every other family has no benign
 * form in a published tarball. Pure.
 */
export function packLeakMatchIsDocumentation(
  name: string,
  lineText: string,
): boolean {
  return name === 'private-path/home-abs-path' && isPurePlaceholder(lineText)
}

/**
 * Scan one entry's text for every named leak pattern, reporting the first
 * non-exempt occurrence of each. Pure — the unit tests drive this directly
 * with synthetic entry text.
 */
export function scanPackEntryText(entry: string, text: string): PackLeakHit[] {
  const hits: PackLeakHit[] = []
  for (let i = 0, { length } = PACK_LEAK_PATTERNS; i < length; i += 1) {
    const pattern = PACK_LEAK_PATTERNS[i]!
    const re = globalPatternFor(pattern)
    let m = re.exec(text)
    let seen = 0
    while (m && seen < PACK_LEAK_MATCH_BUDGET) {
      seen += 1
      const { index } = m
      if (
        !packLeakMatchIsDocumentation(
          pattern.name,
          lineTextAtPackIndex(text, index),
        )
      ) {
        hits.push({
          __proto__: null,
          entry,
          fix: pattern.fix,
          line: lineNumberOfPackIndex(text, index),
          name: pattern.name,
          snippet: trimPackLeakSnippet(m[0]),
        } as PackLeakHit)
        break
      }
      if (m.index === re.lastIndex) {
        re.lastIndex += 1
      }
      m = re.exec(text)
    }
  }
  return hits
}

/**
 * The fail-loud report: What / Where / Saw-vs-wanted / Fix. Pure.
 */
export function formatPackLeakReport(
  pkgName: string,
  hits: readonly PackLeakHit[],
): string {
  const lines = [
    `[pack-bytes-have-no-private-refs] ${pkgName} tarball BYTES carry ${hits.length} reference${hits.length === 1 ? '' : 's'} that must never ship:`,
  ]
  for (let i = 0, { length } = hits; i < length; i += 1) {
    const h = hits[i]!
    lines.push(
      `  ${h.entry}:${h.line} — ${h.name}`,
      `    saw: ${h.snippet}`,
      `    Fix: ${h.fix}`,
    )
  }
  lines.push(
    '',
    '  wanted: no private/internal path, no fleet-denied domain, and no',
    '  credential shape anywhere in the packed bytes.',
    '  A source-level scan cannot catch these — the reference is produced by a',
    '  build step, so fix the step that emits it, then re-run this check.',
  )
  return lines.join('\n')
}

async function main(): Promise<void> {
  const quiet = process.argv.includes('--quiet')
  const pkg = JSON.parse(
    readFileSync(path.join(REPO_ROOT, 'package.json'), 'utf8'),
  ) as { name?: string | undefined; private?: boolean | undefined }
  if (pkg.private === true) {
    if (!quiet) {
      logger.success(
        '[pack-bytes-have-no-private-refs] private package — never publishes; skipping.',
      )
    }
    return
  }
  // Pack through the SAME manifest-prune bracket the publish pipeline packs
  // through, so the bytes scanned are the bytes that would ship.
  const subject = resolveReleaseSubject(REPO_ROOT)
  const inspection = await withPrunedPackManifest(subject.dir, async () =>
    packAndInspect(REPO_ROOT),
  )
  if (!inspection) {
    logger.fail(
      '[pack-bytes-have-no-private-refs] pnpm pack (or tar listing) failed — cannot scan the tarball. Run `pnpm pack` manually to see the error.',
    )
    process.exitCode = 1
    return
  }
  const { listing, tarball } = inspection
  const hits: PackLeakHit[] = []
  let scanned = 0
  let skipped = 0
  for (let i = 0, { length } = listing; i < length; i += 1) {
    const item = listing[i]!
    if (item.mode.charAt(0) !== '-' || !isTextLikePackEntry(item.path)) {
      continue
    }
    const text = readPackEntryText(tarball, item.rawPath)
    if (text === undefined) {
      // Oversized past the scan cap, or unreadable — never scanned partially.
      skipped += 1
      continue
    }
    scanned += 1
    hits.push(...scanPackEntryText(item.path, text))
  }
  if (hits.length) {
    logger.fail(formatPackLeakReport(pkg.name ?? 'package', hits))
    process.exitCode = 1
    return
  }
  if (!quiet) {
    logger.success(
      `[pack-bytes-have-no-private-refs] packed bytes are clean (${scanned} text entr${scanned === 1 ? 'y' : 'ies'} scanned${skipped ? `, ${skipped} skipped as oversized/unreadable` : ''}).`,
    )
  }
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'checks the packed tarball bytes carry no private path, denied domain, or credential shape',
  help: `Usage: node scripts/fleet/check/pack-bytes-have-no-private-refs.mts [flags]

  --quiet  silent on clean`,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
