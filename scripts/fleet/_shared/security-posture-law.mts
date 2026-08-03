/*
 * @file The fleet's GitHub security-posture law, as code. Repo SETTINGS are
 *   invisible to the cascade — no file changes when someone flips a toggle in
 *   a web UI, and nothing in a diff shows that a repo has been scanning
 *   nothing for months. This module is the single importable statement of what
 *   the posture must be, so the checker, any future fixer, and any agent
 *   prompt cite the same clauses instead of re-deriving them from a web page.
 *   `security-posture-probe.mts` is the reading half (gh payload parsers + the
 *   language-presence scanner); this half is pure, imports nothing, and says
 *   only what is ALLOWED.
 *
 *   THE INCIDENT, 2026-08-03, socket-vscode. Its CodeQL default setup read
 *   `state: configured` with languages
 *   `[actions, go, javascript, javascript-typescript, python, typescript]`,
 *   and only four of the six ever produced an analysis. `javascript`,
 *   `javascript-typescript`, and `typescript` are three NAMES FOR ONE
 *   EXTRACTOR, so configuring more than one conflicts and the extras error
 *   permanently. The repo sat at "Code scanning configuration error"
 *   indefinitely while every API read and every settings page still said
 *   `configured`. That is the worst shape a security control can take: it
 *   looks on, it reports on, and it is off.
 *   It is not a socket-vscode quirk. GitHub's SUGGESTED language list for
 *   EVERY not-yet-configured public fleet repo contains that same trio —
 *   socket-lib's suggestion is
 *   `[actions, c-cpp, javascript, javascript-typescript, typescript]` — so
 *   enabling scanning by accepting the suggestions would reproduce the fault
 *   on all fifteen. Sanitising the language set is therefore LAW, not
 *   preference: the fleet cannot turn code scanning on at all without it.
 *
 *   THE LANGUAGE-PRESENCE RULE, and why it is mechanical. A language is
 *   expected iff it is actually present in the tree — `git ls-files` matched
 *   against {@link CODEQL_LANGUAGE_GLOBS}, EXCLUDING any path with a
 *   `fixtures` segment, because fixture code is deliberately weird and mints
 *   findings nobody will ever action. Two different failures make this
 *   non-negotiable, and GitHub's suggestions cause both:
 *
 *   - An absent COMPILED language AUTOBUILD-ERRORS THE WHOLE SETUP. `c-cpp` is
 *     suggested on pure-TypeScript repos (socket-lib), `java-kotlin` on
 *     socket-cli and facts. CodeQL tries to build a language that is not there,
 *     the autobuilder fails, and the failure is not scoped to that language —
 *     it takes the run down, so the languages that WERE right stop being
 *     scanned too.
 *   - An absent INTERPRETED language wastes a CI lane scanning nothing, and
 *     teaches readers that a green code-scanning badge means less than it does.
 *
 *   `actions` is ALWAYS expected: every fleet repo runs workflows, and the
 *   actions extractor has no build step to fail.
 *
 *   THE DEPENDABOT POSTURE, stated once because two of its three parts read
 *   backwards to anyone who has not been bitten. The fleet wants the ALERTS
 *   without the PULL REQUESTS: vulnerability alerts ON so advisories show in
 *   the Security tab, `automated-security-fixes` OFF so nothing opens a PR,
 *   and fixes applied by hand through the `/updating-security` skill (pnpm
 *   `overrides:` for transitive deps). The trap is that the no-op
 *   `.github/dependabot.yml` (`open-pull-requests-limit: 0`) suppresses
 *   VERSION-UPDATE PRs and does NOT suppress SECURITY PRs — those flow from
 *   the separate `automated-security-fixes` repo setting. So a repo can carry
 *   the no-op file, look completely PR-free for months, and open an auto-PR
 *   the moment a real advisory lands against one of its deps. The file must
 *   still exist (GitHub refuses to fully disable Dependabot without it) and
 *   must never be deleted. Doctrine:
 *   `.claude/skills/fleet/cleaning-ci/SKILL.md` sections 2 and Phase 4.
 *
 *   WHAT THIS LAW CANNOT SEE — stated plainly so no clean run is read as
 *   proof:
 *
 *   - Whether a `configured` setup is actually PRODUCING analyses. The
 *     socket-vscode fault was visible in the analyses list, not in the
 *     default-setup payload; clause `one-js-extractor` catches the CAUSE, but
 *     a setup broken some other way still reads `configured` here.
 *   - Whether the alerts anyone gets are ACTIONED. Alerts-without-PRs is only
 *     better than PRs if someone reads the Security tab.
 *   - The fixture exclusion, when there is no local checkout. The
 *     `gh api …/languages` fallback is Linguist over the whole default branch
 *     and cannot exclude a `fixtures/` path, so a repo audited that way (sauce)
 *     may be expected to scan a language that exists only in fixtures.
 *   - Anything about PRIVATE and INTERNAL repos' scanning. Code scanning and
 *     secret scanning are paid GHAS there and answer `403 Code Security must
 *     be enabled`; clause `private-scanning-is-advisory` makes that the
 *     expected shape, so those nine repos are unaudited on those two clauses,
 *     not passing them.
 */

/**
 * The eight clauses.
 */
export type SecurityPostureRuleId =
  | 'automated-security-fixes-disabled'
  | 'dependabot-yml-is-canonical'
  | 'languages-match-presence'
  | 'one-js-extractor'
  | 'private-scanning-is-advisory'
  | 'public-code-scanning-configured'
  | 'public-secret-scanning-enabled'
  | 'vulnerability-alerts-enabled'

/**
 * GitHub's three repo visibilities. `internal` behaves like `private` for
 * every clause here: both need paid GHAS for scanning.
 */
export type RepoVisibility = 'internal' | 'private' | 'public'

/**
 * One clause of the law, as data: what must hold, what goes wrong when it does
 * not, and the shape that fixes it.
 */
export interface SecurityPostureLawEntry {
  id: SecurityPostureRuleId
  /**
   * The corrected shape, in one sentence — a command where one exists.
   */
  remedy: string
  rule: string
  /**
   * The failure the clause was extracted from.
   */
  why: string
}

/**
 * What one repo's code-scanning default setup answers. `ghas-required` is the
 * 403 shape private and internal repos return — an EXPECTED state, never a
 * fault (clause `private-scanning-is-advisory`).
 */
export interface CodeScanningProbe {
  readonly languages?: readonly string[] | undefined
  readonly querySuite?: string | undefined
  readonly state: 'configured' | 'ghas-required' | 'not-configured'
}

/**
 * Whether `.github/dependabot.yml` exists on the default branch, and its bytes
 * when it does. A missing file is a READABLE answer and a finding; an
 * unreadable read is `undefined` at the {@link PostureProbes} level and yields
 * nothing.
 */
export type DependabotYmlProbe =
  | { readonly kind: 'absent' }
  | { readonly kind: 'present'; readonly text: string }

/**
 * The two secret-scanning toggles, read from `security_and_analysis`.
 */
export interface SecretScanningProbe {
  readonly pushProtection: boolean
  readonly secretScanning: boolean
}

/**
 * Everything one sweep read about one repo. EVERY field is optional, and an
 * absent field means UNREADABLE — no network answer, an unexpected payload
 * shape, a 404. An unreadable probe yields NO finding: the law never invents a
 * verdict it cannot stand behind.
 */
export interface PostureProbes {
  readonly automatedSecurityFixes?: boolean | undefined
  readonly codeScanning?: CodeScanningProbe | undefined
  readonly dependabotYml?: DependabotYmlProbe | undefined
  readonly secretScanning?: SecretScanningProbe | undefined
  readonly vulnerabilityAlerts?: boolean | undefined
}

/**
 * What the law demands of one repo, derived from its visibility and the
 * languages mechanically present in its tree.
 */
export interface ExpectedPosture {
  /**
   * True for private and internal repos: scanning clauses report ADVISORIES
   * there, never findings (clause `private-scanning-is-advisory`).
   */
  readonly advisoryOnly: boolean
  readonly automatedSecurityFixes: false
  /**
   * The sanitised CodeQL language set — see {@link sanitizeCodeqlLanguages}.
   */
  readonly codeqlLanguages: readonly string[]
  readonly codeScanning: boolean
  readonly dependabotYml: string
  readonly querySuite: string
  readonly secretScanning: boolean
  readonly visibility: RepoVisibility
  readonly vulnerabilityAlerts: true
}

/**
 * One divergence from the law. `severity: 'advisory'` is a state worth SAYING
 * that must never fail a run — the paid-GHAS 403 on the nine private repos is
 * the whole reason the field exists.
 */
export interface SecurityPostureFinding {
  /**
   * What is wrong and what to do, in one sentence.
   */
  readonly detail: string
  readonly rule: SecurityPostureRuleId
  readonly severity: 'advisory' | 'finding'
}

/**
 * The ONE CodeQL identifier the fleet ever configures for JavaScript and
 * TypeScript. GitHub's own docs name it the successor of the split pair, and
 * it is the only member of {@link JS_TRIO} that covers both languages.
 */
export const CANONICAL_JS_IDENTIFIER = 'javascript-typescript'

/**
 * The three identifiers that all resolve to the SAME extractor. Configuring
 * two of them is the socket-vscode fault: the extras error permanently while
 * the setup still reads `configured`.
 */
export const JS_TRIO: readonly string[] = Object.freeze([
  'javascript',
  'javascript-typescript',
  'typescript',
])

/**
 * The query suite every fleet default setup runs. `extended` roughly doubles
 * the alert volume with a much worse precision profile; the fleet has no
 * triage capacity for that, and an unread alert is not a control.
 */
export const CODEQL_QUERY_SUITE = 'default'

/**
 * Languages expected on EVERY repo regardless of what the tree holds. Every
 * fleet repo runs workflows, and the `actions` extractor has no build step
 * that can fail, so it is free to leave on.
 */
export const ALWAYS_EXPECTED_LANGUAGES: readonly string[] = Object.freeze([
  'actions',
])

/**
 * Glob-per-CodeQL-identifier, the mechanical presence rule. Deliberately
 * extension-only: this decides whether a language EXISTS in the tree, and any
 * cleverer heuristic would be one more thing to be wrong about. Ordered by
 * identifier so a reader can find one.
 */
export const CODEQL_LANGUAGE_GLOBS: Readonly<
  Record<string, readonly string[]>
> = Object.freeze({
  __proto__: null,
  'c-cpp': Object.freeze([
    '*.c',
    '*.cc',
    '*.cpp',
    '*.cxx',
    '*.h',
    '*.hh',
    '*.hpp',
  ]),
  go: Object.freeze(['*.go']),
  'java-kotlin': Object.freeze(['*.java', '*.kt']),
  [CANONICAL_JS_IDENTIFIER]: Object.freeze([
    '*.cjs',
    '*.cts',
    '*.js',
    '*.jsx',
    '*.mjs',
    '*.mts',
    '*.ts',
    '*.tsx',
  ]),
  python: Object.freeze(['*.py']),
  ruby: Object.freeze(['*.rb']),
  rust: Object.freeze(['*.rs']),
  swift: Object.freeze(['*.swift']),
}) as unknown as Readonly<Record<string, readonly string[]>>

/**
 * A path segment whose contents never count toward language presence. Fixture
 * code is deliberately malformed, deliberately vulnerable, or deliberately in
 * a language the repo does not otherwise use — scanning it mints alerts nobody
 * will ever action, and one stray `.rb` fixture would otherwise pull a whole
 * extractor into the setup.
 */
export const EXCLUDED_PATH_SEGMENT = 'fixtures'

/**
 * The canonical `.github/dependabot.yml`, byte-for-byte. Alerts flow, PRs do
 * not, and the file exists because GitHub refuses to fully disable Dependabot
 * without one. Held as literal bytes so this module stays pure; the unit test
 * asserts it equals `template/base/.github/dependabot.yml` exactly, so the two
 * can never drift.
 */
export const CANONICAL_DEPENDABOT_YML = [
  '# Dependabot disabled - we manage dependencies manually',
  '# Using open-pull-requests-limit: 0 to disable version updates',
  '# See: https://docs.github.com/en/code-security/supply-chain-security/keeping-your-dependencies-updated-automatically/configuration-options-for-dependency-updates',
  'version: 2',
  'updates:',
  '  - package-ecosystem: npm',
  '    directory: /',
  '    schedule:',
  '      interval: yearly',
  '    open-pull-requests-limit: 0',
  '    cooldown:',
  '      default-days: 7',
  '',
].join('\n')

/**
 * The eight clauses, in reading order: what scanning must be on, what it must
 * scan, what Dependabot may and may not do, and where the law deliberately
 * stops.
 */
export const SECURITY_POSTURE_LAW: readonly SecurityPostureLawEntry[] =
  Object.freeze([
    Object.freeze({
      id: 'public-code-scanning-configured' as SecurityPostureRuleId,
      remedy:
        'PATCH repos/{owner}/{repo}/code-scanning/default-setup with state=configured, the sanitised language set, and query_suite=default.',
      rule: `Every PUBLIC repo runs CodeQL default setup: state \`configured\`, the sanitised language set, query suite \`${CODEQL_QUERY_SUITE}\`.`,
      why: 'Code scanning is FREE for public repos and fifteen of the sixteen were not-configured — a control nobody had to pay for and nobody had turned on.',
    }),
    Object.freeze({
      id: 'one-js-extractor' as SecurityPostureRuleId,
      remedy: `Configure only \`${CANONICAL_JS_IDENTIFIER}\`; never add \`javascript\` or \`typescript\` beside it.`,
      rule: `At most ONE of ${JS_TRIO.join(', ')} is ever configured, and it is \`${CANONICAL_JS_IDENTIFIER}\`.`,
      why: "All three name the same extractor, so configuring two conflicts and the extras error permanently. socket-vscode read `configured` for months while showing 'Code scanning configuration error', and GitHub SUGGESTS the full trio on every not-yet-configured public fleet repo.",
    }),
    Object.freeze({
      id: 'languages-match-presence' as SecurityPostureRuleId,
      remedy:
        "Derive the language set from `git ls-files` against CODEQL_LANGUAGE_GLOBS (fixtures excluded), never from GitHub's suggestions.",
      rule: 'The configured languages equal the languages mechanically PRESENT in the tree, plus `actions`.',
      why: 'An absent COMPILED language autobuild-errors and takes the whole run down with it, so the languages that were right stop being scanned too — c-cpp is suggested on pure-TypeScript socket-lib, java-kotlin on socket-cli and facts. An absent interpreted language just burns CI scanning nothing.',
    }),
    Object.freeze({
      id: 'vulnerability-alerts-enabled' as SecurityPostureRuleId,
      remedy: 'PUT repos/{owner}/{repo}/vulnerability-alerts (204 = enabled).',
      rule: 'EVERY repo — public, private, internal — has vulnerability alerts enabled.',
      why: "It is the only lane that puts advisories in the Security tab, it is free on every visibility, and with automated fixes off it is the fleet's sole notification of a vulnerable dependency.",
    }),
    Object.freeze({
      id: 'automated-security-fixes-disabled' as SecurityPostureRuleId,
      remedy:
        'gh api -X DELETE repos/{owner}/{repo}/automated-security-fixes (204 = disabled).',
      rule: 'EVERY repo has `automated-security-fixes` DISABLED — the fleet wants the alerts without the pull requests, and fixes land through /updating-security.',
      why: 'The no-op dependabot.yml suppresses VERSION-UPDATE PRs and does NOT cover the security lane, so a repo looks completely PR-free right up until a real advisory lands and Dependabot opens a PR against a dependency the fleet pins through pnpm overrides.',
    }),
    Object.freeze({
      id: 'dependabot-yml-is-canonical' as SecurityPostureRuleId,
      remedy:
        'Let the cascade write it — the canonical copy is template/base/.github/dependabot.yml. Never delete the file.',
      rule: 'EVERY repo carries `.github/dependabot.yml` byte-identical to the canonical no-op (`open-pull-requests-limit: 0`).',
      why: 'GitHub refuses to fully disable Dependabot without the file, so deleting it turns version-update PRs back on; a drifted copy silently re-enables whatever the drift added.',
    }),
    Object.freeze({
      id: 'public-secret-scanning-enabled' as SecurityPostureRuleId,
      remedy:
        'PATCH repos/{owner}/{repo} with security_and_analysis.secret_scanning and .secret_scanning_push_protection set to enabled.',
      rule: 'Every PUBLIC repo has secret scanning AND push protection enabled.',
      why: 'Both are free for public repos and both were off on all sixteen. Push protection is the half that matters most: it stops the credential before it is public, and a public leak is unrecoverable by revocation alone.',
    }),
    Object.freeze({
      id: 'private-scanning-is-advisory' as SecurityPostureRuleId,
      remedy:
        'Report the state and move on — buying GHAS is a budget decision, not a check failure.',
      rule: 'For PRIVATE and INTERNAL repos, code scanning and secret scanning are ADVISORY only and never a finding.',
      why: 'Both are paid GHAS there and answer `403 Code Security must be enabled`. Treating that as a finding would make nine repos permanently red for a state no commit can change — the shape that teaches people to ignore the gate.',
    }),
  ])

/**
 * The law as a verbatim prompt block, for any agent brief that may touch fleet
 * repo security settings. Paraphrase is how "sanitise the languages" would
 * decay back into accepting GitHub's suggestions.
 */
export const SECURITY_POSTURE_LAW_PROMPT = [
  'Fleet GitHub security-posture law (verbatim, non-negotiable):',
  ...SECURITY_POSTURE_LAW.map(entry => `- ${entry.rule}`),
  `Cost of ignoring the language clause: socket-vscode configured all three of ${JS_TRIO.join('/')}, which are one extractor, and sat at "Code scanning configuration error" indefinitely while every read said \`configured\`.`,
].join('\n')

/**
 * The one language set the fleet ever configures, built from a raw list (a
 * configured set, or GitHub's suggestions) and the languages mechanically
 * present in the tree.
 *
 * Three transforms, in order: collapse every member of {@link JS_TRIO} to
 * {@link CANONICAL_JS_IDENTIFIER}, drop anything not in `present`, and force
 * {@link ALWAYS_EXPECTED_LANGUAGES} back in. Sorted and deduped, so two calls
 * that mean the same thing compare equal. PURE.
 */
export function sanitizeCodeqlLanguages(input: {
  readonly present: readonly string[]
  readonly raw: readonly string[]
}): string[] {
  const presentSet = new Set<string>()
  for (let i = 0, { length } = input.present; i < length; i += 1) {
    const language = input.present[i]!
    presentSet.add(
      JS_TRIO.includes(language) ? CANONICAL_JS_IDENTIFIER : language,
    )
  }
  const out = new Set<string>(ALWAYS_EXPECTED_LANGUAGES)
  for (let i = 0, { length } = input.raw; i < length; i += 1) {
    const raw = input.raw[i]!
    const canonical = JS_TRIO.includes(raw) ? CANONICAL_JS_IDENTIFIER : raw
    // `actions` is already in `out` and is never dropped; everything else has
    // to earn its place by existing in the tree.
    if (presentSet.has(canonical)) {
      out.add(canonical)
    }
  }
  return [...out].toSorted()
}

/**
 * What the law demands of one repo. The expected language set is the
 * sanitised PRESENT set — the presence rule IS the expectation, so a repo's
 * own tree decides, never GitHub's suggestions. PURE.
 */
export function expectedPosture(input: {
  readonly presentLanguages: readonly string[]
  readonly visibility: RepoVisibility
}): ExpectedPosture {
  const isPublic = input.visibility === 'public'
  return {
    advisoryOnly: !isPublic,
    automatedSecurityFixes: false,
    codeqlLanguages: sanitizeCodeqlLanguages({
      present: input.presentLanguages,
      raw: input.presentLanguages,
    }),
    codeScanning: isPublic,
    dependabotYml: CANONICAL_DEPENDABOT_YML,
    querySuite: CODEQL_QUERY_SUITE,
    secretScanning: isPublic,
    visibility: input.visibility,
    vulnerabilityAlerts: true,
  }
}

// Two language sets are the same set when sorted-deduped they are equal.
function sameLanguages(a: readonly string[], b: readonly string[]): boolean {
  const left = [...new Set(a)].toSorted()
  const right = [...new Set(b)].toSorted()
  return left.length === right.length && left.every((v, i) => v === right[i])
}

// The scanning clauses (1, 2, 3, 7, 8). Severity follows visibility: on a
// private or internal repo every one of them is advisory, which is clause 8
// expressed as one branch instead of five special cases.
function scanningFindings(
  expected: ExpectedPosture,
  probes: PostureProbes,
  out: SecurityPostureFinding[],
): void {
  const severity = expected.advisoryOnly ? 'advisory' : 'finding'
  const { codeScanning } = probes
  if (codeScanning) {
    if (codeScanning.state === 'ghas-required') {
      out.push({
        detail: expected.advisoryOnly
          ? 'code scanning answered `403 Code Security must be enabled` — the expected shape for a private/internal repo without paid GHAS, so this repo is UNAUDITED on scanning, not passing it'
          : 'code scanning answered `403 Code Security must be enabled` on a PUBLIC repo, where it is free — something is wrong with the org plan or the token, and this repo is unaudited on scanning',
        rule: 'private-scanning-is-advisory',
        severity: 'advisory',
      })
    } else if (codeScanning.state !== 'configured') {
      out.push({
        detail: `code scanning default setup is \`${codeScanning.state}\` — CodeQL is free on a public repo and scans nothing until it is configured`,
        rule: 'public-code-scanning-configured',
        severity,
      })
    } else {
      const configured = codeScanning.languages
      if (configured) {
        const trio = configured.filter(language => JS_TRIO.includes(language))
        if (trio.length > 1) {
          out.push({
            detail: `${trio.length} of the one-extractor trio are configured (${trio.join(', ')}) — the extras error permanently while the setup still reads \`configured\`; keep only \`${CANONICAL_JS_IDENTIFIER}\``,
            rule: 'one-js-extractor',
            severity,
          })
        }
        if (!sameLanguages(configured, expected.codeqlLanguages)) {
          out.push({
            detail: `configured languages [${configured.join(', ')}] do not match the languages present in the tree [${expected.codeqlLanguages.join(', ')}] — an absent compiled language autobuild-errors and takes the whole run down`,
            rule: 'languages-match-presence',
            severity,
          })
        }
      }
      if (
        codeScanning.querySuite !== undefined &&
        codeScanning.querySuite !== expected.querySuite
      ) {
        out.push({
          detail: `query suite is \`${codeScanning.querySuite}\`, not \`${expected.querySuite}\``,
          rule: 'public-code-scanning-configured',
          severity,
        })
      }
    }
  }
  const secret = probes.secretScanning
  if (secret && (!secret.secretScanning || !secret.pushProtection)) {
    const off: string[] = []
    if (!secret.secretScanning) {
      off.push('secret scanning')
    }
    if (!secret.pushProtection) {
      off.push('push protection')
    }
    out.push({
      detail: `${off.join(' and ')} disabled — both are free on a public repo, and push protection is what stops the credential BEFORE it is public`,
      rule: 'public-secret-scanning-enabled',
      severity,
    })
  }
}

// The Dependabot clauses (4, 5, 6). These apply on every visibility at full
// severity: all three settings are free everywhere.
function dependabotFindings(
  expected: ExpectedPosture,
  probes: PostureProbes,
  out: SecurityPostureFinding[],
): void {
  if (probes.vulnerabilityAlerts === false) {
    out.push({
      detail:
        "vulnerability alerts are OFF — with automated fixes disabled by law, this is the fleet's only notification that a dependency is vulnerable",
      rule: 'vulnerability-alerts-enabled',
      severity: 'finding',
    })
  }
  if (probes.automatedSecurityFixes === true) {
    out.push({
      detail:
        'automated-security-fixes is ON — the no-op dependabot.yml does NOT cover the security lane, so this repo opens an auto-PR the moment a real advisory lands; disable with `gh api -X DELETE`',
      rule: 'automated-security-fixes-disabled',
      severity: 'finding',
    })
  }
  const { dependabotYml } = probes
  if (dependabotYml?.kind === 'absent') {
    out.push({
      detail:
        '.github/dependabot.yml is missing — GitHub refuses to fully disable Dependabot without it, so version-update PRs are live',
      rule: 'dependabot-yml-is-canonical',
      severity: 'finding',
    })
  } else if (
    dependabotYml?.kind === 'present' &&
    dependabotYml.text !== expected.dependabotYml
  ) {
    out.push({
      detail:
        '.github/dependabot.yml differs from the canonical no-op — the file flows through the cascade, so re-sync it rather than editing the repo',
      rule: 'dependabot-yml-is-canonical',
      severity: 'finding',
    })
  }
}

/**
 * Every way one repo diverges from the law, in plain sentences. Empty means
 * nothing diverged that this law can see — read the file header before
 * treating that as proof.
 *
 * An UNREADABLE probe (an absent field on {@link PostureProbes}) yields NO
 * entry at all, and a private/internal repo's scanning clauses yield
 * `severity: 'advisory'`, never `'finding'`. PURE.
 */
export function securityPostureFindings(
  expected: ExpectedPosture,
  probes: PostureProbes,
): SecurityPostureFinding[] {
  const out: SecurityPostureFinding[] = []
  scanningFindings(expected, probes, out)
  dependabotFindings(expected, probes, out)
  return out
}
