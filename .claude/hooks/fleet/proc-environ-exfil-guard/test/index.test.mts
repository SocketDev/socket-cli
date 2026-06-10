/**
 * @file Unit tests for scanForProcRead — the path-string matcher that
 *   classifies text (a Bash command or about-to-land source) into a
 *   /proc/<pid>/environ|cmdline read hit.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import {
  isSelfExempt,
  scanBashForProcRead,
  scanForProcRead,
} from '../index.mts'

// ── matches: environ ────────────────────────────────────────────

test('flags /proc/self/environ in a Bash command', () => {
  const hit = scanForProcRead('cat /proc/self/environ')
  assert.ok(hit)
  assert.equal(hit.match, '/proc/self/environ')
})

test('flags a numeric pid: /proc/1/environ', () => {
  assert.ok(scanForProcRead('xxd /proc/1/environ'))
})

test('flags $$ pid: /proc/$$/environ', () => {
  assert.ok(scanForProcRead('tr "\\0" "\\n" < /proc/$$/environ'))
})

test('flags a glob pid: /proc/*/environ', () => {
  assert.ok(scanForProcRead('grep -a KEY /proc/*/environ'))
})

test('flags a string-spliced path in source', () => {
  assert.ok(scanForProcRead("readFileSync('/proc/' + pid + '/environ')"))
})

// ── matches: cmdline ────────────────────────────────────────────

test('flags /proc/self/cmdline', () => {
  const hit = scanForProcRead('cat /proc/self/cmdline')
  assert.ok(hit)
  assert.equal(hit.match, '/proc/self/cmdline')
})

test('flags /proc/<pid>/cmdline in source', () => {
  assert.ok(scanForProcRead('await fs.readFile(`/proc/${target}/cmdline`)'))
})

// ── non-matches ─────────────────────────────────────────────────

test('does NOT flag /proc/cpuinfo (not environ/cmdline)', () => {
  assert.equal(scanForProcRead('cat /proc/cpuinfo'), undefined)
})

test('does NOT flag /proc/self/status', () => {
  assert.equal(scanForProcRead('cat /proc/self/status'), undefined)
})

test('does NOT flag an unrelated environ word', () => {
  assert.equal(scanForProcRead('const environ = process.env'), undefined)
})

test('does NOT flag /proc/self/environ-suffixed word boundary', () => {
  // `\b` after environ: `environment` should not match the bare token.
  assert.equal(scanForProcRead('/proc/self/environment'), undefined)
})

test('returns undefined for empty text', () => {
  assert.equal(scanForProcRead(''), undefined)
})

// ── scanBashForProcRead: read-context narrowing ─────────────────

test('Bash: flags a cat read of /proc/self/environ', () => {
  assert.ok(scanBashForProcRead('cat /proc/self/environ'))
})

test('Bash: flags an xxd / tr / strings read', () => {
  assert.ok(scanBashForProcRead('xxd /proc/1/environ'))
  assert.ok(scanBashForProcRead('strings /proc/self/cmdline'))
})

test('Bash: flags a `<` redirect read', () => {
  assert.ok(scanBashForProcRead('tr "\\0" "\\n" < /proc/self/environ'))
})

test('Bash: does NOT flag a commit message that NAMES the path (prose)', () => {
  // The own-commit false-positive that motivated the read-context narrowing.
  assert.equal(
    scanBashForProcRead(
      'git commit -m "guard blocks reading /proc/self/environ"',
    ),
    undefined,
  )
})

test('Bash: does NOT flag an echo / --body mention', () => {
  assert.equal(
    scanBashForProcRead('echo "see /proc/self/environ in the doc"'),
    undefined,
  )
  assert.equal(
    scanBashForProcRead('gh pr create --body "covers /proc/<pid>/cmdline"'),
    undefined,
  )
})

// ── isSelfExempt: prose surfaces describe the path, don't read it ──

test('Edit arm exempts a markdown doc', () => {
  assert.equal(
    isSelfExempt('/r/docs/agents.md/fleet/prompt-injection.md'),
    true,
  )
  assert.equal(isSelfExempt('/r/README.md'), true)
})

test('Edit arm exempts anything under a docs/ tree', () => {
  assert.equal(isSelfExempt('/r/docs/security/threat-model.txt'), true)
})

test('Edit arm exempts a .claude memory / plan / report file', () => {
  assert.equal(isSelfExempt('/u/.claude/projects/x/memory/incident.md'), true)
  assert.equal(isSelfExempt('/r/.claude/plans/audit.md'), true)
  assert.equal(isSelfExempt('/r/.claude/reports/scan.md'), true)
})

test('Edit arm still flags an authored read in SOURCE', () => {
  assert.equal(isSelfExempt('/r/scripts/repo/harvest.mts'), false)
  assert.equal(isSelfExempt('/r/src/exfil.ts'), false)
})

test('Edit arm still self-exempts the guard + ai-config-poisoning sources', () => {
  assert.equal(
    isSelfExempt('/r/.claude/hooks/fleet/proc-environ-exfil-guard/index.mts'),
    true,
  )
  assert.equal(
    isSelfExempt('/r/.claude/hooks/fleet/ai-config-poisoning-guard/index.mts'),
    true,
  )
})

test('isSelfExempt: undefined path is not exempt (fail-safe)', () => {
  assert.equal(isSelfExempt(undefined), false)
})
