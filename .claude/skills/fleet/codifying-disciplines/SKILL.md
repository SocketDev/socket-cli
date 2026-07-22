---
name: codifying-disciplines
description: Turn repo rules that live only in prose or memory into scripts, hooks, lint rules, or checks.
user-invocable: true
allowed-tools: Workflow, Task, Read, Grep, Glob, Write, AskUserQuestion, Bash(git status:*), Bash(git log:*), Bash(git diff:*), Bash(rg:*), Bash(grep:*), Bash(find:*), Bash(ls:*), Bash(cat:*), Bash(wc:*), Bash(head:*), Bash(tail:*), Bash(node scripts/fleet/ai-codify/cli.mts:*), Bash(node scripts/fleet/codify-rule.mts:*), Bash(node scripts/fleet/codify-scan/inventory.mts:*), Bash(node scripts/repo/run-hook-tests.mts:*), Bash(node scripts/fleet/check/:*), Bash(node scripts/repo/sync-scaffolding/cli.mts:*)
model: claude-opus-4-8
context: fork
---

# codifying-disciplines

Find the disciplines a repo *relies on but doesn't enforce*, and turn each into executable law. The premise: **agent memory is per-session and unreliable, and prose is read-when-convenient — neither enforces anything.** A rule only holds if a script, hook, or lint rule makes the wrong move fail (or at least nag) at the moment it happens. This skill scans for the gaps and codifies them.

Especially load-bearing for **builds and release steps**: "remember to rebuild the bundle before committing," "cascade the template after editing it," "run the floor sync after a version bump" — anything a human or agent has to remember is a latent failure. Code is law.

## When to run

Run after a session surfaces a recurring discipline, when onboarding a repo, or whenever "we keep having to remember X" comes up. The **`uncodified-lesson-nudge`** Stop hook is the automatic trigger: when a `feedback`/`project` memory lands with an enforceable shape and no enforcer citation, it nudges you here — that nudge is the cue to run this skill on that memory (pass it as the `--memory` source in Phase 5). Codifying is the second half of _Compound lessons_: the memory captures the *why*; this skill makes the *what* fail in code.

## Modes

- **Default (interactive)**: `AskUserQuestion` confirms scan scope and which proposed codifications to apply now vs. report-only.
- **Non-interactive**: `/codifying-disciplines non-interactive` (or `CODIFYING_DISCIPLINES_NONINTERACTIVE=1`, or absence of `AskUserQuestion` in the tool surface) scans all sources and produces a report with proposed codifications; applies nothing without confirmation. The four-flag programmatic-Claude lockdown strips `AskUserQuestion`, so headless runs default here automatically.

## What counts as an uncodified discipline

A behavior the repo depends on that has NO executable enforcer firing at the moment it's violated. Sources to scan:

1. **CLAUDE.md rules with no enforcer.** A `🚨` rule or invariant in the fleet/repo block that cites no `(`.claude/hooks/...`)`, no `socket/<rule>`, and no check script. The rule is policy-on-paper.
2. **Repeated review / PR / Bugbot feedback.** The same correction given twice across commits or PRs (`git log`, review threads) — per the _Compound lessons_ rule, that's a rule waiting to be written.
3. **Build / release steps relying on memory.** A step in a build/publish/cascade flow that a human must remember (rebuild-before-commit, cascade-after-template-edit, regenerate-after-rename, bump-then-tag order) with no hook/script gating it. Highest priority — these break silently.
4. **Conventions stated in docs but unchecked.** A `docs/` or README convention ("always do X", "never do Y", "files live at Z") with no validator.
5. **`@file` / comment contracts.** A source comment that asserts an invariant ("callers must…", "keep in lock-step with…") with no lock-step / check enforcing it.
6. **Auto-memory disciplines.** The Claude auto-memory (`<claude-project-dir>/memory/*.md`) is a rich record of what the user has taught across sessions — `feedback`/`project` entries describing "always do X" / "never do Y" / a build-or-release step. Mine it as a SOURCE of candidate disciplines: each enforceable rule there with no code enforcer is a codification candidate. The scanner reads memory READ-ONLY as discovery input — it never deletes or edits memory (that dir is machine-local, the user's, and stays put; memory and code coexist — memory captures the *why*, code enforces the *what*). The skill only proposes/creates the in-repo enforcer.

## Choosing the surface (the core decision)

The hard part isn't finding gaps — it's picking the RIGHT surface so the rule fires where the violation happens, with the least friction. Decide per gap by asking, in order:

1. **Is the violation visible in source text / AST, and is the right form deterministic?** → **Lint rule** (`.config/fleet/oxlint-plugin/fleet/<name>/index.mts` — each rule is its own dir, mirroring `.claude/hooks/`). Catches it for every file on every lint, in the editor + CI. Default `"error"` (never `"warn"`); ship an autofix (`fixable: 'code'`) when the rewrite is deterministic. Best for code-shape rules (naming, imports, API choice).
2. **Is the violation a TOOL ACTION — a Bash command, an Edit/Write — or an end-of-turn state?** → **Hook** (`.claude/hooks/fleet/<name>/`):
   - **`-guard` (PreToolUse, exit 2 = BLOCK)** when the action is dangerous/irreversible and should be STOPPED before it happens — a destructive git command, writing a secret, a forbidden edit. Pair with a bypass phrase for the rare legit case.
   - **`-nudge` (Stop or PreToolUse, exit 0 = NUDGE)** when you can't hard-block (state already exists at turn-end) or a block would be too blunt — a soft "you probably want to cascade now". Fires, never refuses.
   - One surface per concern: NEVER both a `-guard` and a `-nudge` for the same thing.
3. **Is it a repo-wide structural / state invariant best caught at commit/CI?** (drift, parity, file layout, a cross-file consistency rule) → **Check script** (`scripts/fleet/check/<name>.mts`, wired into `check --all`). Fails the gate; not per-file.
4. **Is the discipline "remember to run X"?** → **Build-step automation** (`scripts/…`): make the flow run X itself or gate on its output, so it can't be forgotten. Strictly better than a reminder when X can be invoked programmatically.
5. **Is it a multi-step PROCEDURE a human/agent runs (not a violation to catch)?** → **Skill** (`.claude/skills/fleet/<gerund>/SKILL.md`) + a **command** (`.claude/commands/fleet/<name>.md`) to invoke it. Use when the discipline is "here's how to do the multi-step thing right," not "here's a wrong move to block."
6. **CLAUDE.md rule + `agents.md` doc** — the human-readable statement. NECESSARY — a reader/agent needs the prose — but NOT sufficient alone: a CLAUDE.md rule with no enforcer from 1–5 is exactly the gap this skill flags. Always pair it with one of the above + its `(`.claude/hooks/…`)` or `socket/<rule>` citation. The CLAUDE.md entry is a TERSE one-line bullet under the 40KB whole-file + ≤8-line-per-section caps; all prose goes in a detail doc. Choose the doc scope by the discipline's reach: a **fleet-wide invariant** (applies to every socket-\* repo) → `template/docs/agents.md/fleet/<topic>.md` (cascades out); a **repo-specific** rule → `docs/agents.md/repo/<topic>.md` (this repo only). The `agents-doc` apply surface (Phase 5) routes both through `codify-rule.mts`, which keeps the bullet under the caps; never hand-edit CLAUDE.md for a rule line.

**Combinations are common and encouraged** (defense in depth): a code-shape rule often wants BOTH a lint rule (CI/editor) AND a CLAUDE.md line (the why) AND, for AI-generated code, an edit-time hook — having one doesn't excuse the others. A build step wants automation + a backstop reminder. Pick the combination that makes the wrong move fail at every point it could happen.

**Every codification you land is a future DRY-sweep input.** Before authoring a new hook, check whether its decision logic already lives in a `_shared/` helper (`payload.mts`, `transcript.mts`, `shell-command.mts`, …) — absorb the helper instead of copy-pasting. The `updating-hooks-dry` skill periodically sweeps the hook tree for copy-paste clusters + dead `_shared/` exports; the less it finds, the better you codified. Prefer the shared helper over a fresh copy at authoring time.

## Tests are mandatory — a codification without a test is not done

Every codification this skill produces ships with **thorough tests** (plural — multiple cases that exercise every branch), in the same change. One assertion proves nothing; a token "it blocks the bad thing" test that never checks the good thing passes through, the bypass, or the edge cases is NOT thorough and does not count. Cover, at minimum:

- **Both arms.** Every enforcer has a fires-case AND a does-not-fire case. A guard: a blocked input (exit 2) AND a clean input that passes (exit 0). A reminder: a flagged state AND a quiet state. A lint rule: `invalid` cases AND `valid` cases.
- **Every branch.** One case per distinct code path: each banned pattern/shape the rule matches, each allowlist exemption, each early-return. If the enforcer has five regexes, the test has ≥five firing cases plus the non-matches they must NOT catch.
- **The escape hatch.** The bypass phrase / disable path, asserted to actually let the action through.
- **Pass-through / non-applicability.** A wrong-tool, wrong-file-type, or out-of-scope input that the enforcer must ignore (a guard must not fire on unrelated Bash; a lint rule must not touch unrelated files).
- **Edge + adversarial inputs.** Empty/malformed payload (fail-open, not crash), var-indirection / quoting that could evade an AST-vs-regex check, the look-alike that should NOT match (`my-semver` vs `semver`), boundary values.

Per surface:

- **Lint rule** → `RuleTester` test at `.config/fleet/oxlint-plugin/fleet/<name>/test/<name>.test.mts` with a full `valid[]` + `invalid[]` matrix (every shape + every exemption), and an `output` assertion on each autofix case (assert the FIXED TEXT, not just `messageId` — the fleet has been bitten by autofix-corruption bugs that passed because tests only checked `messageId`). Confirm the plugin still loads (`oxlint-plugin-loads.mts`); a broken rule import silently disables ALL `socket/` rules.
- **Hook** → `test/index.test.mts` that spawns the hook as a subprocess across the full case set above: each blocked shape, each passing shape, the bypass phrase, a pass-through tool, and a malformed-payload fail-open. Assert exit code + message per case.
- **Check script** → drifted fixture → non-zero exit; clean fixture → zero; plus a fixture per distinct drift kind it detects.
- **Skill / command** → structural checks (`model:` tier on a mutating skill, citation resolves) + a dry-run of the happy path AND a degraded path (missing input, non-interactive).

The proposal is incomplete until the tests exist, cover every branch, and pass. Run them before committing.

## Process

### Phase 1: Validate environment

```bash
git status
git log --oneline -30
```

Read-only scan; warn about a dirty tree but continue.

### Phase 2: Inventory the enforcement surfaces

Build the ground-truth set the scanners compare against in one deterministic pass:

```bash
node scripts/fleet/codify-scan/inventory.mts
```

It emits `{ hooks: { guards, reminders, installers }, lintRules: { socket, typescript }, checks, scripts, fleetDocs }` — the authoritative enforcement surface (it wraps `lib/enforcer-inventory.mts`, the same owner the code-is-law gate reads, so the directory conventions live in one place). Pass this JSON as the Workflow `args` so every scanner agent compares proposals against the same set rather than re-running `ls`/`grep` by hand.

- **Auto-memory dir (read-only, best-effort)**: resolve the Claude project memory dir for source #6 — machine-local, OUTSIDE the repo. Find it via `CLAUDE_PROJECT_DIR`'s sibling memory path, or `find "$HOME/.claude/projects" -type d -name memory 2>/dev/null` matching this repo's slug. Read `memory/*.md` + `MEMORY.md` as discovery input only — never edit or delete them. If none is found (CI, fresh checkout, headless with no memory), skip source #6 silently; the repo-source scans always run.

### Phase 3: Determine scan scope

Interactive: `AskUserQuestion` (multiSelect) over the six sources above. Default: all. Non-interactive: all.

### Phase 4: Execute the scan (Workflow)

Run as a **`Workflow`** (sanctioned opt-in; pass the enabled-source list + the enforcement inventory as `args`):

1. **`phase('Scan')` — parallel scanners**, one `agent()` per enabled source (`agentType: 'Explore'`, read-only), each returning a `GAPS_SCHEMA`:
   `{ source, gaps: [{ discipline, evidence (file:line / commit / PR), blastRadius: build|security|correctness|style, currentSurface: prose|memory|comment|none, hasEnforcer: false }] }`.
2. **Barrier → dedup** by discipline text; merge gaps describing the same rule from different sources — a CLAUDE.md rule that's also repeated PR feedback is one gap, ranked higher.
3. **`phase('Propose')` — one `agent()` per deduped gap** that designs the codification: picks the surface per the _Choosing the surface_ decision steps above (and a COMBINATION where defense-in-depth fits), names the original incident (per _Compound lessons_), and emits a concrete diff / new-file skeleton PLUS the matching test. Schema: `{ discipline, surface, combination, rationale, incident, diff, testDiff, citation }`. `testDiff` is required: a codification with no test is incomplete; `combination` lists any companion surfaces (e.g. lint rule + CLAUDE.md line + edit-time hook).
4. **`phase('Verify')` — adversarial pass**: per proposal, a skeptic checks (a) an enforcer doesn't ALREADY exist (no duplicate `-guard`/`-nudge` overlap; no existing `socket/<rule>`), (b) the surface choice is right per the decision steps (a Bash-action discipline shouldn't be a lint rule; a procedure shouldn't be a guard), (c) the diff is sound AND `testDiff` is THOROUGH per the _Tests_ section — both arms, every branch/shape, the bypass, pass-through, and a malformed/edge input; not a token single-case test. The skeptic actively tries to find an input the enforcer mishandles that the tests don't cover, and demands a case for it. Drop proposals that duplicate existing enforcement or whose tests aren't thorough.
5. **Synthesize** — a final `agent()` writes the report: ranked by blast radius (build/security first), each gap with its evidence, chosen surface, and ready-to-apply codification.

Return `{ report, gapCount, byBlastRadius, proposals }`.

### Phase 5: Apply or report

- **Interactive**: `AskUserQuestion` — which proposals to apply now. Route each applied proposal through the **`ai-codify` orchestrator** rather than hand-authoring — it pins model + effort to the surface (token-spend rule) and enforces the four-flag programmatic-Claude lockdown:
  - **Enforcer surfaces** (`hook-guard` / `hook-nudge` / `lint-rule` / `check`): `node scripts/fleet/ai-codify/cli.mts --surface <surface> --discipline "<rule>" --incident "<generic case>" [--memory <path>] [--name <kebab>] --apply`. It authors the surface + its mandatory test on the tier-matched model (hook/lint → opus/high, check → sonnet/medium) and runs the surface's own verifier before returning.
  - **Documentation surface** (`agents-doc` — the terse CLAUDE.md bullet + `docs/agents.md/{fleet,repo}/<topic>.md` detail doc): pass `--surface agents-doc --memory <path>`; ai-codify shells out to `scripts/fleet/codify-rule.mts`, which owns the 40KB CLAUDE.md budget + defer-to-docs split (never hand-edit CLAUDE.md for a rule bullet).
  - For a **combination** (defense-in-depth), run ai-codify once per surface.
  After ai-codify returns: RUN the test before committing — a codification whose test doesn't pass isn't done. A hook + a CLAUDE.md edit both trigger the **same-turn dogfood cascade** in the wheelhouse. Commit each codification (enforcer + test together) separately. Memory is read-only input — never delete or edit it; it can keep describing the *why* alongside the now-enforcing code.
- **Non-interactive**: save the report to `.claude/reports/codifying-disciplines-YYYY-MM-DD.md`, the untracked report location per the _Plan & report storage_ rule — never a committable `reports/` path (each proposal includes its `testDiff` + the exact `ai-codify` invocation that would apply it); apply nothing.

### Phase 6: Summary

Report gaps found, by blast radius; proposals applied vs. deferred; and any gap where the right surface is genuinely ambiguous (flag for a human call rather than guessing).

## Commit cadence

- Codify the highest-blast-radius gaps (build/release/security) first.
- Each codification is its own commit (`feat(hooks): …`, `fix(lint): …`, `feat(scripts): …`), and the enforcer + its test land in that SAME commit — never an enforcer without its test. Never bundle several unrelated enforcers in one commit.
- A new hook follows the full ceremony: CLAUDE.md (or hook-registry) citation BEFORE the index, a test, settings.json registration, and the dogfood cascade.
- The report at `.claude/reports/` is never committed — the report location is untracked by the fleet `.gitignore`; it's a local reference for which gaps to codify, not an artifact.
