#!/usr/bin/env node
// Claude Code PreToolUse hook — no-description-aside-guard.
//
// BLOCKS Write/Edit to a package manifest (package.json, Cargo.toml) when the
// `description` field ends with a listy parenthetical aside — the "extra bits"
// tail that re-lists what the description already says. A manifest description
// states the thing plainly; detail that matters belongs in the sentence.
//
// Bypass: `Allow description-aside bypass` typed verbatim in a recent user turn.

import path from 'node:path'

import { normalizePath } from '@socketsecurity/lib-stable/paths/normalize'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'
import { trailingListyAside } from '../_shared/trailing-aside.mts'

const BYPASS_PHRASE = 'Allow description-aside bypass'

// package.json and Cargo.toml at any depth, matched on the normalized path.
const MANIFEST_RE = /(?:^|\/)(?:Cargo\.toml|package\.json)$/

// package.json: "description": "…"   Cargo.toml: description = "…"
const JSON_DESC_RE = /"description"\s*:\s*"((?:[^"\\]|\\.)*)"/g
const TOML_DESC_RE = /^\s*description\s*=\s*"([^"]*)"/gm

function descriptionValues(content: string): string[] {
  const values: string[] = []
  for (const match of content.matchAll(JSON_DESC_RE)) {
    values.push(match[1] ?? '')
  }
  for (const match of content.matchAll(TOML_DESC_RE)) {
    values.push(match[1] ?? '')
  }
  return values
}

export const check = editGuard((filePath, content, payload) => {
  if (content === undefined) {
    return undefined
  }
  const normalized = normalizePath(filePath)
  if (!MANIFEST_RE.test(normalized)) {
    return undefined
  }
  const offenders: string[] = []
  for (const value of descriptionValues(content)) {
    const aside = trailingListyAside(value)
    if (aside) {
      offenders.push(aside)
    }
  }
  if (!offenders.length) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)) {
    return undefined
  }
  const rel = path.basename(filePath)
  const lines: string[] = [
    `🚨 no-description-aside-guard: blocked write to ${rel}.`,
    '',
  ]
  for (let i = 0, { length } = offenders; i < length; i += 1) {
    lines.push(`  ✗ description ends with a listy aside: (${offenders[i]})`)
  }
  lines.push(
    '',
    'A manifest description states the thing plainly. Drop the trailing',
    'parenthetical that re-lists what the line already says; fold detail that',
    'matters into the sentence.',
    '',
    `Bypass (rare): the user types "${BYPASS_PHRASE}" verbatim.`,
  )
  return block(lines.join('\n'))
})

export const hook = defineHook({
  bypass: ['description-aside'],
  bypassMode: 'manual',
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'MultiEdit', 'Write'],
  scope: 'convention',
  type: 'guard',
})

void runHook(hook, import.meta.url)
