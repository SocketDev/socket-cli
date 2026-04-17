# CLAUDE.md

**MANDATORY**: Act as principal-level engineer. Follow these guidelines exactly.

## USER CONTEXT

- Identify users by git credentials (commit author, GitHub account). Use their actual name, never "the user".
- Use "you/your" when speaking directly; use their name when discussing their work.

## PRE-ACTION PROTOCOL

**MANDATORY**: Review CLAUDE.md before any action. No exceptions.

- Before ANY structural refactor on a file >300 LOC: remove dead code, unused exports, unused imports first -- commit that cleanup separately
- Multi-file changes: break into phases (<=5 files each), verify each phase before the next
- When pointed to existing code as a reference: study it before building
- Work from raw error data, not theories -- if a bug report has no error output, ask for it
- On "yes", "do it", or "go": execute immediately, no plan recap

## VERIFICATION PROTOCOL

**MANDATORY**: Before claiming any task is complete:

1. Run the actual command -- execute the script, run the test, check the output
2. State what you verified, not just "looks good"
3. **FORBIDDEN**: Claiming "Done" when any test output shows failures
4. If type-check or lint is configured, run it and fix ALL errors before reporting done
5. Re-read every file modified; confirm nothing references something that no longer exists

## CONTEXT & EDIT SAFETY

- After 10+ messages: re-read any file before editing it
- Read files >500 LOC in chunks using offset/limit
- Before every edit: re-read the file. After every edit: re-read to confirm
- When renaming: search for direct calls, type references, string literals, dynamic imports, re-exports, test files -- one grep is not enough
- Never fix a display/rendering problem by duplicating state

## JUDGMENT & SCOPE

- If the request is based on a misconception, say so before executing
- If you spot a bug adjacent to what was asked, flag it
- Do not add features, refactor, or make improvements beyond what was asked
- Try the simplest approach first; flag architecture issues and wait for approval
- When asked to "make a plan," output only the plan -- no code until given the go-ahead

## SELF-EVALUATION

- Before calling anything done: present what a perfectionist would reject vs. what a pragmatist would ship
- After fixing a bug: explain why it happened and what category of bug it represents
- If a fix doesn't work after two attempts: stop, re-read top-down, state where the mental model was wrong
- If asked to "step back": drop everything, rethink from scratch

## HOUSEKEEPING

- Before risky changes: offer to checkpoint
- If a file is getting unwieldy (>400 LOC): flag it

## Critical Rules

- **Fix ALL issues when asked** -- never dismiss issues as "pre-existing"
- Never create files unless necessary; always prefer editing existing files
- Forbidden to create docs unless requested
- 🚨 **NEVER use `npx`, `pnpm dlx`, or `yarn dlx`** -- use `pnpm exec <package>` for devDep binaries, or `pnpm run <script>` for package.json scripts

## EVOLUTION

If user repeats instruction 2+ times, ask: "Should I add this to CLAUDE.md?"

## SHARED STANDARDS



- Commits: [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) `<type>(<scope>): <description>` -- NO AI attribution
- Scripts: Prefer `pnpm run foo --flag` over `foo:bar` scripts
- Dependencies: After `package.json` edits, run `pnpm install` to update `pnpm-lock.yaml`
- Backward Compatibility: 🚨 FORBIDDEN to maintain -- actively remove when encountered
- Safe Deletion: Use `safeDelete()` from `@socketsecurity/lib/fs` (NEVER `fs.rm/rmSync` or `rm -rf`)
- HTTP Requests: NEVER use `fetch()` -- use `httpJson`/`httpText`/`httpRequest` from `@socketsecurity/lib/http-request`

### Documentation Policy

Do NOT litter the repository with documentation files. Allowed locations: `docs/`, root `README.md`/`CHANGELOG.md`/`SECURITY.md`/`CLAUDE.md`, `packages/*/README.md`, `test/fixtures/*/README.md`, `test/*/README.md`. No ad-hoc markdown files.

**`.claude/` exception**: markdown files under `.claude/agents/`, `.claude/commands/`, `.claude/hooks/`, and `.claude/skills/` are allowed because the Claude harness reads them as configuration (agent definitions, command metadata, `SKILL.md` entrypoints, skill references). These are config, not analysis docs. Ad-hoc analysis/session notes in `.claude/` are still disallowed.

---

## CLI-SPECIFIC

## Commands

- **Build**: `pnpm run build` (smart build) | `pnpm run build --force` | `pnpm run build:cli` (CLI only) | `pnpm run build:sea`
- **Test**: `pnpm test` (all from monorepo root) | `pnpm --filter @socketsecurity/cli run test:unit`
- **Lint**: `pnpm run lint` | **Type check**: `pnpm run type` | **Check all**: `pnpm run check`
- **Fix**: `pnpm run fix` (auto-fix linting and formatting)
- **Dev**: `pnpm dev` (watch mode) | **Run built**: `node packages/cli/dist/index.js <args>`

### Testing -- CRITICAL

- 🚨 **NEVER USE `--` BEFORE TEST FILE PATHS** -- this runs ALL tests, not just specified files
- Always build before testing: `pnpm run build:cli`
- Single file: `pnpm --filter @socketsecurity/cli run test:unit src/commands/specific/cmd-file.test.mts`
- Update snapshots: `pnpm testu src/commands/specific/cmd-file.test.mts`
- Update with flag: `pnpm --filter @socketsecurity/cli run test:unit src/commands/specific/cmd-file.test.mts --update`
- NEVER write source-code-scanning tests -- verify behavior, not string patterns

### Changelog

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). User-facing changes only: Added, Changed, Fixed, Removed. Marketing voice, stay concise.

## Code Style (MANDATORY)

### File Organization

- `.mts` extensions for TypeScript modules
- 🚨 ALWAYS use separate `import type` statements -- NEVER mix runtime and type imports
- Node.js fs: `import { someSyncThing, promises as fs } from 'node:fs'`
- Process spawning: MUST use `spawn` from `@socketsecurity/registry/lib/spawn` (NEVER `child_process`)
- File existence: ALWAYS use `existsSync()` from `node:fs` (NEVER `fs.access`)

### Code Patterns

- Array destructuring: Use `{ 0: key, 1: data }` instead of `[key, data]`
- Dynamic imports: 🚨 FORBIDDEN -- always use static imports
- Sorting: 🚨 MANDATORY -- sort lists, exports, destructured properties, documentation headers alphabetically
- Comments: Default NO. Only when the WHY is non-obvious. Own line, not inline.
- Functions: Alphabetical order, private first, exported second
- Object mappings: Use `__proto__: null` for static lookup tables; `Map` for dynamic collections
- Array length: `!array.length` not `=== 0`; `array.length` or `!!array.length` for truthy
- Catch: `catch (e)` not `catch (error)`
- Numbers: Use underscore separators (`20_000`). Do NOT modify number values inside strings.
- Flags: MUST use `MeowFlags` type with descriptive help text
- Error handling: Use `InputError` and `AuthError` from `src/utils/errors.mts`; prefer `CResult<T>` for fallible functions; avoid `process.exit(1)`
- GitHub API: Use Octokit from `src/utils/github.mts`, not raw fetch

### Command Pattern

- Simple commands (<200 LOC, no subcommands): single `cmd-*.mts` file
- Complex commands: modular `cmd-*.mts` + `handle-*.mts` + `output-*.mts` + `fetch-*.mts`

### Completion Protocol

- NEVER claim done at 80% -- finish 100% before reporting
- Fix forward: if an approach fails, analyze why, adjust, rebuild -- not `git checkout`
- After EVERY code change: build, test, verify, commit as a single atomic unit
- Reverting requires explicit user approval

### Context Awareness

- Tool results over 50K characters are silently truncated -- narrow scope and re-run if results look incomplete
- For tasks touching >5 files: use sub-agents with worktree isolation

## Codex Usage

- Codex is for advice and critical assessment ONLY -- never for making code changes
- Before complex optimizations (>30min), consult Codex for critical analysis first

## Agents & Skills

- `/security-scan` -- AgentShield + zizmor security audit
- `/quality-scan` -- comprehensive code quality analysis
- `/quality-loop` -- scan and fix iteratively
- `/sync-checksums` -- sync external tool SHA-256 checksums
- Agents: `code-reviewer`, `security-reviewer`, `refactor-cleaner` (in `.claude/agents/`)
- Shared subskills in `.claude/skills/_shared/`
