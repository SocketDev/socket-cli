---
name: designing-interfaces
description: Designs and reviews accessible interfaces using reference research and rendered validation.
license: MIT
compatibility: Useful on its own as a design methodology and craft reference; works best with Refero MCP available for live style, screen, and flow research.
metadata:
  author: SocketDev
  sources: Refero skill @ f78b4ecc (2026-07-10)
---

<!-- Sources: Refero skill @ f78b4ecc (2026-07-10) and the
fleet's focused interface skills. This is a fleet-authored consolidation. -->

# Designing Interfaces

This is the fleet's consolidated interface-design workflow. Refero supplies the
reference-research capability; the companion skills own focused implementation,
review, performance, and test work.

Refero gives agents taste and product evidence. Use it before design work instead of
relying on generic model knowledge.

Refero has three research layers:

1. **Styles** - visual direction and taste.
2. **Screens** - concrete UI patterns and product-screen decisions.
3. **Flows** - multi-step journey logic.

Best results come from combining layers: visual direction from styles, concrete UI
patterns from screens, and sequencing from flows when the task has multiple steps.

## Non-Negotiables

- **Research before design work.** Every design must be grounded in references before
  implementation. Do not rely on the model's generic design taste.
- **Use styles first for visual work when Refero MCP tools are available.** If tools are
  unavailable, use bundled craft references and keep the same reference-lock workflow.
- **Do not copy one reference.** Study several strong references and synthesize a new
  direction for the user's product.
- **Do not average references into a safe middle.** When references conflict, choose one
  dominant direction and preserve its sharp traits. Secondary references may add narrow
  details only.
- **Reject category reflexes twice.** First reject the default aesthetic implied by the
  product category. Then reject the predictable anti-default; choose a direction grounded
  in the brief and research instead.
- **Use grid backgrounds only when the product has a grid.** A two-axis gradient grid belongs
  to canvases, maps, blueprints, or measurement surfaces. Else use product structure or a
  plain surface.
- **Do not change token meanings.** If a reference says a color, font, radius, shadow,
  gradient, or component is for a specific role, use it only for that role or omit it.
- **Respect imagery guidance.** If a style depends on photography, illustration, product
  shots, or graphics, preserve the media role. Use real/generated/stock assets when
  available; otherwise create an intentional placeholder with art direction. Do not fake
  complex imagery with weak CSS, text, or decorative boxes.
- **Do not use generic frontend/product design skills as a parallel design authority**
  when this skill is available. This fleet skill is the design methodology; generic design skills
  tend to pull work back toward generic AI design.
- **Research output must be specific.** Name the references, describe concrete choices,
  and explain what will be adapted.
- **No design from vibe memory.** Every major visual, layout, content, or interaction
  decision must trace to Refero research, the user's brief, or a craft reference.
- **Synthesize before implementation.** Turn research into a concept, token direction,
  and concrete decision ledger before drawing or coding.
- **A brief is not a build target.** Before implementation, lock either a user-provided
  visual source, an existing product/design-system target, a selected generated mockup,
  or an explicit reference-locked direction approved for direct build.
- **Use image generation only when it changes the outcome.** Image generation can be slow
  and may not exist in every coding environment. Use it for visual exploration, mockups,
  imagery, illustrations, textures, and difficult assets; skip it for small fixes,
  obvious production edits, or code-native UI work.
- **Validate after building visual work.** Compare the rendered implementation against
  the locked target/reference before handoff. Fix actionable design drift instead of
  treating research as sufficient.

## Companion Skills

This skill owns design direction: reference research, the visual lock, and
the implementation direction. Use the companion skills only for their narrower roles:

- [improving-web-interfaces](../improving-web-interfaces/SKILL.md) for component
  construction and motion after the direction is locked.
- [extracting-design-systems](../extracting-design-systems/SKILL.md) for turning repeated,
  proven interface patterns into tokens and components.
- [reviewing-web-interfaces](../reviewing-web-interfaces/SKILL.md) for deterministic
  anti-pattern and accessibility review.
- [optimizing-react-interfaces](../optimizing-react-interfaces/SKILL.md) for React
  performance work.
- [testing-web-interfaces](../testing-web-interfaces/SKILL.md) for browser and
  component-test coverage.

## MCP Setup

This skill is useful on its own as a research-first design methodology and craft reference.
Research is mandatory. Use Refero MCP for live style, screen, and flow research when
available; otherwise research with bundled craft references and any user-provided references.

Typical MCP setup:

```bash
claude mcp add --transport http refero https://api.refero.design/mcp --header "Authorization: Bearer <token>"
```

For full tool details, read [references/mcp-tools.md](references/mcp-tools.md).

## Discovery

Before researching, form a short design brief. Ask only for missing information that
would materially change the result; otherwise make reasonable assumptions and proceed.

Clarify:

- what is being designed
- platform: web, iOS, or both
- audience and technical level
- primary user goal
- desired feeling or brand direction
- business/user objections to overcome
- constraints: existing brand, framework, deadline, accessibility, content
- whether the task needs visual direction, concrete UI patterns, journey logic, or a mix
- whether the task should go directly to code, produce visual options first, or create
  generated assets during implementation

Brief format:

```text
Designing [WHAT] for [WHO] on [PLATFORM].
Goal: [PRIMARY USER GOAL].
Tone: [DESIRED FEELING].
Main objection/risk: [OBJECTION].
Must remember: [HOOK OR DISTINCTIVE IDEA].
Constraints: [CONSTRAINTS].
Research needed: [styles/screens/flows].
Path: [direct build / visual exploration / audit / asset generation].
```

## Workflow Routing

Choose the lightest workflow that can produce a high-quality result.

- **Direct build:** use for small UI fixes, clear production edits, existing design-system
  work, or tasks with a concrete source to match. Research and lock the direction, then code.
- **Visual exploration:** use when the user asks for variants, a new visual language, a
  major redesign, a landing page, or another high-visibility surface with several plausible
  directions. Default to three reference-locked options and ask the user to choose; see
  [references/visual-workflow.md](references/visual-workflow.md).
- **Audit:** use captured screenshots, Refero screens, or flows as evidence before critique.
- **Asset generation:** use generated imagery only when the reference lock requires bitmap
  media that code, icons, or existing assets cannot faithfully provide; see
  [references/visual-workflow.md](references/visual-workflow.md).

## Tool Routing

### Use Styles First For Visual Work

Use `refero_search_styles` when the user asks to design, redesign, improve, polish, or
create anything with a visual component.

A style is a semantic design reference extracted from a real web marketing/product page.
It is not a screenshot and not a component library. Search results give previews; full
style references from `refero_get_style` provide design guidance such as visual thesis,
tokens, typography, layout/composition, section rhythm, spacing, elevation, surfaces,
components, imagery treatment, implementation notes, and do/don't rules.

Current limitation: Refero styles currently cover web marketing/product pages such as
landing pages, pricing pages, product marketing sites, editorial brand sites, and SaaS
websites. They do not currently cover in-app dashboards, auth screens, settings screens,
or iOS app screens as style systems. Still use styles for product UI tasks to establish
visual language, then use screens/flows for product logic.

Use styles for:

- look and feel
- brand direction
- landing pages and marketing pages
- typography, palette, layout, section structure, spacing, radius, elevation, surfaces
- component treatments and sometimes component/code examples
- imagery and product screenshot treatment
- design-system inspiration
- making a generic interface feel more tasteful

### Use Screens For Concrete UI Patterns

Use `refero_search_screens` when you need:

- a specific screen type
- a specific component or UI pattern
- page layout and content hierarchy
- copy and CTA patterns
- form/state examples
- dashboards, settings, modals, tables, pricing, empty states, auth, or product-screen details

After finding strong screens:

- use `refero_get_screen` for full details
- use `refero_get_similar_screens` to expand from a strong example
- use `refero_get_screen_image` only when raw screenshot inspection is needed

### Use Flows For Journeys

Use `refero_search_flows` when the task has a before/after sequence:

- onboarding
- signup
- checkout
- subscription management
- cancellation
- account deletion
- password reset
- profile/settings changes
- any multi-step process

After finding a strong flow, use `refero_get_flow` for step-by-step goals, actions,
system responses, and completion states.

### Use Visual Workflow For Images And QA

For image generation, visual options, generated assets, and visual QA, read
[references/visual-workflow.md](references/visual-workflow.md) when the task needs it.

## Research Workflow

### 1. Research Visual Direction With Styles

For any visual design task, start here.

Recommended loop:

1. Search 3-5 different visual angles.
2. Include one broad aesthetic query.
3. Include one domain/category query.
4. Include one known-brand or strong-product query when relevant.
5. Retrieve 3-4 strong styles with `refero_get_style`; full styles are large, so split larger research into multiple batches.
6. Compare what each style contributes.
7. Choose one primary foundation and borrow 1-2 specific details from other styles.
8. Lock the primary reference's signature traits before implementation.

Good style queries:

- editorial monochrome SaaS landing page
- warm trustworthy healthcare product marketing
- premium fintech website with restrained typography
- playful creator tool landing page with vivid accents
- developer tool website with product screenshots
- luxury ecommerce editorial product page
- productivity SaaS with airy spacing
- data infrastructure website dark technical style
- Attio editorial SaaS typography
- Linear changelog dark developer tool
- shadcn monochrome design system

Extract from styles:

- north star / visual thesis
- typography personality and type scale
- color roles and accent discipline
- spacing density and rhythm
- layout system, section rhythm, and composition patterns
- card/button/surface treatments
- borders, shadows, radius
- elevation and depth rules
- component examples and implementation/code notes when present
- imagery, graphics, illustration, or product screenshot treatment
- media asset strategy: real asset, generated/stock asset, code-native primitive, product screenshot, or placeholder
- do/don't rules
- one memorable visual move to adapt

Synthesis rule:

- Primary style: overall mood, density, and structure.
- Secondary styles: specific borrowed details.
- User context: adapt everything to the product, audience, and task.
- Do not use the average/intersection of all references. If one reference is dark, one is
  acid, and one is serif, the answer is not warm cream + muted orange + polite serif.

Never present the result as "copying X". Present it as a new direction inspired by
several references.

Before implementation, create a reference lock:

```text
Primary reference/direction: [one dominant source]
Preserve: [3-5 traits that must survive: canvas, type, accent, layout, density, media]
Borrow only: [1-2 specific secondary details]
Role rules: [source token/component meanings to preserve, e.g. CTA-only, code-only, decorative-only]
Media strategy: [real/generated/stock/code-native/placeholder, with aspect ratio and art direction]
Reject: [defaults/averages that would collapse the direction]
Token commitments: [background, type, accent, radius, border/shadow, imagery treatment, with roles]
```

If implementation drifts from the lock, stop and correct it. Do not soften distinctive
traits into safer colors, safer fonts, softer radius, or generic section layouts.
Reference lock is not cloning; it preserves selected traits while adapting content,
brand, and interaction details to the user's product.

When combining styles, assign each source a bounded job. For example: one source may own
canvas/type, another may own code-window treatment, and another may own primary CTA.
Never move a token outside its source role: CTA colors stay CTA-only, syntax colors stay
inside code, decorative gradients stay decorative, and card/button rules keep their
specified radius, shadow, and state behavior.

If the primary style is image-led, do not replace it with text-only layout. If you cannot
produce the needed image or graphic, preserve the slot with stable dimensions, aspect
ratio, caption/alt text, and a short art-direction note. Build simple diagrams, icons,
code windows, or geometric primitives only when they match the source style.

For substantial visual exploration, generated mockups, bitmap assets, or post-build visual
QA, follow [references/visual-workflow.md](references/visual-workflow.md).

### 2. Research Screens For Product Details

Use screens when you need to know what the interface should contain or how real products
solve a specific UI problem.

Good screen queries:

- pricing page annual monthly toggle
- feature comparison table
- dashboard empty state
- billing settings cancellation modal
- onboarding progress indicator
- 2FA setup recovery codes
- data table filters
- destructive action confirmation

Search by facts on the screen:

- page type
- component
- state
- company/product
- on-screen text

Avoid using screens as the primary style source when the task is visual. Use styles first,
then screens for structure and concrete details.

Extract from screens:

- layout structure
- information hierarchy
- component choices
- CTA patterns
- content/copy patterns
- states and edge cases
- trust or conversion tactics
- concrete details worth adapting

### 3. Research Flows For Journey Logic

Use flows when there are multiple steps or a user changes state over time.

Good flow queries:

- signup onboarding
- checkout with promo code
- subscription cancellation
- account deletion feedback
- password reset 2FA
- workspace billing upgrade

If flow search is sparse, broaden the query. If still sparse, use screens and reconstruct
the journey.

Extract from flows:

- entry point and exit state
- step count
- decisions the user makes
- friction reducers
- required confirmations
- save/recovery states
- error handling
- retention or persuasion moments
- system response at each step

## Research Depth

Match depth to task risk.

For a quick visual improvement:

- 2-3 style searches
- 2-3 full styles
- 1 short synthesis

For a new landing page, brand direction, or major redesign:

- 3-5 style searches
- 3-4 full styles in one batch; use additional batches only when needed
- screen research for concrete sections/components
- clear visual direction before implementation

For a product workflow:

- styles for visual language
- screens for key states/components
- flows for sequencing

For high-stakes or ambiguous tasks:

- search from several angles
- inspect later pages
- compare strong and unusual references
- document tradeoffs before designing

## Synthesis

Separate findings into three buckets.

### Visual Direction

From styles:

- mood
- typography
- palette
- density
- surfaces
- imagery
- distinctive details
- do/don't rules

Output example:

```text
Use a precise analytics SaaS foundation: white canvas, compact UI copy, restrained black
primary actions, thin borders, and product screenshots in framed panels. Borrow disciplined
accent use from another reference, but keep color rare.
```

### Product Pattern

From screens:

- what the interface needs to contain
- common layouts
- component patterns
- states
- copy and CTAs
- specific tactics

Output example:

```text
Pricing pages commonly put the billing toggle above plan cards, highlight one plan, and
move detailed feature comparison below. We should adapt the comparison structure but keep
the hero quieter because this product sells trust, not hype.
```

### Journey Logic

From flows:

- steps
- decision points
- system responses
- user confidence and friction
- success/failure states

Output example:

```text
Cancellation flows usually collect a reason, offer a relevant alternative, confirm the
destructive action, then state when access ends. The best flows give a clear return path.
```

## Delivery and Craft

Before presenting research, implementing the direction, or doing final visual QA, read
[delivery-and-craft.md](references/delivery-and-craft.md).

For UI labels, errors, empty states, confirmations, and recovery copy, read
[interface-copy.md](references/interface-copy.md).

For final tuning dials like clarify, distill, harden, onboard, bolder, quieter, and delight,
read [refinement-modes.md](references/refinement-modes.md).
