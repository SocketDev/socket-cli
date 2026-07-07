---
name: fleet-rendering-chromium-to-png
description: Render a web page, local HTML file, or a real unpacked Chrome MV3 extension popup to a PNG so you can SEE it — then Read the image to put the actual rendered pixels in context. Catches layout / color / empty-state / render-throw bugs that code-reading misses (a view can look correct in source and render broken). Use before redesigning UI, when "verify rendered output before commit" applies, or to inspect an extension popup with its real chrome.* powers. Page mode renders any url/file; extension mode loads an unpacked MV3 extension (background SW + content scripts + popup) and screenshots a page inside it.
user-invocable: true
allowed-tools: Read, Bash(node:*), Bash(pnpm exec playwright:*), Bash(ls:*)
model: claude-haiku-4-5
context: fork
---

# rendering-chromium-to-png

Type-checking and tests verify code *correctness*, not *feature correctness* — a UI can be
green on `tsc`/`vitest` and render broken (empty section, stuck spinner, wrong colors, a
throw that aborts the render partway). This skill gives you eyes: render to a PNG, then
`Read` the PNG so the actual pixels enter context. It's the HOW behind the fleet's
"verify rendered output before commit" rule.

## Page mode — render any URL or local file

```sh
node .claude/skills/fleet/rendering-chromium-to-png/screenshot.mts <url|file> \
  [--out p.png] [--width 580] [--height 0=full] [--theme dark|light] [--wait 2500] [--full]
```

Then `Read` the `--out` PNG. Defaults: 580px wide, full-page, dark theme, 2.5s settle.

## Extension mode — load a real unpacked MV3 extension

```sh
node .claude/skills/fleet/rendering-chromium-to-png/screenshot.mts \
  --extension <unpacked-dir> [--page popup.html] [--out p.png] [--width 580] [--theme dark|light]
```

This loads the extension with its REAL powers — background service worker, content scripts,
`chrome.*` APIs — via `launchPersistentContext` + `channel: 'chromium'` (the documented way
to run extensions in headless Chromium; plain headless silently ignores `--load-extension`).
It resolves the extension id from the background service worker, navigates to
`chrome-extension://<id>/<page>` (popup by default), and screenshots it. Use this to see an
extension popup as it actually renders in-browser, not a static file:// approximation.

## How you actually "see" it

1. Run the script → it writes a PNG.
2. `Read` that PNG path. The harness decodes the image; the rendered pixels go into your
   context. You observe the UI the same as a human looking at a screenshot.

## Caveats (state these honestly in your summary)

- **Static snapshot, not interactive.** You can't hover/click/scroll in one shot. For a
  state behind a click, drive it (a small playwright script that clicks then screenshots) or
  capture different states by timing the `--wait`. Each state = its own screenshot.
- **Mock vs live data.** If the page needs a backend that isn't running, you're seeing
  empty/placeholder states — say so. (A built-in `?preview` mock, if the app has one, is
  still mock data; the layout/colors/bugs are real, the content isn't.)
- **MV3 service workers suspend** after ~30s idle and restart on demand — long-lived
  `evaluate()` may throw "Service worker restarted"; keep interactions short.
- **No browser available** (headless CI without chromium): say so explicitly rather than
  claiming you verified — run `pnpm exec playwright install chromium` first.

## Browser dependency

`playwright-core` (fleet catalog devDep) drives a headless Chromium. If the binary is
missing the script says so — install it with `pnpm exec playwright install chromium`.
