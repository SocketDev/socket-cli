/**
 * @file node --test specs for the dated-citation-reminder hook. PreToolUse hook
 *   that nudges (exit 0 + stderr) when an Edit/Write ADDS a dated-incident
 *   citation to a fleet-facing rule-prose surface. A clean / out-of-scope /
 *   self-exempt write produces no stderr. Fail-open on malformed stdin.
 *
 *   Also exercises the shared matcher (findDatedCitations / isRuleProseSurface)
 *   directly — the same module the commit-time check consumes.
 */

import test from 'node:test'
import assert from 'node:assert/strict'
// prefer-async-spawn: streaming-stdio-required — test spawns the hook
// subprocess and pipes stdin/stdout/stderr; Node spawn returns the
// ChildProcess streaming surface the lib promise wrapper does not.
import { spawn } from '@socketsecurity/lib-stable/process/spawn/child'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  findDatedCitations,
  isRuleProseSurface,
} from '../../_shared/dated-citation.mts'

const here = path.dirname(fileURLToPath(import.meta.url))
const HOOK = path.join(here, '..', 'index.mts')

const NUDGE = /\[dated-citation-reminder]/

interface Result {
  readonly code: number
  readonly stderr: string
}

function runHook(payload: Record<string, unknown>): Promise<Result> {
  const child = spawn('node', [HOOK], { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  child.process.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  child.process.stdin?.end(JSON.stringify(payload))
  return new Promise(resolve => {
    child.process.on('close', (code: number | null) => {
      resolve({ code: code ?? 0, stderr })
    })
  })
}

function editPayload(filePath: string, content: string): Record<string, unknown> {
  return {
    tool_name: 'Write',
    tool_input: { file_path: filePath, content },
  }
}

// ── shared matcher: findDatedCitations ──────────────────────────────────────

test('findDatedCitations flags an ISO date on a Why line', () => {
  const hits = findDatedCitations('**Why:** 2026-06-07 the cascade broke.')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'ISO date (YYYY-MM-DD)')
})

test('findDatedCitations flags a version delta on an incident line', () => {
  const hits = findDatedCitations('Incident: pnpm 11.4.0 vs 11.3.0 red-lined CI.')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'version delta')
})

test('findDatedCitations flags a percentage delta', () => {
  const hits = findDatedCitations('**Why:** coverage rose 98.9%→99.15% after the fix.')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'percentage delta')
})

test('findDatedCitations flags a commit SHA in rationale', () => {
  const hits = findDatedCitations('The regression landed at commit a1b2c3d.')
  assert.equal(hits.length, 1)
  assert.equal(hits[0]!.label, 'commit SHA')
})

test('findDatedCitations ignores a date with NO rationale marker', () => {
  // A SHA-pin comment carries a required date but is not rationale prose.
  assert.equal(
    findDatedCitations('uses: foo/bar@deadbeef # v1.2.3 (2026-06-07)').length,
    0,
  )
})

test('findDatedCitations ignores a generic example (no specificity token)', () => {
  assert.equal(
    findDatedCitations(
      '**Why:** a stale pnpm on PATH fails the version check and aborts the install.',
    ).length,
    0,
  )
})

test('findDatedCitations leaves a single targeted version alone', () => {
  // A rule may name the version it targets; only a DELTA marks a changelog.
  assert.equal(
    findDatedCitations('**Why:** lib 6.0.7 drops the checksums subpath.').length,
    0,
  )
})

// ── shared matcher: isRuleProseSurface ──────────────────────────────────────

test('isRuleProseSurface matches the rule-prose surfaces', () => {
  assert.ok(isRuleProseSurface('CLAUDE.md'))
  assert.ok(isRuleProseSurface('template/CLAUDE.md'))
  assert.ok(isRuleProseSurface('template/docs/agents.md/fleet/tooling.md'))
  assert.ok(isRuleProseSurface('.claude/skills/fleet/prose/SKILL.md'))
  assert.ok(isRuleProseSurface('.claude/hooks/fleet/foo-guard/README.md'))
})

test('isRuleProseSurface rejects non-rule-prose paths', () => {
  assert.equal(isRuleProseSurface('src/index.mts'), false)
  assert.equal(isRuleProseSurface('CHANGELOG.md'), false)
  assert.equal(isRuleProseSurface('docs/some-package/api.md'), false)
  // memory files keep dates for recall
  assert.equal(
    isRuleProseSurface('.claude/projects/x/memory/feedback_foo.md'),
    false,
  )
})

// ── hook end-to-end ─────────────────────────────────────────────────────────

test('hook nudges on a dated citation in a hook README', async () => {
  const { code, stderr } = await runHook(
    editPayload(
      '/repo/template/.claude/hooks/fleet/foo-guard/README.md',
      '## Why\n\n**Why:** 2026-06-07 a stale pnpm broke the cascade.\n',
    ),
  )
  assert.equal(code, 0, 'reminder always exits 0')
  assert.match(stderr, NUDGE)
})

test('hook is silent on a generic citation', async () => {
  const { code, stderr } = await runHook(
    editPayload(
      '/repo/template/.claude/hooks/fleet/foo-guard/README.md',
      '## Why\n\n**Why:** a stale pnpm on PATH aborts the cascade install.\n',
    ),
  )
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('hook is silent for a non-rule-prose file (surface scoping)', async () => {
  const { code, stderr } = await runHook(
    editPayload(
      '/repo/src/version.mts',
      'export const RELEASED = "2026-06-07" // incident shipped',
    ),
  )
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('hook is silent for its own self-exempt files', async () => {
  const { code, stderr } = await runHook(
    editPayload(
      '/repo/template/.claude/hooks/fleet/dated-citation-reminder/README.md',
      '**Why:** 2026-06-07 example incident in the docs.\n',
    ),
  )
  assert.equal(code, 0)
  assert.equal(stderr.trim(), '')
})

test('hook fails open on malformed stdin', async () => {
  const child = spawn('node', [HOOK], { stdio: ['pipe', 'ignore', 'pipe'] })
  let stderr = ''
  child.process.stderr?.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  child.process.stdin?.end('not json{{{')
  const result = await new Promise<Result>(resolve => {
    child.process.on('close', (code: number | null) => {
      resolve({ code: code ?? 0, stderr })
    })
  })
  assert.equal(result.code, 0)
  assert.equal(result.stderr.trim(), '')
})
