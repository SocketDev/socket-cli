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

const LOCAL_PATH_FIX_LINES: readonly string[] = [
  '  A `link:`/`file:` spec is a PUBLISHING GAP wearing a dependency’s',
  '  clothes. The install resolves to whatever sits at that path on the',
  '  machine running it, and to NOTHING on a fresh clone — CI, a new',
  '  contributor, a release runner. Treat it as release work, not cleanup.',
  '',
  '  Fix — in priority order:',
  '    1. PUBLISH THE PACKAGE, THEN GO THROUGH THE CATALOG. Reserve the',
  '       name and wire trusted publishing:',
  '         node scripts/fleet/publish-infra/npm/placeholder.mts',
  '         node scripts/fleet/publish-infra/cargo/placeholder.mts',
  '         node scripts/fleet/publish-infra/cargo/trusted-publisher.mts',
  '       Add the published version to the fleet catalog',
  '       (`.config/fleet/pnpm-workspace.fleet.yaml`), then depend on it',
  '       as `"pkg": "catalog:"`. `catalog:` is the PREFERRED fleet form:',
  '       it pins hard, and one central bump upgrades every repo at once.',
  '    2. Exact published version — `"pkg": "1.2.3"`. Use when the package',
  '       does not belong in the fleet-wide catalog; it costs a manifest',
  '       bump per release.',
  '    3. FALLBACK, in-repo package that genuinely cannot be published —',
  '       `"pkg": "workspace:1.2.3"` (exact, not `workspace:*`) and list',
  '       its directory under `packages:` in `pnpm-workspace.yaml`. This is',
  '       the last resort, NOT the recommended destination: every sibling',
  '       release forces a manifest bump in each dependent.',
  '    4. Generated per-platform output a `packages:` glob swept in (the',
  '       decmpfs shape: `napi/decmpfs/npm/<triple>/` build artifacts) —',
  '       NARROW THE GLOB so it stops matching generated dirs, then',
  '       regenerate the lockfile. Those packages resolve from the',
  '       registry and the publish engine finds them by convention.',
]

const WORKSPACE_RANGE_FIX_LINES: readonly string[] = [
  '  A range lets the resolved sibling version drift with whatever tree the',
  '  install runs against, and pnpm expands it at publish time into a range',
  '  every consumer inherits.',
  '',
  '  Fix — in priority order:',
  '    1. `"pkg": "catalog:"` — PREFERRED. Publish the sibling if it is not',
  '       published yet, add it to the fleet catalog',
  '       (`.config/fleet/pnpm-workspace.fleet.yaml`), and depend on it',
  '       through the catalog. One central bump upgrades every repo.',
  '    2. `"pkg": "1.2.3"` — the sibling’s exact published version, when it',
  '       does not belong in the fleet-wide catalog.',
  '    3. `"pkg": "workspace:1.2.3"` — FALLBACK only, for a sibling that',
  '       genuinely cannot be published. Legal, but it buys a manifest bump',
  '       in every dependent on each sibling release.',
]

function describeFindings(
  findings: readonly DependencySpecFinding[],
): string[] {
  const lines: string[] = []
  for (let i = 0, { length } = findings; i < length; i += 1) {
    const finding = findings[i]!
    lines.push(`  • ${finding.field}.${finding.name}: "${finding.value}"`)
  }
  return lines
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
  const workspaceRange = added.filter(
    finding => finding.kind === 'workspace-range',
  )

  const headline =
    localPath.length > 0
      ? '[link-protocol-dep-guard] Blocked: this dependency is UNPUBLISHED — publish it'
      : '[link-protocol-dep-guard] Blocked: unpinned `workspace:` range in package.json'
  const lines: string[] = [headline, '', `  File: ${filePath}`, '']

  if (localPath.length > 0) {
    lines.push(...describeFindings(localPath))
    lines.push(
      '',
      '  Saw:    a `link:`/`file:` spec — this dependency resolves to a',
      '          local path, so the package it points at is NOT published.',
      '  Wanted: a published package reached through the fleet catalog —',
      '          `catalog:` first, an exact registry version (`"1.2.3"`)',
      '          second, `workspace:1.2.3` only as a fallback for a package',
      '          that genuinely cannot be published.',
      '',
      ...LOCAL_PATH_FIX_LINES,
    )
  }

  if (workspaceRange.length > 0) {
    if (localPath.length > 0) {
      lines.push('')
    }
    lines.push(...describeFindings(workspaceRange))
    lines.push(
      '',
      '  Saw:    a `workspace:` RANGE — `*`, `^`, or `~` floats the version.',
      '  Wanted: `catalog:` — the preferred fleet form for a pinned sibling.',
      '',
      ...WORKSPACE_RANGE_FIX_LINES,
    )
  }

  return block(lines.join('\n'))
})

export const hook = defineHook({
  bypass: ['link-protocol-dep'],
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
