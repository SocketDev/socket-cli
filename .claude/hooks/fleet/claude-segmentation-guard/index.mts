#!/usr/bin/env node
// Claude Code PreToolUse hook — claude-segmentation-guard.
//
// Blocks Edit/Write tool calls that create or modify entries directly
// under `.claude/{agents,commands,hooks,skills}/<name>/` (instead of
// `fleet/<name>/` or `repo/<name>/`). Pre-segmentation top-level
// dangling entries shadow the canonical `fleet/<name>/` copy and break
// skill resolution.
//
// Past incident: a fleet-wide audit found ~200 dangling
// entries across 10 repos — every fleet repo had at least 18
// duplicate top-level skill directories shadowing their `fleet/<name>/`
// counterparts. The cleanup script
// (`scripts/fleet/check/claude-dirs-are-segmented.mts --fix`) resolved them in
// bulk; this hook prevents the regression at edit time.
//
// Allowed paths:
//   .claude/agents/fleet/<name>/...
//   .claude/agents/repo/<name>/...
//   .claude/agents/_*/...                  (internals folder exception)
//   .claude/commands/fleet/<name>.md
//   .claude/commands/repo/<name>.md
//   .claude/hooks/_shared/...              (and any _-prefixed name)
//   .claude/hooks/fleet/<name>/...
//   .claude/hooks/repo/<name>/...
//   .claude/skills/_shared/...
//   .claude/skills/fleet/<name>/...
//   .claude/skills/repo/<name>/...
//
// Blocked:
//   .claude/agents/<name>.md               (not under fleet/ or repo/)
//   .claude/commands/<name>.md             (same)
//   .claude/hooks/<name>/...               (same)
//   .claude/skills/<name>/...              (same)
//
// Wheelhouse-template paths under `template/.claude/<kind>/` follow
// the same rule — the template ships canonical entries, and the
// cascade keeps the layout consistent fleet-wide.
//
// Fails open on malformed payloads (allow, stderr log handled by the runner).

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'

const KINDS: readonly string[] = ['agents', 'commands', 'hooks', 'skills']

// Match `.claude/<kind>/<entry>` at the root of the captured path. The
// regex is rooted on `.claude/` and consumes the kind segment; the
// post-kind segment is what we validate.
//
// Examples:
//   path=/.../template/.claude/skills/foo/SKILL.md  → kind=skills entry=foo
//   path=/.../.claude/skills/fleet/foo/SKILL.md      → kind=skills entry=fleet (OK)
//   path=/.../.claude/skills/repo/bar/SKILL.md       → kind=skills entry=repo (OK)
//   path=/.../.claude/skills/_shared/util.mts        → kind=skills entry=_shared (OK)
//   path=/.../.claude/agents/foo.md                  → kind=agents entry=foo.md (block)
const SEGMENT_RE = new RegExp(
  String.raw`\.claude/(?<kind>${KINDS.join('|')})/(?<entry>[^/]+)`,
)

interface SegmentMatch {
  kind: string
  entry: string
}

export function findDanglingSegment(
  filePath: string,
): SegmentMatch | undefined {
  const m = SEGMENT_RE.exec(filePath)
  if (!m?.groups) {
    return undefined
  }
  const kind = m.groups['kind']!
  const entry = m.groups['entry']!
  // `_`-prefixed internals folder, `fleet/`, and `repo/` are the
  // allowed second-level segments. Anything else is a dangling
  // top-level entry that should be moved.
  if (entry.startsWith('_') || entry === 'fleet' || entry === 'repo') {
    return undefined
  }
  return { kind, entry }
}

export const check = editGuard(filePath => {
  const hit = findDanglingSegment(filePath)
  if (!hit) {
    return undefined
  }

  const targetForCanonical = `.claude/${hit.kind}/fleet/${hit.entry}`
  const targetForRepo = `.claude/${hit.kind}/repo/${hit.entry}`

  return block(
    [
      '[claude-segmentation-guard] Blocked: dangling top-level entry.',
      '',
      `  Attempted path: \`.claude/${hit.kind}/${hit.entry}\``,
      '',
      '  `.claude/{agents,commands,hooks,skills}/<name>/` must segment as',
      '  `fleet/<name>/` (wheelhouse-canonical) or `repo/<name>/` (everything',
      '  else). Top-level entries shadow the canonical `fleet/<name>/`',
      '  copy and break skill resolution.',
      '',
      `  Fix: pick the right subdir for \`${hit.entry}\`:`,
      '',
      `    Wheelhouse-canonical (look in socket-wheelhouse/template/.claude/${hit.kind}/fleet/ for the set):`,
      `      ${targetForCanonical}`,
      '',
      '    Repo-only:',
      `      ${targetForRepo}`,
      '',
      '  Or run `node scripts/fleet/check/claude-dirs-are-segmented.mts --fix` from the',
      '  repo root to auto-resolve any dangling entries already on disk.',
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
