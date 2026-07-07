#!/usr/bin/env node
// Claude Code PreToolUse hook — inline-script-defer-guard.
//
// Blocks Edit/Write operations that add a script tag with defer or
// async attribute to an HTML / template file when the same tag lacks a
// `src=` attribute. Per HTML spec, `defer` and `async` are no-ops on
// inline (no-src) script tags — the script executes immediately,
// even though the author intent is "wait for DOMContentLoaded." Browsers
// don't warn; the failure mode is a silent broken page (e.g. unstyled
// `<pre><code>` blocks when the script that styles them runs before its
// targets exist).
//
// Detection: regex over the after-edit text. Find script openers with
// defer or async in their attrs, check the same tag for `src=`.
// If absent → block.
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

import { block, defineHook, editGuard, runHook } from '../_shared/guard.mts'
import { resolveEditedText } from '../_shared/payload.mts'
import { bypassPhrasePresent } from '../_shared/transcript.mts'

const BYPASS_PHRASE = 'Allow inline-defer bypass'

// File extensions where we check the full text content. For other
// extensions, only the new_string is checked (template strings embedded
// in TS/JS source).
const HTML_EXT_RE = /\.(?:astro|ejs|handlebars|hbs|htm|html|njk|svelte|vue)$/i

// JS/TS source extensions: optional `m` or `c` prefix, then `js`/`ts`
// with an optional `x` suffix (JSX/TSX), anchored to the end of the path.
const SOURCE_EXT_RE = /\.(?:m?[jt]sx?|cts|cjs)$/i

// Match each `<script ...>` opener and capture its attribute body.
const SCRIPT_OPENER_RE = /<script\b(?<attrs>[^>]*)>/gi

export function findInlineDeferOrAsync(text: string):
  | {
      attrs: string
    }
  | undefined {
  let m: RegExpExecArray | null
  // Reset the regex's lastIndex for safety across multiple calls.
  SCRIPT_OPENER_RE.lastIndex = 0
  while ((m = SCRIPT_OPENER_RE.exec(text)) !== null) {
    /* c8 ignore next - named-group regex always populates m.groups when it matches */
    const attrs = m.groups?.attrs ?? ''
    if (!/\b(?:async|defer)\b/i.test(attrs)) {
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

export const check = editGuard((filePath, content, payload) => {
  const isHtml = HTML_EXT_RE.test(filePath)
  const isSource = SOURCE_EXT_RE.test(filePath)
  if (!isHtml && !isSource) {
    return undefined
  }

  // HTML: scan the FULL post-edit text (the violation may already be present
  // and we're only touching neighboring lines). Source: scan just the
  // new_string / content (avoid flagging existing template strings buried in
  // unrelated source).
  let textToScan: string
  if (isHtml) {
    const afterText = resolveEditedText(payload)
    if (afterText === undefined) {
      return undefined
    }
    textToScan = afterText
  } else {
    textToScan = content ?? ''
  }

  const found = findInlineDeferOrAsync(textToScan)
  if (!found) {
    return undefined
  }

  if (
    payload.transcript_path &&
    bypassPhrasePresent(payload.transcript_path, BYPASS_PHRASE)
  ) {
    return undefined
  }

  const tag = `<script${found.attrs.slice(0, 80)}>`
  return block(
    [
      '[inline-script-defer-guard] Blocked: inline script with defer/async but no src=',
      '',
      `  File: ${filePath}`,
      `  Tag:  ${tag}`,
      '',
      '  Per the HTML spec, `defer` and `async` are no-ops on inline',
      '  (no-src) script tags. The script runs immediately — the',
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
})

export const hook = defineHook({
  check,
  event: 'PreToolUse',
  matcher: ['Edit', 'Write', 'MultiEdit'],
  type: 'guard',
})

void runHook(hook, import.meta.url)
