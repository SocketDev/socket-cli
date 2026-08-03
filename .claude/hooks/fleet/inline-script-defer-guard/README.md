# inline-script-defer-guard

PreToolUse Edit/Write hook that blocks introducing `<script defer>` or
`<script async>` to an HTML / template file when the same tag lacks a
`src=` attribute.

## Why

Per HTML spec, `defer` and `async` are no-ops on inline (no-src)
`<script>` tags. The script executes immediately, even though the author
intent is "wait for DOMContentLoaded." Browsers don't warn. The failure
mode is a silently broken page — code styles `<pre><code>` blocks that
don't exist yet, etc.

This pattern bit a fleet project twice. The fix is the
`DOMContentLoaded` listener:

```html
<script>
  document.addEventListener('DOMContentLoaded', () => {
    /* your code */
  })
</script>
```

Or, for code that genuinely belongs in an external file:

```html
<script defer src="/path/to/script.js"></script>
```

## What it covers

| File extension                                           | Checked?        |
| -------------------------------------------------------- | --------------- |
| `.html` / `.htm`                                         | full text       |
| `.njk` / `.ejs` / `.hbs` / `.handlebars`                 | full text       |
| `.svelte` / `.vue` / `.astro`                            | full text       |
| `.ts` / `.tsx` / `.mts` / `.cts` / `.js` / `.jsx` / etc. | new_string only |
| anything else                                            | not checked     |

## Bypass

Type the canonical phrase in a new message:

    Allow inline-defer bypass

Use sparingly — the bug is silent in production.

## Companion: oxlint rule

`socket/no-inline-defer-async` catches the same shape at commit time
even when edits happened outside Claude.
