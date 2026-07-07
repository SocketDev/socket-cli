#!/usr/bin/env node
// Claude Code PreToolUse hook — no-hand-edit-registry-pin-guard.
//
// BLOCKS an Edit/Write that changes a SocketDev/socket-registry shared
// workflow/action SHA pin by hand:
//
//   uses: SocketDev/socket-registry/.github/workflows/ci.yml@<40-hex>
//   uses: SocketDev/socket-registry/.github/actions/setup-and-install@<40-hex>
//
// Those pins are OWNED by the cascade: `cascade-workflows.mts` (in
// socket-registry) sets them upstream and the wheelhouse's tool-pin cascade
// orchestrator (`scripts/repo/pipeline.mts` Stage 4 Propagate) repins them
// downstream, behind the layered drift-watch order + its own CI-green gate. A
// hand-edit skips both — it can land a SHA that the cascade then fights, or one
// that was never green-gated. The cascade scripts write via fs (not the Edit
// tool), so ANY Edit/Write that flips one of these pins is, by definition, a
// hand-edit.
//
// Fires only on workflow / action files (`.github/workflows/*.y[a]ml`,
// `.github/actions/**`). A pin appearing where none existed (a brand-new file)
// is NOT a change and is left alone — only a DIFFERING SHA on a uses-path
// present in both the before and after text trips the guard.
//
// Bypass: `Allow registry-pin-edit bypass` typed verbatim in a recent turn.
//
// Fails open on parse / payload errors (allow) — a guard bug must not block
// every workflow edit.

import { existsSync, readFileSync } from 'node:fs'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import type { ToolCallPayload } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow registry-pin-edit bypass' as const

interface MultiEdit {
  old_string?: unknown | undefined
  new_string?: unknown | undefined
}

// A registry shared-workflow / action pin: capture the uses-path (key) and the
// 40-hex SHA. One capturing group + one `(?:…)` alternation = a commented
// complex pattern.
const REGISTRY_PIN_RE =
  /SocketDev\/socket-registry\/\.github\/(?:workflows|actions)\/[^@\s'"]+@(?<sha>[0-9a-f]{40})/g

// True when the path is a GitHub Actions workflow or composite-action file —
// the only place a registry `uses:` pin lives. Normalized to `/` first.
export function isGuardedWorkflowFile(filePath: string): boolean {
  const p = filePath.replaceAll('\\', '/')
  return (
    /\/\.github\/workflows\/[^/]+\.ya?ml$/.test(p) ||
    /\/\.github\/actions\//.test(p) ||
    /^\.github\/workflows\/[^/]+\.ya?ml$/.test(p) ||
    p.startsWith('.github/actions/')
  )
}

// Map each registry uses-path to its pinned SHA in `text`.
export function registryPins(text: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const m of text.matchAll(REGISTRY_PIN_RE)) {
    const full = m[0]
    const sha = m.groups!.sha!
    const usesPath = full.slice(0, full.length - sha.length - 1)
    out.set(usesPath, sha)
  }
  return out
}

export interface PinChange {
  readonly changed: boolean
  readonly from: string
  readonly to: string
  readonly usesPath: string
}

const NO_CHANGE: PinChange = { changed: false, from: '', to: '', usesPath: '' }

// A pin CHANGE is a uses-path present in BOTH old and new text whose SHA
// differs. A pin only in `newText` (added to a new/edited file) is not a
// change — there's no on-disk pin to differ from.
export function detectRegistryPinChange(
  oldText: string,
  newText: string,
): PinChange {
  const oldPins = registryPins(oldText)
  const newPins = registryPins(newText)
  for (const [usesPath, newSha] of newPins) {
    const oldSha = oldPins.get(usesPath)
    if (oldSha && oldSha !== newSha) {
      return { changed: true, from: oldSha, to: newSha, usesPath }
    }
  }
  return NO_CHANGE
}

export function formatBlock(c: PinChange): string {
  return (
    [
      '[no-hand-edit-registry-pin-guard] Blocked: hand-edit of a socket-registry SHA pin.',
      '',
      `  Pin  : ${c.usesPath}`,
      `  From : ${c.from}`,
      `  To   : ${c.to}`,
      '',
      '  These pins are cascade-owned, never hand-edited. socket-registry sets',
      '  the canonical SHA (cascade-workflows.mts); socket-wheelhouse propagates',
      '  it here behind the drift-watch order + green-gate:',
      '',
      '    node scripts/repo/pipeline.mts …   # (run from socket-wheelhouse; Stage 4 Propagate)',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" to allow this edit.`,
    ].join('\n') + '\n'
  )
}

// Resolve (oldText, newText) for the edit. Edit → old_string / new_string;
// Write → on-disk file / content; MultiEdit → concatenated old / new strings.
export function editTexts(
  payload: ToolCallPayload,
  filePath: string,
): [string, string] {
  const ti = payload.tool_input ?? {}
  if (payload.tool_name === 'Write') {
    let onDisk = ''
    if (existsSync(filePath)) {
      try {
        onDisk = readFileSync(filePath, 'utf8')
      } catch {
        /* c8 ignore start - file exists but is unreadable (permissions); recovery only */
        onDisk = ''
        /* c8 ignore stop */
      }
    }
    return [onDisk, typeof ti.content === 'string' ? ti.content : '']
  }
  if (payload.tool_name === 'MultiEdit' && Array.isArray(ti.edits)) {
    let oldText = ''
    let newText = ''
    for (const raw of ti.edits as MultiEdit[]) {
      if (typeof raw?.old_string === 'string') {
        oldText += raw.old_string + '\n'
      }
      if (typeof raw?.new_string === 'string') {
        newText += raw.new_string + '\n'
      }
    }
    return [oldText, newText]
  }
  return [
    typeof ti.old_string === 'string' ? ti.old_string : '',
    typeof ti.new_string === 'string' ? ti.new_string : '',
  ]
}

export const check = editGuard((filePath, _content, payload) => {
  if (!isGuardedWorkflowFile(filePath)) {
    return undefined
  }
  const [oldText, newText] = editTexts(payload, filePath)
  const change = detectRegistryPinChange(oldText, newText)
  if (!change.changed) {
    return undefined
  }
  if (bypassPhrasePresent(payload.transcript_path, [BYPASS_PHRASE], 3)) {
    return undefined
  }
  return block(formatBlock(change))
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  scope: 'convention',
  type: 'guard',
})
void runHook(hook, import.meta.url)
