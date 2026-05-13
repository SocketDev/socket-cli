/**
 * @fileoverview Cross-file rule promotions for the path-hygiene gate.
 *
 * Rule F — same path shape constructed in 2+ DISTINCT files. Runs
 * after every scanner has populated `state.findings`. Walks the
 * Rule-A findings (the only ones that produce comparable snippets),
 * groups by the literal-segment shape of each snippet, and when a
 * shape appears in two or more distinct files, promotes those
 * findings to Rule F with a sharper message.
 *
 * Two hand-builds in a single file stay Rule A; the violation is
 * cross-FILE duplication of the construction.
 */

import { findings } from './state.mts'

import type { Finding } from './types.mts'

export const checkRuleF = (): void => {
  // A path is "constructed" each time we see a new path.join with a
  // matching shape. Group findings of Rule A by their snippet shape;
  // when the same shape appears in 2+ files, demote them to Rule F so
  // the message is more accurate.
  const byShape = new Map<string, Finding[]>()
  for (const f of findings) {
    if (f.rule !== 'A') {
      continue
    }
    // Normalize: strip whitespace, identifiers, surrounding context;
    // keep just the literal path-segment shape.
    const literalsRe = /'[^']*'|"[^"]*"/g
    const literals = (f.snippet.match(literalsRe) ?? []).join(',')
    if (!literals) {
      continue
    }
    const list = byShape.get(literals) ?? []
    list.push(f)
    byShape.set(literals, list)
  }
  for (const [shape, list] of byShape) {
    if (list.length < 2) {
      continue
    }
    // Rule F is "same path shape appears in two or more *files*" — two
    // hand-builds in a single file are still a Rule-A pattern, not a
    // cross-file duplication. Promote only when at least two distinct
    // files share the shape.
    const distinctFiles = new Set(list.map(f => f.file))
    if (distinctFiles.size < 2) {
      continue
    }
    for (const f of list) {
      f.rule = 'F'
      f.message = `Same path shape constructed in ${distinctFiles.size} files (${list.length} places): ${shape.slice(0, 100)}`
      f.fix =
        'Construct this path ONCE in a paths.mts (or build-infra helper) and import the computed value. References of the computed variable are unlimited; re-constructing the same shape twice is the violation.'
    }
  }
}
