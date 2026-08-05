#!/usr/bin/env node
/**
 * @file Generate / verify the `# <name>-<version> sha256:<64hex>` content-hash
 *   comment that `uses-sha-verify-guard` requires above every `.gitmodules`
 *   `[submodule]` block. The hash is the SHA-256 of the GitHub codeload archive
 *   at the pinned `ref` —
 *   `https://codeload.github.com/<owner>/<repo>/tar.gz/<ref>` — the same bytes
 *   a consumer fetching that submodule downloads. It is the "upstream-archive
 *   content-hash" drift-watch signal that complements the git-Merkle `ref =`
 *   pin: the `ref` proves which commit, the archive hash proves the bytes
 *   GitHub serves for it haven't shifted under us. Reproducibility: codeload
 *   `.tar.gz` output is byte-stable across fetches for a given commit. GitHub
 *   has, rarely, changed archive gzip parameters platform-wide (breaking
 *   Go-module / Homebrew checksums); when that happens `--check` flags the
 *   drift and `--write` refreshes the pin. That is the intended drift-watch
 *   behavior, not a failure. Non-GitHub remotes (e.g. *.googlesource.com) have
 *   no codeload archive, and gitiles `+archive` .tar.gz is gzip-timestamped
 *   (regenerated per fetch — movable under our feet), so they are pinned to the
 *   SHA-256 of the `git ls-tree -r <ref>` manifest of the materialized
 *   submodule worktree instead: blob SHAs are immutable content addresses, so
 *   that hash is an unmovable content pin tied to the commit. It is re-verified
 *   whenever the worktree is present and fail-open (skipped) on a checkout that
 *   hasn't materialized the submodule. Usage: gen/gitmodules-hash.mts --check
 *   [path/to/.gitmodules] # verify, exit 1 on drift gen/gitmodules-hash.mts
 *   --write [path/to/.gitmodules] # rewrite stale/missing hashes.
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs, readFileSync } from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import zlib from 'node:zlib'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import { isMainModule } from '../_shared/is-main-module.mts'
import { runMain } from '../_shared/run-main.mts'
import type { ScriptMeta } from '../_shared/run-main.mts'

const logger = getDefaultLogger()

const USAGE = `gen/gitmodules-hash — set / generate / verify .gitmodules content-hash pins

Usage:
  gen/gitmodules-hash.mts --check [<.gitmodules>]   verify every block's sha256 + date (exit 1 on drift)
  gen/gitmodules-hash.mts --write [<.gitmodules>]   rewrite stale / missing sha256 + date comments
  gen/gitmodules-hash.mts --set <name|path> <ref> [--label <text>] [<.gitmodules>]
                                                    bump one submodule's ref AND its sha256 + date
                                                    together (the only correct way to bump a
                                                    ref — uses-sha-verify-guard requires both)

The header is \`# <name>-<version> (<YYYY-MM-DD>) sha256:<hex>\`. The hash is
sha256 of https://codeload.github.com/<owner>/<repo>/tar.gz/<ref> for GitHub
remotes, or the sha256 of \`git ls-tree -r <ref>\` (the materialized worktree's
manifest) for non-GitHub remotes (e.g. *.googlesource.com). The parenthesized
date is the pinned commit's committer date — a DERIVED + CHECKED field, so a
ref bump that forgets to re-stamp it fails --check. The date field is optional
and back-compatible: legacy headers without it still pass --check; --write /
--set back-fill it.
`

export interface Block {
  // The submodule's quoted name from `[submodule "<name>"]`.
  name: string
  // 0-based index of the `[submodule "<name>"]` opening line.
  openLine: number
  // 0-based index of the `# <name>-<version>[ sha256:<hex>]` header comment,
  // or undefined when no such comment precedes the block.
  headerLine: number | undefined
  // The header comment's existing sha256, or undefined when absent.
  headerSha: string | undefined
  // The header comment's existing DERIVED-and-CHECKED committer date in the
  // parenthesized `(<YYYY-MM-DD>)` field, or undefined when the header predates
  // the date field (legacy entries) / carries none.
  headerDate: string | undefined
  // The `# <name>-<version>` prefix (everything before the ` (<date>)` /
  // ` sha256:` fields), preserved verbatim on rewrite so the version label
  // survives.
  headerPrefix: string | undefined
  // owner/repo parsed from the GitHub `url =` line, else undefined.
  ownerRepo: string | undefined
  // The `ref = <sha>` value, else undefined.
  ref: string | undefined
  // 0-based index of the `ref = <sha>` line, or undefined when absent.
  refLine: number | undefined
  // The submodule `path = <p>` value, else undefined (an alternate selector
  // for `--set`, since callers think in paths more than quoted names).
  path: string | undefined
}

// A `# <keyword>: <freetext>` block annotation (e.g. `# full-checkout: …`,
// `# no-release-tag: …`, or any future `# vendored-patch: …`). Its first
// whitespace-delimited token ends in a colon; a genuine
// `# <name>-<version>[ (<date>)][ sha256:<hex>]` header's first token never
// does (there a colon appears only in the `sha256:` SECOND token, after a
// space). This structural test is the single source of truth for "is this
// comment an annotation" — parseBlocks uses it to skip annotations while
// hunting the header, and the writer uses it to refuse ever stamping a sha256
// over one.
export function isAnnotationComment(line: string): boolean {
  // require-regex-comment: first comment token immediately followed by a colon.
  return /^#\s*[^\s:]+:/.test(line)
}

// Render the canonical header line. The committer date is a DERIVED + CHECKED
// field carried in parentheses — `# <name>-<version> (<YYYY-MM-DD>) sha256:…` —
// which disambiguates it from date-shaped version tokens (those need no
// parens). Omitted when no date could be derived, keeping the pre-date form
// byte-stable for legacy entries whose upstream we cannot date.
export function formatHeaderLine(
  prefix: string,
  date: string | undefined,
  sha: string,
): string {
  return date ? `${prefix} (${date}) sha256:${sha}` : `${prefix} sha256:${sha}`
}

// Parse `.gitmodules` into blocks, retaining the header-comment line index so
// `--write` can rewrite exactly that line. Mirrors the section/keyword shapes
// `uses-sha-verify-guard` and `git-partial-submodule.mts` recognize.
export function parseBlocks(lines: string[]): Block[] {
  const blocks: Block[] = []
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const open = /^\s*\[submodule\s+"([^"]+)"\s*\]\s*$/.exec(lines[i]!)
    if (!open) {
      continue
    }
    let headerLine: number | undefined
    let headerSha: string | undefined
    let headerDate: string | undefined
    let headerPrefix: string | undefined
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = lines[j]!
      if (prev.trim() === '' || /^\s*\[submodule\s+"/.test(prev)) {
        break
      }
      // Documented block annotations — `# no-release-tag: <why>`,
      // `# full-checkout: <why>`, and any future `# <keyword>: <why>` — are
      // comments whose kebab-case keyword also satisfies the name-version
      // grammar below, so without this skip an annotation sitting between the
      // hash header and its block shadows the header (the block reads as
      // "comment <none>", and a whole-file --write then stamps sha256 over the
      // annotation, destroying the reason text). Skip them STRUCTURALLY — a
      // genuine header's first token is `<name>-<version>` and never ends in a
      // colon, whereas an annotation's does (`isAnnotationComment`) — and keep
      // scanning upward.
      if (isAnnotationComment(prev)) {
        continue
      }
      // A `# <name>-<version>` comment line: captures (1) the `# name-…`
      // prefix, (2) an optional parenthesized `(<YYYY-MM-DD>)` committer date,
      // (3) an optional `sha256:<hex>` stamp, (4) any trailing text.
      const header =
        /* oxlint-disable-next-line socket/require-regex-comment -- captures the ref, its optional date, and its optional sha256 stamp from a .gitmodules header comment */ /^(#\s+[A-Za-z0-9][A-Za-z0-9.-]*-\S+?)(?:\s+\((\d{4}-\d{2}-\d{2})\))?(?:\s+sha256:([0-9a-f]+))?(\s.*)?$/.exec(
          prev,
        )
      if (header) {
        headerLine = j
        headerPrefix = header[1]
        headerDate = header[2]
        headerSha = header[3]
        break
      }
    }
    let ownerRepo: string | undefined
    let ref: string | undefined
    let refLine: number | undefined
    let blockPath: string | undefined
    for (let j = i + 1; j < length; j += 1) {
      const next = lines[j]!
      if (/^\s*\[/.test(next)) {
        break
      }
      // A `url = …github.com…<owner>/<repo>` line, https or ssh form, captures
      // `owner/repo` (sans optional `.git`). Alternation sorted (`git@` before
      // `https`) per sort-regex-alternations.
      const urlMatch =
        /* oxlint-disable-next-line socket/require-regex-comment -- captures the owner/repo from a .gitmodules url line */ /^\s*url\s*=\s*(?:git@github\.com:|https?:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(
          next,
        )
      if (urlMatch) {
        ownerRepo = urlMatch[1]
      }
      const refMatch = /^\s*ref\s*=\s*([0-9a-f]+)\s*$/.exec(next)
      if (refMatch) {
        ref = refMatch[1]
        refLine = j
      }
      const pathMatch = /^\s*path\s*=\s*(\S+)\s*$/.exec(next)
      if (pathMatch) {
        blockPath = pathMatch[1]
      }
    }
    blocks.push({
      name: open[1]!,
      openLine: i,
      headerLine,
      headerSha,
      headerDate,
      headerPrefix,
      ownerRepo,
      ref,
      refLine,
      path: blockPath,
    })
  }
  return blocks
}

// Resolve the AUTHORITATIVE pinned SHA for a submodule from `.gitmodules` — the
// `ref = <sha>` of the `[submodule]` block whose `path =` matches
// `submodulePath`. `no-upstream-gitlink-guard` + `uses-sha-verify-guard`
// already treat this `ref` as the single source of truth for the pin, so
// lockstep DERIVES a `version-pin` row's pin from here rather than storing a
// duplicate `pinned_sha`. Pure + sync; fails open to `undefined` (never throws
// at this public boundary) when the `.gitmodules` file is absent / unreadable,
// no block matches the path, or the matched block carries no `ref =`.
export function resolvePinnedSha(
  gitmodulesPath: string,
  submodulePath: string,
): string | undefined {
  if (!existsSync(gitmodulesPath)) {
    return undefined
  }
  let raw: string
  try {
    raw = readFileSync(gitmodulesPath, 'utf8')
  } catch {
    return undefined
  }
  const blocks = parseBlocks(raw.split(/\r?\n/))
  return blocks.find(b => b.path === submodulePath)?.ref
}

// SHA-256 of the codeload .tar.gz at `ref`. Uses the lib http helper so the
// fleet's proxy / retry / redirect handling applies.
export async function archiveSha256(
  ownerRepo: string,
  ref: string,
): Promise<string> {
  const url = `https://codeload.github.com/${ownerRepo}/tar.gz/${ref}`
  const res = await httpRequest(url, { method: 'GET' })
  if (!res.ok) {
    throw new Error(
      `codeload fetch failed for ${ownerRepo}@${ref}: HTTP ${res.status} ${res.statusText} — verify the ref is pushed and the repo is public`,
    )
  }
  return crypto.createHash('sha256').update(res.body).digest('hex')
}

// Format a UNIX epoch (seconds) as a UTC `YYYY-MM-DD`. Both date sources — the
// codeload tar mtime and `git log --format=%ct` — hand us an absolute epoch, so
// converting BOTH here (in UTC, not the committer's local zone) guarantees the
// archive path and the worktree path agree on the same date string for a given
// commit.
function epochToUtcDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10)
}

// Recover the archived commit's committer DATE from the codeload .tar.gz bytes
// we already fetched for the sha256 — no extra request, no checkout (so it
// works on a bare CI fetch). `git archive` (which GitHub codeload serves)
// stamps every tar entry's mtime with the commit's committer date, so the
// first ustar header's mtime octal field (offset 136, 12 bytes) IS that date.
// Fail-open to undefined on any gunzip / parse error — a missing date must
// never block the sha256 pin.
export function archiveCommitDate(bytes: Buffer): string | undefined {
  let tar: Buffer
  try {
    tar = zlib.gunzipSync(bytes)
  } catch {
    return undefined
  }
  if (tar.length < 512) {
    return undefined
  }
  // ustar mtime field: octal digits, NUL/space-terminated, at offset 136.
  const mtimeField = tar.subarray(136, 148).toString('ascii')
  const octalMatch = /^\s*([0-7]+)/.exec(mtimeField)
  if (!octalMatch) {
    return undefined
  }
  const epoch = Number.parseInt(octalMatch[1]!, 8)
  if (!Number.isFinite(epoch) || epoch <= 0) {
    return undefined
  }
  return epochToUtcDate(epoch)
}

// Fetch the codeload archive ONCE and return both the content sha256 and the
// derived committer date (from the same bytes — see archiveCommitDate). The
// date is undefined when the archive can't be parsed as a git tarball, which
// keeps a malformed / mocked body from turning into a hard failure.
export async function archiveShaAndDate(
  ownerRepo: string,
  ref: string,
): Promise<{ date: string | undefined; sha: string }> {
  const url = `https://codeload.github.com/${ownerRepo}/tar.gz/${ref}`
  const res = await httpRequest(url, { method: 'GET' })
  if (!res.ok) {
    throw new Error(
      `codeload fetch failed for ${ownerRepo}@${ref}: HTTP ${res.status} ${res.statusText} — verify the ref is pushed and the repo is public`,
    )
  }
  const body = res.body
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body as string)
  return {
    date: archiveCommitDate(buf),
    sha: crypto.createHash('sha256').update(body).digest('hex'),
  }
}

// The committer DATE of `ref` from a MATERIALIZED worktree, via
// `git log -1 --format=%ct` (committer date as a UNIX epoch). `%ct` — not the
// zone-local `%cs` — so the conversion matches archiveCommitDate's UTC epoch
// path exactly; a commit near midnight can't disagree by a day between the two
// sources. Fail-open to undefined (no worktree / unknown ref / no git) — the
// same posture as treeManifestSha256.
export async function worktreeCommitDate(
  worktreeDir: string,
  ref: string,
): Promise<string | undefined> {
  try {
    const result = (await spawn(
      'git',
      ['-C', worktreeDir, 'log', '-1', '--format=%ct', ref],
      { stdio: 'pipe', stdioString: true },
    )) as { stdout?: string | undefined }
    const out = String(result?.stdout ?? '').trim()
    const epoch = Number.parseInt(out, 10)
    if (!Number.isFinite(epoch) || epoch <= 0) {
      return undefined
    }
    return epochToUtcDate(epoch)
  } catch {
    return undefined
  }
}

// SHA-256 of the `git ls-tree -r <ref>` manifest of a MATERIALIZED submodule
// worktree. Every manifest line is `<mode> <type> <blob-sha>\t<path>`; the blob
// SHAs are git's immutable content addresses and `ls-tree` output is
// git-version-stable, so this hash is an UNMOVABLE content pin tied to the
// commit — it cannot shift under our feet the way a gitiles `+archive` .tar.gz
// gzip-timestamped, regenerated per fetch, does. This is the content-hash for
// a non-codeload remote (e.g. *.googlesource.com); the codeload archive hash
// stays the pin for GitHub remotes. Requires the worktree checked out at `ref`.
export async function treeManifestSha256(
  worktreeDir: string,
  ref: string,
): Promise<string> {
  let stdout = ''
  try {
    // `-c core.quotePath=false`: emit non-ASCII path bytes verbatim, not the
    // config-dependent `\NNN`-escaped form — otherwise the manifest hash (the
    // pin) would shift with the local git config for a tree with a non-ASCII
    // path, breaking the "unmovable" guarantee. No-op for an all-ASCII tree.
    const result = (await spawn(
      'git',
      ['-C', worktreeDir, '-c', 'core.quotePath=false', 'ls-tree', '-r', ref],
      {
        stdio: 'pipe',
        stdioString: true,
      },
    )) as { stdout?: string | undefined }
    stdout = String(result?.stdout ?? '')
  } catch (e) {
    throw new Error(
      `git ls-tree failed for ${ref} in ${worktreeDir}: ${errorMessage(e)} — is the submodule materialized at that ref?`,
    )
  }
  if (stdout.trim() === '') {
    throw new Error(
      `git ls-tree produced no output for ${ref} in ${worktreeDir} — the submodule is not materialized at that ref`,
    )
  }
  return crypto.createHash('sha256').update(stdout).digest('hex')
}

// A submodule worktree is materialized when its checkout dir holds a `.git`
// pointer, file for a submodule, dir for a plain clone.
export function isMaterialized(worktreeDir: string): boolean {
  return existsSync(path.join(worktreeDir, '.git'))
}

export interface Resolved {
  block: Block
  computed: string | undefined
  // The derived committer date (`YYYY-MM-DD`) for the pinned ref, or undefined
  // when it could not be derived (mocked/malformed archive, non-materialized
  // worktree). A missing date is never a hard failure — it just means the date
  // field is neither checked nor (re)written for that block this run.
  computedDate: string | undefined
  skipped: string | undefined
}

export async function resolveAll(
  blocks: Block[],
  repoRoot: string,
): Promise<Resolved[]> {
  const out: Resolved[] = []
  for (let i = 0, { length } = blocks; i < length; i += 1) {
    const block = blocks[i]!
    if (!block.ref) {
      out.push({
        block,
        computed: undefined,
        computedDate: undefined,
        skipped: 'no `ref = <sha>` to hash',
      })
      continue
    }
    const worktree = block.path ? path.join(repoRoot, block.path) : undefined
    // GitHub remote: the codeload .tar.gz is the pin (remote-verifiable). If it
    // is unavailable (404 — private repo, or a commit not reachable from any
    // public ref), fall back to the ls-tree manifest of the materialized
    // worktree, the same unmovable pin used for non-GitHub remotes.
    if (block.ownerRepo) {
      try {
        logger.log(`fetching ${block.ownerRepo}@${block.ref.slice(0, 12)}…`)
        const { date, sha } = await archiveShaAndDate(
          block.ownerRepo,
          block.ref,
        )
        out.push({
          block,
          computed: sha,
          computedDate: date,
          skipped: undefined,
        })
        continue
      } catch (e) {
        if (!/HTTP 404/.test(errorMessage(e))) {
          throw e
        }
        if (!worktree || !isMaterialized(worktree)) {
          out.push({
            block,
            computed: undefined,
            computedDate: undefined,
            skipped: `codeload 404 and worktree not materialized — cannot pin ${block.name}`,
          })
          continue
        }
        logger.warn(
          `${block.name}: codeload 404; falling back to ls-tree manifest of the materialized worktree`,
        )
        out.push({
          block,
          computed: await treeManifestSha256(worktree, block.ref),
          computedDate: await worktreeCommitDate(worktree, block.ref),
          skipped: undefined,
        })
        continue
      }
    }
    // Non-GitHub remote: hash the materialized worktree's git ls-tree manifest
    // (unmovable). Fail-open when not materialized (a fresh/shallow CI checkout
    // hasn't cloned it) — same posture as upstream-contracts.
    if (!worktree || !isMaterialized(worktree)) {
      out.push({
        block,
        computed: undefined,
        computedDate: undefined,
        skipped:
          'non-GitHub remote not materialized (worktree absent) — cannot verify tree manifest',
      })
      continue
    }
    out.push({
      block,
      computed: await treeManifestSha256(worktree, block.ref),
      computedDate: await worktreeCommitDate(worktree, block.ref),
      skipped: undefined,
    })
  }
  return out
}

// ── Pure decision cores for --check / --write ────────────────────────────────
// Extracting these out of main() makes the WRITE path unit-testable without a
// network round-trip (main() does the fetch + file I/O; these decide what the
// bytes mean). It is also the belt to parseBlocks' braces: the writer here
// NEVER touches a line unless it is a genuine header, so an annotation cannot be
// clobbered even if a future parser change regressed.

// A per-block --check verdict: `sha` (stale/missing hash) or `date` (a header
// that carries a date whose derived value no longer matches — i.e. a ref bump
// that forgot to re-stamp the date). An ABSENT header date is never drift, so
// legacy entries keep passing until a --write/--set opts them into the field.
export interface CheckIssue {
  name: string
  kind: 'date' | 'sha'
  detail: string
}

export function planCheck(resolved: Resolved[]): {
  issues: CheckIssue[]
  skips: number
  verified: number
} {
  const issues: CheckIssue[] = []
  let skips = 0
  let verified = 0
  for (const { block, computed, computedDate, skipped } of resolved) {
    if (skipped) {
      skips += 1
      continue
    }
    verified += 1
    if (computed !== block.headerSha) {
      issues.push({
        name: block.name,
        kind: 'sha',
        detail: `sha256 ${block.headerSha ? 'stale' : 'missing'} — comment ${block.headerSha?.slice(0, 12) ?? '<none>'}…, archive ${computed?.slice(0, 12) ?? '<none>'}…`,
      })
      continue
    }
    if (
      block.headerDate !== undefined &&
      computedDate !== undefined &&
      block.headerDate !== computedDate
    ) {
      issues.push({
        name: block.name,
        kind: 'date',
        detail: `date stale — header (${block.headerDate}), commit (${computedDate}); the ref moved without re-stamping the date`,
      })
    }
  }
  return { issues, skips, verified }
}

export interface WritePlanEntry {
  name: string
  status: 'current' | 'no-header' | 'skipped' | 'written'
  detail: string
}

export interface WritePlan {
  entries: WritePlanEntry[]
  errors: number
  lines: string[]
  skips: number
  written: number
}

// Given the file `lines` and the resolved (sha + date) blocks, produce the
// rewritten lines for --write. Touches ONLY the genuine sha256 header of each
// drifted block — never an annotation, and never any other block's lines.
// Back-fills the date onto a legacy entry (desired line gains `(<date>)`),
// refreshes a stale sha/date, and leaves current lines byte-identical.
export function planWrites(lines: string[], resolved: Resolved[]): WritePlan {
  const out = lines.slice()
  const entries: WritePlanEntry[] = []
  let written = 0
  let skips = 0
  let errors = 0
  for (const { block, computed, computedDate, skipped } of resolved) {
    if (skipped) {
      skips += 1
      entries.push({ name: block.name, status: 'skipped', detail: skipped })
      continue
    }
    if (
      computed === undefined ||
      block.headerLine === undefined ||
      !block.headerPrefix
    ) {
      errors += 1
      entries.push({
        name: block.name,
        status: 'no-header',
        detail:
          'no `# <name>-<version>` header comment to attach a sha256 to — add the comment first (gitmodules-comment-guard shape), then re-run',
      })
      continue
    }
    const current = out[block.headerLine]!
    // Defense-in-depth: the parser already skips annotations, but never stamp a
    // sha256 over a `# <keyword>: <reason>` line even if one somehow arrived
    // here — that is the corruption this tool exists to avoid.
    if (isAnnotationComment(current)) {
      errors += 1
      entries.push({
        name: block.name,
        status: 'no-header',
        detail: `refusing to overwrite the annotation comment at line ${block.headerLine + 1} — the header resolved onto an annotation`,
      })
      continue
    }
    const desired = formatHeaderLine(block.headerPrefix, computedDate, computed)
    if (current === desired) {
      entries.push({ name: block.name, status: 'current', detail: '' })
      continue
    }
    out[block.headerLine] = desired
    written += 1
    entries.push({
      name: block.name,
      status: 'written',
      detail: `sha256 ${computed.slice(0, 12)}…${computedDate ? ` (${computedDate})` : ''}`,
    })
  }
  return { entries, errors, lines: out, skips, written }
}

// Resolve the `.gitmodules` path argument, positional, after any flags, and
// confirm it exists. Exits non-zero with a fix message otherwise.
export function resolveGitmodulesPath(positional: string | undefined): string {
  const gitmodulesPath = path.resolve(positional ?? '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    logger.fail(
      `gen/gitmodules-hash: no .gitmodules at ${gitmodulesPath} — pass the path as the first argument`,
    )
    process.exit(1)
  }
  return gitmodulesPath
}

// `--set <name|path> <ref> [--label <text>]` argv parsing + validation: the
// hex-40 ref shape and the positional-arg presence checks. Pure so the CLI
// exit-on-error path and the decision logic can be tested independently.
export type SetArgs =
  | { error: string }
  | { label: string | undefined; newRef: string; selector: string }

export function parseSetArgs(argv: string[]): SetArgs {
  const setIdx = argv.indexOf('--set')
  const selector = argv[setIdx + 1]
  const newRef = argv[setIdx + 2]
  const labelIdx = argv.indexOf('--label')
  const label = labelIdx >= 0 ? argv[labelIdx + 1] : undefined
  if (
    !selector ||
    !newRef ||
    selector.startsWith('--') ||
    newRef.startsWith('--')
  ) {
    return {
      error:
        'gen/gitmodules-hash --set: needs `<name|path> <ref>` — e.g. `--set packages/acorn/upstream/acorn 8a47812…`',
    }
  }
  if (!/^[0-9a-f]{40}$/.test(newRef)) {
    return {
      error: `gen/gitmodules-hash --set: ref must be a full 40-hex commit SHA, got \`${newRef}\` — resolve a tag/branch to its commit first (git ls-remote <url> refs/tags/<t>^{})`,
    }
  }
  return { label, newRef, selector }
}

// `--set <name|path> <ref> [--label <text>]`: bump one submodule's ref AND its
// sha256 in a single write. This is the sanctioned ref-bump path — a hand-edit
// of `ref =` alone is (correctly) blocked by uses-sha-verify-guard because the
// new archive hash can't be computed at edit time. `--label` replaces the
// `# <name>-<version|date>` prefix, keep it accurate to the new ref's track.
async function runSet(argv: string[], gitmodulesPath: string): Promise<void> {
  const parsed = parseSetArgs(argv)
  if ('error' in parsed) {
    logger.fail(parsed.error)
    process.exit(2)
  }
  const { label, newRef, selector } = parsed

  const raw = await fs.readFile(gitmodulesPath, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const blocks = parseBlocks(lines)
  const block = blocks.find(b => b.name === selector || b.path === selector)
  if (!block) {
    logger.fail(
      `gen/gitmodules-hash --set: no submodule matching \`${selector}\` — selector matches a [submodule "<name>"] or its \`path =\`.`,
    )
    process.exit(1)
  }
  // A brand-new block (just `git submodule add`ed) has neither the
  // `# <name>-<version>` header nor a `ref =` line. `--set` provisions both —
  // but then it needs a `--label` to name the new comment.
  const isNew = block.headerLine === undefined || block.refLine === undefined
  if (isNew && !label) {
    logger.fail(
      `gen/gitmodules-hash --set: ${block.name} has no header comment and/or ref line — pass \`--label <name>-<version|date>\` so the pin can be provisioned.`,
    )
    process.exit(1)
  }

  // GitHub → codeload archive hash; non-GitHub (or a GitHub codeload 404:
  // private repo / unreachable commit) → git ls-tree manifest of the
  // materialized worktree, an unmovable content hash tied to the commit.
  const worktree = block.path
    ? path.join(path.dirname(gitmodulesPath), block.path)
    : undefined
  const lsTreeOrFail = async (
    why: string,
  ): Promise<{ date: string | undefined; sha: string }> => {
    if (!worktree || !isMaterialized(worktree)) {
      logger.fail(
        `gen/gitmodules-hash --set: ${block.name} ${why} — its sha256 is then the git ls-tree manifest hash, which needs the submodule materialized at ${newRef.slice(0, 12)}…. Check it out first (git -C ${block.path ?? '<path>'} fetch + checkout ${newRef.slice(0, 12)}…), then re-run.`,
      )
      process.exit(1)
    }
    logger.log(
      `hashing ls-tree manifest of ${block.path}@${newRef.slice(0, 12)}…`,
    )
    return {
      date: await worktreeCommitDate(worktree, newRef),
      sha: await treeManifestSha256(worktree, newRef),
    }
  }
  let sha: string
  let date: string | undefined
  if (block.ownerRepo) {
    try {
      logger.log(`fetching ${block.ownerRepo}@${newRef.slice(0, 12)}…`)
      ;({ date, sha } = await archiveShaAndDate(block.ownerRepo, newRef))
    } catch (e) {
      if (!/HTTP 404/.test(errorMessage(e))) {
        throw e
      }
      logger.warn(
        `${block.name}: codeload 404; falling back to ls-tree manifest`,
      )
      ;({ date, sha } = await lsTreeOrFail(
        'is a GitHub remote whose codeload archive 404s (private / unreachable commit)',
      ))
    }
  } else {
    ;({ date, sha } = await lsTreeOrFail(
      'is a non-GitHub remote (no codeload archive)',
    ))
  }
  const prefix = label ? `# ${label}` : block.headerPrefix!
  const headerText = formatHeaderLine(prefix, date, sha)

  // Update existing lines in place; otherwise insert. Insert the ref line right
  // after the opening `[submodule …]` line, and the header comment right above
  // it — descending order so the earlier insert's index stays valid.
  if (block.refLine !== undefined) {
    lines[block.refLine] = lines[block.refLine]!.replace(
      /(ref\s*=\s*)[0-9a-f]+/,
      `$1${newRef}`,
    )
  } else {
    lines.splice(block.openLine + 1, 0, `\tref = ${newRef}`)
  }
  if (block.headerLine !== undefined) {
    lines[block.headerLine] = headerText
  } else {
    lines.splice(block.openLine, 0, headerText)
  }
  await fs.writeFile(gitmodulesPath, lines.join(eol), 'utf8')
  logger.success(
    `gen/gitmodules-hash: ${isNew ? 'provisioned' : 'set'} ${block.name} → ref ${newRef.slice(0, 12)}… sha256 ${sha.slice(0, 12)}…${date ? ` (${date})` : ''}.`,
  )
  process.exitCode = 0
}

// The positional .gitmodules path is the last non-flag arg that isn't a value
// consumed by --set / --label.
export function resolvePositionalFileArg(argv: string[]): string | undefined {
  const consumed = new Set<number>()
  for (const flag of ['--set', '--label']) {
    const fi = argv.indexOf(flag)
    if (fi >= 0) {
      consumed.add(fi)
      consumed.add(fi + 1)
      if (flag === '--set') {
        consumed.add(fi + 2)
      }
    }
  }
  return argv.find((a, idx) => !a.startsWith('--') && !consumed.has(idx))
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2)
  const mode = argv.find(
    a => a === '--check' || a === '--set' || a === '--write',
  )
  if (!mode) {
    process.stderr.write(USAGE)
    process.exit(2)
  }
  const fileArg = resolvePositionalFileArg(argv)
  const gitmodulesPath = resolveGitmodulesPath(fileArg)

  if (mode === '--set') {
    await runSet(argv, gitmodulesPath)
    return
  }

  const raw = await fs.readFile(gitmodulesPath, 'utf8')
  const eol = raw.includes('\r\n') ? '\r\n' : '\n'
  const lines = raw.split(/\r?\n/)
  const blocks = parseBlocks(lines)
  const resolved = await resolveAll(blocks, path.dirname(gitmodulesPath))

  for (const { block, skipped } of resolved) {
    if (skipped) {
      logger.warn(`${block.name}: skipped — ${skipped}`)
    }
  }

  if (mode === '--check') {
    const { issues, skips, verified } = planCheck(resolved)
    for (const issue of issues) {
      logger.fail(`${issue.name}: ${issue.detail}`)
    }
    if (issues.length > 0) {
      const shaCount = issues.filter(i => i.kind === 'sha').length
      const dateCount = issues.length - shaCount
      logger.fail(
        `gen/gitmodules-hash: ${issues.length} drift(s) — ${shaCount} sha256, ${dateCount} date. Run \`--write\` to refresh.`,
      )
      process.exitCode = 1
      return
    }
    logger.success(
      `gen/gitmodules-hash: all ${verified} pinned block(s) current${skips ? `, ${skips} skipped` : ''}.`,
    )
    process.exitCode = 0
    return
  }

  // --write. planWrites touches only genuine headers; it never mutates an
  // annotation, so the good pins persist even when a sibling block lacks a
  // header to write to. Surface those with a non-zero exit so a drift can't be
  // silently swallowed.
  const plan = planWrites(lines, resolved)
  for (const entry of plan.entries) {
    if (entry.status === 'no-header') {
      logger.fail(`${entry.name}: ${entry.detail}`)
    }
  }
  if (plan.written > 0) {
    await fs.writeFile(gitmodulesPath, plan.lines.join(eol), 'utf8')
  }
  if (plan.errors > 0) {
    logger.fail(
      `gen/gitmodules-hash: ${plan.errors} block(s) drifted with no header to attach a pin to — add the comment, then re-run.${plan.written ? ` (${plan.written} other pin(s) written.)` : ''}`,
    )
    process.exitCode = 1
    return
  }
  if (plan.written > 0) {
    logger.success(
      `gen/gitmodules-hash: wrote ${plan.written} pin(s)${plan.skips ? `, ${plan.skips} skipped` : ''}.`,
    )
    process.exitCode = 0
    return
  }
  logger.success(
    `gen/gitmodules-hash: all ${plan.entries.length - plan.skips} pinned block(s) current${plan.skips ? `, ${plan.skips} skipped` : ''}.`,
  )
  process.exitCode = 0
}

const SCRIPT_META: ScriptMeta = {
  describe:
    'set, generate, or verify the .gitmodules content-hash pin comments',
  help: USAGE,
}

if (isMainModule(import.meta.url)) {
  runMain(main, SCRIPT_META)
}
