/**
 * @file Pure, side-effect-free discovery + render helpers for the Homebrew soak
 *   slice. The CLI shell (`brew.mts`) and the offline gate
 *   (`check/brew-install-is-pinned.mts`) both build on these: shell-text +
 *   Brewfile parsing, tap-file resolution, soak math, Brewfile / tap-pin
 *   rendering. No `gh` spawn and no `process` reads live here — that keeps
 *   every piece unit-testable without a network. `brew.mts` re-exports this
 *   module, so consumers import from `brew.mts`.
 */

import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { findOwnFiles } from './_shared.mts'

import type { BrewTapPin } from '../constants/brew-tap-pins.mts'

const DAY_MS = 86_400_000

// A brew tool discovered from a `brew install` site or a Brewfile.
export interface BrewTool {
  cask: boolean
  // Declared explicitly (`--cask` / Brewfile). An explicit tool that resolves
  // to no tap file is surfaced; a bare discovered token is silently dropped.
  explicit: boolean
  // The token as written — plain (`pnpm`) or tap-qualified (`owner/tap/name`).
  name: string
}

// A resolved soak verdict for one deduplicated tool.
export interface BrewToolStatus {
  ageDays: number | undefined
  cask: boolean
  explicit: boolean
  name: string
  resolved: boolean
  soakCleared: boolean
}

// A tap file to probe: a GitHub repo + path within it.
export interface TapFile {
  path: string
  repo: string
}

// A resolved tap pin: the `sha` a tap is checked out at + its ISO committer
// date (the soak clock).
export interface ResolvedTapPin {
  committedAt: string
  sha: string
}

/**
 * Valid Homebrew formula/cask token, optionally tap-qualified (`a/b/c`).
 */
export function isValidBrewToken(token: string): boolean {
  return /^[a-z0-9][a-z0-9._+@-]*(?:\/[a-z0-9][a-z0-9._+@-]*){0,2}$/.test(token)
}

// Unquoted characters that end one shell statement and begin the next.
const STATEMENT_SEPARATORS = new Set(['\n', ';', '(', ')', '&', '|'])

// Sorted shell/YAML tokens that may lead a statement before the real command
// (control keywords, command wrappers, `- run:` step scaffolding). Skipped while
// scanning for a leading `brew`, so `sudo brew install` resolves but `echo … brew
// install` (echo leads) does not; `env VAR=x` assignments are matched separately.
const COMMAND_PREFIX_TOKENS = new Set(
  '! - command do elif else env exec if run: sudo then time until while'.split(
    ' ',
  ),
)

/**
 * True when `prefix` leaves no shell quote open. Text inside an `echo "…"` hint
 * string leaves its quote open, so a marker within it reads as quoted.
 */
export function isUnquotedPosition(prefix: string): boolean {
  let inSingle = false
  let inDouble = false
  for (let i = 0, { length } = prefix; i < length; i += 1) {
    const ch = prefix[i]
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    }
  }
  return !inSingle && !inDouble
}

/**
 * Splice shell line continuations: a trailing backslash before a newline joins
 * the next line onto this one, as the shell reads it before tokenizing.
 */
export function joinLineContinuations(text: string): string {
  return text.replace(/\\\r?\n/g, '')
}

/**
 * Drop a trailing comment from one line, quote-aware: an unquoted `#` anywhere,
 * or an unquoted `//` at line start / after whitespace (so `https://`
 * survives).
 */
export function stripLineComment(line: string): string {
  for (let i = 0, { length } = line; i < length; i += 1) {
    const ch = line[i]
    const isHash = ch === '#'
    const isDoubleSlash =
      ch === '/' &&
      line[i + 1] === '/' &&
      (i === 0 || line[i - 1] === ' ' || line[i - 1] === '\t')
    if ((isHash || isDoubleSlash) && isUnquotedPosition(line.slice(0, i))) {
      return line.slice(0, i)
    }
  }
  return line
}

/**
 * Split shell text into statements at unquoted separators (`; && || | &` and
 * subshell parens); a separator inside a quote does not cut. Callers pass one
 * line at a time, so a stray quote never desyncs the scan past its line.
 */
export function splitShellStatements(text: string): string[] {
  const statements: string[] = []
  let inSingle = false
  let inDouble = false
  let start = 0
  for (let i = 0, { length } = text; i < length; i += 1) {
    const ch = text[i]!
    if (ch === "'" && !inDouble) {
      inSingle = !inSingle
    } else if (ch === '"' && !inSingle) {
      inDouble = !inDouble
    } else if (!inSingle && !inDouble && STATEMENT_SEPARATORS.has(ch)) {
      statements.push(text.slice(start, i))
      start = i + 1
    }
  }
  statements.push(text.slice(start))
  return statements
}

/**
 * Extract brew tools from ONE statement — accepted only when `brew install`
 * lead its command tokens (after an optional prefix), which rejects `echo …
 * brew install …` prose. A redirection token (`>`, `2>&1`) ends the arguments.
 */
export function parseBrewInstallStatement(statement: string): BrewTool[] {
  const tokens = statement.split(/\s+/).filter(token => token !== '')
  let i = 0
  while (
    i < tokens.length &&
    (COMMAND_PREFIX_TOKENS.has(tokens[i]!) ||
      /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[i]!))
  ) {
    i += 1
  }
  if (tokens[i] !== 'brew' || tokens[i + 1] !== 'install') {
    return []
  }
  const tools: BrewTool[] = []
  let cask = false
  const raws = tokens.slice(i + 2)
  for (let j = 0, { length: jlen } = raws; j < jlen; j += 1) {
    const raw = raws[j]!
    if (/^\d*[<>]/.test(raw)) {
      break
    }
    if (raw === '--cask' || raw === '--casks') {
      cask = true
      continue
    }
    if (raw === '--formula') {
      cask = false
      continue
    }
    if (raw.startsWith('-') || !isValidBrewToken(raw)) {
      continue
    }
    tools.push({ cask, explicit: cask, name: raw })
  }
  return tools
}

/**
 * Extract brew tools from shell text — splice continuations, then per line
 * strip comments, split into statements, and keep a `brew install` only when
 * `brew` leads. Quote scope is per line, so an unbalanced quote elsewhere is
 * contained.
 */
export function parseBrewInstallCommands(text: string): BrewTool[] {
  const tools: BrewTool[] = []
  const rawLines = joinLineContinuations(text).split('\n')
  for (let i = 0, { length } = rawLines; i < length; i += 1) {
    const rawLine = rawLines[i]!
    for (const statement of splitShellStatements(stripLineComment(rawLine))) {
      tools.push(...parseBrewInstallStatement(statement))
    }
  }
  return tools
}

/**
 * Extract `cask "…"` / `brew "…"` declarations from a Brewfile (all explicit).
 */
export function parseBrewfile(text: string): BrewTool[] {
  const tools: BrewTool[] = []
  const lineList = text.split(/\r?\n/)
  for (let i = 0, { length } = lineList; i < length; i += 1) {
    const line = lineList[i]!
    // A Brewfile entry: capture 1 = the entry kind (brew formula or cask),
    // capture 2 = the quoted tool name (single or double quotes).
    const match = /^\s*(brew|cask)\s+["']([^"']+)["']/.exec(line)
    if (match) {
      tools.push({ cask: match[1] === 'cask', explicit: true, name: match[2]! })
    }
  }
  return tools
}

/**
 * Deduplicate by (kind, name); an explicit declaration wins over a bare one.
 * Returned sorted by name for stable output.
 */
export function dedupeBrewTools(tools: readonly BrewTool[]): BrewTool[] {
  const seen = new Map<string, BrewTool>()
  for (const tool of tools) {
    const key = `${tool.cask ? 'cask' : 'formula'}:${tool.name}`
    const prior = seen.get(key)
    if (!prior || (tool.explicit && !prior.explicit)) {
      seen.set(key, tool)
    }
  }
  return [...seen.values()].toSorted((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
  )
}

/**
 * The tap files to probe for a tool, in resolution order. A three-part token
 * (`owner/tap/name`) is a third-party tap `owner/homebrew-tap`; a bare token is
 * homebrew-core (with a homebrew-cask fallback) unless `cask` is set.
 */
export function tapFileCandidates(tool: BrewTool): TapFile[] {
  const parts = tool.name.split('/')
  if (parts.length === 3) {
    const [owner, tap, name] = parts as [string, string, string]
    const repo = `${owner}/homebrew-${tap}`
    return [
      { path: `Formula/${name}.rb`, repo },
      { path: `${name}.rb`, repo },
      { path: `Casks/${name}.rb`, repo },
      { path: `Formula/${name[0]!.toLowerCase()}/${name}.rb`, repo },
    ]
  }
  const { name } = tool
  const first = name[0]!.toLowerCase()
  if (tool.cask) {
    return [
      { path: `Casks/${first}/${name}.rb`, repo: 'Homebrew/homebrew-cask' },
    ]
  }
  return [
    { path: `Formula/${first}/${name}.rb`, repo: 'Homebrew/homebrew-core' },
    { path: `Casks/${first}/${name}.rb`, repo: 'Homebrew/homebrew-cask' },
  ]
}

/**
 * The `gh api` path returning the newest commit that touched a tap file.
 */
export function commitsApiPath(tapFile: TapFile): string {
  return `repos/${tapFile.repo}/commits?path=${tapFile.path}&per_page=1`
}

/**
 * Parse the committer date out of `gh api … --jq '.[0].commit.committer.date'`
 * output (a bare ISO string, or empty when the path resolved to no commits).
 */
export function parseCommitDate(stdout: string): Date | undefined {
  const trimmed = stdout.trim()
  if (trimmed === '') {
    return undefined
  }
  const date = new Date(trimmed)
  return Number.isNaN(date.getTime()) ? undefined : date
}

/**
 * Fractional days between two instants (`later - earlier`).
 */
export function daysBetween(earlier: Date, later: Date): number {
  return (later.getTime() - earlier.getTime()) / DAY_MS
}

/**
 * Under soak when the newest tap commit is younger than the window. An
 * unverifiable age (undefined) counts as under soak — fail-closed.
 */
export function isUnderSoak(
  lastModified: Date | undefined,
  soakDays: number,
  now: Date,
): boolean {
  if (!lastModified) {
    return true
  }
  return daysBetween(lastModified, now) < soakDays
}

/**
 * Resolve each tool's soak status. `fetchLastModified` (the newest tap commit
 * date, or undefined when unresolved) is injected so tests skip spawning `gh`.
 */
export async function checkBrewToolAges(
  tools: readonly BrewTool[],
  soakDays: number,
  now: Date,
  fetchLastModified: (tool: BrewTool) => Promise<Date | undefined>,
): Promise<BrewToolStatus[]> {
  const out: BrewToolStatus[] = []
  for (const tool of tools) {
    const lastModified = await fetchLastModified(tool)
    const resolved = lastModified !== undefined
    out.push({
      ageDays: resolved ? daysBetween(lastModified, now) : undefined,
      cask: tool.cask,
      explicit: tool.explicit,
      name: tool.name,
      resolved,
      soakCleared: resolved && !isUnderSoak(lastModified, soakDays, now),
    })
  }
  return out
}

/**
 * Files worth scanning for `brew install` invocations.
 */
export function isBrewScanFile(name: string): boolean {
  return (
    name === 'Brewfile' || /\.(?:bash|mjs|mts|sh|ts|yaml|yml|zsh)$/.test(name)
  )
}

/**
 * Every brew tool the repo references: `brew install` sites under `.github/`
 * and `scripts/` plus the `.config/repo/Brewfile`. Feeds the advisory planner.
 */
export function findBrewToolSites(root: string): BrewTool[] {
  const out: BrewTool[] = []
  for (const dir of ['.github', 'scripts']) {
    const abs = path.join(root, dir)
    if (!existsSync(abs)) {
      continue
    }
    for (const file of findOwnFiles(abs, isBrewScanFile)) {
      out.push(...parseBrewInstallCommands(readFileSync(file, 'utf8')))
    }
  }
  const brewfile = brewfilePath(root)
  if (existsSync(brewfile)) {
    out.push(...parseBrewfile(readFileSync(brewfile, 'utf8')))
  }
  return out
}

/**
 * The brew tools CI installs, from `.github/` only. This is the install
 * manifest surface — the Brewfile is what `brew bundle` installs in CI, so it
 * derives from the CI `brew install` sites, not from `scripts/` dev helpers
 * (whose prose about brew would leak non-tools into the manifest).
 */
export function findManifestBrewSites(root: string): BrewTool[] {
  const out: BrewTool[] = []
  const abs = path.join(root, '.github')
  if (existsSync(abs)) {
    for (const file of findOwnFiles(abs, isBrewScanFile)) {
      out.push(...parseBrewInstallCommands(readFileSync(file, 'utf8')))
    }
  }
  return out
}

/**
 * Render a repo-root Brewfile: one `brew "name"` / `cask "name"` line per
 * deduped tool, sorted; tap-qualified names keep their prefix. The `soak-days`
 * header mirrors `SOAK_DAYS` (a Brewfile can't import it) for the gate's parity
 * check. Pure + deterministic — the gate re-renders and byte-compares.
 */
export function renderBrewfile(
  tools: readonly BrewTool[],
  soakDays: number,
): string {
  const lines = [
    '# generated by scripts/fleet/update/brew.mts — do not hand-edit.',
    `# soak-days: ${soakDays} (mirrors SOAK_DAYS; installs come from a tap pinned >= this many days old).`,
  ]
  for (const tool of dedupeBrewTools(tools)) {
    lines.push(`${tool.cask ? 'cask' : 'brew'} "${tool.name}"`)
  }
  return `${lines.join('\n')}\n`
}

/**
 * The `until=` cutoff for a tap-pin query: the newest commit at or before this
 * instant is at least `soakDays` old, so every version present at it is soaked.
 */
export function buildUntilCutoff(now: Date, soakDays: number): string {
  return new Date(now.getTime() - soakDays * DAY_MS).toISOString()
}

/**
 * Parse `{ sha, committedAt }` from a `gh api repos/<tap>/commits` response (a
 * JSON array, newest first). Throws loud on an empty/malformed response — a tap
 * returning no commit at the cutoff is a hard error, never a silent skip.
 */
export function parsePinFromCommitsResponse(json: unknown): ResolvedTapPin {
  const rec = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {}
  const top = rec(Array.isArray(json) ? json[0] : undefined)
  const sha = top['sha']
  const committedAt = rec(rec(top['commit'])['committer'])['date']
  if (typeof sha !== 'string' || typeof committedAt !== 'string') {
    throw new Error(
      'Homebrew tap-pin query returned no usable commit.\n' +
        '  Where: gh api repos/<tap>/commits response\n' +
        `  Saw: ${JSON.stringify(json)?.slice(0, 120)}; wanted [{ sha, commit.committer.date }].\n` +
        '  Fix: check gh auth + the tap name, then re-run with --apply.',
    )
  }
  return { committedAt, sha }
}

// The static preamble of constants/brew-tap-pins.mts — everything above the
// generated `BREW_TAP_PINS` array. Kept here because --apply regenerates the
// whole file (it is script-owned); the gate re-imports the array.
const BREW_TAP_PINS_HEADER = `/**
 * @file Canonical Homebrew tap SHA pins — the ONE source the pinned-bundle CI
 *   flow reads to check each tap out at a commit at least \`SOAK_DAYS\` old.
 *   Every version present at that SHA is definitionally soaked, so one pin per
 *   tap soaks every install from it. Owned by
 *   \`scripts/fleet/update/brew.mts --apply\` (regenerated whole; never
 *   hand-edit), gated offline by
 *   \`scripts/fleet/check/brew-install-is-pinned.mts\` (each pin >= SOAK_DAYS
 *   old + internally consistent). Advance: \`node
 *   scripts/fleet/update/brew.mts --apply --soak-days N\`.
 */

export interface BrewTapPin {
  // ISO-8601 committer date of \`sha\` (YYYY-MM-DDTHH:MM:SSZ) — the soak clock.
  readonly committedAt: string
  // The commit the tap is checked out at during a pinned install.
  readonly sha: string
  // The tap repo, \`owner/repo\` form.
  readonly tap: 'Homebrew/homebrew-cask' | 'Homebrew/homebrew-core'
}
`

/**
 * The whole `constants/brew-tap-pins.mts` text for `pins`, sorted by tap.
 */
export function renderBrewTapPinsFile(pins: readonly BrewTapPin[]): string {
  const entries = [...pins]
    .toSorted((a, b) => (a.tap < b.tap ? -1 : a.tap > b.tap ? 1 : 0))
    .map(
      pin =>
        `  {\n    committedAt: '${pin.committedAt}',\n` +
        `    sha: '${pin.sha}',\n    tap: '${pin.tap}',\n  },`,
    )
    .join('\n')
  return `${BREW_TAP_PINS_HEADER}\nexport const BREW_TAP_PINS: readonly BrewTapPin[] = [\n${entries}\n]\n`
}

/**
 * Advance every tap pin to the newest commit >= `soakDays` old. `fetchCommits`
 * is injected so tests drive it without spawning `gh`.
 */
export async function advanceTapPins(
  pins: readonly BrewTapPin[],
  soakDays: number,
  now: Date,
  fetchCommits: (tap: string, until: string) => Promise<unknown>,
): Promise<BrewTapPin[]> {
  const until = buildUntilCutoff(now, soakDays)
  const out: BrewTapPin[] = []
  for (const pin of pins) {
    const next = parsePinFromCommitsResponse(await fetchCommits(pin.tap, until))
    out.push({ committedAt: next.committedAt, sha: next.sha, tap: pin.tap })
  }
  return out
}

/**
 * Absolute path to the script-owned tap-pin constants file.
 */
export function brewTapPinsPath(): string {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  return path.join(dir, '..', 'constants', 'brew-tap-pins.mts')
}

/**
 * Absolute path to the `.config/repo/Brewfile` discovery covers.
 */
export function brewfilePath(root: string): string {
  return path.join(root, '.config', 'repo', 'Brewfile')
}
