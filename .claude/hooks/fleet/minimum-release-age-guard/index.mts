#!/usr/bin/env node
// Claude Code PreToolUse hook — minimum-release-age-guard.
//
// Blocks Edit/Write operations that add entries to a `pnpm-workspace.yaml`
// file's `minimumReleaseAge.exclude[]` array. The 7-day soak is intentional
// malware-soak protection — packages on npm <7 days are still in the
// suspicion window for typosquats / postinstall-script malware / etc.
// Adding to the exclude list bypasses that protection.
//
// Detection model:
//   - Fires only on Edit / Write to files named `pnpm-workspace.yaml`.
//   - For Edit: applies new_string-over-old_string to current file contents,
//     parses before+after as YAML, computes the set difference of the
//     `minimumReleaseAge.exclude` array. New names → block.
//   - For Write: compares against current contents (absent file = empty
//     exclude array).
//
// Bypass: `Allow soak-time bypass` (alias: `Allow minimumReleaseAge bypass`)
// typed verbatim in a recent user turn — for emergency CVE patches where a
// legitimately-published-yesterday fix must be installed before the 7-day
// window closes. The matcher folds hyphens to spaces, so `soak-time` and
// `soak time` both match the same phrase.
//
// Fails open on parse errors (better to under-block than to brick edits
// when the file isn't parseable YAML).

import path from 'node:path'

import { safeReadFileSync } from '@socketsecurity/lib-stable/fs/read-file'

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

// `soak-time` is the canonical phrase; `minimumReleaseAge` is kept as an alias
// so older transcripts / muscle memory still authorize the bypass. Both fold
// through normalizeBypassText, so spacing/hyphen variants of each also match.
const BYPASS_PHRASES = [
  'Allow soak-time bypass',
  'Allow minimumReleaseAge bypass',
]

// Permissive YAML extraction tailored to the `minimumReleaseAge.exclude`
// block. We don't pull in a full YAML library — the block shape is narrow:
//
//   minimumReleaseAge:
//     exclude:
//       - pkg-a
//       - "@scope/pkg-b"
//
// Returns the set of `- <name>` entries under the exclude list. Empty set
// when the block isn't present.
export function extractExcludeNames(yamlText: string): Set<string> {
  const lines = yamlText.split(/\r?\n/)
  const out = new Set<string>()
  let inMra = false
  let mraIndent = -1
  let inExclude = false
  let excludeIndent = -1
  for (let i = 0, { length } = lines; i < length; i += 1) {
    const raw = lines[i]!
    const line = raw.replace(/\s+#.*$/, '')
    const trimmed = line.trim()
    if (!trimmed) {
      continue
    }
    const indent = line.length - line.trimStart().length

    if (!inMra) {
      if (/^minimumReleaseAge\s*:\s*$/.test(trimmed)) {
        inMra = true
        mraIndent = indent
      }
      continue
    }

    if (indent <= mraIndent && trimmed.length > 0) {
      inMra = false
      inExclude = false
      continue
    }

    if (!inExclude) {
      if (/^exclude\s*:\s*$/.test(trimmed)) {
        inExclude = true
        excludeIndent = indent
      }
      continue
    }

    if (indent <= excludeIndent && trimmed.length > 0) {
      inExclude = false
      continue
    }

    const itemMatch = /^-\s+(?<item>.+)$/.exec(trimmed)
    if (!itemMatch) {
      continue
    }
    let name = itemMatch.groups!.item!.trim()
    // Strip a surrounding pair of single or double quotes from a YAML scalar value.
    name = name.replace(/^["']|["']$/g, '')
    if (name) {
      out.add(name)
    }
  }
  return out
}

export const check = editGuard((filePath, _content, payload) => {
  if (path.basename(filePath) !== 'pnpm-workspace.yaml') {
    return undefined
  }
  const currentText = safeReadFileSync(filePath) ?? ''
  const afterText = resolveEditedText(payload)
  if (afterText === undefined) {
    return undefined
  }

  const beforeNames = extractExcludeNames(currentText)
  const afterNames = extractExcludeNames(afterText)

  const added: string[] = []
  for (const name of afterNames) {
    if (!beforeNames.has(name)) {
      added.push(name)
    }
  }
  if (added.length === 0) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASES)
  ) {
    return undefined
  }

  added.sort()
  return block(
    [
      '[minimum-release-age-guard] Blocked: minimumReleaseAge.exclude additions',
      '',
      `  File:        ${filePath}`,
      `  New entries: ${added.map(n => `\`${n}\``).join(', ')}`,
      '',
      '  The 7-day `minimumReleaseAge` soak is intentional malware-soak',
      '  protection. Packages on npm < 7 days are still in the typosquat /',
      '  postinstall-malware suspicion window. Adding to `exclude[]`',
      '  bypasses that protection for the listed packages.',
      '',
      '  Legitimate cases (rare):',
      '    - Emergency CVE patch published < 7 days ago.',
      '    - First-party package you control.',
      '',
      "  Don't hand-edit the exclude list — run the canonical helper, which",
      '  looks up the npm publish date and writes the dated annotation for you:',
      '    node scripts/fleet/soak-bypass.mts <pkg>@<version>',
      '  (the daily updating-daily job removes the entry once its soak clears).',
      '',
      `  Bypass (to hand-edit anyway): type "${BYPASS_PHRASES[0]}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
