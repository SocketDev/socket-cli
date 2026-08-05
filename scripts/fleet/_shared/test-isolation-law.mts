/*
 * @file The test-isolation law, as code. A test suite that spawns a package
 *   manager writes into the home directory of whoever ran it unless every
 *   child process is pointed somewhere else first. This module is the single
 *   importable statement of the three rules that hold, so the guard, the
 *   sweep, and any agent prompt cite the same law instead of re-deriving it.
 *   `docs/agents.md/fleet/test-layout.md` ("Isolation") is the doctrine page;
 *   this is its executable half.
 *   The incident, 2026-08-02, socket-patch: the CLI integration suites do real
 *   installs as fixture setup — npm, corepack yarn/pnpm, bun, go build, pip,
 *   gem, bundler — and none is `#[ignore]`d, so a plain `cargo test` ran them
 *   all with no environment of their own. One full run left 3,601 files in the
 *   developer's home. It also made results depend on what happened to be lying
 *   around: a fixture install succeeds against something an unrelated run
 *   cached, then fails on a clean CI runner. Closing it produced three rules,
 *   each of which cost a separate discovery:
 *
 *   - AVAILABILITY PROBES LEAK TOO. `has_command("pnpm")` looked inert. Where
 *     `pnpm` is a corepack shim, `pnpm --version` makes corepack download the
 *     entire package manager: 907 files from one probe, more than most of the
 *     actual installs leaked. The corollary is not just hygiene — an
 *     unisolated probe answers for a different environment than the install
 *     will run in, so it is also WRONG. Any command a test spawns gets the
 *     isolation, including version checks, `--help`, and existence probes.
 *   - SCRUB ORDER IS LOAD-BEARING. `e2e_vendor_yarn_classic_dev_flow.rs`
 *     seeded a private `YARN_CACHE_FOLDER`, then called a scrub helper whose
 *     last act is `env_remove("YARN_CACHE_FOLDER")` — wiping the override it
 *     had just set, so every fixture install silently used the developer's
 *     global cache (165 files, measured). Its sibling file carries a comment
 *     about having fixed exactly this; the newer file reintroduced it. Scrub
 *     the ambient environment FIRST, then apply the overrides. A helper that
 *     removes variables must never run after the code that sets them.
 *   - ISOLATION MUST NOT DISABLE THE TOOLCHAIN IT PROTECTS. rbenv, pyenv, nvm,
 *     fnm, volta, asdf, mise, sdkman and rustup all live under `$HOME`.
 *     Redirect `HOME` naively and the shim cannot find its root and fails to
 *     launch — which a suite that treats a missing tool as SKIP will swallow,
 *     silently dropping coverage while looking green. Seed each version-manager
 *     root from the real home when it is not already exported and the directory
 *     exists, and assert the tools still resolve.
 *
 *   `testIsolationSmells` is ADVISORY, named so no caller mistakes it for a
 *   gate. What it CANNOT see, stated plainly so nobody reads a clean run as
 *   proof:
 *
 *   - Cross-file isolation. A spawn wrapped by a helper in another file reads
 *     as unisolated. Pass the project's helper name through
 *     `options.isolationCalls`; a same-file helper is already understood
 *     because the spawn is inside it.
 *   - Whether the isolation is CORRECT. That a function calls `isolate()`
 *     proves nothing about which variables it pins. Only the isolation
 *     module's own self-tests can hold that, which is why
 *     {@link ISOLATED_ENV_VARS} is exported as data to assert against.
 *   - A spawn through a shell string (`sh -c "pnpm install"`), a program held
 *     in a struct field, or a builder assembled across two functions.
 *   - A JS/TS environment written as an object LITERAL
 *     (`{ ...process.env, HOME: dir }`). The assignment form
 *     (`env.HOME = dir`) is seen; the literal is not.
 *   - The origin scrub-order case in its exact form. The caller fed
 *     `YARN_CACHE_FOLDER` in through a `for (k, v) in extra_env` loop, so no
 *     literal key was visible at the set site. It is caught here only because
 *     the scrub removes a name in {@link ISOLATED_ENV_VARS} — removing a
 *     cache-redirect variable after setting env is a bug whatever fed it.
 *     A scrub of keys the law does not know is not reported at all: every
 *     pattern tried for it also matched a legitimate disjoint-key scrub.
 *   - The cost of clause 3. A suite that lost coverage because a shim could
 *     not launch still looks green; nothing in the source text says so.
 *
 *   Reading the source is `spawn-env-scan.mts`, which lists its own limits.
 *   Measured precision, so a future edit has a baseline: over the 142 files of
 *   the socket-patch CLI test tree AFTER the fix landed, 24 findings, all of
 *   them real unisolated spawns; over the 1,467 files of the wheelhouse's own
 *   `test/` tree, 1. Both incident files fire before the fix and go silent
 *   after it.
 */

import {
  envRemovedKey,
  envRemovedKeys,
  envSetKey,
  sourceFunctions,
  spawnProgram,
} from './spawn-env-scan.mts'

import type { SourceFunction } from './spawn-env-scan.mts'

/**
 * The three clauses.
 */
export type TestIsolationRuleId =
  | 'probes-are-isolated'
  | 'scrub-before-override'
  | 'toolchain-survives-home-redirect'

/**
 * One clause of the law, as data: what to do, what happened when it was not
 * done, and the shape that fixes it.
 */
export interface TestIsolationLawEntry {
  id: TestIsolationRuleId
  /**
   * The measured failure the clause was extracted from.
   */
  incident: string
  /**
   * The corrected shape, in one sentence.
   */
  remedy: string
  rule: string
}

/**
 * One advisory finding.
 */
export interface TestIsolationSmell {
  /**
   * What to do about it, in one sentence.
   */
  detail: string
  /**
   * The environment variable the finding is about, when one is named.
   */
  key?: string | undefined
  /**
   * 1-based line the finding sits on.
   */
  line: number
  rule: TestIsolationRuleId
  /**
   * The enclosing function's name, or `line <n>` outside any function.
   */
  where: string
}

/**
 * Caller adjustments. `isolationCalls` names the project's own isolation
 * helper so a spawn it wraps is not reported.
 */
export interface TestIsolationOptions {
  isolationCalls?: readonly string[] | undefined
}

/**
 * Files one unisolated probe left in the developer's home: `pnpm --version`
 * against a corepack shim downloads the whole package manager.
 */
export const PROBE_LEAKED_FILES = 907

/**
 * Files the scrub-order bug leaked: the private yarn cache was wiped after
 * being set, so every fixture install used the global one.
 */
export const SCRUB_ORDER_LEAKED_FILES = 165

/**
 * Files one full run of the socket-patch CLI integration suites left in the
 * home directory before any of this was fixed.
 */
export const SUITE_LEAKED_FILES = 3601

/**
 * Every variable an isolation helper must pin, because each one outranks
 * `HOME` for the tool that reads it: setting `HOME` alone leaves the real
 * cache in play whenever a developer — or a CI action, `pnpm/action-setup`
 * exports `PNPM_HOME` — has one exported. Two that catch people out: `GOCACHE`
 * is a SEPARATE cache from `GOPATH`/`GOMODCACHE`, and `COREPACK_HOME` holds
 * the package managers corepack downloads.
 */
export const ISOLATED_ENV_VARS: readonly string[] = Object.freeze([
  'BUNDLE_USER_HOME',
  'BUN_INSTALL',
  'BUN_INSTALL_CACHE_DIR',
  'CARGO_HOME',
  'COMPOSER_CACHE_DIR',
  'COMPOSER_HOME',
  'COREPACK_HOME',
  'GEM_SPEC_CACHE',
  'GOCACHE',
  'GOMODCACHE',
  'GOPATH',
  'HOME',
  'NUGET_HTTP_CACHE_PATH',
  'NUGET_PACKAGES',
  'PIP_CACHE_DIR',
  'PNPM_HOME',
  'USERPROFILE',
  'UV_CACHE_DIR',
  'XDG_CACHE_HOME',
  'XDG_DATA_HOME',
  'XDG_STATE_HOME',
  'YARN_CACHE_FOLDER',
  'YARN_GLOBAL_FOLDER',
  'npm_config_cache',
])

/**
 * The version-manager roots clause 3 is about, each with its default
 * directory under the real home. A redirected `HOME` that does not carry
 * these over makes the tool itself unresolvable — an rbenv shim that cannot
 * find `~/.rbenv` never launches ruby, and the suite prints SKIP.
 */
export const TOOLCHAIN_ROOT_VARS: ReadonlyArray<{
  dir: string
  name: string
}> = Object.freeze([
  Object.freeze({ dir: '.asdf', name: 'ASDF_DATA_DIR' }),
  Object.freeze({ dir: '.asdf', name: 'ASDF_DIR' }),
  Object.freeze({ dir: '.fnm', name: 'FNM_DIR' }),
  Object.freeze({ dir: '.config/mise', name: 'MISE_CONFIG_DIR' }),
  Object.freeze({ dir: '.local/share/mise', name: 'MISE_DATA_DIR' }),
  Object.freeze({ dir: '.nvm', name: 'NVM_DIR' }),
  Object.freeze({ dir: '.pyenv', name: 'PYENV_ROOT' }),
  Object.freeze({ dir: '.rbenv', name: 'RBENV_ROOT' }),
  Object.freeze({ dir: '.rustup', name: 'RUSTUP_HOME' }),
  Object.freeze({ dir: '.sdkman', name: 'SDKMAN_DIR' }),
  Object.freeze({ dir: '.volta', name: 'VOLTA_HOME' }),
])

/**
 * Programs that write a cache under the home directory. A spawn of one of
 * these from a test is in scope for clause 1 whether or not it is a probe.
 */
export const CACHE_WRITING_COMMANDS: readonly string[] = Object.freeze([
  'bun',
  'bundle',
  'bundler',
  'cargo',
  'composer',
  'corepack',
  'deno',
  'dotnet',
  'gem',
  'go',
  'gradle',
  'mvn',
  'npm',
  'npx',
  'nuget',
  'pip',
  'pip3',
  'pnpm',
  'poetry',
  'python',
  'python3',
  'uv',
  'yarn',
])

/**
 * Helper names that count as applying the isolation. Extend per project via
 * `options.isolationCalls` rather than editing this list.
 */
export const DEFAULT_ISOLATION_CALLS: readonly string[] = Object.freeze([
  'isolate',
  'isolateCommand',
  'isolateEnv',
  'isolate_env',
  'isolated_env',
  'withIsolatedEnv',
])

/**
 * Arguments that mark a spawn as an availability probe rather than real work.
 * Long forms only, and matched as a whole quoted token: a bare `version`
 * matched the `"version"` key of a `package.json` fixture string, and `-h`
 * matched `chflags -h`. A probe spelled `-V` is missed; that is the price of
 * a sweep worth reading.
 */
export const PROBE_ARGS: readonly string[] = Object.freeze([
  '--help',
  '--version',
])

/**
 * The three clauses, in the order they were learned (not sorted — the order
 * is the lesson: isolate everything, isolate it in the right order, and do
 * not break the toolchain doing it).
 */
export const TEST_ISOLATION_LAW: readonly TestIsolationLawEntry[] =
  Object.freeze([
    Object.freeze({
      id: 'probes-are-isolated' as TestIsolationRuleId,
      incident: `A bare has_command("pnpm") probe left ${PROBE_LEAKED_FILES} files in the home directory — where pnpm is a corepack shim, "pnpm --version" downloads the whole package manager.`,
      remedy:
        'Apply the isolation to the Command before it is spawned, probes included.',
      rule: 'Every command a test spawns gets the isolation — version checks, --help, and existence probes included. An unisolated probe both leaks and answers for a different environment than the install will run in.',
    }),
    Object.freeze({
      id: 'scrub-before-override' as TestIsolationRuleId,
      incident: `A scrub helper ending in env_remove("YARN_CACHE_FOLDER") ran AFTER the private cache was seeded, wiping it, and every fixture install used the developer's global cache (${SCRUB_ORDER_LEAKED_FILES} files).`,
      remedy:
        'Scrub, then isolate, then apply the test-specific env — last write per name wins.',
      rule: 'Scrub the ambient environment FIRST, then apply the overrides. A helper that removes variables must never run after the code that sets them.',
    }),
    Object.freeze({
      id: 'toolchain-survives-home-redirect' as TestIsolationRuleId,
      incident:
        'rbenv, pyenv, nvm, fnm, volta, asdf, mise, sdkman and rustup all root under $HOME; a naive redirect makes the shim unresolvable, and a suite that treats a missing tool as SKIP drops the coverage silently while staying green.',
      remedy:
        'Seed each version-manager root from the real home when it is unset and its directory exists, then assert the tools still resolve.',
      rule: 'Redirecting HOME must not disable the toolchain the tests need. Isolation that quietly turns tests into skips is worse than the leak it fixed.',
    }),
  ])

/**
 * The law as a verbatim prompt block, for any agent brief that may touch a
 * test that spawns a process. Paraphrase is how "isolate the installs"
 * decayed into leaving the probes bare.
 */
export const TEST_ISOLATION_LAW_PROMPT = [
  'Test-isolation law (verbatim, non-negotiable):',
  ...TEST_ISOLATION_LAW.map(entry => `- ${entry.rule}`),
  `Measured cost of ignoring it: ${SUITE_LEAKED_FILES} files written into the developer's home by one suite run, and fixture installs that pass locally against a warm global cache then fail on a clean runner.`,
].join('\n')

// `HOME` / `USERPROFILE` in a WRITE position, three shapes: quoted and
// preceded by an open paren, which covers `.env("HOME", dir)` and the Rust
// overrides tuple `("HOME", home.clone())`; quoted with a `:`/`=>` value; or
// an unquoted object key after `{` or `,`. The paren is what keeps a plain
// array of variable NAMES (`['FAKE_GH_API_EXIT', 'HOME', 'PATH']`, a test
// listing what it saves and restores) from reading as a redirect.
const HOME_KEY_RE =
  /\(\s*["'](?:HOME|USERPROFILE)["']\s*,|["'](?:HOME|USERPROFILE)["']\s*(?::|=>)\s*\S|[,{]\s*(?:HOME|USERPROFILE)\s*:\s*\S/

function isolationCallRe(names: readonly string[]): RegExp {
  const escaped = names.map(name => name.replace(/[$()*+.?[\\\]^{|}]/g, '\\$&'))
  // An optional `path::`/`obj.` qualifier, then one of the helper names, then
  // an open paren: matches `isolate(cmd)`, `cache_env::isolate(&mut cmd)`, and
  // `env.isolateCommand(cmd)`.
  return new RegExp(`(?:[\\w:.]+(?:::|\\.))?\\b(?:${escaped.join('|')})\\s*\\(`)
}

function probeFlagLine(bodyLines: readonly string[]): number {
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const line = bodyLines[i]!
    for (let j = 0, argCount = PROBE_ARGS.length; j < argCount; j += 1) {
      const arg = PROBE_ARGS[j]!
      if (line.includes(`"${arg}"`) || line.includes(`'${arg}'`)) {
        return i
      }
    }
  }
  return -1
}

function collectProbeSmells(
  fn: SourceFunction,
  isolationRe: RegExp,
  smells: TestIsolationSmell[],
): void {
  const { bodyLines } = fn
  let spawnLine = -1
  let program = ''
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const found = spawnProgram(bodyLines[i]!)
    if (found !== undefined && spawnLine === -1) {
      spawnLine = i
      program = found
    }
    if (isolationRe.test(bodyLines[i]!)) {
      return
    }
  }
  if (spawnLine === -1) {
    return
  }
  const probeLine = probeFlagLine(bodyLines)
  const cacheWriting = CACHE_WRITING_COMMANDS.includes(program)
  if (probeLine === -1 && !cacheWriting) {
    return
  }
  const line = fn.firstLine + (probeLine === -1 ? spawnLine : probeLine)
  smells.push({
    detail:
      probeLine === -1
        ? `\`${program}\` is spawned with no isolation call in \`${fn.name}\` — it writes its cache into the home directory of whoever runs the suite`
        : `an availability probe is spawned bare — a probe is what downloads a corepack-shimmed package manager (${PROBE_LEAKED_FILES} files), and an unisolated probe answers for a different environment than the install will run in`,
    line,
    rule: 'probes-are-isolated',
    where: fn.name,
  })
}

function collectScrubSmells(
  fn: SourceFunction,
  removalHelpers: ReadonlyMap<string, readonly string[]>,
  smells: TestIsolationSmell[],
): void {
  const { bodyLines } = fn
  const found: TestIsolationSmell[] = []
  const setKeys = new Set<string>()
  let firstSetLine = -1
  let spawns = false
  for (let i = 0, { length } = bodyLines; i < length; i += 1) {
    const line = bodyLines[i]!
    if (spawnProgram(line) !== undefined) {
      spawns = true
    }
    const setKey = envSetKey(line)
    if (setKey !== undefined) {
      if (firstSetLine === -1) {
        firstSetLine = i
      }
      if (setKey) {
        setKeys.add(setKey)
      }
    }
    if (firstSetLine === -1 || i === firstSetLine) {
      continue
    }
    const removed = envRemovedKey(line)
    if (removed) {
      pushScrubSmell(fn, i, removed, setKeys, undefined, found)
      continue
    }
    const helper = calledRemovalHelper(line, removalHelpers)
    if (!helper || helper === fn.name) {
      continue
    }
    const keys = removalHelpers.get(helper)!
    for (let j = 0, keyCount = keys.length; j < keyCount; j += 1) {
      pushScrubSmell(fn, i, keys[j]!, setKeys, helper, found)
    }
  }
  // The clause is about a command builder, so a plain env mutation in a
  // fixture helper that spawns nothing is out of scope.
  if (spawns) {
    smells.push(...found)
  }
}

function pushScrubSmell(
  fn: SourceFunction,
  offset: number,
  key: string,
  setKeys: ReadonlySet<string>,
  helper: string | undefined,
  smells: TestIsolationSmell[],
): void {
  // Only the cache-isolation names. A test that seeds a hostile decoy value
  // and then scrubs it is a real, deliberate pattern — narrowing to the
  // variables the law pins is what tells the two apart.
  const sameKey = setKeys.has(key)
  // A DIRECT removal names its key in the clear, so it is a finding only when
  // the same function set that key: removing a DIFFERENT cache variable
  // inline is an ordinary ambient scrub (`.env("GOMODCACHE", …)` then
  // `.env_remove("GOPATH")` is correct). A helper-mediated removal gets the
  // weaker test because the caller's keys are usually opaque — the origin
  // case fed them in through a `for (k, v) in extra_env` loop.
  if (!ISOLATED_ENV_VARS.includes(key) || (!helper && !sameKey)) {
    return
  }
  const via = helper ? `\`${helper}()\`, whose body removes it,` : 'the removal'
  smells.push({
    detail: sameKey
      ? `\`${key}\` is set earlier in \`${fn.name}\` and ${via} runs after — the cache override is wiped before the spawn; scrub first, then set`
      : `\`${key}\` is a cache-isolation variable and ${via} runs after this function sets env — that is the shape that silently sent ${SCRUB_ORDER_LEAKED_FILES} files to a developer's global cache; scrub first, then set`,
    key,
    line: fn.firstLine + offset,
    rule: 'scrub-before-override',
    where: fn.name,
  })
}

function calledRemovalHelper(
  line: string,
  removalHelpers: ReadonlyMap<string, readonly string[]>,
): string | undefined {
  for (const name of removalHelpers.keys()) {
    if (new RegExp(`\\b${name}\\s*\\(`).test(line)) {
      return name
    }
  }
  return undefined
}

function collectHomeSmells(source: string, smells: TestIsolationSmell[]): void {
  const lines = source.split('\n')
  let homeLine = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    if (homeLine === -1 && HOME_KEY_RE.test(lines[i]!)) {
      homeLine = i
    }
  }
  if (homeLine === -1) {
    return
  }
  for (let i = 0, { length } = TOOLCHAIN_ROOT_VARS; i < length; i += 1) {
    // oxlint-disable-next-line socket/no-source-sniffing -- this module scans other files' text by design.
    if (source.includes(TOOLCHAIN_ROOT_VARS[i]!.name)) {
      return
    }
  }
  smells.push({
    detail: `HOME is redirected but no version-manager root (${TOOLCHAIN_ROOT_VARS.map(v => v.name).join(', ')}) is carried over — a shim that cannot find its root fails to launch, and a suite that treats a missing tool as SKIP drops the coverage while staying green`,
    line: homeLine + 1,
    rule: 'toolchain-survives-home-redirect',
    where: `line ${homeLine + 1}`,
  })
}

/**
 * Every way the source diverges from the law, in plain sentences, sorted by
 * line. Empty means nothing smelled. ADVISORY — read the file header for what
 * it cannot see before treating a clean run as proof.
 */
export function testIsolationSmells(
  source: string,
  options?: TestIsolationOptions | undefined,
): TestIsolationSmell[] {
  const { isolationCalls } = {
    __proto__: null,
    ...options,
  } as TestIsolationOptions
  const isolationRe = isolationCallRe([
    ...DEFAULT_ISOLATION_CALLS,
    ...(isolationCalls ?? []),
  ])
  const functions = sourceFunctions(source)
  const removalHelpers = new Map<string, readonly string[]>()
  for (let i = 0, { length } = functions; i < length; i += 1) {
    const fn = functions[i]!
    const keys = envRemovedKeys(fn.bodyLines)
    if (keys.length > 0) {
      removalHelpers.set(fn.name, keys)
    }
  }
  const smells: TestIsolationSmell[] = []
  for (let i = 0, { length } = functions; i < length; i += 1) {
    const fn = functions[i]!
    collectProbeSmells(fn, isolationRe, smells)
    collectScrubSmells(fn, removalHelpers, smells)
  }
  collectHomeSmells(source, smells)
  return smells.toSorted((a, b) => a.line - b.line)
}
