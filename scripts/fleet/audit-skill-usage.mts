#!/usr/bin/env node
/**
 * @file Aggregate skill-usage telemetry across fleet projects. Reads every
 *   `~/.claude/projects/* /.skill-usage.log` (the canonical path the
 *   `skill-usage-logger` hook writes to) and emits a histogram + per-skill
 *   freshness so the operator can identify high-leverage skills (promote
 *   patterns to lint rules / hooks) and dead-weight skills (drop them per
 *   CLAUDE.md _Compound lessons_). Output format (TSV by default):
 *   <skill-name>\t<invocations>\t<last-seen-ISO>\t<unique-cwds> Pass `--days N`
 *   to filter to invocations in the last N days. Pass `--unused-days N` to
 *   print ONLY skills with zero invocations in the last N days (the
 *   drop-candidate list). Exit codes:
 *
 *   - 0 — clean (reports printed)
 *   - 1 — log directory missing / nothing to aggregate
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'

interface LogEntry {
  readonly timestamp: string
  readonly skill: string
  readonly cwd: string
}

interface SkillStat {
  readonly skill: string
  count: number
  lastSeen: string
  cwds: Set<string>
}

// Walk `~/.claude/projects/` and collect every `.skill-usage.log` file.
// Subdirectories are per-project; the log is at the top of each. A flat
// `.skill-usage.log` at the projects root (fallback when no transcript
// path was available at hook time) is included too.
export function findLogFiles(projectsRoot: string): string[] {
  const out: string[] = []
  let topEntries: string[]
  try {
    topEntries = readdirSync(projectsRoot)
  } catch {
    return out
  }
  for (let i = 0, { length } = topEntries; i < length; i += 1) {
    const entry = topEntries[i]!
    const full = path.join(projectsRoot, entry)
    let stats
    try {
      stats = statSync(full)
    } catch {
      continue
    }
    if (stats.isFile() && entry === '.skill-usage.log') {
      out.push(full)
      continue
    }
    if (stats.isDirectory()) {
      const candidate = path.join(full, '.skill-usage.log')
      try {
        const cs = statSync(candidate)
        if (cs.isFile()) {
          out.push(candidate)
        }
      } catch {
        // No log in this project; skip.
      }
    }
  }
  return out
}

export function parseLogFile(content: string): LogEntry[] {
  const out: LogEntry[] = []
  const lines = content.split('\n')
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const line = lines[i] ?? ''
    if (!line) {
      continue
    }
    const cols = line.split('\t')
    if (cols.length < 3) {
      continue
    }
    out.push({
      timestamp: cols[0]!,
      skill: cols[1]!,
      cwd: cols[2]!,
    })
  }
  return out
}

// Filter entries to those whose timestamp is within the last `days`
// days. Negative / zero / undefined `days` returns the full set.
export function withinDays(entries: LogEntry[], days: number): LogEntry[] {
  if (!days || days <= 0) {
    return entries
  }
  const cutoffMs = Date.now() - days * 24 * 60 * 60 * 1000
  const out: LogEntry[] = []
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    const ts = Date.parse(e.timestamp)
    if (!Number.isNaN(ts) && ts >= cutoffMs) {
      out.push(e)
    }
  }
  return out
}

export function aggregate(entries: LogEntry[]): Map<string, SkillStat> {
  const stats = new Map<string, SkillStat>()
  for (let i = 0, { length } = entries; i < length; i += 1) {
    const e = entries[i]!
    const existing = stats.get(e.skill)
    if (existing) {
      existing.count += 1
      if (e.timestamp > existing.lastSeen) {
        existing.lastSeen = e.timestamp
      }
      existing.cwds.add(e.cwd)
    } else {
      stats.set(e.skill, {
        skill: e.skill,
        count: 1,
        lastSeen: e.timestamp,
        cwds: new Set([e.cwd]),
      })
    }
  }
  return stats
}

function parseNumberFlag(flag: string): number | undefined {
  const i = process.argv.indexOf(flag)
  if (i < 0 || i + 1 >= process.argv.length) {
    return undefined
  }
  const n = Number(process.argv[i + 1])
  return Number.isFinite(n) ? n : undefined
}

function main(): void {
  const projectsRoot = path.join(os.homedir(), '.claude', 'projects')
  const logFiles = findLogFiles(projectsRoot)
  if (logFiles.length === 0) {
    process.stderr.write(
      `[audit-skill-usage] no .skill-usage.log files found under ${projectsRoot}.\n` +
        `The skill-usage-logger hook may not have fired yet, or the path is wrong.\n`,
    )
    process.exit(1)
  }

  const allEntries: LogEntry[] = []
  for (let i = 0, { length } = logFiles; i < length; i += 1) {
    let content: string
    try {
      content = readFileSync(logFiles[i]!, 'utf8')
    } catch {
      continue
    }
    allEntries.push(...parseLogFile(content))
  }

  const days = parseNumberFlag('--days')
  const unusedDays = parseNumberFlag('--unused-days')

  if (unusedDays !== undefined) {
    // Drop-candidate mode: list skills with zero invocations in the
    // last N days. Survey ALL recorded skill names (not just those in
    // the recent window) so we can subtract.
    const allSkills = new Set<string>()
    for (let i = 0, { length } = allEntries; i < length; i += 1) {
      allSkills.add(allEntries[i]!.skill)
    }
    const recent = aggregate(withinDays(allEntries, unusedDays))
    const dropCandidates: string[] = []
    for (const s of allSkills) {
      if (!recent.has(s)) {
        dropCandidates.push(s)
      }
    }
    dropCandidates.sort()
    process.stdout.write(
      `[audit-skill-usage] ${dropCandidates.length} skill(s) had zero invocations in the last ${unusedDays} days:\n\n`,
    )
    for (let i = 0, { length } = dropCandidates; i < length; i += 1) {
      process.stdout.write(`  - ${dropCandidates[i]}\n`)
    }
    process.exit(0)
  }

  const filtered = withinDays(allEntries, days ?? 0)
  const stats = aggregate(filtered)
  const sorted = Array.from(stats.values()).toSorted(
    (a, b) => b.count - a.count,
  )

  process.stdout.write(`skill\tinvocations\tlast-seen\tunique-cwds\n`)
  for (let i = 0, { length } = sorted; i < length; i += 1) {
    const s = sorted[i]!
    process.stdout.write(
      `${s.skill}\t${s.count}\t${s.lastSeen}\t${s.cwds.size}\n`,
    )
  }
  process.exit(0)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
}
