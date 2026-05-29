# no-meta-comments-guard

`PreToolUse(Edit|Write)` hook. Blocks source-file edits that introduce a comment which either:

1. **References the current task / plan / user request** rather than the code's runtime semantics — e.g. `// Plan: use the cache here` / `// Task: rename foo to bar` / `// Per the task instructions, swap to async` / `// As requested, add retry`.

2. **Describes code that was removed** rather than code that exists — e.g. `// removed: old behavior used a Map here` / `// previously called X` / `// used to be sync, made async in 6.0`.

Per CLAUDE.md "Code style → Comments": comments default to none; when written, they explain the **constraint** or the **hidden invariant**, not the development context. Development context (the plan, the task, the user request, removed code) goes in commit messages and PR descriptions, not source comments.

## The comment is usually useful — it's the prefix that's noise

When the hook fires on a `Plan:` / `Task:` style comment, the suggested fix **strips the meta prefix and keeps the underlying explanation**:

```
Saw:     // Plan: use the cache to avoid re-resolving
Suggest: // Use the cache to avoid re-resolving
```

The agent gets to keep the useful "why" — drop the meta-label.

For removed-code references the suggestion is to delete entirely (the info lives in git history).

## File scope

Only matches source files: `.{m,c,}{j,t}sx?`, `.cc`, `.cpp`, `.h`, `.hpp`, `.rs`, `.go`, `.py`, `.sh`. Markdown / JSON / YAML aren't checked — those file types use `#` / `//` / `*` as legitimate body content, not as comment markers.

## Bypass

There's no canonical bypass phrase. The fix is to rewrite the comment per the suggestion. If you genuinely need the comment to read as-is (rare — usually means the explanation is missing important context), the hook can be temporarily disabled via `SOCKET_NO_META_COMMENTS_DISABLED=1` for the session.

## Source of truth

The rule itself lives in [`CLAUDE.md`](../../../CLAUDE.md) under "Code style → Comments". This hook enforces it at edit time.
