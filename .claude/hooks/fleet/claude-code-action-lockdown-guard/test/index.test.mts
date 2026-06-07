/**
 * @file Unit tests for findLockdownGaps + isWorkflowPath — the matchers that
 *   decide when a claude-code-action workflow is under-locked-down on an
 *   untrusted trigger.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { findLockdownGaps, isWorkflowPath } from '../index.mts'

// ── isWorkflowPath ──────────────────────────────────────────────

test('isWorkflowPath matches .github/workflows/*.yml', () => {
  assert.equal(isWorkflowPath('/r/.github/workflows/ci.yml'), true)
  assert.equal(isWorkflowPath('/r/.github/workflows/agent.yaml'), true)
})

test('isWorkflowPath rejects non-workflow paths', () => {
  assert.equal(isWorkflowPath('/r/.github/ci.yml'), false)
  assert.equal(isWorkflowPath('/r/src/agent.yml'), false)
})

// ── fully locked-down → no gap ──────────────────────────────────

const LOCKED_DOWN = `
on:
  issue_comment:
    types: [created]
permissions:
  contents: read
jobs:
  claude:
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          allowed_tools: "Read,Grep"
          disallowed_tools: "Bash,WebFetch"
          permission_mode: dontAsk
`

test('locked-down workflow on an untrusted trigger → no gap', () => {
  assert.equal(findLockdownGaps(LOCKED_DOWN), undefined)
})

// ── untrusted trigger + missing lockdown → gap ──────────────────

test('untrusted trigger, NO permissions + NO with-inputs → gap lists all', () => {
  const wf = `
on: issue_comment
jobs:
  claude:
    steps:
      - uses: anthropics/claude-code-action@v1
`
  const gap = findLockdownGaps(wf)
  assert.ok(gap)
  assert.equal(gap.missing.length, 4)
})

test('untrusted trigger, has with-inputs but NO permissions → gap is permissions only', () => {
  const wf = `
on: issues
jobs:
  claude:
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          allowed_tools: "Read"
          disallowed_tools: "Bash"
          permission_mode: dontAsk
`
  const gap = findLockdownGaps(wf)
  assert.ok(gap)
  assert.equal(gap.missing.length, 1)
  assert.match(gap.missing[0]!, /permissions/)
})

test('permission_mode: default does NOT satisfy the mode requirement', () => {
  const wf = `
on: pull_request_target
permissions:
  contents: read
jobs:
  claude:
    steps:
      - uses: anthropics/claude-code-action@v1
        with:
          allowed_tools: "Read"
          disallowed_tools: "Bash"
          permission_mode: default
`
  const gap = findLockdownGaps(wf)
  assert.ok(gap)
  assert.ok(gap.missing.some(m => /permission_mode/.test(m)))
})

// ── not applicable → undefined ──────────────────────────────────

test('trusted-trigger-only workflow → not applicable (no untrusted input)', () => {
  const wf = `
on:
  workflow_dispatch:
  schedule:
    - cron: "0 0 * * *"
jobs:
  claude:
    steps:
      - uses: anthropics/claude-code-action@v1
`
  assert.equal(findLockdownGaps(wf), undefined)
})

test('non-claude-code-action workflow → not applicable', () => {
  const wf = `
on: issue_comment
jobs:
  build:
    steps:
      - uses: actions/checkout@v4
`
  assert.equal(findLockdownGaps(wf), undefined)
})
