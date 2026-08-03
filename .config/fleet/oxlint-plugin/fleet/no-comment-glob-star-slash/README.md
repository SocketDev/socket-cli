# socket/no-comment-glob-star-slash

Forbid a star-then-slash glob sequence inside a block comment.

## Why

oxfmt's jsdoc reflow rewrites comment prose. When a block comment contains a
glob like the escaped double-star-slash-star-dot-yml form, the reflow unescapes
it, leaving a star immediately before a slash — which is the comment-closing
token. The block ends early and the rest of the file becomes a parse error, and
oxfmt produces output it cannot itself re-parse (so `pnpm run fix` breaks the
file and the format gate becomes unsatisfiable).

No oxfmt sub-option preserves the escape, and even backtick-wrapping the whole
glob fails when the backticked text still contains a literal star-then-slash.

## Fix (autofix)

Split the glob on every star-then-slash boundary and backtick each side so no
literal star-then-slash survives. The autofix does this deterministically:

- `**`/`*.yml` becomes `` `**`/`*.yml` ``
- `**`/`Dockerfile*` becomes `` `**`/`Dockerfile*` ``

Line comments are exempt — they have no closing token to break.

## Severity

`error` (fleet-wide). Autofixable (`fixable: code`).
