/*
 * @file Rule-facing helpers for the `@lockstep-mirror` exemption — the sibling
 *   of `fleet-paths.mts` for the lockstep-mirror concern. A verbatim upstream
 *   mirror (a shim kept byte-close to its upstream source, e.g. a conformance
 *   shim re-exposing upstream's API so upstream's OWN test suite runs against a
 *   port) legitimately fights the fleet's fidelity rules: the upstream test
 *   `import Yoga from "../../yoga.js"` REQUIRES a default export, the mirror is
 *   a 1400-line cohesive unit that can't split, and the idiom rules (sort-*,
 *   prefer-undefined-over-null, …) would rewrite it away from its upstream
 *   shape. A file that carries the validated `@lockstep-mirror` header marker
 *   (grammar + parser in `comment-markers.mts`) opts out of exactly the rules
 *   in `LOCKSTEP_MIRROR_EXEMPT_RULES` and nothing else.
 *
 *   Two coupled surfaces consume this:
 *
 *   - socket/* fidelity rules self-exempt: each calls `isLockstepMirror(context)`
 *     and returns `{}` (no visitors) on a marked mirror — the same shape as the
 *     existing `isConfigEntrypoint` / `isPluginInternalPath` guards. A rule that
 *     never consults `isLockstepMirror` can never be silenced by the marker, so
 *     the exempt set is bounded structurally, not by a blanket path ignore.
 *   - rules the fleet does NOT own (oxlint core, e.g. `curly`) can't self-exempt,
 *     so they route through a marker-gated file-scope `oxlint-disable` that
 *     `no-file-scope-oxlint-disable` PERMITS only when every named rule is in
 *     `LOCKSTEP_MIRROR_EXEMPT_RULES`.
 *
 *   `LOCKSTEP_MIRROR_EXEMPT_RULES` is the ONE source of the exempted-rule set;
 *   the validation check (`lockstep-mirror-markers-are-declared`) re-asserts
 *   membership for defense-in-depth.
 */

import { parseLockstepMirrorMarker, sourceTextOf } from './comment-markers.mts'
import type { RuleContext } from './rule-types.mts'

/**
 * The rules a declared `@lockstep-mirror` file is exempt from — the single
 * source of truth. socket/* entries are the fidelity rules that self-exempt via
 * `isLockstepMirror`; `curly` (and any future non-socket core rule) is exempt
 * only through a marker-gated file-scope disable that
 * `no-file-scope-oxlint-disable` allows. Keep this list in sync with the
 * per-rule guards; the validation check asserts a file-scope disable on a
 * mirror names nothing outside it.
 */
export const LOCKSTEP_MIRROR_EXEMPT_RULES: readonly string[] = [
  'curly',
  'socket/export-top-level-functions',
  'socket/max-file-lines',
  'socket/no-default-export',
  'socket/no-file-scope-oxlint-disable',
  'socket/prefer-function-declaration',
  'socket/prefer-node-builtin-imports',
  'socket/prefer-undefined-over-null',
  'socket/sort-array-literals',
  'socket/sort-boolean-chains',
  'socket/sort-equality-disjunctions',
  'socket/sort-named-imports',
  'socket/sort-object-literal-properties',
  'socket/sort-regex-alternations',
  'socket/sort-set-args',
  'socket/sort-source-methods',
]

const EXEMPT_RULE_SET = new Set(LOCKSTEP_MIRROR_EXEMPT_RULES)

/**
 * True when the file currently being linted carries a well-formed
 * `@lockstep-mirror` header marker. Reads the raw source text (engine-version-
 * independent, exactly like `makeBypassChecker`) and delegates grammar to
 * `parseLockstepMirrorMarker` so the marker is recognized identically by rules,
 * the validator, and the format-deriver. Rules guard with
 * `if (isLockstepMirror(context)) return {}`.
 */
export function isLockstepMirror(context: RuleContext): boolean {
  return parseLockstepMirrorMarker(sourceTextOf(context)) !== undefined
}

/**
 * True when the rule named by an `oxlint-disable <rule>` directive is one a
 * declared lockstep mirror may exempt via a file-scope disable. Bare oxlint
 * core names (`curly`) and `socket/<id>` names are matched as authored.
 */
export function isLockstepMirrorExemptRule(ruleName: string): boolean {
  return EXEMPT_RULE_SET.has(ruleName.trim())
}
