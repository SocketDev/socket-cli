#!/usr/bin/env node
// Claude Code PreToolUse hook — link-protocol-dep-guard.
//
// Blocks Edit/Write to a `package.json` that adds an unpinned dependency
// spec to any dependency block — `dependencies`, `devDependencies`,
// `optionalDependencies`, `peerDependencies`, `overrides`, `resolutions`,
// or `pnpm.overrides`.
//
// Two blocking classes, from `_shared/dependency-spec-forms.mts`:
//
//   local-path      `link:` / `file:`. The dependency resolves to a
//                   directory on the installing machine, which means the
//                   package it names is UNPUBLISHED. Publishing it and
//                   routing it through the fleet catalog is the fix;
//                   narrowing a `packages:` glob is the rarer one.
//   workspace-range `workspace:*` / `workspace:^1.2.3`. A range floats.
//
// The fleet preference order among the pinned forms is `catalog:` > exact
// `1.2.3` > `workspace:1.2.3`, because one central catalog bump beats a
// manifest bump per dependent on every sibling release. Full rationale:
// `docs/agents.md/fleet/dependency-spec-pinning.md`.
//
// Two kinds are classified but never blocked here: `registry-range` (a bare
// `^1.2.3`, staged while the fleet's remaining ranges convert) and
// `workspace-pin` (`workspace:1.2.3` — legal, reported by the check as the
// `catalog:` conversion backlog). `isBlockingSpecKind` is the seam.
//
// Companion gate: `scripts/fleet/check/dependency-specs-are-registry-or-
// workspace.mts` catches the specs this hook cannot see — the ones pnpm
// GENERATES into `pnpm-lock.yaml` when a `packages:` glob in
// `pnpm-workspace.yaml` covers generated/gitignored directories. No
// manifest edit happens in that flow, so an edit-time guard alone would
// never fire.
//
// Bypass: `Allow link-protocol-dep bypass` typed verbatim.
//
// Fails open on JSON parse errors.

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import {
  collectDependencySpecFindings,
  dependencySpecFindingKey,
  isBlockingSpecKind,
} from '../_shared/dependency-spec-forms.mts'
import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'

import type { DependencySpecFinding } from '../_shared/dependency-spec-forms.mts'

export {
  isBlockingSpecKind,
  isRegistryRangeSpec,
  isWorkspaceRangeSpec,
  localPathProtocol,
} from '../_shared/dependency-spec-forms.mts'

export function isPackageJson(filePath: string): boolean {
  return path.basename(filePath) === 'package.json'
}

// Every out-of-contract spec in a package.json's dependency surface, keyed
// `<field>.<dependency name>` so a caller can diff before-vs-after and report
// only what an edit ADDS.
export function collectDependencySpecMap(
  text: string,
): Map<string, DependencySpecFinding> {
  const out = new Map<string, DependencySpecFinding>()
  const findings = collectDependencySpecFindings(text)
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    out.set(dependencySpecFindingKey(finding), finding)
  }
  return out
}

export function describeFindings(
  findings: readonly DependencySpecFinding[],
): string {
  return findings
    .map(finding => `${finding.field}.${finding.name} "${finding.value}"`)
    .join(', ')
}

export const check = editGuard((filePath, _content, payload) => {
  if (!isPackageJson(filePath)) {
    return undefined
  }

  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }
  const currentText = safeReadFileSync(filePath) ?? '{}'

  const beforeSpecs = collectDependencySpecMap(currentText)
  const afterSpecs = collectDependencySpecMap(afterText)

  const added: DependencySpecFinding[] = []
  for (const [key, finding] of afterSpecs) {
    if (!isBlockingSpecKind(finding.kind)) {
      continue
    }
    const before = beforeSpecs.get(key)
    if (before === undefined || before.value !== finding.value) {
      added.push(finding)
    }
  }
  if (added.length === 0) {
    return undefined
  }

  const localPath = added.filter(finding => finding.kind === 'local-path')

  // Priority order among the pinned forms: `catalog:` (one central bump)
  // > exact `1.2.3` > `workspace:1.2.3` as the last resort.
  const reason =
    localPath.length > 0
      ? 'a `link:`/`file:` spec means the package is UNPUBLISHED — publish it ' +
        '(node scripts/fleet/publish-infra/npm/placeholder.mts), then pin via ' +
        '`catalog:` (preferred) > exact "1.2.3" > `workspace:1.2.3` (last ' +
        'resort); a generated dir swept by a `packages:` glob instead needs ' +
        'the glob narrowed'
      : 'a `workspace:` RANGE floats — pin via `catalog:` (preferred) > ' +
        'exact "1.2.3" > `workspace:1.2.3` (last resort)'
  return block(
    `🚨 link-protocol-dep-guard: blocked ${describeFindings(added)} in ` +
      `${filePath} — ${reason}.`,
  )
})

export const hook = defineHook({
  bypass: ['link-protocol-dep'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
