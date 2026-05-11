# Skill authoring patterns

Conventions every fleet skill follows. Reference from new-skill scaffolds and from auditor agents.

## Modular structure

A skill's `SKILL.md` is the **orchestrator**, not the encyclopedia. When a skill grows past ~300 lines or covers more than one phase / tool / domain, push the depth into siblings:

```
.claude/skills/
├── _shared/
│   ├── <topic>.md          # shared prose loaded on demand by multiple skills
│   └── scripts/
│       └── <helper>.mts    # shared TS helpers used by per-skill run.mts files
└── my-skill/
    ├── SKILL.md            # ≤ 300 lines, table of contents + decision flow
    ├── reference.md        # long-form prose Claude reads (single file, growable to a dir)
    ├── scans/<type>.md     # one file per scan type / phase / tool (when many)
    ├── templates/          # file scaffolding copied verbatim by install/setup modes
    │   └── <name>.tmpl
    └── run.mts             # skill-specific executable runner
```

Two naming conventions are load-bearing:

- **`lib/` vs `scripts/`** matches the fleet's public-vs-private convention. `lib/` names a public, importable, stable surface (think `@socketsecurity/lib`); `scripts/` names private, internal automation that's not consumed outside the host repo. Skill helpers under `_shared/scripts/` are internal automation — no external consumers — so `scripts/` is the right name. (No `_shared/lib/` exists in this tree.)
- **`reference.md` vs `reference/`** — single file by default; grow to a directory only when a skill genuinely has multiple distinct reference docs. Don't preemptively wrap a single doc in a dir.
- **`templates/`** is reserved for file scaffolding (`.tmpl` files copied verbatim by `install` / `setup` modes). Don't mix templates into `reference/` — readers can't tell prose from scaffolding by directory name alone.

The same File-size rule from CLAUDE.md applies — soft cap 500, hard cap 1000 — but for skills the trigger is usually **shape**, not lines: as soon as the SKILL.md is "this and also that and also the other thing," extract.

What goes where:

| Path | Purpose |
|---|---|
| `<skill>/SKILL.md` | Orchestrator: when to use, modes, phase list, links to deeper files. Reads top-to-bottom in one screen. |
| `<skill>/reference.md` | Long-form depth: bash blocks, full validation rules, sample outputs, recovery procedures. Loaded by the orchestrator when a phase needs it. |
| `<skill>/scans/`, `phases/`, `tools/` | One file per discrete unit when the skill enumerates many (e.g., `scanning-quality/scans/<type>.md`). Adding a new unit = one new file, no SKILL.md touch. |
| `<skill>/templates/<name>.tmpl` | File scaffolding (`.tmpl` files copied verbatim by `install` / `setup` modes — gate scripts, allowlist starters, etc.). Distinct from `reference.md` which is prose, not scaffolding. |
| `<skill>/run.mts` | Skill-specific executable runner. Inline prompts so prompts and code can't drift. Per CLAUDE.md _Tooling — Runners are `.mts`, not `.sh`_. |
| `_shared/<topic>.md` | Shared **prose** (variant-analysis discipline, compound-lessons workflow, multi-agent backends). Cross-skill load surface. |
| `_shared/scripts/<helper>.mts` | Shared **TypeScript** helpers imported by per-skill `run.mts` (default-branch resolution, report formatting, spawn wrappers). Internal automation — not a public library, hence `scripts/` not `lib/`. Use `@socketsecurity/lib/spawn` for subprocesses, never raw `node:child_process`. |

## Auditor agents

Skills that author other artifacts (skills, hooks, slash commands, subagents) should ship an auditor sibling. The pattern:

1. The authoring skill emits a draft.
2. An auditor agent (separate prompt, narrower tool surface) reviews against a checklist.
3. The authoring skill applies the auditor's feedback before shipping.

Three audit dimensions per artifact:

| Artifact | Auditor checks |
|---|---|
| Skill | frontmatter complete, when-to-use unambiguous, tool surface minimal, no buried opinions |
| Hook | matcher tight, command exits fast, doesn't depend on session state, can't deadlock |
| Slash command | argument shape clear, idempotent, doesn't touch shared state without confirmation |
| Subagent | prompt self-contained (no "based on the conversation"), tool surface matches the task, return shape documented |

A fleet skill that does this well is the canonical reference; the auditor is a `Task` agent spawned by the authoring skill, not a long-running daemon.

## Compound-lessons capture

When a fleet skill discovers a recurring failure mode — a lint rule that catches the same kind of bug, a hook that blocks the same antipattern, a review pass that flags the same regression — codify it once:

1. Open a follow-up to add the rule to CLAUDE.md, the hook, or the skill prompt.
2. Reference the original incident (commit, PR, finding ID) in a one-line `**Why:**` so future readers know the rule is load-bearing.
3. Resist the urge to write a full retrospective doc — the fleet rule **is** the retrospective.

This is the fleet's equivalent of a post-mortem: every recurring bug becomes a rule, every rule earns its place by closing a class of bugs. The principle is _compound engineering_: each unit of work makes the next unit easier.

## When to NOT extract

- One-off skill (≤ 100 lines, single phase, single tool) — keep it monolithic.
- Code unique to one repo that can't be shared — keep it in that repo's `unique` skill.
- Prompt that's tightly coupled to its caller — inline, don't split.

The principle: **a reader should be able to predict what's in a skill from its name, and find what they need without scrolling past three other concerns.** Same as the File-size rule, applied to skills.

## Frontmatter requirements (from upstream)

The Anthropic docs codify several rules; honor them:

- `name`: ≤ 64 chars, lowercase letters / numbers / hyphens only. No `anthropic` / `claude` substring.
- `description`: ≤ 1024 chars, third-person voice (`"Manages X"`, not `"I help with X"` or `"You can use this to X"`). Include both **what** and **when to use**.
- Prefer **gerund form** for the name (`processing-pdfs`, `scanning-quality`); noun-phrase (`pdf-processing`) and verb-imperative (`process-pdfs`) are acceptable alternatives, but pick one and be consistent across the fleet.
- Use forward slashes in any path the skill references — never backslashes, even in docs that target Windows users.

## Fleet repo references

When scaffolding a new fleet repo, or when a sync question arises ("how does the fleet do X?"), mimic the reference that matches both axes (`layout` + `native`) in `.config/socket-wheelhouse.json`:

| layout × native | Best reference | Notes |
|---|---|---|
| `single-package` × `none` | **`socket-packageurl-js`** or **`socket-sdk-js`** | Clean `pnpm-workspace.yaml`, canonical `scripts/{check,fix,clean,cover,security,update,lockstep,build}.mts`, simple `lockstep.json` with empty `rows`. |
| `monorepo` × `producer` | **`socket-btm`** | 10+ packages (`build-infra`, per-tool-builder workspaces), deep `pnpm --filter` patterns, full `packages: [packages/*, .claude/hooks/*]`, richer catalog, lockstep + submodules + native release matrix. The canonical "monorepo done right" reference. |
| `monorepo` × `consumer` | **`socket-cli`** | 3-package layout (`build-infra`, `cli`, `package-builder`); consumes prebuilts from socket-btm. |
| `monorepo` × `none` | `socket-registry` | Mono npm publish path, no native artifacts via the fleet's release-checksums infra. |
| `monorepo` × `none` + lang-parity | `ultrathink` | Per-language ports tracked entirely in `lockstep.json` `lang-parity` rows, not via release-checksums. Each port has its own build matrix. |
| Library with vendored upstreams | `socket-lib` | Shows `packages: [.claude/hooks/*, tools/*, vendor/*]`, vendored-as-workspace pattern. |
| Skill marketplace / no real build graph | `skills` | Dep-free shims for `clean.mts` / `cover.mts` are acceptable; document the deviation in the script's header. |

**Don't cross axes when picking a reference.** A `single-package` × `none` repo (`socket-lib`) and a `monorepo` × `consumer` repo (`socket-cli`) ship very different `scripts/*.mts` shapes — `socket-cli`'s scripts assume `packages/` and `pnpm --filter`, which break in a single-package repo. Match both axes.

## Build-tool decision

The fleet standardizes on the **VoidZero tool suite** for JavaScript/TypeScript tooling. VoidZero (https://voidzero.dev) maintains the unified upstream stack we adopt component-by-component:

| Layer | Tool | Status in the fleet |
|---|---|---|
| Test runner | **Vitest** | ✓ Adopted fleet-wide (catalog-pinned). |
| Linter | **Oxlint** (Oxc) | ✓ Adopted fleet-wide. |
| Formatter | **Oxfmt** (Oxc) | ✓ Adopted fleet-wide. |
| Bundler (libraries) | **esbuild** today; **Rolldown** under evaluation | Migration tracked separately; pilot in socket-packageurl-js. |
| Dev server / app build | **Vite** | Used implicitly via Vitest; not directly invoked by the fleet's library repos. |
| Unified CLI / monorepo orchestrator | **Vite+** | **Not adopted.** Alpha-stage; revenue-via-enterprise-support trajectory; no concrete pain point our existing `pnpm run *` orchestration doesn't already solve. Reconsider when (a) Vite+ ships 1.0 stable, AND (b) we have a problem it solves better than current scaffolding. |

**Why component-by-component, not the bundle.** Each VoidZero component matures independently. Adopting individually mature components (Vitest 4.x, Oxlint 1.5x, Oxfmt 0.37+, Rolldown 1.0+) lets the fleet move at the pace of the slowest part — not at the pace of the whole bundle. Adopting Vite+ would couple the fleet to whichever component is least mature at any given time.

**Rolldown vs esbuild.** Rolldown 1.0 (May 2026) ships with Rollup-API compatibility + esbuild-equivalent perf + better chunking control. For library repos that publish CommonJS-and-ESM dual entry (socket-lib, socket-sdk-js, socket-packageurl-js), the chunking-control win matters when output size matters; esbuild's simpler model still wins on tiny single-entry bundles. Pilot in socket-packageurl-js (most complex single-package repo): if rolldown works there, the rest of the fleet follows.

**General rule for fleet-wide tool adoption**, regardless of vendor:

- **Stable** (1.0+, not alpha / beta / RC).
- **License clarity** with no recent shifts (or, if shifted, settled for ≥6 months).
- **Concrete pain point** the new tool solves better than the current setup. Hype isn't a pain point. "Same vendor as our current toolchain" isn't a pain point.

### Inspiration to borrow from Vite+

We don't adopt Vite+ as a runtime dependency, but its **resolver pattern** is worth absorbing. Vite+ separates "where does this tool's binary live?" from "how do I dispatch the command?" via small per-tool resolver functions:

```ts
// vite-plus/packages/cli/src/resolve-test.ts
export async function test(): Promise<{ binPath: string; envs: Record<string, string> }> {
  const binPath = join(dirname(resolve('@voidzero-dev/vite-plus-test')), 'dist', 'cli.js')
  return { binPath, envs: { ...DEFAULT_ENVS } }
}
```

The Rust dispatcher then execs `binPath` with the user's args. Swapping the tool = changing one resolver; the dispatcher doesn't care.

**Why the fleet should borrow this:** today every fleet repo carries 200–450-line `scripts/check.mts` / `scripts/fix.mts` / `scripts/test.mts` files that duplicate "find the tool binary, build the right args, exec it." Real drift surface — the same logic written 12 times rarely stays in sync.

**Implemented:** `_shared/scripts/resolve-tools.mts` (fleet-shared, byte-identical) exports `resolveLinter()` / `resolveFormatter()` / `resolveTypeChecker()` / `resolveTestRunner()` / `resolveBundler()` — each returning `{ args, envs }` where `args` is the full `pnpm exec` argv (tool name first) and `envs` is the env-var overrides. A `runResolved()` convenience runs the resolved tool and returns `{ exitCode, stdout, stderr }`.

```ts
// Caller (per-repo scripts/check.mts):
import { resolveLinter, runResolved } from '../.claude/skills/_shared/scripts/resolve-tools.mts'
const result = await runResolved(resolveLinter({ mode: 'check' }), { cwd })
```

The resolver gives us a clean migration path: when rolldown goes fleet-wide, we change `resolveBundler()` to return `['rolldown']` instead of `['esbuild']` — every per-repo `scripts/build.mts` that consults the resolver picks up the swap. Per-repo migration to consume the resolver lands repo-by-repo so we don't bundle bundler-swap risk into a 12-repo cascade.

## References

Authoritative upstream docs — keep these as the source of truth, mirror their guidance here only when fleet specifics demand it:

- [Anthropic — Skill authoring best practices](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/best-practices) — frontmatter rules, progressive disclosure, evaluation-driven development.
- [Anthropic — Claude Code best practices: writing an effective CLAUDE.md](https://code.claude.com/docs/en/best-practices#write-an-effective-claude-md) — CLAUDE.md scope, pruning discipline, when to push knowledge into a skill instead.
- [Anthropic — Prompt engineering best practices](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/claude-prompting-best-practices) — model-tuning, response-length calibration, examples-over-descriptions.

Real-world plugin reference (not fleet-canonical, useful as a worked example of skills + hooks + templates working together): [`arscontexta`](https://github.com/agenticnotetaking/arscontexta) — knowledge-system plugin that derives skills/hooks/templates from a conversational setup. Useful as a study of the "skills compose into a system" pattern.
