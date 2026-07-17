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
 *   behavior, not a failure. Usage: gen-gitmodules-hash.mts --check
 *   [path/to/.gitmodules] # verify, exit 1 on drift gen-gitmodules-hash.mts
 *   --write [path/to/.gitmodules] # rewrite stale/missing hashes Non-GitHub
 *   remotes (e.g. *.googlesource.com) have no codeload archive and are skipped
 *   with a logged note — the guard still requires a hash there, so such a
 *   submodule needs a hand-supplied pin (out of scope for this tool).
 */

import crypto from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { errorMessage } from '@socketsecurity/lib-stable/errors/message'
import { httpRequest } from '@socketsecurity/lib-stable/http-request'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { isMainModule } from './_shared/is-main-module.mts'

const logger = getDefaultLogger()

const USAGE = `gen-gitmodules-hash — set / generate / verify .gitmodules content-hash pins

Usage:
  gen-gitmodules-hash.mts --check [<.gitmodules>]   verify every block's sha256 (exit 1 on drift)
  gen-gitmodules-hash.mts --write [<.gitmodules>]   rewrite stale / missing sha256 comments
  gen-gitmodules-hash.mts --set <name|path> <ref> [--label <text>] [<.gitmodules>]
                                                    bump one submodule's ref AND its sha256
                                                    together (the only correct way to bump a
                                                    ref — uses-sha-verify-guard requires both)

The hash is sha256 of https://codeload.github.com/<owner>/<repo>/tar.gz/<ref>.
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
  // The `# <name>-<version>` prefix (everything before ` sha256:`), preserved
  // verbatim on rewrite so the version label and any trailing notes survive.
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
    let headerPrefix: string | undefined
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = lines[j]!
      if (prev.trim() === '' || /^\s*\[submodule\s+"/.test(prev)) {
        break
      }
      // A `# <name>-<version>` comment line: captures (1) the `# name-…` prefix,
      // (2) an optional `sha256:<hex>` stamp, (3) any trailing text.
      const header =
        /* socket-lint: allow uncommented-regex */ /^(#\s+[a-z0-9][a-z0-9.-]*-\S+?)(?:\s+sha256:([0-9a-f]+))?(\s.*)?$/.exec(
          prev,
        )
      if (header) {
        headerLine = j
        headerPrefix = header[1]
        headerSha = header[2]
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
      // A `url = …github.com…<owner>/<repo>` line (https or ssh form), captures
      // `owner/repo` (sans optional `.git`). Alternation sorted (`git@` before
      // `https`) per sort-regex-alternations.
      const urlMatch =
        /* socket-lint: allow uncommented-regex */ /^\s*url\s*=\s*(?:git@github\.com:|https?:\/\/github\.com\/)([^/\s]+\/[^/\s]+?)(?:\.git)?\s*$/.exec(
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
      headerPrefix,
      ownerRepo,
      ref,
      refLine,
      path: blockPath,
    })
  }
  return blocks
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

export interface Resolved {
  block: Block
  computed: string | undefined
  skipped: string | undefined
}

export async function resolveAll(blocks: Block[]): Promise<Resolved[]> {
  const out: Resolved[] = []
  for (let i = 0, { length } = blocks; i < length; i += 1) {
    const block = blocks[i]!
    if (!block.ownerRepo) {
      out.push({
        block,
        computed: undefined,
        skipped: 'non-GitHub remote (no codeload archive)',
      })
      continue
    }
    if (!block.ref) {
      out.push({
        block,
        computed: undefined,
        skipped: 'no `ref = <sha>` to hash',
      })
      continue
    }
    logger.log(`fetching ${block.ownerRepo}@${block.ref.slice(0, 12)}…`)
    out.push({
      block,
      computed: await archiveSha256(block.ownerRepo, block.ref),
      skipped: undefined,
    })
  }
  return out
}

// Resolve the `.gitmodules` path argument (positional, after any flags) and
// confirm it exists. Exits non-zero with a fix message otherwise.
export function resolveGitmodulesPath(positional: string | undefined): string {
  const gitmodulesPath = path.resolve(positional ?? '.gitmodules')
  if (!existsSync(gitmodulesPath)) {
    logger.fail(
      `gen-gitmodules-hash: no .gitmodules at ${gitmodulesPath} — pass the path as the first argument`,
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
        'gen-gitmodules-hash --set: needs `<name|path> <ref>` — e.g. `--set packages/acorn/upstream/acorn 8a47812…`',
    }
  }
  if (!/^[0-9a-f]{40}$/.test(newRef)) {
    return {
      error: `gen-gitmodules-hash --set: ref must be a full 40-hex commit SHA, got \`${newRef}\` — resolve a tag/branch to its commit first (git ls-remote <url> refs/tags/<t>^{})`,
    }
  }
  return { label, newRef, selector }
}

// `--set <name|path> <ref> [--label <text>]`: bump one submodule's ref AND its
// sha256 in a single write. This is the sanctioned ref-bump path — a hand-edit
// of `ref =` alone is (correctly) blocked by uses-sha-verify-guard because the
// new archive hash can't be computed at edit time. `--label` replaces the
// `# <name>-<version|date>` prefix (keep it accurate to the new ref's track).
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
      `gen-gitmodules-hash --set: no submodule matching \`${selector}\` — selector matches a [submodule "<name>"] or its \`path =\`.`,
    )
    process.exit(1)
  }
  if (!block.ownerRepo) {
    logger.fail(
      `gen-gitmodules-hash --set: ${block.name} is not a GitHub remote — no codeload archive to hash; set the sha256 by hand.`,
    )
    process.exit(1)
  }
  // A brand-new block (just `git submodule add`ed) has neither the
  // `# <name>-<version>` header nor a `ref =` line. `--set` provisions both —
  // but then it needs a `--label` to name the new comment.
  const isNew = block.headerLine === undefined || block.refLine === undefined
  if (isNew && !label) {
    logger.fail(
      `gen-gitmodules-hash --set: ${block.name} has no header comment and/or ref line — pass \`--label <name>-<version|date>\` so the pin can be provisioned.`,
    )
    process.exit(1)
  }

  logger.log(`fetching ${block.ownerRepo}@${newRef.slice(0, 12)}…`)
  const sha = await archiveSha256(block.ownerRepo, newRef)
  const prefix = label ? `# ${label}` : block.headerPrefix!
  const headerText = `${prefix} sha256:${sha}`

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
    `gen-gitmodules-hash: ${isNew ? 'provisioned' : 'set'} ${block.name} → ref ${newRef.slice(0, 12)}… sha256 ${sha.slice(0, 12)}….`,
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
  const resolved = await resolveAll(blocks)

  let drift = 0
  let skips = 0
  for (const { block, computed, skipped } of resolved) {
    if (skipped) {
      logger.warn(`${block.name}: skipped — ${skipped}`)
      skips += 1
      continue
    }
    if (computed === block.headerSha) {
      continue
    }
    drift += 1
    if (mode === '--check') {
      logger.fail(
        `${block.name}: sha256 ${block.headerSha ? 'stale' : 'missing'} — comment ${block.headerSha?.slice(0, 12) ?? '<none>'}…, archive ${computed!.slice(0, 12)}…`,
      )
    } else if (block.headerLine === undefined || !block.headerPrefix) {
      logger.fail(
        `${block.name}: no \`# <name>-<version>\` header comment to attach a sha256 to — add the comment first (gitmodules-comment-guard shape), then re-run`,
      )
    } else {
      lines[block.headerLine] = `${block.headerPrefix} sha256:${computed}`
    }
  }

  if (mode === '--write' && drift > 0) {
    await fs.writeFile(gitmodulesPath, lines.join(eol), 'utf8')
    logger.success(
      `gen-gitmodules-hash: wrote ${drift} sha256 pin(s)${skips ? `, ${skips} skipped` : ''}.`,
    )
    process.exitCode = 0
    return
  }
  if (mode === '--check' && drift > 0) {
    logger.fail(
      `gen-gitmodules-hash: ${drift} block(s) with a stale / missing sha256 — run \`--write\` to refresh.`,
    )
    process.exitCode = 1
    return
  }
  logger.success(
    `gen-gitmodules-hash: all ${resolved.length - skips} GitHub block(s) current${skips ? `, ${skips} skipped` : ''}.`,
  )
  process.exitCode = 0
}

if (isMainModule(import.meta.url)) {
  main().catch((e: unknown) => {
    logger.fail(`gen-gitmodules-hash: ${errorMessage(e)}`)
    process.exitCode = 1
  })
}
