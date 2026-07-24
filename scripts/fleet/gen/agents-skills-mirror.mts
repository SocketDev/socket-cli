#!/usr/bin/env node
/**
 * @file Generate the cross-tool `.agents/skills/` mirror from the segmented
 *   `.claude/skills/{fleet,repo}/<name>/` source. Why: Claude Code reads
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
 *   tool-gating is the operator's agent config. The rewritten `name:` plus
 *   YAML-safe `description:` quoting are the only frontmatter changes;
 *   `allowed-tools`/`model`/`context` are copied through (ignored as unknown
 *   keys by Codex/OpenCode, which only require name + description). Repos may
 *   expose a smaller lazy catalog through `codexSkills.default` in
 *   `.config/socket-wheelhouse.json`; `--only` and `AGENTS_SKILLS` override it.
 *   Idempotent:
 *   regenerates `.agents/skills/` from scratch each run (clears stale entries).
 *   The `agents-skills-mirror-current` check fails
 *   `check --all` if the committed mirror drifts from the source — the mirror
 *   is generated, never hand-edited. Usage: node
 *   scripts/fleet/gen/agents-skills-mirror.mts [--check] (no flag) regenerate
 *   the mirror in place. --check report drift without writing (exit 1 if
 *   stale); used by the check-only twin.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import process from 'node:process'

import { safeDeleteSync } from '@socketsecurity/lib-stable/fs/safe'
import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'
import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { REPO_ROOT } from '../paths.mts'
import { isMainModule } from '../_shared/is-main-module.mts'

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

function selectionFrom(value: unknown): Set<string> | undefined {
  const names = Array.isArray(value)
    ? value.filter((name): name is string => typeof name === 'string')
    : typeof value === 'string'
      ? value.split(/[\s,]+/).filter(Boolean)
      : []
  return names.length > 0 ? new Set(names) : undefined
}

export function resolveSelectedSkills(
  repoRoot: string,
  args: readonly string[],
  env: Readonly<Record<string, string | undefined>>,
): Set<string> | undefined {
  const onlyArg = args.find(arg => arg.startsWith('--only='))
  const onlyIndex = args.indexOf('--only')
  const cliValue =
    onlyArg?.slice('--only='.length) ??
    (onlyIndex >= 0 ? args[onlyIndex + 1] : undefined)
  const cli = selectionFrom(cliValue)
  if (cli) {
    return cli
  }
  const fromEnv = selectionFrom(env['AGENTS_SKILLS'])
  if (fromEnv) {
    return fromEnv
  }
  try {
    const settings = JSON.parse(
      readFileSync(
        path.join(repoRoot, '.config/socket-wheelhouse.json'),
        'utf8',
      ),
    ) as { codexSkills?: { default?: unknown | undefined } | undefined }
    return selectionFrom(settings.codexSkills?.default)
  } catch {
    return undefined
  }
}

function yamlSingleQuote(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function rewriteFrontmatterLine(key: string, value: string): string {
  return `${key}: ${value}`
}

function quoteUnsafeDescription(frontmatter: string): string {
  return frontmatter.replace(/^description:[ \t]*(.+)$/m, (line, raw) => {
    const value = String(raw).trim()
    if (
      value === '' ||
      value.startsWith("'") ||
      value.startsWith('"') ||
      value.startsWith('|') ||
      value.startsWith('>')
    ) {
      return line
    }
    return rewriteFrontmatterLine('description', yamlSingleQuote(value))
  })
}

function rewriteLeadingFrontmatter(
  skillMd: string,
  rewrite: (frontmatter: string) => string,
): string {
  // YAML front-matter: `^` anchors to string start, `---\r?\n` matches the
  // opening delimiter, `[\s\S]*?` lazily captures the body, then `\r?\n---`
  // matches the closing delimiter followed by a newline or end-of-string.
  const match = /^(---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/.exec(skillMd)
  if (match === null) {
    return skillMd
  }
  return `${match[1]}${rewrite(match[2]!)}${match[3]}${skillMd.slice(match[0].length)}`
}

// Rewrite the SKILL.md frontmatter for the flat mirror. OpenCode requires
// name === directory name; the tier-prefixed dir forces the name rewrite. Codex
// validates YAML strictly, so unsafe plain description scalars are quoted while
// preserving the rest of the skill verbatim.
export function rewriteSkillName(skillMd: string, mirrorName: string): string {
  return rewriteLeadingFrontmatter(skillMd, frontmatter =>
    quoteUnsafeDescription(
      frontmatter.replace(
        /^name:[ \t]*\S.*$/m,
        rewriteFrontmatterLine('name', mirrorName),
      ),
    ),
  )
}

// Discover the segmented skills as flat mirror entries.
export function discoverSkills(
  repoRoot: string,
  selected?: ReadonlySet<string> | undefined,
): MirrorEntry[] {
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
      const mirrorName = `${tier}-${name}`
      if (selected && !selected.has(mirrorName)) {
        continue
      }
      entries.push({
        mirrorName,
        source: normalizePath(path.relative(repoRoot, skillDir)),
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
      const outputRel = normalizePath(childRel)
      if (childRel === 'SKILL.md') {
        const rewritten = rewriteSkillName(
          readFileSync(fileAbs, 'utf8'),
          entry.mirrorName,
        )
        out.set(outputRel, Buffer.from(rewritten, 'utf8'))
      } else {
        out.set(outputRel, readFileSync(fileAbs))
      }
    }
  }
  walk('')
  return out
}

export function writeMirror(
  repoRoot: string,
  entries: readonly MirrorEntry[],
): void {
  const agentsSkills = path.join(repoRoot, '.agents', 'skills')
  // Regenerate from scratch so a removed/renamed source skill can't leave a
  // stale mirror entry behind.
  safeDeleteSync(agentsSkills)
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
      '[gen/agents-skills-mirror] no .claude/skills/ — nothing to mirror.',
    )
    return
  }
  const entries = discoverSkills(
    REPO_ROOT,
    resolveSelectedSkills(REPO_ROOT, process.argv.slice(2), process.env),
  )
  if (checkOnly) {
    const drift = findMirrorDrift(REPO_ROOT, entries)
    if (drift.length) {
      logger.fail(
        `[gen/agents-skills-mirror] .agents/skills/ is stale (${drift.length} drift(s)) — regenerate with \`node scripts/fleet/gen/agents-skills-mirror.mts\`:`,
      )
      for (let i = 0, { length } = drift; i < length; i += 1) {
        logger.error(`  ✗ ${drift[i]}`)
      }
      process.exitCode = 1
      return
    }
    logger.success(
      `[gen/agents-skills-mirror] .agents/skills/ in sync (${entries.length} skills mirrored).`,
    )
    return
  }
  writeMirror(REPO_ROOT, entries)
  logger.success(
    `[gen/agents-skills-mirror] regenerated .agents/skills/ — ${entries.length} skills (${AGENTS_SKILLS_DIR}).`,
  )
}

if (isMainModule(import.meta.url)) {
  main()
}
