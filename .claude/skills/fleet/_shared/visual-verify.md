# Visual verification — render it, then read the pixels

Type-checking and tests verify code *correctness*, not *feature correctness*. A UI can pass
`tsc` and `vitest` and still render broken: an empty section, a stuck spinner, wrong colors,
or a render that throws partway and aborts. The only way to know what a UI actually looks
like is to **look at it**. This is the technique for doing that.

Referenced by the `rendering-chromium-to-png` skill and the "verify rendered output before
commit" rule (`docs/agents.md/fleet/judgment-and-self-evaluation.md`).

## The mechanism

1. **Render to a PNG** with headless Chromium (the `rendering-chromium-to-png` skill, or a
   one-off `playwright-core` script). The page runs its real CSS + JS.
2. **`Read` the PNG.** The harness decodes the image; the rendered pixels enter your context.
   You observe the UI the same way a human reads a screenshot — this is literal seeing, not
   inference from source.

The difference from code-reading: reasoning about what markup *should* produce misses bugs
that only appear when it *actually* runs. Real example (2026-06-04): a Chrome-extension
review panel looked correct in `review.ts`, but rendering it showed the whole diff/manifest/
scan area empty — a `const { counts } = review.summary.fileCounts` destructure threw
(`fileCounts` IS the counts; no `.counts`), aborting the render after the first section. The
source read fine; the pixels exposed it instantly.

## Two modes (via the rendering-chromium-to-png skill)

- **Page mode** — any URL or local HTML file → PNG.
- **Extension mode** — load an unpacked Chrome MV3 extension with its REAL powers (background
  service worker, content scripts, `chrome.*` APIs) via `launchPersistentContext` +
  `channel: 'chromium'` (the documented way to run extensions in headless Chromium), then
  screenshot a page inside it (the popup by default). This is the actual in-browser render,
  not a `file://` approximation.

## When to reach for it

- **Before redesigning UI** — see the current state, don't redesign blind.
- **Before committing a UI/render change** — the fleet rule + the
  `verify-render-pre-commit-nudge` hook expect it.
- **To inspect an extension popup** with its live `chrome.*` context.
- Iteratively: render → read → fix → render again, each state its own screenshot.

## Caveats — state them honestly in your summary

- **Static snapshot, not interactive.** One shot = one state. You can't hover/click/scroll.
  For a state behind interaction, script the click then screenshot, or time the `--wait`.
- **Mock vs live data.** If the backend isn't running you're seeing empty/placeholder states
  — say so. A built-in `?preview` mock is still mock content (layout/colors/bugs are real,
  the data isn't).
- **MV3 service workers suspend** after ~30s idle; long-lived `evaluate()` may throw
  "Service worker restarted" — keep interactions short.
- **No browser available** (headless CI without chromium): say so explicitly rather than
  claiming you verified. Install with `pnpm exec playwright install chromium`.

## The discipline

Never claim a UI change "looks right" or "renders correctly" without having rendered it.
"Works now" on a UI means *seen working*, not *type-checks*. If you genuinely can't render
(no browser), say that plainly in the summary instead of implying visual confirmation.
