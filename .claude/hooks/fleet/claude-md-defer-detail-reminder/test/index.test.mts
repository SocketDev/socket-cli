import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  extractFleetBlock,
  findAddedSectionsLackingLink,
  isClaudeMd,
  parseSections,
} from '../index.mts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const HOOK_PATH = path.join(__dirname, '..', 'index.mts')

const BEGIN = '<!-- BEGIN FLEET-CANONICAL (managed) -->'
const END = '<!-- END FLEET-CANONICAL -->'

function fleetDoc(body: string): string {
  return `# CLAUDE.md\n\n${BEGIN}\n\n${body}\n\n${END}\n`
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

test('isClaudeMd matches CLAUDE.md at any depth', () => {
  assert.equal(isClaudeMd('/repo/CLAUDE.md'), true)
  assert.equal(isClaudeMd('/repo/template/CLAUDE.md'), true)
  assert.equal(isClaudeMd('CLAUDE.md'), true)
})

test('isClaudeMd rejects non-CLAUDE.md', () => {
  assert.equal(isClaudeMd('/repo/README.md'), false)
  assert.equal(isClaudeMd('/repo/claude.md'), false)
  assert.equal(isClaudeMd(undefined), false)
})

test('extractFleetBlock returns content between markers', () => {
  const doc = fleetDoc('### Rule\nbody\n')
  const block = extractFleetBlock(doc)
  assert.ok(block)
  assert.ok(block.includes('### Rule'))
  assert.ok(block.includes('body'))
})

test('extractFleetBlock returns undefined when markers missing', () => {
  assert.equal(extractFleetBlock('# CLAUDE.md\n\nno markers here\n'), undefined)
})

test('parseSections splits on ### boundaries', () => {
  const block = `${BEGIN}\n### A\nbody a\n\n### B\nbody b1\nbody b2\n`
  const sections = parseSections(block)
  assert.equal(sections.length, 2)
  assert.equal(sections[0]!.heading, 'A')
  assert.equal(sections[0]!.bodyLineCount, 1)
  assert.equal(sections[1]!.heading, 'B')
  assert.equal(sections[1]!.bodyLineCount, 2)
})

// ---------------------------------------------------------------------------
// Diff: added section lacking a docs link
// ---------------------------------------------------------------------------

test('flags added section with no docs link + ≥3 body lines', () => {
  const pre = fleetDoc('### Existing\none-liner')
  const post = fleetDoc(
    '### Existing\none-liner\n\n### New Long Rule\nLine 1.\nLine 2.\nLine 3. No link.',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 1)
  assert.equal(added[0]!.heading, 'New Long Rule')
  assert.equal(added[0]!.bodyLineCount, 3)
})

test('does NOT flag added section with docs/claude.md/fleet/ link', () => {
  const pre = fleetDoc('### Existing\none-liner')
  const post = fleetDoc(
    '### Existing\none-liner\n\n### New Rule\nLine 1.\nLine 2.\nLine 3. Spec: docs/claude.md/fleet/new-rule.md',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 0)
})

test('does NOT flag added section with docs/claude.md/repo/ link', () => {
  const pre = fleetDoc('### Existing\none-liner')
  const post = fleetDoc(
    '### Existing\none-liner\n\n### Repo Rule\nLine 1.\nLine 2.\nLine 3. See docs/claude.md/repo/x.md',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 0)
})

test('does NOT flag added section with docs/claude.md/wheelhouse/ link', () => {
  const pre = fleetDoc('### Existing\none-liner')
  const post = fleetDoc(
    '### Existing\none-liner\n\n### WH Rule\nLine 1.\nLine 2.\nLine 3. See docs/claude.md/wheelhouse/x.md',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 0)
})

test('does NOT flag short added section (< 3 lines)', () => {
  const pre = fleetDoc('### Existing\none-liner')
  const post = fleetDoc(
    '### Existing\none-liner\n\n### Quick Rule\nOne line. **Why:** brief.',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 0)
})

test('does NOT flag growth of existing section', () => {
  const pre = fleetDoc('### Existing\nshort')
  const post = fleetDoc(
    '### Existing\nshort\nadded line 1\nadded line 2\nadded line 3',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 0)
})

test('flags multiple new sections in one edit', () => {
  const pre = fleetDoc('### Existing\nshort')
  const post = fleetDoc(
    '### Existing\nshort\n\n' +
      '### New A\nLine A1\nLine A2\nLine A3\n\n' +
      '### New B\nLine B1\nLine B2\nLine B3\nLine B4',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 2)
  const headings = added.map(a => a.heading).toSorted()
  assert.deepEqual(headings, ['New A', 'New B'])
})

test('counts only non-blank body lines', () => {
  const pre = fleetDoc('### Existing\nshort')
  const post = fleetDoc(
    '### Existing\nshort\n\n### New Rule\nLine 1.\n\nLine 2.\n\nLine 3.',
  )
  const added = findAddedSectionsLackingLink(pre, post)
  assert.equal(added.length, 1)
  assert.equal(added[0]!.bodyLineCount, 3)
})

test('handles empty pre-content (new CLAUDE.md)', () => {
  const post = fleetDoc('### First Rule\nLine 1\nLine 2\nLine 3 with no link')
  const added = findAddedSectionsLackingLink(undefined, post)
  assert.equal(added.length, 1)
  assert.equal(added[0]!.heading, 'First Rule')
})

test('returns nothing when fleet block markers absent', () => {
  const post = '# CLAUDE.md\n\nrandom prose with no markers\n'
  const added = findAddedSectionsLackingLink(undefined, post)
  assert.equal(added.length, 0)
})

// ---------------------------------------------------------------------------
// CLI integration
// ---------------------------------------------------------------------------

function runHook(payload: object): {
  stderr: string
  stdout: string
  exitCode: number
} {
  const result = spawnSync('node', [HOOK_PATH], {
    input: JSON.stringify(payload),
    env: { ...process.env },
  })
  return {
    stderr: String(result.stderr),
    stdout: String(result.stdout),
    exitCode: result.status ?? -1,
  }
}

test('CLI: Write CLAUDE.md with new long no-link section warns (exit 0)', () => {
  const tmpdir = mkdtempSync(path.join(os.tmpdir(), 'cmped-'))
  try {
    const filePath = path.join(tmpdir, 'CLAUDE.md')
    const initial = fleetDoc('### Old Rule\nshort body')
    writeFileSync(filePath, initial)
    const newContent = fleetDoc(
      '### Old Rule\nshort body\n\n### New Section\nLine 1.\nLine 2.\nLine 3. no link.',
    )
    const { stderr, exitCode } = runHook({
      tool_name: 'Write',
      tool_input: { file_path: filePath, content: newContent },
    })
    assert.equal(exitCode, 0)
    assert.match(stderr, /defer-detail-reminder/)
    assert.match(stderr, /New Section/)
  } finally {
    rmSync(tmpdir, { recursive: true, force: true })
  }
})

test('CLI: Edit CLAUDE.md adding a linked section is silent', () => {
  const tmpdir = mkdtempSync(path.join(os.tmpdir(), 'cmped-'))
  try {
    const filePath = path.join(tmpdir, 'CLAUDE.md')
    const initial = fleetDoc('### Old\nshort')
    writeFileSync(filePath, initial)
    const oldString = '### Old\nshort'
    const newString =
      '### Old\nshort\n\n### Big New Rule\nLine 1\nLine 2\nLine 3 docs/claude.md/fleet/big-new-rule.md'
    const { stderr, exitCode } = runHook({
      tool_name: 'Edit',
      tool_input: {
        file_path: filePath,
        old_string: oldString,
        new_string: newString,
      },
    })
    assert.equal(exitCode, 0)
    assert.equal(stderr, '')
  } finally {
    rmSync(tmpdir, { recursive: true, force: true })
  }
})

test('CLI: edit to non-CLAUDE.md file is silent', () => {
  const { stderr, exitCode } = runHook({
    tool_name: 'Write',
    tool_input: { file_path: '/repo/README.md', content: 'anything' },
  })
  assert.equal(exitCode, 0)
  assert.equal(stderr, '')
})
