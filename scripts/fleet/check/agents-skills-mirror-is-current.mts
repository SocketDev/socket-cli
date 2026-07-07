// Fleet check — the cross-tool `.agents/skills/` mirror is in sync with the
// segmented `.claude/skills/{fleet,repo}/` source.
//
// The mirror is GENERATED (gen-agents-skills-mirror.mts) so Codex + OpenCode —
// which discover skills one level deep — find every fleet/repo skill flattened
// to `.agents/skills/<tier>-<name>/` with its frontmatter `name:` rewritten to
// match the dir. It must never be hand-edited; the source of truth is
// `.claude/skills/`. This check fails `check --all` when the committed mirror
// drifts (a skill added/renamed/removed under .claude/skills/ without
// regenerating, or a hand-edit to .agents/skills/).
//
// Fix: `node scripts/fleet/gen-agents-skills-mirror.mts` then commit.
//
// Delegates to the generator's own `--check` mode so the drift logic has one
// home (the generator) — this check is the `check --all` entry point. No-op in
// a repo with no `.claude/skills/`.
//
// Usage: node scripts/fleet/check/agents-skills-mirror-is-current.mts

import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { spawnSync } from '@socketsecurity/lib-stable/process/spawn/child'

import { REPO_ROOT } from '../paths.mts'

function main(): void {
  const r = spawnSync(
    'node',
    ['scripts/fleet/gen-agents-skills-mirror.mts', '--check'],
    { cwd: REPO_ROOT, stdio: 'inherit' },
  )
  // The generator sets exitCode 1 on drift, 0 in sync. Mirror that.
  process.exitCode = r.status ?? 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
