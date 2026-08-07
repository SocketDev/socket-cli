/*
 * @file The one suppression syntax and the names it uses. The fleet used to
 *   carry two: `// socket-lint: allow <marker>` for its own scanners and
 *   `// oxlint-disable-next-line socket/<rule>` for the linter. Two syntaxes
 *   meant two placement rules, two parsers, and a marker vocabulary that never
 *   matched the rule names it stood for (`uncommented-regex` for
 *   `require-regex-comment`). Everything is the linter's form now.
 *
 *   Nothing is lost by moving the fleet-only scanners onto it. oxlint ignores a
 *   disable directive naming a rule it does not have, so a hook-only scanner
 *   can claim a `socket/<rule>` name and suppress on it without oxlint
 *   objecting — verified against the pinned oxlint, and pinned by a test here.
 *
 *   `MARKER_RULE_NAMES` maps every marker the fleet ever wrote to the rule name
 *   that replaces it. It exists so the migration is one table rather than a
 *   regex per scanner, and so a member repo carrying an old marker gets a
 *   readable name in the error instead of silence.
 */

/**
 * A line-scoped suppression: the linter's own `-disable-next-line`, carrying a
 * comma-separated rule list and an optional ` -- <reason>`. Matched anywhere on
 * the line so the trailing form (`code() // oxlint-disable-line rule`) counts.
 *
 * The comment opener is OPTIONAL because callers feed this two different
 * shapes: a raw source line, which has one, and an AST comment's `value`, which
 * oxlint hands over with the opener already stripped. Requiring it would make
 * every rule that reads comment nodes silently stop honoring waivers.
 *
 * Multiline, so `$` closes at end of LINE. A file-level reader hands over the
 * whole source text, and an end-of-string anchor would see only the last line.
 */
export const SUPPRESSION_RE: RegExp =
  /(?:#|\/\*|\/\/)?\s*(?:eslint|oxlint)-disable(?:-line|-next-line)?\s+(?<rules>[^-\s][^\n]*?)(?:\s--\s|\s*\*\/|$)/m

/**
 * Every marker name the fleet wrote under the old syntax, mapped to the rule
 * that replaces it. Names on the left are historical; names on the right are
 * what the scanners read now.
 *
 * The right-hand side is a real oxlint plugin rule wherever one exists. The
 * seven that have none belong to scanners that run at commit or edit time on
 * surfaces oxlint never lints (workflow YAML, `.gitmodules`, a submodule
 * stanza), so they claim a `socket/` name of their own and read it themselves.
 */
export const MARKER_RULE_NAMES: Readonly<Record<string, string>> =
  Object.freeze({
    __proto__: null,
    'bag-param-optionality-naming': 'socket/bag-param-optionality-naming',
    'bare-semver': 'socket/prefer-lib-versions-over-semver',
    'bare-spawn-access': 'socket/no-bare-spawn-childproc-access',
    'boolean-trap': 'socket/no-boolean-trap-param',
    capture: 'socket/prefer-non-capturing-group',
    console: 'socket/no-console-prefer-logger',
    'cross-repo': 'socket/no-cross-repo-path',
    'deprecated-marker': 'socket/no-deprecation',
    // Historical name.
    // oxlint-disable-next-line socket/no-eslint-biome-config-ref -- historical
    'eslint-biome-ref': 'socket/no-eslint-biome-config-ref',
    'gitmodules-no-comment': 'socket/gitmodules-entry-has-comment',
    'global-fetch': 'socket/no-fetch-prefer-http-request',
    'inline-defer': 'socket/no-inline-defer-async',
    'literal-ellipsis': 'socket/prefer-ellipsis-char',
    // The original name for `console`, kept because members still carry it.
    logger: 'socket/no-console-prefer-logger',
    'logger-decoration': 'socket/no-logger-newline-literal',
    'long-comment-block': 'socket/max-comment-block-lines',
    'malformed-bypass-marker': 'socket/no-malformed-bypass-marker',
    'no-required-in-options-bag': 'socket/no-required-in-options-bag',
    npx: 'socket/no-npx-dlx',
    'object-property-order': 'socket/sort-object-literal-properties',
    'optional-positional-trap': 'socket/no-optional-positional-trap',
    'options-null-proto': 'socket/options-null-proto',
    'options-param-mutation': 'socket/no-options-param-mutation',
    'options-param-naming': 'socket/options-param-naming',
    'personal-path': 'socket/personal-path-placeholders',
    'pnpm-first': 'socket/docs-lead-with-pnpm',
    'pr-process-comment': 'socket/no-pr-process-comment',
    'private-path': 'socket/no-private-path-in-source',
    'process-stdio': 'socket/no-direct-stream-write',
    'raw-windows-test': 'socket/prefer-windows-test-helpers',
    'redundant-spread-fallback': 'socket/no-redundant-spread-fallback',
    'regex-alternation-order': 'socket/sort-regex-alternations',
    'schema-lib': 'socket/prefer-typebox-schema',
    'soak-exclude-no-date-annotation': 'socket/soak-exclude-has-date',
    'soak-window': 'socket/soak-window-is-honored',
    'socket-api-key': 'socket/socket-api-token-env',
    'source-method-order': 'socket/sort-source-methods',
    'spawn-stream-double-consume': 'socket/no-spawn-stream-double-consume',
    'spawnsync-code-field': 'socket/no-spawnsync-code-field',
    'stat-for-metadata': 'socket/prefer-exists-sync',
    'structured-clone': 'socket/no-structured-clone-prefer-json',
    'top-level-await': 'socket/no-top-level-await',
    'uncommented-regex': 'socket/require-regex-comment',
    'uses-no-stamp': 'socket/workflow-uses-has-stamp',
    'which-lookup': 'socket/no-which-for-local-bin',
  } as unknown as Record<string, string>)

/**
 * The rule a historical marker name became, or undefined when the name was
 * never one of ours. Callers use it to name the replacement in an error rather
 * than leaving an operator to guess.
 */
export function ruleNameForMarker(marker: string): string | undefined {
  return Object.hasOwn(MARKER_RULE_NAMES, marker)
    ? MARKER_RULE_NAMES[marker]
    : undefined
}

/**
 * The rule names a suppression comment on `line` covers, in written order.
 * Empty when the line carries no suppression.
 *
 * Reads the comma-separated list the linter defines, so a single directive can
 * waive several rules and the fleet scanners agree with oxlint about what it
 * covers.
 */
export function suppressedRuleNames(line: string): string[] {
  const list = SUPPRESSION_RE.exec(line)?.groups?.['rules']
  if (!list) {
    return []
  }
  return list
    .split(',')
    .map(name => name.trim())
    .filter(Boolean)
}

/**
 * Whether a suppression ON `line` waives `rule` for THAT line.
 *
 * Only `-disable-line` counts. A trailing `-disable-next-line` reads like a
 * same-line opt-out and is not one: oxlint applies it to the line BELOW, so
 * honoring it here would waive a line the author never waived and leave the
 * next one excused by accident.
 */
export function suppressionWaivesOwnLine(line: string, rule: unknown): boolean {
  return /-disable-line\b/.test(line) && suppressionWaives(line, rule)
}

/**
 * Whether a suppression on `line` waives `rule` for the line BELOW it.
 *
 * Only `-disable-next-line` counts, and only when the directive is the whole
 * comment: a `-disable-line` above covers its own line, not this one.
 */
export function suppressionWaivesNextLine(
  line: string,
  rule: unknown,
): boolean {
  return /-disable-next-line\b/.test(line) && suppressionWaives(line, rule)
}

/**
 * Whether a suppression on `line` waives `rule`.
 *
 * `rule` is the scanner's own `socket/<name>`; a bare `<name>` is accepted too,
 * so a caller can ask with either spelling.
 */
export function suppressionWaives(line: string, rule: unknown): boolean {
  // A cascaded member can run a NEWER copy of this reader against an OLDER
  // caller that still passes a regex. Answering false there keeps the lint run
  // alive through that window; throwing would take every rule down with it.
  if (typeof rule !== 'string') {
    return false
  }
  // Callers ask by whatever name they have always used, including the marker
  // name that predates the rule (`npx` for `socket/no-npx-dlx`). Resolving here
  // means every scanner keeps its own vocabulary and still matches a converted
  // line, so the migration needed no edit at the call sites.
  const canonical = ruleNameForMarker(rule) ?? rule
  const bare = canonical.startsWith('socket/')
    ? canonical.slice('socket/'.length)
    : canonical
  const names = suppressedRuleNames(line)
  for (let i = 0, { length } = names; i < length; i += 1) {
    const name = names[i]!
    if (name === canonical || name === bare || name === `socket/${bare}`) {
      return true
    }
  }
  return false
}
