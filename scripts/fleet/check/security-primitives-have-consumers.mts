#!/usr/bin/env node
// Fleet check — a security-annotated export must have an in-repo caller.
//
// A primitive that refuses something is only a control when something calls
// it. A dormant one reads as coverage to the next person who greps for it:
// the name is there, the tests are green, and nothing on the request path
// ever runs it. Four such primitives surfaced in a single review — a PATH
// de-poisoning resolver, a URL fetch gate, a shadow-bin walker, and a bind
// restriction — each of which enforced nothing.
//
// ANNOTATED: an explicit `@security` tag, or a doc that scores against two
// threat vocabularies. A tag alone would only find the primitives someone
// remembered to tag, and nobody had tagged any of the four; the working signal
// is the prose these controls already carry. NAMED_THREATS ("SSRF", "shadow
// bin") appear only when describing an attack, so one is enough.
// AMBIGUOUS_TERMS ("loopback", "sanitize") also occur in ordinary prose, so one
// proves nothing and two together do. See isSecurityAnnotated for the three
// grounds an export can qualify on.
//
// CONSUMER: any tracked non-test source file that names the symbol. Tests do
// NOT count — a test proves the primitive works, never that it is wired, and
// the failure mode here is a well-tested control nothing calls. Doc comments
// and barrel `export … from` lines are stripped before matching. A use inside
// the declaring module counts; its entry point carries it.
//
// ESCAPE HATCH: a primitive legitimately awaiting a caller says so in its own
// doc — `@unused <reason>` (socket-lib's existing convention) or
// `@security-disposition <reason>`. Silence fails; a reasoned line passes.
//
// Full rationale: docs/agents.md/fleet/security-primitives-have-consumers.md
// Usage: node scripts/fleet/check/security-primitives-have-consumers.mts

import { readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import { REPO_ROOT } from '../paths.mts'

import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

/**
 * Annotation score a doc comment must reach to read as a security annotation
 * rather than an incidental mention. One named attack clears it; two ambiguous
 * terms clear it; one ambiguous term alone never does.
 */
export const MIN_ANNOTATION_SCORE = 2

/**
 * Score at which an export's own doc annotates it on its own, no matter what
 * its module header says. Enumerating several distinct threats is a statement
 * of purpose, not a passing mention of a neighbour's.
 */
export const DENSE_ANNOTATION_SCORE = MIN_ANNOTATION_SCORE * 2

/**
 * Largest module that lets its file header annotate every export it declares.
 * Past this the header describes a neighbourhood, not each function.
 */
export const MAX_INHERITING_EXPORTS = 8

/**
 * Named attacks and defended-against mechanisms. These appear in prose only
 * when describing a threat, so ONE is enough on its own — the shadow-bin
 * walker's whole doc is a single such term, and a two-term floor would miss it.
 */
export const NAMED_THREATS: readonly string[] = [
  'adversar',
  'attack surface',
  'attacker',
  'clickjack',
  'cloud metadata',
  'confused deputy',
  'csrf\\b',
  'exfiltrat',
  'hostile',
  'malicious',
  'metadata service',
  'path traversal',
  'prototype.?pollution',
  'rce\\b',
  // "shadow bin(s)" / "shadow-bin" is the threat; the trailing boundary keeps
  // it off Socket's own "shadow binary" product feature.
  'shadow.?bins?\\b',
  'ssrf\\b',
  'symlink escape',
  'threat model',
  'xss\\b',
  'zip slip',
]

/**
 * Security-adjacent terms that also occur in ordinary prose ("loopback
 * interface", "ingesting JSON from untrusted sources" on any validator). One
 * is not evidence; two together are.
 */
export const AMBIGUOUS_TERMS: readonly string[] = [
  'escalat',
  'hijack',
  'link-local',
  'loopback',
  'poison',
  'privilege',
  'redact',
  'sanitiz',
  'spoof',
  'tamper',
  'untrusted',
]

/**
 * Compile one term table entry. The leading `\b` stops a mid-word match
 * (`rce` inside "sources" once flagged a plain schema parser).
 */
// oxlint-disable-next-line socket/require-regex-comment -- the source is a term table entry.
export function compileTermMatcher(term: string): RegExp {
  return new RegExp(`\\b${term}`, 'i')
}

const THREAT_MATCHERS = NAMED_THREATS.map(compileTermMatcher)
const AMBIGUOUS_MATCHERS = AMBIGUOUS_TERMS.map(compileTermMatcher)

// Repo-OWNED source. A member's security primitives live under these roots.
const SOURCE_PATH_RE =
  // oxlint-disable-next-line socket/require-regex-comment -- described above
  /^(?:lib|packages\/[^/]+\/(?:lib|src)|scripts\/repo|src)\//

// Cascaded trees are authored in socket-wheelhouse and byte-copied into every
// member, so a member sees the file without its callers. Scanning them would
// fail 20 repos for one wheelhouse-owned export. The wheelhouse's canonical
// `template/` copies are excluded for the mirror reason: their consumers are
// the cascaded copies, not the template.
// oxlint-disable-next-line socket/require-regex-comment -- described above
const CASCADED_PATH_RE = /^(?:\.config\/fleet|scripts\/fleet|template)\//

// Test-shaped paths: never a consumer, never scanned for candidates.
const TEST_PATH_RE =
  // oxlint-disable-next-line socket/require-regex-comment -- described above
  /(?:^|\/)(?:__tests__|fixtures?|mocks?|tests?)\/|\.(?:bench|fuzz|spec|test)\./

// oxlint-disable-next-line socket/require-regex-comment -- a source-file extension suffix
const CODE_PATH_RE = /\.(?:cjs|cts|js|mjs|mts|ts)$/

const DECLARATION_RE =
  // oxlint-disable-next-line socket/require-regex-comment -- captures the kind and name of a top-level export
  /^export\s+(?:async\s+)?(class|const|function|interface|let|type)\s+([A-Za-z_$][\w$]*)/

// `@unused <reason>` / `@security-disposition <reason>` — the reason must carry
// real content, so a bare tag stays silent and still fails.
// oxlint-disable-next-line socket/require-regex-comment -- described above
const DISPOSITION_RE = /@(?:security-disposition|unused)[ \t]+(\S[^\n]{9,})/

// oxlint-disable-next-line socket/require-regex-comment -- the bare @security doc tag
const SECURITY_TAG_RE = /@security\b/

// oxlint-disable-next-line socket/require-regex-comment -- a JS identifier
const IDENTIFIER_RE = /[A-Za-z_$][\w$]*/g

export interface SecurityDeclaration {
  doc: string
  kind: string
  line: number
  symbol: string
}

export interface DormantPrimitive {
  file: string
  line: number
  symbol: string
}

/**
 * Score `text` as a security annotation: a named attack is worth
 * `MIN_ANNOTATION_SCORE` on its own, an ambiguous term one point.
 */
export function scoreSecurityAnnotation(text: string): number {
  let score = 0
  for (let i = 0, { length } = THREAT_MATCHERS; i < length; i += 1) {
    score += THREAT_MATCHERS[i]!.test(text) ? MIN_ANNOTATION_SCORE : 0
  }
  for (let i = 0, { length } = AMBIGUOUS_MATCHERS; i < length; i += 1) {
    score += AMBIGUOUS_MATCHERS[i]!.test(text) ? 1 : 0
  }
  return score
}

// Leading whitespace, then EITHER a run of `//` lines OR one `/* … */` block.
const FILE_HEADER_RE = /^\s*(?:(?:\/\/.*\n)+|\/\*[\s\S]*?\*\/)/

/**
 * The leading block or line-comment header of a module, or an empty string.
 */
export function extractFileHeader(src: string): string {
  const match = FILE_HEADER_RE.exec(src)
  return match ? match[0] : ''
}

// A line that may sit between a doc block and the declaration it documents:
// an opening `/* c8 …` pragma, or a `//` note.
const DOC_SKIPPABLE_LINE_RE = /^\s*(?:\/\*\s*c8\b|\/\/)/

/**
 * The doc comment directly above line `index`, or an empty string. Walks up
 * past `//` notes and `c8` pragmas only — a blank line or code ends the block,
 * so a doc can never be attributed to a later declaration.
 */
export function docCommentAbove(
  lines: readonly string[],
  index: number,
): string {
  let cursor = index - 1
  while (cursor >= 0 && DOC_SKIPPABLE_LINE_RE.test(lines[cursor]!)) {
    cursor -= 1
  }
  if (cursor < 0 || !/\*\/\s*$/.test(lines[cursor]!)) {
    return ''
  }
  const end = cursor
  while (cursor >= 0 && !/^\s*\/\*/.test(lines[cursor]!)) {
    cursor -= 1
  }
  return cursor < 0 ? '' : lines.slice(cursor, end + 1).join('\n')
}

/**
 * Every top-level `export <kind> <name>` in a module, paired with its doc.
 */
export function extractDeclarations(src: string): SecurityDeclaration[] {
  const lines = src.split('\n')
  const declarations: SecurityDeclaration[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const match = DECLARATION_RE.exec(lines[i]!)
    if (match) {
      declarations.push({
        doc: docCommentAbove(lines, i),
        kind: match[1]!,
        line: i + 1,
        symbol: match[2]!,
      })
    }
  }
  return declarations
}

export interface AnnotationEvidence {
  declaredExports: number
  doc: string
  header: string
}

/**
 * Whether an export reads as a security primitive. See the file header for the
 * scoring model and why both scopes have to speak.
 */
export function isSecurityAnnotated(evidence: AnnotationEvidence): boolean {
  const { declaredExports, doc, header } = evidence
  if (SECURITY_TAG_RE.test(doc) || SECURITY_TAG_RE.test(header)) {
    return true
  }
  const ownScore = scoreSecurityAnnotation(doc)
  const moduleScore = scoreSecurityAnnotation(header)
  // A doc dense in threat vocabulary stands on its own. An SSRF gate that
  // enumerates cloud metadata, link-local, and loopback is stating its purpose,
  // not glancing at a neighbour's, so a generic module header cannot mask it.
  if (ownScore >= DENSE_ANNOTATION_SCORE) {
    return true
  }
  // At the floor, the module must declare the domain too: a lone threat term
  // inside an otherwise unrelated module is a cross-reference, not an
  // annotation — a PATH lookup documented as "the inverse of the shadow-bin
  // walker" names the guard it is NOT.
  if (moduleScore >= 1 && ownScore >= MIN_ANNOTATION_SCORE) {
    return true
  }
  // A focused module's header annotates each export it declares; past
  // MAX_INHERITING_EXPORTS it describes a neighbourhood, so the export still
  // has to show intent of its own.
  return (
    ownScore >= 1 &&
    moduleScore >= MIN_ANNOTATION_SCORE &&
    declaredExports <= MAX_INHERITING_EXPORTS
  )
}

/**
 * The recorded disposition for a dormant primitive, or undefined when its doc
 * is silent.
 */
export function readDispositionNote(doc: string): string | undefined {
  const match = DISPOSITION_RE.exec(doc)
  return match ? match[1]!.trim() : undefined
}

const BLOCK_COMMENT_RE = /\/\*[\s\S]*?\*\//g

// A `//` comment, but not the `//` inside a `https://` URL: group 1 keeps the
// character before the slashes so a `:` or word character disqualifies it.
const LINE_COMMENT_RE = /(^|[^:\w])\/\/.*$/gm

// A whole barrel line: `export * from '…'` or `export { … } from '…'`. These
// re-expose a symbol without calling it.
const BARREL_LINE_RE =
  /^\s*export\s+(?:\*|\{[\s\S]*?\})\s*from\s*['"][^'"]+['"].*$/gm

/**
 * Source with comments and barrel re-export lines removed, so only text that
 * could actually call a symbol survives.
 */
export function callableSource(src: string): string {
  return src
    .replace(BLOCK_COMMENT_RE, ' ')
    .replace(LINE_COMMENT_RE, '$1 ')
    .replace(BARREL_LINE_RE, ' ')
}

/**
 * Identifier -> occurrence count over `text`.
 */
export function tallyIdentifiers(text: string): Map<string, number> {
  const counts = new Map<string, number>()
  const matches = text.match(IDENTIFIER_RE)
  if (!matches) {
    return counts
  }
  for (let i = 0, { length } = matches; i < length; i += 1) {
    const word = matches[i]!
    counts.set(word, (counts.get(word) ?? 0) + 1)
  }
  return counts
}

export function isSourceCandidatePath(relPath: string): boolean {
  return (
    SOURCE_PATH_RE.test(relPath) &&
    !CASCADED_PATH_RE.test(relPath) &&
    CODE_PATH_RE.test(relPath) &&
    !TEST_PATH_RE.test(relPath) &&
    !relPath.endsWith('.d.ts')
  )
}

export function isConsumerPath(relPath: string): boolean {
  return (
    CODE_PATH_RE.test(relPath) &&
    !TEST_PATH_RE.test(relPath) &&
    !relPath.endsWith('.d.ts')
  )
}

export function trackedRepoFiles(rootDir: string): string[] {
  const result = spawnSync('git', ['ls-files'], {
    cwd: rootDir,
    stdio: 'pipe',
    stdioString: true,
  })
  if (result.status !== 0) {
    return []
  }
  return String(result.stdout ?? '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

export interface PrimitiveScan {
  candidates: number
  dormant: DormantPrimitive[]
}

/**
 * Scan `rootDir` for security-annotated exports with no non-test caller.
 */
export function scanSecurityPrimitives(
  rootDir: string,
  files: readonly string[],
): PrimitiveScan {
  const consumerFiles = files.filter(isConsumerPath)
  const ownTallies = new Map<string, Map<string, number>>()
  const corpus = new Map<string, number>()
  for (let i = 0, { length } = consumerFiles; i < length; i += 1) {
    const rel = consumerFiles[i]!
    let text = ''
    try {
      text = readFileSync(path.join(rootDir, rel), 'utf8')
    } catch {
      continue
    }
    const tally = tallyIdentifiers(callableSource(text))
    ownTallies.set(rel, tally)
    for (const { 0: word, 1: count } of tally) {
      corpus.set(word, (corpus.get(word) ?? 0) + count)
    }
  }

  const dormant: DormantPrimitive[] = []
  let candidates = 0
  const sourceFiles = files.filter(isSourceCandidatePath)
  for (let i = 0, { length } = sourceFiles; i < length; i += 1) {
    const rel = sourceFiles[i]!
    let src = ''
    try {
      src = readFileSync(path.join(rootDir, rel), 'utf8')
    } catch {
      continue
    }
    const header = extractFileHeader(src)
    const declarations = extractDeclarations(src)
    const ownTally = ownTallies.get(rel)
    for (let j = 0, { length: dlen } = declarations; j < dlen; j += 1) {
      const declaration = declarations[j]!
      if (
        !isSecurityAnnotated({
          declaredExports: declarations.length,
          doc: declaration.doc,
          header,
        })
      ) {
        continue
      }
      candidates += 1
      const note = readDispositionNote(declaration.doc)
      if (note) {
        continue
      }
      const { symbol } = declaration
      const ownCount = ownTally?.get(symbol) ?? 0
      const totalCount = corpus.get(symbol) ?? 0
      // Wired when another file names it, or when the declaring module uses it
      // beyond the declaration line itself.
      if (totalCount - ownCount > 0 || ownCount > 1) {
        continue
      }
      dormant.push({ file: rel, line: declaration.line, symbol })
    }
  }
  return { candidates, dormant }
}

function main(): void {
  const files = trackedRepoFiles(REPO_ROOT)
  const { candidates, dormant } = scanSecurityPrimitives(REPO_ROOT, files)

  if (candidates === 0) {
    // Zero scope is never a pass. A repo with no security-annotated export
    // resolved may genuinely have none, or the scan may have missed its source
    // roots — say which, never print a green.
    logger.warn(
      'security-primitives-have-consumers: 0 security-annotated exports resolved — this is NOT a pass.',
    )
    logger.log(
      `  Scanned ${files.filter(isSourceCandidatePath).length} repo-owned source file(s) under lib/, src/, scripts/repo/, packages/*/{lib,src}/ (cascaded fleet trees excluded).`,
    )
    logger.log(
      '  If this repo does ship a security primitive, its doc names no threat terms — add a `@security` tag so the gate can see it.',
    )
    return
  }

  if (dormant.length === 0) {
    logger.success(
      `security-primitives-have-consumers: all ${candidates} security-annotated export(s) have a caller.`,
    )
    return
  }

  logger.fail(
    `Security primitive with no caller: ${dormant.length} of ${candidates} security-annotated export(s) enforce nothing.`,
  )
  logger.log('')
  for (let i = 0, { length } = dormant; i < length; i += 1) {
    const finding = dormant[i]!
    logger.log(`  ${finding.file}:${finding.line} → \`${finding.symbol}\``)
  }
  logger.log('')
  logger.log(
    '  Saw:    declared, documented as a security control, referenced only by its tests (or by nothing).',
  )
  logger.log(
    '  Wanted: at least one non-test caller in this repo, or a recorded disposition.',
  )
  logger.log('')
  logger.log('  Fix, in order of preference:')
  logger.log(
    '    1. Wire it — call it from the path it was written to protect.',
  )
  logger.log(
    '    2. Delete it, if that path is gone. The fleet deletes, it does not deprecate.',
  )
  logger.log(
    "    3. Record why nothing calls it, in the export's own doc — silence fails, a reasoned line passes:",
  )
  logger.log(
    '         @unused No internal or Socket consumers; exercised only by its unit tests.',
  )
  logger.log(
    "         @security-disposition Published API — <repo>'s <path> is the caller.",
  )
  process.exitCode = 1
}

const SCRIPT_META: ScriptMeta = {
  describe: 'checks every security-annotated export has an in-repo caller',
  help: 'Usage: node scripts/fleet/check/security-primitives-have-consumers.mts',
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
