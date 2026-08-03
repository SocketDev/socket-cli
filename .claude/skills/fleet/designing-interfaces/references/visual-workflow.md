# Visual Workflow

Use this reference only when the task needs visual exploration, generated mockups,
bitmap assets, or post-build visual QA. Keep the main Refero workflow research-first:
styles for taste, screens for product patterns, flows for journeys.

## Image Generation Capability

Image generation is optional. Use it only when the current environment exposes an image
tool, or when the user has approved a CLI/API image workflow. Refero must still work
in Claude Code, Codex, Cursor, Gemini CLI, Lovable, and other MCP-compatible agents when
no image tool exists.

In Codex Desktop, use the built-in `image_gen` / Image Gen tool when it is available.
Generate each visual direction or bitmap asset as its own image result. Do not use
browser screenshots, CSS drawings, inline SVG, or placeholder shapes as a substitute for
generated bitmap assets when the reference lock calls for real imagery.

If image generation is unavailable, present written reference-locked directions and
implementation-ready prompts instead. Do not assume another agent can call Codex
Desktop's built-in image tool just because Codex is installed locally; verify the tool
is exposed and user-approved first.

## Three Visual Directions

Use this only when exploration is useful: variants, a new visual language, major
redesigns, landing pages, or other high-visibility surfaces with several plausible
directions. Do not run it for small edits, obvious component work, or production fixes
with a clear source.

1. Research styles first; add screens/flows when structure or journey matters.
2. Create three distinct reference-locked directions with a primary source, traits to
   preserve, borrowed details, media strategy, and rejects, unless the user asks for a
   different count.
3. If image generation is available and worth the latency, generate one independent
   image per direction. Otherwise provide written directions with implementation-ready
   prompts.
4. Stop and ask the user to choose. The selected option becomes the visual target for
   build and QA.

Example format only. Replace these names and directions for every task based on the
current brief and Refero research:

```text
1. [Direction name] - [specific layout, style, product framing, and primary reference].
2. [Direction name] - [specific layout, style, product framing, and primary reference].
3. [Direction name] - [specific layout, style, product framing, and primary reference].
```

## Visual Target Gate

Before coding substantial visual work, identify the build target and what must not drift:

```text
Build target: [existing UI / user screenshot / Figma frame / URL capture / selected generated mockup / approved reference lock]
What must not drift: [canvas, typography, accent roles, layout, media, density]
```

If no target exists and the visual direction is material, explore options or ask the
user to approve one reference-locked direction first.

## Generated Assets

Generate assets only when the reference lock needs bitmap media: hero/product imagery,
illustrations, textures, thumbnails, cutouts, or required replacement assets. Do not use
image generation for standard icons, editable SVG systems, code-native UI, or fake
product evidence.

Before generating, write a short asset lock:

```text
Asset role: [hero image / texture / illustration / thumbnail / cutout]
Slot: [dimensions/aspect ratio/location]
Art direction: [source, palette, subject, rendering, crop, density]
Avoid: [wrong palette, extra text, brand drift, generic placeholders]
```

Generated assets must be placed into the implementation before handoff or documented as
blocked.

## Visual QA

After implementation, run a visual QA pass for substantial UI/design work:

```text
Source truth: [reference lock / selected mockup / screenshot / Figma / URL capture]
Implementation evidence: [local screenshot, deployed URL screenshot, or captured app state]
Viewport/state: [desktop/mobile, route, theme, interaction state]
Final result: [passed / blocked]
```

Check typography, spacing/layout, colors/tokens, imagery/assets, relevant component
states, and product copy. Use the relevant craft references during QA when judging
typography, color, motion, icons, accessibility, images, copy, and generic-design drift.

Classify issues by severity:

- `P0`: broken task, unreadable/overlapping UI, or severe accessibility issue
- `P1`: major design drift or likely user-facing usability regression
- `P2`: moderate visual mismatch, missing state, responsive issue, or asset drift
- `P3`: polish that can follow after handoff

Do not hand off visual work with unresolved P0/P1/P2 findings unless clearly blocked by
missing source access, missing assets, or an unavailable tool. If blocked, say what
evidence is missing and what should be checked next.
