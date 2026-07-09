// Fleet check — internal GitHub Action / reusable-workflow SHA pins are current.
//
// A content change to a DATA DEPENDENCY of a composite action (e.g.
// external-tools.json or .github/actions/lib/*.mjs, read at runtime via
// `${GITHUB_ACTION_PATH}/../…`) silently invalidates any SHA pin that resolved
// at an older checkout — an IMPLICIT edge with no `uses:` line. A consumer
// pinning `setup@<sha>` gets external-tools.json AS IT WAS at <sha>, so the
// DEEPEST pin in a chain decides tool versions, not the entrypoint. That broke
// fleet CI once (a pinned pnpm version went stale behind the data edge), with
// nothing to catch it at edit time.
//
// The closure model:
//   CLOSURE(unit) = the unit's own files
//                 ∪ the closure of each transitive internal `uses:` dep
//                 ∪ every declared `# cascade-data-deps:` path.
//   A pin (file, dep, sha) is STALE iff
//     `git rev-list --count <sha>..<base> -- <closure(dep) paths>` > 0,
//   UNREACHABLE if <sha> is not an ancestor of <base>.
//
// Self-enforcement: every external read DETECTED in an action (a path escaping
// its own dir via `${GITHUB_ACTION_PATH}/../…`) MUST be covered by a declared
// `# cascade-data-deps:` entry. A detected-but-undeclared read fails the check,
// so a future edit cannot add a data edge the staleness analysis would miss.
//
// GENERIC: discovers `.github/actions/*` + `.github/workflows/*`, reads each
// unit's own `# cascade-data-deps:`, and only checks a pin whose DEP unit is
// LOCAL — so it no-ops in repos without internal action pins (the wheelhouse,
// pure consumers). NO repo tree paths are hard-coded. The repo whose name
// appears in the internal-ref `uses:` lines is read from those lines, not
// assumed. Consumer-side drift (pins to a remote producer's HEAD) is the
// wheelhouse tool-pin cascade orchestrator's job (`scripts/repo/pipeline.mts`
// Stage 4 Propagate), not this producer-internal gate.
//
// Usage: node scripts/fleet/check/action-pins-are-current.mts [--fix] [--quiet]

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'
// oxlint-disable-next-line socket/prefer-async-spawn -- sync check script; needs typed string stdout from git, no async flow.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

const logger = getDefaultLogger()

const ACTIONS_DIR = '.github/actions'
const WORKFLOWS_DIR = '.github/workflows'

// An internal SHA pin: `uses: <Org>/<Repo>/.github/(actions|workflows)/<name>@<40hex>`.
// The org/repo is captured (not assumed) so the rule stays repo-agnostic.
const INTERNAL_REF_RE =
  /uses:\s*([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+)\/\.github\/(actions|workflows)\/([A-Za-z0-9._-]+?)(?:\.yml)?@([0-9a-f]{40})/g

// A path escaping the action's own dir: `${GITHUB_ACTION_PATH}/../<rest>` with
// one-or-more `/..` hops. The runtime data-edge shape the closure must cover.
const ESCAPING_READ_RE =
  /\$\{GITHUB_ACTION_PATH\}((?:\/\.\.)+)\/([A-Za-z0-9._/-]+)/g

// `# cascade-data-deps: a, b/c` — the declared data edges of an action.
const DATA_DEPS_RE = /#\s*cascade-data-deps:\s*(.+)$/

export type UnitKind = 'actions' | 'workflows'

export interface UnitRef {
  readonly kind: UnitKind
  readonly name: string
}

export interface InternalPin extends UnitRef {
  readonly repo: string
  readonly sha: string
}

export interface Unit extends UnitRef {
  // The unit id, `${kind}/${name}`.
  readonly id: string
  // Repo-relative paths whose change invalidates a pin to this unit (the unit's
  // own file/dir, before transitive expansion).
  readonly ownPaths: readonly string[]
  // Internal pins this unit declares (its `uses:` lines).
  readonly deps: readonly InternalPin[]
  // Declared `# cascade-data-deps:` paths (repo-relative).
  readonly dataDeps: readonly string[]
  // Paths read from outside the unit's own dir via `${GITHUB_ACTION_PATH}/../…`
  // (actions only; empty for workflows). Detected once at build time so
  // findUndeclared stays pure.
  readonly reads: readonly string[]
}

export type Verdict = 'stale' | 'unreachable' | 'missing_dep'

export interface PinFinding {
  // The unit file the pin appears in.
  readonly file: string
  readonly dep: string
  readonly sha: string
  readonly verdict: Verdict
}

// git operations, injected so the pure analysis is testable without a repo.
export interface GitRunner {
  // True when `sha` is an ancestor of (or equal to) `base`.
  isReachable(sha: string, base: string): boolean
  // Commits touching any of `paths` in the range `sha..base`.
  countSince(sha: string, base: string, paths: readonly string[]): number
  // The committer date (YYYY-MM-DD) of a ref, for the refreshed pin comment.
  committerDate(ref: string): string
  // The full SHA a ref resolves to.
  resolve(ref: string): string
}

export function unitId(ref: UnitRef): string {
  return `${ref.kind}/${ref.name}`
}

// Strip YAML comments so a `#`-commented `uses:`/`${GITHUB_ACTION_PATH}` line is
// not mistaken for a live edge. Conservative: drops from the first `#` that is
// preceded by whitespace or line start (a `#` inside a quoted value is rare in
// these files and erring toward stripping only loses a would-be edge, never
// invents one).
export function stripYamlComments(content: string): string {
  return content
    .split('\n')
    .map(line => line.replace(/(^|\s)#.*$/, '$1').trimEnd())
    .join('\n')
}

// Repo-relative paths an action reads from OUTSIDE its own dir, resolved from
// `${GITHUB_ACTION_PATH}/../…` against `.github/actions/<name>`. Comment lines
// are excluded (a documented example must not count as a live edge).
export function detectEscapingReads(
  actionName: string,
  content: string,
): string[] {
  const live = stripYamlComments(content)
  const actionDir = `${ACTIONS_DIR}/${actionName}`
  const reads = new Set<string>()
  let m: RegExpExecArray | null = ESCAPING_READ_RE.exec(live)
  while (m) {
    const hops = (m[1]!.match(/\/\.\./g) ?? []).length
    const rest = m[2]!
    const resolved = normalizePath(
      path.posix.normalize(
        path.posix.join(actionDir, '../'.repeat(hops), rest),
      ),
    )
    // A read resolving to repo root or above (too many hops) is meaningless;
    // keep only in-repo paths.
    if (resolved && !resolved.startsWith('..')) {
      reads.add(resolved)
    }
    m = ESCAPING_READ_RE.exec(live)
  }
  return [...reads].toSorted()
}

// The `# cascade-data-deps:` paths declared in a unit file (normalized).
export function parseDeclaredDataDeps(content: string): string[] {
  const deps = new Set<string>()
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const m = DATA_DEPS_RE.exec(lines[i]!)
    if (m) {
      for (const part of m[1]!.split(',')) {
        const trimmed = part.trim()
        if (trimmed) {
          deps.add(normalizePath(trimmed))
        }
      }
    }
  }
  return [...deps].toSorted()
}

// True when a declared data-dep covers a detected read: an exact match, or the
// declared entry is an ancestor directory of the read.
export function coversRead(declared: readonly string[], read: string): boolean {
  for (let i = 0, { length } = declared; i < length; i += 1) {
    const d = declared[i]!
    if (read === d || read.startsWith(`${d}/`)) {
      return true
    }
  }
  return false
}

// Internal SHA pins declared in a unit file.
export function parseInternalPins(content: string): InternalPin[] {
  const live = stripYamlComments(content)
  const pins: InternalPin[] = []
  let m: RegExpExecArray | null = INTERNAL_REF_RE.exec(live)
  while (m) {
    pins.push({
      repo: m[1]!,
      kind: m[2]! as UnitKind,
      name: m[3]!,
      sha: m[4]!,
    })
    m = INTERNAL_REF_RE.exec(live)
  }
  return pins
}

// `.github/actions/*` dirs holding an action.yml.
export function listActionNames(repoRoot: string): string[] {
  const dir = path.join(repoRoot, ACTIONS_DIR)
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(
      d => d.isDirectory() && existsSync(path.join(dir, d.name, 'action.yml')),
    )
    .map(d => d.name)
    .toSorted()
}

// `.github/workflows/*.yml` basenames (without extension).
export function listWorkflowNames(repoRoot: string): string[] {
  const dir = path.join(repoRoot, WORKFLOWS_DIR)
  if (!existsSync(dir)) {
    return []
  }
  return readdirSync(dir, { withFileTypes: true })
    .filter(d => d.isFile() && /\.ya?ml$/.test(d.name))
    .map(d => d.name.replace(/\.ya?ml$/, ''))
    .toSorted()
}

// The repo-relative file a unit's content is read from.
export function unitFile(ref: UnitRef): string {
  return ref.kind === 'actions'
    ? `${ACTIONS_DIR}/${ref.name}/action.yml`
    : `${WORKFLOWS_DIR}/${ref.name}.yml`
}

// The repo-relative path(s) whose change invalidates a pin to this unit, before
// transitive expansion: an action's whole dir, or a workflow's single file.
export function unitOwnPaths(ref: UnitRef): string[] {
  return ref.kind === 'actions'
    ? [`${ACTIONS_DIR}/${ref.name}`]
    : [`${WORKFLOWS_DIR}/${ref.name}.yml`]
}

// Build the local unit map: every action + workflow that exists locally, with
// its own paths, declared internal pins, and declared data-deps.
export function buildUnits(repoRoot: string): Map<string, Unit> {
  const units = new Map<string, Unit>()
  const add = (ref: UnitRef): void => {
    const file = path.join(repoRoot, unitFile(ref))
    const content = existsSync(file) ? readFileSync(file, 'utf8') : ''
    const unit: Unit = {
      ...ref,
      id: unitId(ref),
      ownPaths: unitOwnPaths(ref),
      deps: parseInternalPins(content),
      dataDeps: parseDeclaredDataDeps(content),
      reads:
        ref.kind === 'actions' ? detectEscapingReads(ref.name, content) : [],
    }
    units.set(unit.id, unit)
  }
  for (const name of listActionNames(repoRoot)) {
    add({ kind: 'actions', name })
  }
  for (const name of listWorkflowNames(repoRoot)) {
    add({ kind: 'workflows', name })
  }
  return units
}

// The transitive closure of repo-relative paths for a unit: its own paths, its
// data-deps, and recursively every LOCAL self-repo internal dep's closure.
// Memoized + cycle-guarded. A dep is followed only when it names this same repo
// (`selfRepo`) AND exists as a local unit — a cross-repo dep's history is not in
// this repo, and a same-basename local unit must not be confused for it.
export function closureFor(
  id: string,
  units: ReadonlyMap<string, Unit>,
  selfRepo: string,
  memo: Map<string, string[]> = new Map<string, string[]>(),
  seen: Set<string> = new Set<string>(),
): string[] {
  const cached = memo.get(id)
  if (cached) {
    return cached
  }
  const unit = units.get(id)
  if (!unit || seen.has(id)) {
    return []
  }
  seen.add(id)
  const paths = new Set<string>([...unit.ownPaths, ...unit.dataDeps])
  for (
    let i = 0, { length } = unit.deps, deps = unit.deps;
    i < length;
    i += 1
  ) {
    const dep = deps[i]!
    const depId = unitId(dep)
    if (dep.repo === selfRepo && units.has(depId)) {
      for (const p of closureFor(depId, units, selfRepo, memo, seen)) {
        paths.add(p)
      }
    }
  }
  seen.delete(id)
  const result = [...paths].toSorted()
  memo.set(id, result)
  return result
}

// Every action whose detected escaping reads are not all declared. Returns one
// message per offending action. Pure over the units' precomputed `reads`.
export function findUndeclared(units: ReadonlyMap<string, Unit>): string[] {
  const messages: string[] = []
  for (const unit of units.values()) {
    if (unit.kind !== 'actions') {
      continue
    }
    const missing = unit.reads.filter(r => !coversRead(unit.dataDeps, r))
    if (missing.length) {
      messages.push(
        `${unitFile(unit)} reads ${missing.join(', ')} via \${GITHUB_ACTION_PATH}/../… but does not declare ${missing.length > 1 ? 'them' : 'it'} in a \`# cascade-data-deps:\` comment. Add: \`# cascade-data-deps: ${missing.join(', ')}\``,
      )
    }
  }
  return messages
}

// Classify every SELF-REPO internal pin whose dep is a local unit. A pin to a
// different repo is a consumer-side pin to a remote producer (its history is
// not local) — skipped here; that drift is the wheelhouse tool-pin cascade
// orchestrator's concern (`scripts/repo/pipeline.mts` Stage 4 Propagate). A
// self-repo pin to a local dep is the producer-internal edge this gate owns.
export function findStalePins(
  units: ReadonlyMap<string, Unit>,
  base: string,
  git: GitRunner,
  selfRepo: string,
): PinFinding[] {
  const findings: PinFinding[] = []
  const memo = new Map<string, string[]>()
  for (const unit of units.values()) {
    for (
      let i = 0, { length } = unit.deps, deps = unit.deps;
      i < length;
      i += 1
    ) {
      const pin = deps[i]!
      const depId = unitId(pin)
      if (pin.repo !== selfRepo) {
        continue
      }
      const file = unitFile(unit)
      // A self-repo pin whose dep unit is GONE from the current tree (the
      // action moved tiers or was deleted) is broken the moment the pinned SHA
      // advances past the removal — and repinning to HEAD would guarantee it.
      // Silently skipping here once shipped a false-green while a reusable
      // workflow pointed consumers at a path that no longer existed.
      if (!units.has(depId)) {
        findings.push({
          file,
          dep: depId,
          sha: pin.sha,
          verdict: 'missing_dep',
        })
        continue
      }
      if (!git.isReachable(pin.sha, base)) {
        findings.push({
          file,
          dep: depId,
          sha: pin.sha,
          verdict: 'unreachable',
        })
        continue
      }
      const paths = closureFor(depId, units, selfRepo, memo)
      if (git.countSince(pin.sha, base, paths) > 0) {
        findings.push({ file, dep: depId, sha: pin.sha, verdict: 'stale' })
      }
    }
  }
  return findings
}

// Rewrite a pinned SHA → newSha in `text`, replacing any trailing `# …` pin
// comment on the same line with `# <comment>`. Pure; the I/O wrapper applyFix
// reads/writes the files. Every `@<oldSha>` occurrence is rewritten.
export function rewritePin(
  text: string,
  oldSha: string,
  newSha: string,
  comment: string,
): string {
  // The 40-hex SHA plus any trailing `# …` comment up to end of line.
  const pinRe = new RegExp(`@${oldSha}([ \\t]*#[^\\n]*)?`, 'g')
  return text.replace(pinRe, `@${newSha} # ${comment}`)
}

// Rewrite each stale/unreachable pin's SHA → base HEAD and refresh its
// `# <branch> (YYYY-MM-DD)` comment (committer date of the new SHA). Returns the
// set of files rewritten. A missing_dep finding is never rewritten: its dep
// path does not exist at HEAD, so repinning would point the ref at a commit
// where the action is guaranteed absent.
export function applyFix(
  findings: readonly PinFinding[],
  base: string,
  git: GitRunner,
): string[] {
  const head = git.resolve(base)
  const date = git.committerDate(head)
  const branch = base.replace(/^.*\//, '')
  const comment = `${branch} (${date})`
  const touched = new Set<string>()
  const byFile = new Map<string, PinFinding[]>()
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const f = findings[i]!
    if (f.verdict === 'missing_dep') {
      continue
    }
    const list = byFile.get(f.file)
    if (list) {
      list.push(f)
    } else {
      byFile.set(f.file, [f])
    }
  }
  for (const [file, list] of byFile) {
    const abs = path.join(REPO_ROOT, file)
    if (!existsSync(abs)) {
      continue
    }
    let text = readFileSync(abs, 'utf8')
    for (let i = 0, { length } = list; i < length; i += 1) {
      text = rewritePin(text, list[i]!.sha, head, comment)
    }
    writeFileSync(abs, text)
    touched.add(file)
  }
  return [...touched].toSorted()
}

// ── git wiring (CLI only) ──────────────────────────────────────────

function git(args: readonly string[]): {
  status: number
  stdout: string
} {
  const r = spawnSync('git', [...args], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'pipe', 'pipe'],
    stdioString: true,
  })
  return {
    status: typeof r.status === 'number' ? r.status : 1,
    stdout: typeof r.stdout === 'string' ? r.stdout : '',
  }
}

// base = remote default branch (origin/HEAD → origin/main → origin/master),
// per the fleet default-branch fallback; never hard-code `main`.
export function resolveBase(): string {
  const head = git(['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (head.status === 0) {
    const ref = head.stdout.trim().replace(/^refs\/remotes\//, '')
    if (ref) {
      return ref
    }
  }
  for (const name of ['main', 'master']) {
    if (
      git(['show-ref', '--verify', '--quiet', `refs/remotes/origin/${name}`])
        .status === 0
    ) {
      return `origin/${name}`
    }
  }
  return 'origin/main'
}

// This repo's `owner/name`, parsed from the origin remote URL (SSH or HTTPS,
// `.git` suffix optional). Used to tell a producer-internal self-reference pin
// from a consumer's pin to a remote producer. Empty when no origin remote — the
// caller then treats every pin as cross-repo (no-op), the safe default.
export function parseRepoFromRemote(url: string): string {
  const m = /[:/]([A-Za-z0-9._-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(
    url.trim(),
  )
  return m ? m[1]! : ''
}

export function resolveSelfRepo(): string {
  return parseRepoFromRemote(git(['remote', 'get-url', 'origin']).stdout)
}

const cliGit: GitRunner = {
  committerDate(ref) {
    return git(['show', '-s', '--format=%cs', ref]).stdout.trim()
  },
  countSince(sha, base, paths) {
    if (!paths.length) {
      return 0
    }
    const r = git(['rev-list', '--count', `${sha}..${base}`, '--', ...paths])
    const n = Number.parseInt(r.stdout.trim(), 10)
    return Number.isNaN(n) ? 0 : n
  },
  isReachable(sha, base) {
    return git(['merge-base', '--is-ancestor', sha, base]).status === 0
  },
  resolve(ref) {
    return git(['rev-parse', ref]).stdout.trim()
  },
}

function main(): void {
  const quiet = process.argv.includes('--quiet')
  const fix = process.argv.includes('--fix')
  let units: Map<string, Unit>
  try {
    units = buildUnits(REPO_ROOT)
  } catch (e) {
    // Fail open: an unreadable .github tree is not a pin-staleness failure.
    if (!quiet) {
      logger.warn(
        `[check-action-pins-are-current] could not scan .github: ${errorMessage(e)} — skipping.`,
      )
    }
    return
  }

  const selfRepo = resolveSelfRepo()
  const undeclared = findUndeclared(units)
  // Any self-repo pin counts — including one whose dep unit no longer exists
  // in the tree (that is the missing_dep case this check must surface, not
  // a reason to declare "nothing to check").
  const hasInternalPins = [...units.values()].some(u =>
    u.deps.some(d => d.repo === selfRepo),
  )
  if (!hasInternalPins && !undeclared.length) {
    if (!quiet) {
      logger.success(
        '[check-action-pins-are-current] no internal action/workflow pins to check.',
      )
    }
    return
  }

  const base = resolveBase()
  const all = findStalePins(units, base, cliGit, selfRepo)
  const missing = all.filter(f => f.verdict === 'missing_dep')
  const stale = all.filter(f => f.verdict !== 'missing_dep')

  if (fix && stale.length) {
    const touched = applyFix(stale, base, cliGit)
    logger.success(
      `[check-action-pins-are-current] repinned ${stale.length} pin(s) to ${base} HEAD in: ${touched.join(', ')}`,
    )
    // Re-scan after the rewrite so undeclared and missing_dep (which --fix
    // cannot repair — the dep path is gone at HEAD) still gate.
    if (!undeclared.length && !missing.length) {
      return
    }
  }

  if (undeclared.length || missing.length || (!fix && stale.length)) {
    logger.fail('[check-action-pins-are-current] action-pin problems:')
    for (let i = 0, { length } = undeclared; i < length; i += 1) {
      logger.error(`  ✗ undeclared data edge: ${undeclared[i]!}`)
    }
    for (let i = 0, { length } = missing; i < length; i += 1) {
      const f = missing[i]!
      logger.error(
        `  ✗ ${f.file}: pin to ${f.dep}@${f.sha.slice(0, 12)} references a path that no longer exists in this tree — the action moved or was deleted, so any newer SHA breaks the ref. Fix the \`uses:\` PATH to the action's new location (e.g. its {fleet,repo}/ tier), then re-run --fix; repinning alone cannot repair this.`,
      )
    }
    for (let i = 0, { length } = stale; i < length; i += 1) {
      const f = stale[i]!
      logger.error(
        `  ✗ ${f.file}: pin to ${f.dep}@${f.sha.slice(0, 12)} is ${f.verdict === 'stale' ? `STALE (its closure changed on ${base})` : `UNREACHABLE from ${base}`}`,
      )
    }
    logger.error(
      `  Run with --fix to repin stale entries to ${base} HEAD; add a \`# cascade-data-deps:\` comment for each undeclared read.`,
    )
    process.exitCode = 1
    return
  }

  if (!quiet) {
    logger.success(
      '[check-action-pins-are-current] every internal pin is current and every data edge is declared.',
    )
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
