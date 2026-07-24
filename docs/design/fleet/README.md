# Socket Style Guide

How to make Socket projects look like Socket projects. Copy-paste recipes,
visual examples, and the rules behind them.

Two files:

- `tokens.css` — every color, font, spacing, radius, shadow, and animation
  duration as a CSS custom property. Single source of truth.
- `components.css` — recipes (buttons, forms, cards, modals, spinners) built
  entirely from tokens. No hex literals outside `tokens.css`.

Author once, theme everywhere.

## The Socket design system

This guide is one piece of the Socket design system. When you design or polish
a Socket UI (dashboard, landing page, extension, product screen), work in this
order:

1. **Methodology first — the `refero-design` skill.** It is the default skill
   for any UI / product / visual work: research real references before
   designing, then reach for the tokens below. Don't design from generic model
   taste.
2. **Tokens + components — this guide.** `tokens.css` + `components.css` are the
   single source of truth for color, type, spacing, motion, and the component
   recipes. Never hand-roll a hex or spacing value a token already names.
3. **Brand assets — `assets/`.** The Socket wordmark lockups (light/dark),
   favicon, avatar, shield, and follow badges live under `assets/`. The
   `assets/fleet/` subset cascades to every repo; the full kit stays in the
   wheelhouse. Use the lockup for the README `<picture>` footer and the favicon
   for hosted surfaces — don't recreate the mark from the brand colors below.

Onboarding a UI repo (e.g. meander) means opting into `docs/design/fleet/`: copy it
once and the cascade keeps it byte-identical thereafter; your own app-specific
CSS lives in a sibling `styles/repo/` you own (never cascaded). Non-UI repos
skip both.

## Quick start

Drop these two lines into your `<head>` and you're done:

```html
<link rel="stylesheet" href="./docs/design/fleet/tokens.css" />
<link rel="stylesheet" href="./docs/design/fleet/components.css" />
```

For inline-CSS scenarios (Chrome extensions, single-file demos) where
`<link>` is awkward, paste the file contents into a `<style>` block, or use
`@import`:

```html
<style>
  @import url('./docs/design/fleet/tokens.css');
  @import url('./docs/design/fleet/components.css');
</style>
```

That's it. No build step, no PostCSS, no preprocessor.

## Themes

Four themes ship in `tokens.css`:

```text
  light       Default. Cream + ink for product surfaces.
  dark        Charcoal + lavender for devtools / power-user contexts.
  synthwave   Neon pink on deep purple — Socket-branded celebration.
  system      Follows OS via prefers-color-scheme.
```

Switch themes by setting `data-theme` on `<html>`:

```js
document.documentElement.setAttribute('data-theme', 'dark')
```

ASCII swatches showing the four themes side-by-side:

```text
  light       dark        synthwave    system
  ┌─────┐     ┌─────┐     ┌─────┐      ┌─────┐
  │ FFF │     │ 0A0 │     │ 1A0 │      │ ??? │
  │ 18Z │     │ F4Z │     │ F8F │      │ OS  │
  │ purp│     │ lav │     │ pink│      │     │
  └─────┘     └─────┘     └─────┘      └─────┘
```

If you don't set `data-theme`, you get `light`. If you set `data-theme="system"`,
the user's OS preference picks light or dark.

## Colors

### Brand

```text
  --socket-purple  #8c50ff     ████████  Socket logo primary
  --socket-pink    #ff00aa     ████████  Socket logo secondary
```

These are the **logo** colors. Don't use them directly for UI chrome — they're
loud by design. Use `--primary` (which references `--socket-purple` in light
mode) or `--mkt-glow` instead.

### Core (shadcn) vs marketing

The core UI tokens follow shadcn/ui's semantic naming — every surface has a
paired `-foreground`, so text-on-surface contrast is guaranteed. Pick based on
what you're building:

```text
  shadcn core   Chrome — dashboards, extensions, dev tools, popups.
                --background/--foreground, --card, --popover, --primary,
                --secondary, --muted, --accent, --destructive (+ each one's
                -foreground), --border, --input, --ring, --radius.
                Theme-stable; the same code looks right in light/dark/synthwave.

  --mkt-*       Marketing — landing pages, docs, hero sections (Socket
                extension). Warmer, brand-forward palette. Doesn't impose
                itself on tools.
```

Mockups, side-by-side:

```text
  UI chrome (--ui-*)              Marketing (--mkt-*)
  ┌──────────────────┐            ┌──────────────────┐
  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │            │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
  │  Save  Cancel    │            │  Get started ▶   │
  │ ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ │            │ ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ │
  └──────────────────┘            └──────────────────┘
   white bg, ink fg                cream bg, deep purple fg
```

### Status colors

Semantic palette — same names across all themes, hue tuned per theme:

| Token              | Light     | Dark      | Synthwave | Use case               |
| ------------------ | --------- | --------- | --------- | ---------------------- |
| `--status-success` | `#15803d` | `#4ade80` | `#50fa7b` | Deploy completed       |
| `--status-warning` | `#a16207` | `#facc15` | `#f1fa8c` | Stale data in field    |
| `--status-alert`   | `#9a3412` | `#fb923c` | `#ffb86c` | In-progress retry      |
| `--destructive`   | `#b91c1c` | `#f87171` | `#ff6b9d` | Run failed, fix needed |
| `--status-info`    | `#1d4ed8` | `#60a5fa` | `#8be9fd` | Neutral information    |

Use case rules of thumb:

- `success` — confirmed positive outcome. "Deploy completed", "Saved".
- `warning` — caution; user may still be okay. "Form has stale data".
- `alert` — in-progress with degraded path. "Retrying, may succeed".
- `error` — failure requiring action. "Build failed".
- `info` — neutral, non-blocking. "Tip: try the docs".

## Typography

```text
  --font-sans   Geist > IBM Plex Sans > system-ui > -apple-system > sans-serif
  --font-mono   Geist Mono > ui-monospace > SFMono > Menlo > Consolas > monospace
```

Use `--font-mono` for code, package names, file paths, log lines, hashes,
versions. Use `--font-sans` for everything else.

The system fallback chain matters — Geist isn't bundled. If a project doesn't
ship Geist, the next entry takes over silently. On macOS that's IBM Plex Sans
if installed, else `system-ui`. Linux/Windows have their own system fallbacks.
All fallbacks are sans-serif, so layout doesn't reflow.

## Spacing

Use the scale, not magic numbers:

```text
  --space-xs   4px      ▌ thin gap — icon + label inside a button
  --space-sm   8px      █ between related inline elements
  --space-md  16px      ██ between sections inside a card
  --space-lg  24px      ███ between cards
  --space-xl  48px      ██████ between major page regions
```

If your design wants 12px, pick the closer scale value (16 or 8). Resist
inventing intermediate values; the rhythm of the page is in the scale.

## Components

### Buttons

```html
<button class="btn btn-primary">Save</button>
<button class="btn btn-secondary">Cancel</button>
<button class="btn btn-danger">Delete</button>
<button class="btn" disabled>Locked</button>
```

```text
  Primary             Secondary            Danger              Disabled
  ┌─────────────┐    ┌─────────────┐     ┌─────────────┐     ┌───────────┐
  │░░░ Save ░░░░│    │  Cancel     │     │  Delete     │     │  Locked   │
  └─────────────┘    └─────────────┘     └─────────────┘     └───────────┘
   gradient fill      neutral bg           red border          45% opacity
```

`btn-primary` carries the brand gradient — reserve for the action you want
the user to take. One primary per page region.

`btn-secondary` is the workhorse — neutral chrome, for everything that isn't
the primary action.

`btn-danger` for destructive verbs (Delete, Remove, Discard). The hover
state inverts to a filled red — a built-in "wait, am I sure?" beat.

### Form fields

```html
<input type="text" placeholder="namespace" />
<textarea placeholder="paste package list"></textarea>
```

```text
  ┌──────────────────────────────────┐    focus state adds a ring:
  │  namespace                       │    ┌──────────────────────────────────┐
  └──────────────────────────────────┘    │ █▒  socketsecurity            ▒█ │
   border = --input                   └──────────────────────────────────┘
   placeholder = --muted-foreground              border = --primary
                                            ring = --accent (3px)
```

`<textarea>` inherits the same shape, switches to `--font-mono`, and grows
vertically.

### Cards

```html
<details class="card">
  <summary class="card-header">Packages</summary>
  <p>...content...</p>
</details>
```

Or with explicit toggle classes (for non-`<details>` patterns):

```html
<div class="card card-expanded">
  <div class="card-header">Status</div>
  <p>...content...</p>
</div>
```

```text
  Collapsed                          Expanded
  ┌──────────────────────┐           ┌──────────────────────┐
  │ ▶ Packages           │           │ ▼ Packages           │
  └──────────────────────┘           │                      │
   subtle recess                     │   pnpm install foo   │
                                     │   pnpm install bar   │
                                     └──────────────────────┘
                                      lifted forward, with shadow
```

### Modals

```html
<div class="modal-backdrop"></div>
<div class="modal">...</div>
```

The backdrop dims + blurs everything behind it. In light mode it's a gentle
lavender wash; in dark / synthwave it's plum. Combine with `body:has(.modal)`
to disable pointer events on the underlying chrome.

### Spinners

```html
<span class="spinner" aria-label="Loading"></span>
```

Single-color ring rotating at 0.9s/turn. The ring color is `--primary`,
so it auto-themes.

### Shimmer

```html
<span class="shimmer">All trusted publisher settings updated</span>
```

Text-clipped rainbow shimmer. Reserve for celebratory states (completed run,
finished migration). Loops indefinitely once added — toggle the class off
when the moment passes.

## Accessibility

Every color pair in `tokens.css` has been verified to clear **WCAG AA**
(contrast ratio ≥ 4.5:1) against its native background. The fleet ships a
contrast lint:

```bash
node scripts/check-contrast.mts
```

Wired into `pnpm check`, so a token tweak that drops a pair below AA fails
the build. Example output:

```text
  log .ok    #9af7c0   7.34  AAA
  log .warn  #ffd285   6.61  AAA
  log .err   #ffaaaa   5.17  AA
  ticker.ok  #0a5e2c   7.26  AAA  (light theme)

  All status colors clear WCAG AA.
```

If you add a new color combination, add it to `.config/contrast.json` so
the lint covers it.

## Animations

Use the named keyframes from `components.css`, not custom `@keyframes`:

- `.spinner` — loading state, infinite rotation.
- `.shimmer` — celebratory text effect, infinite.
- `.pulse` — single-shot attention pulse for changing values.

Durations come from the motion scale:

```text
  --motion-fast    120ms    hover responses, focus rings
  --motion-med     220ms    entrances, expand/collapse
  --motion-slow    360ms    emphasis, hero treatments
```

Never use a duration shorter than 80ms — the eye reads it as "snapped",
which looks broken on slower hardware.

## Terminal output

For Node CLIs / TUI tools, mirror the CSS palette in your terminal with the
matching socket-lib helper:

```ts
import { getPalette } from '@socketsecurity/lib/colors/socket-palette'

const palette = getPalette('dark')
console.log(palette.success('Done'))
console.log(palette.error('Failed'))
```

ASCII output sample:

```text
  $ socket scan
  ████ Done            ← --status-success (green)
  ▓▓▓▓ Warning         ← --status-warning (amber)
  ░░░░ Error           ← --destructive (red)
```

The CLI palette mirrors the CSS tokens by name. Switch terminal themes via
`SOCKET_THEME=light|dark|synthwave` in your shell, or pass an explicit theme
to `getPalette()`.

## Don'ts

- **Don't add hardcoded hexes outside `tokens.css`.** If you need a color
  that isn't tokenized, add it as a token first.
- **Don't use `--socket-purple` / `--socket-pink` directly for chrome.**
  Those are LOGO colors. Use `--primary` or `--mkt-glow` for chrome
  surfaces; reserve the brand constants for the actual logo treatment.
- **Don't disable a button by removing its click handler.** Apply `:disabled`
  or `aria-disabled="true"` so screen readers and keyboard users know.
- **Don't ship contrast < 4.5:1 even if it "looks fine" on your monitor.**
  Run the lint — your screen isn't the user's.
- **Don't write custom `@keyframes` when one of `spin` / `shimmer` /
  `pulse` already covers it.** Fewer animations = more predictable.
- **Don't override tokens in component CSS.** If a component needs a
  different shade, the token is wrong — fix it in `tokens.css`.

## Extending

### Add a new theme

Copy a section of `tokens.css`, change the `data-theme` selector, override
**only** the tokens that should change. The cascade handles the rest. Run
the contrast lint to verify any combination you didn't inherit.

### Add a new component

Write it in `components.css` using **only** tokens from `tokens.css`. No
hex literals, no magic numbers — even `padding: 13px` is a smell (use
`var(--space-sm)` or add a new spacing token).

### Add a new color token

Add it to all four theme blocks in `tokens.css` (light, dark, synthwave,
and the `prefers-color-scheme: dark` system override). Pick perceptually
matched values — same lightness, different hue — so the token tells the
same story across themes. Run the contrast lint to verify any pair against
its surface.
