// Edit/Write surface for `.gitmodules`.
// Validates each `[submodule "..."]` block:
//   - the preceding `# <name>-<version> sha256:<64hex>` header comment
//   - the `ref = <40hex>` field shape
//   - (when cache is provided) reachability of refSha in the
//     submodule's GitHub url

import { verifyCommitSha } from './cache.mts'
import type { Cache } from './cache.mts'
import type { SubmoduleIssue } from './issue-types.mts'
import {
  GITMODULES_HEADER_RE,
  GITMODULES_REF_RE,
  GITMODULES_URL_RE,
  SUBMODULE_OPEN_RE,
} from './regexes.mts'

interface Block {
  name: string
  startLine: number
  headerCommentSha: string | undefined
  refSha: string | undefined
  ownerRepo: string | undefined
}

export function findGitmodulesIssues(
  content: string,
  cache?: Cache,
): SubmoduleIssue[] {
  const issues: SubmoduleIssue[] = []
  const lines = content.split('\n')

  const blocks: Block[] = []
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const open = SUBMODULE_OPEN_RE.exec(line)
    if (!open) {
      continue
    }
    const name = open.groups!.name!
    let headerSha: string | undefined
    for (let j = i - 1; j >= 0; j -= 1) {
      const prev = lines[j]!
      if (prev.trim() === '' || SUBMODULE_OPEN_RE.test(prev)) {
        break
      }
      const headerMatch = GITMODULES_HEADER_RE.exec(prev)
      if (headerMatch) {
        headerSha = headerMatch.groups!.sha
        break
      }
    }
    let refSha: string | undefined
    let ownerRepo: string | undefined
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j]!
      if (/^\s*\[/.test(next)) {
        break
      }
      if (!refSha) {
        const refMatch = GITMODULES_REF_RE.exec(next)
        if (refMatch) {
          refSha = refMatch.groups!.ref
        }
      }
      if (!ownerRepo) {
        const urlMatch = GITMODULES_URL_RE.exec(next)
        if (urlMatch) {
          ownerRepo = urlMatch.groups!.ownerRepo
        }
      }
    }
    blocks.push({
      name,
      startLine: i + 1,
      headerCommentSha: headerSha,
      refSha,
      ownerRepo,
    })
  }

  for (let i = 0, { length } = blocks; i < length; i += 1) {
    const block = blocks[i]!
    if (!block.headerCommentSha) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem:
          'missing `# <name>-<version> sha256:<64hex>` comment above the [submodule] block (content-hash pin required)',
      })
    } else if (!/^[0-9a-f]{64}$/.test(block.headerCommentSha)) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem: `header comment sha256 must be exactly 64 hex chars; got ${block.headerCommentSha.length}`,
      })
    }
    if (!block.refSha) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem:
          'missing `ref = <40hex>` field inside the [submodule] block (commit-SHA pin required)',
      })
    } else if (!/^[0-9a-f]{40}$/.test(block.refSha)) {
      issues.push({
        submodule: block.name,
        line: block.startLine,
        problem: `ref must be exactly 40 hex chars; got ${block.refSha.length}`,
      })
    } else if (cache && block.ownerRepo) {
      // Reachability check — refSha is a full 40-char hex, ownerRepo
      // came from a GitHub `url = ` line. If gh api says the commit
      // doesn't exist in that repo, the pin is broken (typo,
      // fabricated SHA, force-pushed branch that removed the commit).
      if (!verifyCommitSha(block.ownerRepo, block.refSha, cache)) {
        issues.push({
          submodule: block.name,
          line: block.startLine,
          problem: `ref SHA ${block.refSha.slice(0, 10)}… not reachable in ${block.ownerRepo} (gh api 404). Either the SHA was mistyped, the commit was force-pushed away, or the repo is private and gh isn't authed for it.`,
        })
      }
    }
  }
  return issues
}
