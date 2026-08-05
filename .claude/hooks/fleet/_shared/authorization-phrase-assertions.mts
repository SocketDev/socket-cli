/*
 * @file The one carve-out in authorization-phrase-emission-guard's file-write
 *   arm: a vitest spec that ASSERTS a guard's deny message names the grant
 *   phrase an operator has to type.
 *
 *   Why a carve-out is needed: a guard's deny message is part of its contract,
 *   so the spec that pins that contract has to contain the message, phrase
 *   included. Without an exemption those specs are unwritable, and every later
 *   edit anywhere in one is blocked on inherited text rather than on what the
 *   author typed.
 *
 *   Why it is safe: nothing accepts a FILE as an authorization. The detection
 *   side keys on transcript role provenance, so a phrase sitting in a spec is
 *   never a grant. What the emission guard protects on the file surface is the
 *   weaker property — no copy-paste-ready grant in the tree — and a regex
 *   literal is not copy-paste-ready: the delimiters and any escapes have to be
 *   edited out before the text could be typed anywhere.
 *
 *   The carve-out is a CONJUNCTION and both halves carry weight:
 *
 *   1. PATH — the write target is a vitest spec: a `*.test.*` / `*.spec.*`
 *      basename under a `test/` root. Production code, hook sources, docs, and
 *      prose files never qualify, so none of them gains a way to carry a
 *      phrase.
 *   2. SYNTAX — the phrase sits inside a regex literal that fills a WHOLE call
 *      argument (`assert.match(msg, /…/)`, `expect(x).toMatch(/…/)`). A bare
 *      sentence, a comment, and a hoisted `const RE = /…/` all stay blocked,
 *      so a spec cannot become the laundering channel either.
 *
 *   Both halves are asserted in
 *   `test/repo/unit/hooks/authorization-phrase-emission-guard.test.mts`.
 */

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

// A vitest spec basename: a `.test.` or `.spec.` infix followed by any
// JS/TS extension — `.js`, `.jsx`, `.ts`, `.tsx`, and the `.cjs`/`.cts`/
// `.mjs`/`.mts` module-flavored spellings the `[cm]?` prefix covers.
const SPEC_BASENAME_RE = /\.(?:spec|test)\.[cm]?[jt]sx?$/

/**
 * Directory names that root a test tree. Each is written with BOTH slashes so
 * it only matches a whole path segment — `latest/` and `contest/` contain the
 * letters `test` but are not test roots.
 */
export const TEST_ROOT_SEGMENTS: readonly string[] = [
  '/__tests__/',
  '/test/',
  '/tests/',
]

/**
 * Is `filePath` a vitest spec — a `*.test.*` / `*.spec.*` file under a test
 * root? Half one of the emission-guard carve-out; on its own it grants
 * nothing, because {@link stripPhraseAssertionRegexLiterals} still has to
 * remove the phrase from the content.
 *
 * A leading slash is prepended so a repo-relative path (`test/x.test.mts`)
 * matches the same segment forms an absolute path does.
 */
export function isVitestSpecPath(filePath: string | undefined): boolean {
  if (!filePath) {
    return false
  }
  const normalized = `/${normalizePath(filePath)}`
  return (
    SPEC_BASENAME_RE.test(normalized) &&
    TEST_ROOT_SEGMENTS.some(segment => normalized.includes(segment))
  )
}

// A regex literal that fills a whole call argument. Read left to right:
//   (?<open>[(,])   the delimiter that OPENS the argument — a call's `(` or
//                   the `,` between two arguments. Captured and put back, so
//                   the surrounding call shape survives the strip.
//   (?<lead>\s{0,8}) the formatter's gap between the delimiter and the regex,
//                   which oxfmt may turn into a newline plus indent.
//   \/[^/\n]{1,200}\/  the literal itself: single line, no inner slash, so a
//                   quoted path (`'/tmp/x'`) and a division can never pair up
//                   as one. Bounded, so no unbounded backtracking.
//   [dgimsuvy]*     regex flags.
//   (?=\s{0,8}[),]) LOOKAHEAD for the delimiter that CLOSES the argument. A
//                   lookahead rather than a match, so the `,` between two
//                   adjacent regex arguments is still available to open the
//                   next one.
const PHRASE_ASSERTION_REGEX_ARGUMENT_RE =
  /(?<open>[(,])(?<lead>\s{0,8})\/[^/\n]{1,200}\/[dgimsuvy]*(?=\s{0,8}[),])/g

/**
 * Replace every whole-argument regex literal with a space, so the phrase scan
 * reads the surrounding code without them. Half two of the emission-guard
 * carve-out — call it only for a path {@link isVitestSpecPath} accepts.
 */
export function stripPhraseAssertionRegexLiterals(text: string): string {
  return text.replace(PHRASE_ASSERTION_REGEX_ARGUMENT_RE, '$<open>$<lead> ')
}
