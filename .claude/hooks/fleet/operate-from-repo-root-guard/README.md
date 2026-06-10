# operate-from-repo-root-guard

**Type:** PreToolUse guard (Bash) — BLOCKS.

**Trigger:** a Bash command line with a `cd <subpackage>` segment
immediately followed by a `pnpm` / `npm` / `yarn` segment — e.g.
`cd packages/foo && pnpm test`.

**Why:** in a pnpm workspace, running a package manager from a
subpackage runs against that package's local resolution (missing
workspace-root config, hoisted bins, the lockfile's graph view) and
parks the persistent Bash cwd in the subpackage for every later command.
Target one project from the root instead:

```bash
pnpm --filter <pkg> <script>
```

**Deliberately narrow** so it doesn't fight legitimate `cd`:
- Only fires on `cd <subpackage>` *immediately chained* to a package
  manager. A bare `cd` (cwd drift) is `avoid-cd-reminder`'s concern.
- Skips targets that aren't a subpackage of this repo: worktrees
  (`…worktree…`), absolute paths, `~`, `-` (cd back), `$VAR`, and
  `../sibling` escapes.

**Bypass:** `Allow repo-root bypass` (typed verbatim in a recent turn).
