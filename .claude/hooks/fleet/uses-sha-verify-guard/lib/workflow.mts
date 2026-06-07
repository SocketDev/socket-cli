// Edit/Write surface for workflow / action YAML files.
// Validates every `uses: <owner>/<repo>(/<path>)?@<ref>` line.

import type { Cache } from './cache.mts'
import type { UsesIssue } from './issue-types.mts'
import { USES_RE } from './regexes.mts'
import { validateRefReachable, validateRefShape } from './validate-ref.mts'

export function findUsesIssues(content: string, cache: Cache): UsesIssue[] {
  const issues: UsesIssue[] = []
  const lines = content.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]!
    const m = USES_RE.exec(line)
    if (!m) {
      continue
    }
    const ownerRepoPath = m[1]!
    const ref = m[2]!
    const ownerRepo = ownerRepoPath.split('/').slice(0, 2).join('/')
    const shape = validateRefShape(ref)
    if (!shape.ok) {
      issues.push({ line: i + 1, raw: line.trim(), problem: shape.problem })
      continue
    }
    const reach = validateRefReachable(ownerRepo, ref, cache)
    if (!reach.ok) {
      issues.push({ line: i + 1, raw: line.trim(), problem: reach.problem })
    }
  }
  return issues
}
