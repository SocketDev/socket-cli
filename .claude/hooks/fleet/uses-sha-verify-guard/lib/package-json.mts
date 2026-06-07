// Edit/Write surface for `package.json` files (and nested workspace
// package.json files; excludes `node_modules/`).
//
// Validates every `git+https://github.com/<owner>/<repo>(.git)?#<ref>`
// dep specifier in `dependencies`, `devDependencies`, `peerDependencies`,
// `optionalDependencies`, `overrides`, or `resolutions` — each `<ref>`
// must be a full 40-char hex SHA that resolves in `<owner>/<repo>`.

import type { Cache } from './cache.mts'
import type { PackageJsonIssue } from './issue-types.mts'
import { PACKAGE_JSON_GITHUB_RE } from './regexes.mts'
import { validateRefReachable, validateRefShape } from './validate-ref.mts'

export function findPackageJsonIssues(
  content: string,
  cache: Cache,
): PackageJsonIssue[] {
  const issues: PackageJsonIssue[] = []
  PACKAGE_JSON_GITHUB_RE.lastIndex = 0
  let match: RegExpExecArray | null = PACKAGE_JSON_GITHUB_RE.exec(content)
  while (match) {
    const ownerRepo = match[1]!
    const ref = match[2]!
    const shape = validateRefShape(ref)
    if (!shape.ok) {
      issues.push({ ownerRepo, ref, problem: shape.problem })
    } else {
      const reach = validateRefReachable(ownerRepo, ref, cache)
      if (!reach.ok) {
        issues.push({ ownerRepo, ref, problem: reach.problem })
      }
    }
    match = PACKAGE_JSON_GITHUB_RE.exec(content)
  }
  return issues
}
