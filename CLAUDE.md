# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## USER CONTEXT

- Identify users by git credentials (commit author, GitHub account). Use their actual name, never "the user".
- Use "you/your" when speaking directly; use their name when discussing their work.

## PRE-ACTION PROTOCOL

**MANDATORY**: Review CLAUDE.md before any action. No exceptions.

- Before ANY structural refactor on a file >300 LOC: remove dead code/unused exports/imports first — commit separately
- Multi-file changes: break into phases (≤5 files each), verify each phase before the next
- Study existing code before building
- Work from raw error data, not theories — if a bug report has no error output, ask for it
- On "yes", "do it", or "go": execute immediately, no plan recap

## VERIFICATION PROTOCOL

1. Run the actual command — execute, don't assume
2. State what you verified, not just "looks good"
3. **FORBIDDEN**: Claiming "Done" when any test output shows failures
4. Run type-check/lint if configured; fix ALL errors before reporting done
5. Re-read every modified file; confirm nothing references removed items

## CONTEXT & EDIT SAFETY

- After 10+ messages: re-read files before editing
- Read files >500 LOC in chunks (offset/limit)
- Before every edit: re-read. After every edit: re-read to confirm
- When renaming: search direct calls, type refs, string literals, dynamic imports, re-exports, tests
- Tool results over 50K chars are silently truncated — narrow scope and re-run if incomplete
- For tasks touching >5 files: use sub-agents with worktree isolation
- Never fix a display/rendering problem by duplicating state

## JUDGMENT PROTOCOL

- If the user's request is based on a misconception, say so before executing
- If you spot a bug adjacent to what was asked, flag it: "I also noticed X — want me to fix it?"
- You are a collaborator, not just an executor
- Fix warnings when you find them (lint, type-check, build, runtime) — don't leave them for later

## SCOPE PROTOCOL

- Do not add features, refactor, or make improvements beyond what was asked
- Simplest approach first; flag architectural flaws and wait for approval
- When asked to "make a plan," output only the plan — no code until given the go-ahead

## COMPLETION PROTOCOL

- NEVER claim done at 80% — finish 100% before reporting
- Fix forward: if an approach fails, analyze why, adjust, rebuild — not `git checkout`
- After EVERY code change: build, test, verify, commit as a single atomic unit
- Reverting requires explicit user approval

## SELF-EVALUATION

- Present two views before calling done: what a perfectionist would reject vs. what a pragmatist would ship
- After fixing a bug: explain why it happened and what category of bug it represents
- If a fix fails twice: stop, re-read top-down, state where the mental model was wrong
- If asked to "step back": drop everything, rethink from scratch

## HOUSEKEEPING

- Offer to checkpoint before risky changes
- Flag files >400 LOC for potential splitting

## ABSOLUTE RULES

- **Fix ALL issues when asked** — never dismiss as "pre-existing"
- Never create files unless necessary; always prefer editing existing files
- Forbidden to create docs unless requested
- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** — use `pnpm exec <package>` or `pnpm run <script>`

## EVOLUTION

If user repeats instruction 2+ times, ask: "Should I add this to CLAUDE.md?"

## SHARED STANDARDS

- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` — NO AI attribution
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` variants
- Dependencies: After `package.json` edits, run `pnpm install`
- Backward Compatibility: 🚨 FORBIDDEN to maintain — actively remove when encountered
- Safe Deletion: Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)
- HTTP Requests: NEVER use `fetch()` — use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`
- File existence: ALWAYS `existsSync` from `node:fs`. NEVER `fs.access`, `fs.stat`-for-existence, or an async `fileExists` wrapper. Import: `import { existsSync, promises as fs } from 'node:fs'`.

### Documentation Policy

Do NOT litter the repo with markdown. Allowed: `docs/`, root `README.md`/`CHANGELOG.md`/`SECURITY.md`/`CLAUDE.md`, `packages/*/README.md`, `test/fixtures/*/README.md`, `test/*/README.md`.

**`.claude/` exception**: markdown under `.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, `.claude/skills/` is allowed (harness-loaded config). Ad-hoc analysis/session notes still disallowed.

---

## 🏗️ CLI-SPECIFIC

### Commands

- **Build**: `pnpm run build` (smart) | `--force` | `pnpm run build:cli` | `pnpm run build:sea`
- **Test**: `pnpm test` (monorepo root) | `pnpm --filter @socketsecurity/cli run test:unit <path>`
- **Lint**: `pnpm run lint` | **Type check**: `pnpm run type` | **Check all**: `pnpm run check`
- **Fix**: `pnpm run fix` | **Dev**: `pnpm dev` (watch) | **Run built**: `node packages/cli/dist/index.js <args>`

### Testing

- 🚨 **NEVER use `--` before test file paths** — runs ALL tests
- Always build before testing: `pnpm run build:cli`
- Update snapshots: `pnpm testu <path>` or `--update` flag
- NEVER write source-code-scanning tests — verify behavior, not string patterns

### Changelog

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). User-facing only: Added, Changed, Fixed, Removed. Concise.

### Code Style (MANDATORY)

- `.mts` extensions for TS modules
- 🚨 Separate `import type` statements — NEVER mix runtime and type imports
- Process spawning: MUST use `spawn` from `@socketsecurity/registry/lib/spawn` (NEVER `child_process`)
- Array destructuring: `{ 0: key, 1: data }` instead of `[key, data]`
- Dynamic imports: 🚨 FORBIDDEN — always static imports
- Sorting: 🚨 MANDATORY — lists, exports, destructured properties, doc headers alphabetically
- Comments: Default NO. Only when WHY is non-obvious. Own line, not inline.
- Functions: alphabetical; private first, exported second
- Object mappings: `__proto__: null` for static lookup; `Map` for dynamic
- Array length: `!array.length` not `=== 0`
- Catch: `catch (e)` not `catch (error)`
- Numbers: underscore separators (`20_000`); don't modify values inside strings
- Flags: MUST use `MeowFlags` type with descriptive help
- Error handling: `InputError`/`AuthError` from `src/utils/errors.mts`; prefer `CResult<T>`; avoid `process.exit(1)`
- GitHub API: Octokit from `src/utils/github.mts`, not raw fetch

### Command Pattern

- Simple (<200 LOC, no subcommands): single `cmd-*.mts`
- Complex: `cmd-*.mts` + `handle-*.mts` + `output-*.mts` + `fetch-*.mts`

## Codex Usage

Advice and critical assessment ONLY — never for making code changes. Consult before complex optimizations (>30min).

## Agents & Skills

- `/security-scan` — AgentShield + zizmor security audit
- `/quality-scan` — comprehensive code quality analysis
- `/quality-loop` — scan and fix iteratively
- `/sync-checksums` — sync external tool SHA-256 checksums
- Agents: `code-reviewer`, `security-reviewer`, `refactor-cleaner` (in `.claude/agents/`)
- Shared subskills in `.claude/skills/_shared/`
