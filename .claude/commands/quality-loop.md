Run the `/quality-scan` skill and fix all issues found. Repeat until zero issues remain or 5 iterations complete.

**Interactive only** — this command makes code changes and commits. Do not use as an automated pipeline gate.

## Process

1. Run `/quality-scan` skill (all scan types)
2. If issues found: spawn the `refactor-cleaner` agent (see `agents/refactor-cleaner.md`) to fix them, grouped by category
3. Run verify-build (see `_shared/verify-build.md`) after fixes
4. Run `/quality-scan` again
5. Repeat until:
   - Zero issues found (success), OR
   - 5 iterations completed (stop)
6. Commit all fixes: `fix: resolve quality scan issues (iteration N)`

## Rules

- Fix every issue, not just easy ones
- Spawn refactor-cleaner with CLAUDE.md's pre-action protocol: dead code first, then structural changes, ≤5 files per phase
- Run tests after fixes to verify nothing broke
- Track iteration count and report progress
