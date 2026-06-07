#!/usr/bin/env node
// Claude Code PreToolUse hook — inline-script-defer-guard.
//
// Blocks Edit/Write operations that add `<script defer>` or
// `<script async>` to an HTML / template file when the same tag lacks a
// `src=` attribute. Per HTML spec, `defer` and `async` are no-ops on
// inline (no-src) `<script>` tags — the script executes immediately,
// even though the author intent is "wait for DOMContentLoaded." Browsers
// don't warn; the failure mode is a silent broken page (e.g. unstyled
// `<pre><code>` blocks when the script that styles them runs before its
// targets exist).
//
// Detection: regex over the after-edit text. Find `<script [^>]*\b(defer|async)\b[^>]*>`,
// check the same tag for `src=`. If absent → block.
//
// Fix: wrap the script body in
//
//     <script>
//       document.addEventListener('DOMContentLoaded', () => {
//         // your code here
//       })
//     </script>
//
// Files covered: `*.html` / `*.htm` / `*.njk` / `*.ejs` / `*.hbs` /
// `*.handlebars` / `*.svelte` / `*.vue` / `*.astro`. Also fires on TS/JS
// source files that contain HTML string literals matching the pattern —
// SSR / static-gen code paths.
//
// Bypass: `Allow inline-defer bypass` typed verbatim in a recent user turn.

import { readFileSync } from 'node:fs'
import process from 'node:process'

import { getDefaultLogger } from '@socketsecurity/lib-stable/logger/default'

import { withEditGuard } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const logger = getDefaultLogger()

const BYPASS_PHRASE = 'Allow inline-defer bypass'

// File extensions where we check the full text content. For other
// extensions, only the new_string is checked (template strings embedded
// in TS/JS source).
const HTML_EXT_RE = /\.(astro|ejs|handlebars|hbs|htm|html|njk|svelte|vue)$/i

const SOURCE_EXT_RE = /\.(m?[jt]sx?|cts|cjs)$/i

// Match each `<script ...>` opener and capture its attribute body.
const SCRIPT_OPENER_RE = /<script\b([^>]*)>/gi

export function findInlineDeferOrAsync(text: string):
  | {
      attrs: string
    }
  | undefined {
  let m: RegExpExecArray | null
  // Reset the regex's lastIndex for safety across multiple calls.
  SCRIPT_OPENER_RE.lastIndex = 0
  while ((m = SCRIPT_OPENER_RE.exec(text)) !== null) {
    const attrs = m[1] ?? ''
    if (!/\b(async|defer)\b/i.test(attrs)) {
      continue
    }
    // If src= is present (anywhere in the tag), the defer/async IS valid.
    if (/\bsrc\s*=/.test(attrs)) {
      continue
    }
    return { attrs }
  }
  return undefined
}

export function readFileSafe(p: string): string {
  try {
    return readFileSync(p, 'utf8')
  } catch {
    return ''
  }
}

// withEditGuard handles the stdin drain, tool_name gate, file_path narrow,
// content extraction (new_string / content), and fail-open on any throw.
await withEditGuard((filePath, content, payload) => {
  const isHtml = HTML_EXT_RE.test(filePath)
  const isSource = SOURCE_EXT_RE.test(filePath)
  if (!isHtml && !isSource) {
    return
  }

  // For HTML files, check the FULL after-edit text (the violation may
  // already be present and we're touching neighboring lines).
  // For source files, only check the new_string (avoid flagging existing
  // template strings buried in unrelated source).
  let textToScan: string
  if (payload.tool_name === 'Write') {
    textToScan = content ?? ''
  } else {
    const newStr = content ?? ''
    if (isHtml) {
      const currentText = readFileSafe(filePath)
      textToScan = newStr
        ? currentText.replace(
            (payload.tool_input?.old_string as string | undefined) ?? '',
            newStr,
          )
        : currentText
    } else {
      textToScan = newStr
    }
  }

  const found = findInlineDeferOrAsync(textToScan)
  if (!found) {
    return
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return
  }

  logger.error(
    [
      // socket-lint: allow inline-defer -- the hook's own diagnostic text names the banned shape; it isn't real inline-script markup.
      '[inline-script-defer-guard] Blocked: <script defer/async> without src=',
      '',
      `  File: ${filePath}`,
      `  Tag:  <script${found.attrs.slice(0, 80)}>`,
      '',
      '  Per the HTML spec, `defer` and `async` are no-ops on inline',
      '  (no-src) `<script>` tags. The script runs immediately — the',
      '  author intent (wait for DOMContentLoaded) is silently ignored.',
      '  Browsers do not warn; the failure mode is a broken page.',
      '',
      '  Fix — wrap the body in a DOMContentLoaded listener:',
      '',
      '      <script>',
      "        document.addEventListener('DOMContentLoaded', () => {",
      '          /* your code here */',
      '        })',
      '      </script>',
      '',
      '  Or — if the script DOES belong in an external file:',
      '',
      '      <script defer src="/path/to/script.js"></script>',
      '',
      `  Bypass: type "${BYPASS_PHRASE}" in a new message, then retry.`,
      '',
    ].join('\n'),
  )
  process.exitCode = 2
})
