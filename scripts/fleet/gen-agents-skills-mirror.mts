#!/usr/bin/env node
/**
 * @file Generate the cross-tool `.agents/skills/` mirror from the segmented
 *   `.claude/skills/{fleet,repo}/<name>/` source. Why: Claude reads
 *   `.claude/skills/` and handles the `fleet/` + `repo/` namespacing. Codex
 *   (`.agents/skills`) and OpenCode (one-level `<root>/<name>/SKILL.md`)
 *   discover skills ONE level deep — they'd see the `fleet`/`repo` segment dirs
 *   as skill names with no `SKILL.md` inside. So the cross-tool view must be
 *   FLAT. This generator hoists each segmented skill to
 *   `.agents/skills/<tier>-<name>/` (tier prefix = collision-free + preserves
 *   which tier it came from), so Codex + OpenCode find every fleet/repo skill.
 *   The tier prefix forces a rename, and OpenCode validates that a skill's
 *   frontmatter `name:` MATCHES its directory name — so the mirror cannot be a
 *   symlink (the `name:` would mismatch). It is a generated COPY with `name:`
 *   rewritten to `<tier>-<name>`. Supporting files (reference.md, scripts/, …)
 *   are copied verbatim. Tool-restriction caveat (documented, by design):
 *   Claude's per-skill `allowed-tools` does NOT port — Codex/OpenCode gate
 *   tools at the agent level. A mirrored skill runs with whatever the
 *   Codex/OpenCode session allows. Mirroring all skills is the chosen policy;
 *   tool-gating is the operator's agent config. The rewritten `name:` is the
 *   only frontmatter change; `allowed-tools`/`model`/`context` are copied
 *   through (ignored as unknown keys by Codex/OpenCode, which only require name
 *   + description). Idempotent: regenerates `.agents/skills/` from scratch each
 *   run (clears stale entries). The `agents-skills-mirror-current` check fails
 *   `check --all` if the committed mirror drifts from the source — the mirror
 *   is generated, never hand-edited. Usage: node
 *   scripts/fleet/gen-agents-skills-mirror.mts [--check] (no flag) regenerate
 *   the mirror in place. --check report drift without writing (exit 1 if
 *   stale); used by the check-only twin.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { REPO_ROOT } from './paths.mts'

const logger = getDefaultLogger()

const TIERS = ['fleet', 'repo'] as const
// Directories under a tier that are NOT skills (no SKILL.md to mirror).
const NON_SKILL_DIRS = new Set(['_shared'])

const CLAUDE_SKILLS_DIR = path.join(REPO_ROOT, '.claude', 'skills')
const AGENTS_SKILLS_DIR = path.join(REPO_ROOT, '.agents', 'skills')

export interface MirrorEntry {
  // Source skill dir, repo-relative (e.g. .claude/skills/fleet/foo).
  source: string
  // Flat mirror name (e.g. fleet-foo).
  mirrorName: string
}

// Rewrite the SKILL.md frontmatter `name:` to the flat mirror name. OpenCode
// requires name === directory name; the tier-prefixed dir forces the rewrite.
// Only the `name:` line changes; everything else (description, allowed-tools,
// body) is preserved verbatim.
export function rewriteSkillName(skillMd: string, mirrorName: string): string {
  // Match the first `name:` line inside the leading frontmatter block.
  // Frontmatter is the `---` … `---` at the top; `name:` is a top-level key.
  return skillMd.replace(/^name:[ \t]*\S.*$/m, `name: ${mirrorName}`)
}

// Discover the segmented skills as flat mirror entries.
export function discoverSkills(repoRoot: string): MirrorEntry[] {
  const entries: MirrorEntry[] = []
  const claudeSkills = path.join(repoRoot, '.claude', 'skills')
  for (let i = 0, { length } = TIERS; i < length; i += 1) {
    const tier = TIERS[i]!
    const tierDir = path.join(claudeSkills, tier)
    let names: string[]
    try {
      names = readdirSync(tierDir)
    } catch {
      continue
    }
    for (let j = 0, { length: nlen } = names; j < nlen; j += 1) {
      const name = names[j]!
      if (NON_SKILL_DIRS.has(name)) {
        continue
      }
      const skillDir = path.join(tierDir, name)
      if (!existsSync(path.join(skillDir, 'SKILL.md'))) {
        continue
      }
      entries.push({
        mirrorName: `${tier}-${name}`,
        source: path.relative(repoRoot, skillDir),
      })
    }
  }
  return entries
}

// Build the mirror content for one entry as a map of repo-relative-within-mirror
// path → file bytes. Used by both the writer and the drift check.
export function renderMirrorEntry(
  repoRoot: string,
  entry: MirrorEntry,
): Map<string, Buffer> {
  const out = new Map<string, Buffer>()
  const srcAbs = path.join(repoRoot, entry.source)
  const walk = (rel: string): void => {
    const abs = path.join(srcAbs, rel)
    const stats = readdirSync(abs, { withFileTypes: true })
    for (let i = 0, { length } = stats; i < length; i += 1) {
      const ent = stats[i]!
      const childRel = rel ? path.join(rel, ent.name) : ent.name
      if (ent.isDirectory()) {
        walk(childRel)
        continue
      }
      const fileAbs = path.join(srcAbs, childRel)
      if (childRel === 'SKILL.md') {
        const rewritten = rewriteSkillName(
          readFileSync(fileAbs, 'utf8'),
          entry.mirrorName,
        )
        out.set(childRel, Buffer.from(rewritten, 'utf8'))
      } else {
        out.set(childRel, readFileSync(fileAbs))
      }
    }
  }
  walk('')
  return out
}

function writeMirror(repoRoot: string, entries: readonly MirrorEntry[]): void {
  const agentsSkills = path.join(repoRoot, '.agents', 'skills')
  // Regenerate from scratch so a removed/renamed source skill can't leave a
  // stale mirror entry behind.
  rmSync(agentsSkills, { force: true, recursive: true })
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const files = renderMirrorEntry(repoRoot, entry)
    const destDir = path.join(agentsSkills, entry.mirrorName)
    for (const [rel, bytes] of files) {
      const dest = path.join(destDir, rel)
      mkdirSync(path.dirname(dest), { recursive: true })
      writeFileSync(dest, bytes)
    }
  }
}

// Compare the on-disk mirror to what would be generated. Returns the list of
// drift descriptions (empty = in sync).
export function findMirrorDrift(
  repoRoot: string,
  entries: readonly MirrorEntry[],
): string[] {
  const drift: string[] = []
  const agentsSkills = path.join(repoRoot, '.agents', 'skills')
  const expectedDirs = new Set(entries.map(e => e.mirrorName))
  // Stale mirror dirs (no longer a source skill).
  let actualDirs: string[] = []
  try {
    actualDirs = readdirSync(agentsSkills)
  } catch {
    // No mirror dir at all → every entry is missing.
  }
  for (let i = 0, { length } = actualDirs; i < length; i += 1) {
    if (!expectedDirs.has(actualDirs[i]!)) {
      drift.push(
        `stale mirror dir (no source skill): .agents/skills/${actualDirs[i]}`,
      )
    }
  }
  // Missing / mismatched per entry.
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const entry = entries[i]!
    const files = renderMirrorEntry(repoRoot, entry)
    for (const [rel, bytes] of files) {
      const dest = path.join(agentsSkills, entry.mirrorName, rel)
      let actual: Buffer | undefined
      try {
        actual = readFileSync(dest)
      } catch {
        drift.push(
          `missing mirror file: .agents/skills/${entry.mirrorName}/${rel}`,
        )
        continue
      }
      if (!actual.equals(bytes)) {
        drift.push(
          `stale mirror file: .agents/skills/${entry.mirrorName}/${rel}`,
        )
      }
    }
  }
  return drift
}

function main(): void {
  const checkOnly = process.argv.includes('--check')
  if (!existsSync(CLAUDE_SKILLS_DIR)) {
    logger.log(
      '[gen-agents-skills-mirror] no .claude/skills/ — nothing to mirror.',
    )
    return
  }
  const entries = discoverSkills(REPO_ROOT)
  if (checkOnly) {
    const drift = findMirrorDrift(REPO_ROOT, entries)
    if (drift.length) {
      logger.fail(
        `[gen-agents-skills-mirror] .agents/skills/ is stale (${drift.length} drift(s)) — regenerate with \`node scripts/fleet/gen-agents-skills-mirror.mts\`:`,
      )
      for (let i = 0, { length } = drift; i < length; i += 1) {
        logger.error(`  ✗ ${drift[i]}`)
      }
      process.exitCode = 1
      return
    }
    logger.success(
      `[gen-agents-skills-mirror] .agents/skills/ in sync (${entries.length} skills mirrored).`,
    )
    return
  }
  writeMirror(REPO_ROOT, entries)
  logger.success(
    `[gen-agents-skills-mirror] regenerated .agents/skills/ — ${entries.length} skills (${AGENTS_SKILLS_DIR}).`,
  )
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
