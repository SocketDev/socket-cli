#!/usr/bin/env node
/**
 * @file `check --all` gate: every gh-aw agentic workflow's compiled
 *   `<name>.lock.yml` is in sync with its `<name>.md` source. gh-aw embeds a
 *   `body_hash` (sha256 of the markdown body, trimmed) in the `.lock.yml`'s `#
 *   gh-aw-metadata:` header; this check recomputes that hash from the `.md` and
 *   fails if they diverge — i.e. someone edited the prompt body without
 *   re-running `gh aw compile`, so the committed `.lock.yml` (the file GitHub
 *   Actions actually runs) is stale. Pure node, no gh-aw dependency, so it runs
 *   in CI without the extension installed. A `.md` with no sibling `.lock.yml`
 *   (authored but never compiled) fails too — the `.lock.yml` is what runs, so
 *   an uncompiled `.md` is a no-op workflow. A repo with no gh-aw workflows
 *   passes vacuously. Exit 0 — all in sync (or none); 1 — at least one stale /
 *   missing lock.
 */

// oxlint-disable-next-line socket/prefer-async-spawn -- sync check; needs typed string stdout from `git ls-files`, no async.
import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'
import crypto from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

const logger = getDefaultLogger()

// The markdown body (everything after the closing frontmatter `---`), the way
// gh-aw hashes it for `body_hash`: sha256 of the body with surrounding
// whitespace trimmed.
export function bodyHashOf(mdText: string): string {
  const parts = mdText.split(/^---\s*$/mu)
  // parts[0] is the pre-frontmatter (empty), parts[1] the frontmatter, the
  // rest is the body (a `---` inside the body rejoins faithfully).
  const body = parts.slice(2).join('---')
  return crypto.createHash('sha256').update(body.trim()).digest('hex')
}

// Pull the embedded body_hash from a .lock.yml's gh-aw-metadata header line.
export function embeddedBodyHash(lockText: string): string | undefined {
  const m = /"body_hash":"([0-9a-f]+)"/u.exec(lockText)
  return m ? m[1] : undefined
}

// Enumerate tracked gh-aw workflow markdown sources.
function listAgenticMarkdown(): string[] {
  try {
    const r = spawnSync('git', ['ls-files', '*.github/workflows/*.md'], {
      stdio: 'pipe',
    })
    if (r.status !== 0) {
      return []
    }
    const { stdout } = r
    return (typeof stdout === 'string' ? stdout : String(stdout))
      .split(/\r?\n/u)
      .map(s => s.trim())
      .filter(Boolean)
  } catch {
    return []
  }
}

const mdFiles = listAgenticMarkdown()
const problems: string[] = []
let checked = 0

for (let i = 0, { length } = mdFiles; i < length; i += 1) {
  const md = mdFiles[i]!
  // A gh-aw workflow source always opens with YAML frontmatter (`---`); plain
  // documentation living beside the workflows (README.md) does not, and has no
  // .lock.yml to compile.
  let head = ''
  try {
    head = readFileSync(md, 'utf8').slice(0, 4)
  } catch {
    head = ''
  }
  if (!head.startsWith('---')) {
    continue
  }
  const lock = md.replace(/\.md$/u, '.lock.yml')
  if (!existsSync(lock)) {
    problems.push(
      `${md}: no compiled ${lock} — run \`gh aw compile ${md}\` and commit it (the .lock.yml is what GitHub Actions runs)`,
    )
    continue
  }
  checked += 1
  let mdText: string
  let lockText: string
  try {
    mdText = readFileSync(md, 'utf8')
    lockText = readFileSync(lock, 'utf8')
  } catch (e) {
    problems.push(`${md}: could not read source/lock (${String(e)})`)
    continue
  }
  const embedded = embeddedBodyHash(lockText)
  if (!embedded) {
    problems.push(
      `${lock}: no body_hash in the gh-aw-metadata header — not a gh-aw lock, or hand-edited`,
    )
    continue
  }
  const actual = bodyHashOf(mdText)
  if (actual !== embedded) {
    problems.push(
      `${md} body changed without recompiling: lock body_hash ${embedded.slice(0, 12)}… ≠ source ${actual.slice(0, 12)}… — run \`gh aw compile ${md}\` and commit the .lock.yml`,
    )
  }
}

if (problems.length === 0) {
  logger.log(
    checked === 0
      ? 'gh-aw locks: no agentic workflows in this repo (not applicable).'
      : `gh-aw locks: ${checked} workflow(s) in sync with their .md source.`,
  )
  process.exitCode = 0
} else {
  logger.error('')
  logger.error(`[gh-aw-locks] ${problems.length} stale / missing lock(s):`)
  for (let i = 0, { length } = problems; i < length; i += 1) {
    logger.error(`  ✗ ${problems[i]!}`)
  }
  process.exitCode = 1
}
